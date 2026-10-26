using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using k8s;
using k8s.Models;
using KubeSpoke.Agent.Services;
using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Contracts.Extensions;
using KubeSpoke.Contracts.Models;
using Microsoft.Extensions.Logging;

namespace KubeSpoke.Agent.Apis
{
    /// <summary>
    /// 镜像仓库的 tag 清单：走各仓库都实现的 registry v2 接口（GET /v2/&lt;repo&gt;/tags/list），
    /// 阿里云 ACR 个人版与企业版、Harbor、Docker Hub 都是同一套 401 → 换 token → 重发。
    /// <para>
    /// 不调阿里云 OpenAPI 是刻意的：OpenAPI 要么得存一对常驻 AK/SK，要么只服务企业版实例，
    /// 而 v2 这条路能直接复用集群里已有的 imagePullSecrets——运维为了让 Pod 拉到镜像本来就得配，
    /// 我们不再往库里塞第二份第三方凭证。代价是 v2 不返回推送时间，所以「最近版本」只能按版本号倒序，
    /// 真实推送时间得逐个 tag 拉 manifest 与 config blob（3 次请求一个 tag），不值当。
    /// </para>
    /// <para>
    /// 与其它 RPC 一样是同步返回：派发是反射调用方法本身，不会 await，里面直接
    /// GetAwaiter().GetResult()，等待窗口由接口上的 [MaxWaitSec] 在服务端放宽。
    /// </para>
    /// </summary>
    public partial class AgentApiImpl
    {
        /// <summary>
        /// 列 tag 是界面上点开下拉就等结果的操作，单次请求给 10s 足够；翻 5 页封顶，
        /// 每页 200 个 tag，再多也只会让下拉长得没法用。
        /// </summary>
        const int RegistryTimeoutSec = 10;
        const int MaxTagPages = 5;
        const int MaxTagsPerPage = 200;

        // agent 是要跑几个月的进程，client 常驻复用；每次 new 会把用完的 socket 一直攒着。
        // 这里只走严格 TLS：证书不合法的仓库宁可报错，也不为了顺手把所有仓库都变成不校验。
        static readonly HttpClient RegistryHttp = new() { Timeout = TimeSpan.FromSeconds(RegistryTimeoutSec) };

        public ImageTags ListImageTags(ListImageTagsRequest request)
        {
            var res = new ImageTags();

            ImageRef r;
            try
            {
                r = ImageReference.Parse(request.Image);
            }
            catch (Exception ex)
            {
                res.Notice = ex.Message;
                return res;
            }

            res.Registry = ImageReference.ApiHost(r);
            res.Repository = r.Repository;

            if (r.Digest.Length > 0)
            {
                res.Notice = "镜像按 digest 固定（@sha256:…），没有可切换的 tag";
                return res;
            }

            var ns = string.IsNullOrWhiteSpace(request.Namespace) ? "default" : request.Namespace;
            try
            {
                var (basic, source) = FindPullCredential(ns, res.Registry);
                res.Credential = source;

                var tags = ListTags(res.Registry, r.Repository, basic).GetAwaiter().GetResult();
                res.Tags = ImageReference.SortDesc(tags);

                if (res.Tags.Count == 0)
                {
                    res.Notice = source == "anonymous"
                        ? "仓库没返回 tag：可能是私有仓库且这个命名空间里没有匹配的 imagePullSecret"
                        : "仓库里没有 tag";
                }
                else if (tags.Count >= MaxTagPages * MaxTagsPerPage)
                {
                    res.Notice = $"tag 太多，只列了前 {res.Tags.Count} 个";
                }
            }
            catch (Exception ex)
            {
                // 这里把异常吞成 Notice 后正常返回，所以 SignalRConnection 的 RPC catch 永远不会触发，
                // agent 日志里也就一条 error 都没有——列 tag 失败在 agent 侧彻底静默。补这条 warn 让它至少留痕。
                res.Tags.Clear();
                res.Notice = ex.Message;
                logger.LogWarning(ex, "[ListImageTags] 列 {Registry}/{Repository} 的 tag 失败（凭证 {Credential}）",
                    res.Registry, res.Repository, res.Credential);
            }
            return res;
        }

