using System.Text.RegularExpressions;

namespace KubeSpoke.Agent.Services
{
    /// <summary>解析后的镜像地址：仓库地址 / 仓库路径 / tag / digest</summary>
    public record ImageRef(string Registry, string Repository, string Tag, string Digest);

    /// <summary>401 里 Www-Authenticate: Bearer 的三段参数</summary>
    public record BearerChallenge(string Realm, string Service, string Scope);

    /// <summary>
    /// 镜像地址与 tag 的纯文本处理。单独拎出来是因为这里没有一行需要碰集群或网络，
    /// 而 docker hub 简写、v 前缀、3.10 与 3.9 谁新这些坑，值得在单测里钉死。
    /// </summary>
    public static class ImageReference
    {
        const string DockerHub = "docker.io";
        const string DockerHubApi = "registry-1.docker.io";

        /// <summary>
        /// 不代表版本先后的浮动 tag，倒序时一律沉底，别让人以为 latest 是最新版。
        /// 次序就是下面数组的下标，越靠前越像「当前用的那个」。
        /// </summary>
        static readonly string[] Floating =
        [
            "latest", "stable", "edge", "canary", "dev", "develop", "main", "master", "testing", "nightly", "snapshot"
        ];

        public static ImageRef Parse(string image)
        {
            if (string.IsNullOrWhiteSpace(image)) throw new ArgumentException("镜像地址为空");
            var text = image.Trim();

            var digest = "";
            var at = text.IndexOf('@');
            if (at >= 0)
            {
                digest = text[(at + 1)..];
                text = text[..at];
            }

            // 第一段带点、带端口、或就是 localhost 才是仓库地址，否则整串都是仓库路径（docker hub 简写）
            var registry = DockerHub;
            var slash = text.IndexOf('/');
            if (slash > 0)
            {
                var first = text[..slash];
                if (first.Contains('.') || first.Contains(':') || first.Equals("localhost", StringComparison.OrdinalIgnoreCase))
                {
                    registry = first;
                    text = text[(slash + 1)..];
                }
            }

            var tag = "";
            var colon = text.LastIndexOf(':');
            if (colon > 0)
            {
                tag = text[(colon + 1)..];
                text = text[..colon];
            }

            if (registry == DockerHub && !text.Contains('/')) text = "library/" + text;
            if (text.Length == 0) throw new ArgumentException($"镜像地址里没有仓库路径：{image}");

            return new ImageRef(registry, text, tag, digest);
        }

        /// <summary>真正收 /v2/ 请求的地址：docker.io 的 tag 接口在 registry-1 上</summary>
        public static string ApiHost(ImageRef r) => r.Registry == DockerHub ? DockerHubApi : r.Registry;

        /// <summary>
        /// 换 tag 拼回镜像全名。digest 地址不保留——它一旦写死 sha256，换 tag 就自相矛盾了，
        /// 调用方应在下拉前就按 <see cref="ImageRef.Digest"/> 拦掉。
        /// </summary>
        public static string WithTag(ImageRef r, string tag)
        {
            var repo = $"{r.Registry}/{r.Repository}";
            return tag.Length == 0 ? repo : $"{repo}:{tag}";
        }

        /// <summary>倒序排好的 tag 清单</summary>
        public static List<string> SortDesc(IEnumerable<string> tags) =>
            tags.Where(t => !string.IsNullOrWhiteSpace(t))
                .Distinct(StringComparer.Ordinal)
                .OrderBy(t => t, Comparer<string>.Create(CompareTagDesc))
                .ToList();

        /// <summary>
        /// 版本号倒序：数字段按数值比（3.10 在 3.9 前面），字母段按字典序倒排，
        /// v 前缀不参与比较（v1.2.0 与 1.2.0 等价），同前缀时正版排在变体之上（3.0 在 3.0.arm64 之前），
        /// 浮动 tag 一律沉底。
        /// </summary>
        public static int CompareTagDesc(string a, string b)
        {
            var rank = FloatingRank(a).CompareTo(FloatingRank(b));
            if (rank != 0) return rank;

            var c = CompareVersionDesc(TrimV(a), TrimV(b));
            if (c != 0) return c;
            // 版本号相等（v3.9 与 3.9）时按原样倒序，保证结果稳定，不随枚举顺序抖
            return string.CompareOrdinal(b, a);
        }

        /// <summary>非浮动 tag 一律 -1，排在所有浮动 tag 前面</summary>
        static int FloatingRank(string tag) => Array.FindIndex(Floating, f => f.Equals(tag, StringComparison.OrdinalIgnoreCase));

        static string TrimV(string tag) =>
            tag.Length > 1 && (tag[0] == 'v' || tag[0] == 'V') && char.IsDigit(tag[1]) ? tag[1..] : tag;

        static int CompareVersionDesc(string a, string b)
        {
            int i = 0, j = 0;
            while (i < a.Length && j < b.Length)
            {
                int c;
                if (char.IsDigit(a[i]) && char.IsDigit(b[j]))
                {
                    var x = ReadDigits(a, ref i);
                    var y = ReadDigits(b, ref j);
                    c = x.Length != y.Length ? x.Length.CompareTo(y.Length) : string.CompareOrdinal(x, y);
                }
                else
                {
                    c = a[i].CompareTo(b[j]);
                    i++;
                    j++;
                }
                if (c != 0) return -c;
            }

            // 走到这儿说明一个是另一个的前缀：短的（3.0）是正版，倒序里排前面。
            // 比较器是喂给 OrderBy 的，负数代表 a 在前，所以谁先走完谁在前。
            return (a.Length - i).CompareTo(b.Length - j);
        }

        /// <summary>读走一段数字，去掉前导零再返回，好按数值长度比大小</summary>
        static string ReadDigits(string s, ref int i)
        {
            var start = i;
            while (i < s.Length && char.IsDigit(s[i])) i++;
            return s[start..i].TrimStart('0');
        }

        public static BearerChallenge? ParseBearer(string? header)
        {
            if (string.IsNullOrWhiteSpace(header)) return null;
            if (!header.StartsWith("Bearer", StringComparison.OrdinalIgnoreCase)) return null;
            var realm = Param(header, "realm");
            if (realm == null) return null;
            return new BearerChallenge(realm, Param(header, "service") ?? "", Param(header, "scope") ?? "");
        }

        /// <summary>取 Link: &lt;...&gt;; rel="next" 里的地址；registry 分页给的是相对路径居多</summary>
        public static string? ParseNextLink(string? link)
        {
            if (string.IsNullOrWhiteSpace(link)) return null;
            foreach (var part in link.Split(','))
            {
                var seg = part.Split(';', 2);
                if (seg.Length < 2 || !seg[1].Contains("next", StringComparison.OrdinalIgnoreCase)) continue;
                var m = Regex.Match(seg[0], "<([^>]+)>");
                if (m.Success) return m.Groups[1].Value;
            }
            return null;
        }

        static string? Param(string header, string name)
        {
            var m = Regex.Match(header, $@"{name}=""([^""]*)""", RegexOptions.IgnoreCase);
            return m.Success ? m.Groups[1].Value : null;
        }
    }
}