        async Task<List<string>> ListTags(string registry, string repo, string? basicAuth)
        {
            var baseUrl = new Uri($"https://{registry}/v2/{repo}/tags/list");
            var url = new Uri($"{baseUrl}?n={MaxTagsPerPage}");
            var tags = new List<string>();

            for (var page = 0; page < MaxTagPages; page++)
            {
                var resp = await SendAsync(url, basicAuth, bearer: null);
                if (resp.StatusCode == HttpStatusCode.Unauthorized)
                {
                    var challenge = ImageReference.ParseBearer(resp.Headers.WwwAuthenticate.ToString());
                    if (challenge == null)
                    {
                        throw new Exception(basicAuth == null
                            ? $"仓库 {registry} 要求登录，而命名空间里没有匹配的 imagePullSecret"
                            : $"仓库 {registry} 拒绝了这个凭证（401）");
                    }
                    var token = await FetchToken(challenge, basicAuth);
                    resp = await SendAsync(url, basicAuth, token);
                    if (resp.StatusCode == HttpStatusCode.Unauthorized)
                    {
                        throw new Exception($"仓库 {registry} 拒绝了这个凭证（401），检查 imagePullSecret 是否还有效");
                    }
                }
                resp.EnsureSuccessStatusCode();

                var body = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
                if (body.RootElement.TryGetProperty("tags", out var arr) && arr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var t in arr.EnumerateArray())
                    {
                        if (t.ValueKind == JsonValueKind.String) tags.Add(t.GetString() ?? "");
                    }
                }

                var next = ImageReference.ParseNextLink(
                    resp.Headers.TryGetValues("Link", out var links) ? string.Join(",", links) : null);
                if (next == null) break;
                url = new Uri(baseUrl, next);
            }

            return tags;
        }

        /// <summary>仓库的 token 端点：带上 Basic 就是私有仓库，不带就是公开仓库的匿名 token</summary>
        async Task<string> FetchToken(BearerChallenge c, string? basicAuth)
        {
            var query = new List<string>();
            if (c.Service.Length > 0) query.Add("service=" + Uri.EscapeDataString(c.Service));
            if (c.Scope.Length > 0) query.Add("scope=" + Uri.EscapeDataString(c.Scope));

            var uri = query.Count == 0
                ? c.Realm
                : c.Realm + (c.Realm.Contains('?') ? "&" : "?") + string.Join("&", query);

            var resp = await SendAsync(new Uri(uri), basicAuth, bearer: null);
            resp.EnsureSuccessStatusCode();

            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            if (doc.RootElement.TryGetProperty("token", out var t) && t.ValueKind == JsonValueKind.String) return t.GetString() ?? "";
            if (doc.RootElement.TryGetProperty("access_token", out var a) && a.ValueKind == JsonValueKind.String) return a.GetString() ?? "";
            throw new Exception($"仓库的 token 端点 {c.Realm} 没有返回 token");
        }

        static async Task<HttpResponseMessage> SendAsync(Uri uri, string? basicAuth, string? bearer)
        {
            var req = new HttpRequestMessage(HttpMethod.Get, uri);
            // token 一旦拿到就只用它：同时带两种 Authorization，有的网关会挑错的那个去校验
            if (bearer != null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
            else if (basicAuth != null) req.Headers.TryAddWithoutValidation("Authorization", basicAuth);
            try
            {
                return await RegistryHttp.SendAsync(req);
            }
            catch (Exception ex)
            {
                // 超时/连不上时 HttpClient 只吐一句「Timeout of 10 seconds」，看不出卡在哪个域名。
                // 这里把完整 URL 拼进去：tags/list 和 401 换 token 两条路都走这个方法，
                // 光看 Notice 里那个 host 就能分清是连不到 registry 本身，还是连不到仓库认证域名。
                throw new Exception($"连不上 {uri.Scheme}://{uri.Authority}（{ex.Message}）", ex);
            }
        }

        /// <summary>
        /// 在命名空间里找能登录这个仓库的凭证。只认 dockerconfigjson 类型的 Secret——
        /// 那是 Pod 拉镜像本来就要用的那份，不是我们另外存的。
        /// </summary>
        /// <returns>Basic 头（可能为 null）与凭证来源描述</returns>
        (string? Basic, string Source) FindPullCredential(string ns, string registryHost)
        {
            try
            {
                foreach (var sec in client.CoreV1.ListNamespacedSecret(ns).Items)
                {
                    if (sec.Type != "kubernetes.io/dockerconfigjson") continue;
                    if (sec.Data == null || !sec.Data.TryGetValue(".dockerconfigjson", out var raw)) continue;

                    var (user, pass) = ReadDockerCredential(raw, registryHost);
                    if (user == null) continue;

                    var basic = "Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes($"{user}:{pass}"));
                    return (basic, $"secret:{ns}/{sec.Name()}");
                }
            }
            catch (Exception ex)
            {
                // 读不到 Secret（RBAC 不够）不该让整个下拉废掉，退回匿名，界面上有凭证来源可看
                logger.LogWarning(ex, "读命名空间 {Namespace} 的 imagePullSecrets 失败，改走匿名", ns);
            }
            return (null, "anonymous");
        }

        /// <summary>
        /// 从 .dockerconfigjson 里挑出匹配这个仓库地址的账号密码。
        /// 不走契约里的 DockerConfig：那个模型只有 username/password，而 kubectl 建的 secret 通常只写
        /// 一个 base64 的 auth 字段，按模型反序列化会直接丢掉凭证。
        /// </summary>
        static (string? User, string? Pass) ReadDockerCredential(byte[] raw, string registryHost)
        {
            try
            {
                using var doc = JsonDocument.Parse(raw);
                if (!doc.RootElement.TryGetProperty("auths", out var auths) || auths.ValueKind != JsonValueKind.Object)
                    return (null, null);

                foreach (var kv in auths.EnumerateObject())
                {
                    if (!SameHost(kv.Name, registryHost)) continue;

                    if (kv.Value.TryGetProperty("auth", out var auth) && auth.ValueKind == JsonValueKind.String)
                    {
                        try
                        {
                            var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(auth.GetString() ?? ""));
                            var sep = decoded.IndexOf(':');
                            if (sep > 0) return (decoded[..sep], decoded[(sep + 1)..]);
                        }
                        catch (FormatException)
                        {
                            // auth 不是合法 base64，当作没有凭证
                        }
                    }

                    var user = kv.Value.TryGetProperty("username", out var u) ? u.GetString() : null;
                    var pass = kv.Value.TryGetProperty("password", out var p) ? p.GetString() : null;
                    if (!string.IsNullOrEmpty(user)) return (user, pass);
                }
            }
            catch (JsonException)
            {
                // 手写坏的 secret 不拦路
            }
            return (null, null);
        }

        /// <summary>
        /// secret 里的 key 常带 scheme 与路径（https://index.docker.io/v1/），比的是主机名部分；
        /// Docker Hub 的登录域与 API 域不同名，这里认成同一个。
        /// </summary>
        static bool SameHost(string authKey, string registryHost)
        {
            var key = NormalizeHost(authKey);
            var host = NormalizeHost(registryHost);
            if (key == host) return true;

            var hub = new[] { DockerHubLoginHost, DockerHubApiHost };
            return hub.Contains(key) && hub.Contains(host);
        }

        const string DockerHubLoginHost = "index.docker.io";
        const string DockerHubApiHost = "registry-1.docker.io";

        static string NormalizeHost(string value)
        {
            var text = value.Trim();
            var scheme = text.IndexOf("://", StringComparison.Ordinal);
            if (scheme >= 0) text = text[(scheme + 3)..];
            var slash = text.IndexOf('/');
            if (slash >= 0) text = text[..slash];
            return text.ToLowerInvariant();
        }
    }
}
