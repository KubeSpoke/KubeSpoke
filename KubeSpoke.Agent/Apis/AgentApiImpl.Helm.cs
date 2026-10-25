using KubeSpoke.Agent.Services;
using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Contracts.Models;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using System.Text.RegularExpressions;

namespace KubeSpoke.Agent.Apis
{
    /// <summary>
    /// Helm 应用：装、升、回滚、卸载，加上逛市场和装前的 YAML 预览。
    /// <para>
    /// 真正的活儿全部交给镜像里的 helm 可执行文件（<see cref="HelmCli"/>）——模板渲染、三方合并、
    /// 钩子、CRD 这些逻辑在 helm 里已经迭代了很多年，代理端拿 KubernetesClient 重抄一遍只会做出
    /// 一个装不上半数 chart 的赝品。这里只负责拼参数、跑进程、把结果读成契约里的模型。
    /// </para>
    /// <para>
    /// 这些方法都是同步返回的——RPC 派发是反射调用方法本身，不会 await，所以里面直接
    /// GetAwaiter().GetResult() 等到底层进程退出。等待窗口由 [MaxWaitSec] 在服务端按接口分别放宽，
    /// 代理端再用 <see cref="HelmCli.HardLimitSec"/> 兜一层，挂死的 helm 进程会被杀掉。
    /// </para>
    /// </summary>
    public partial class AgentApiImpl
    {
        HelmCli helm;

        /// <summary>index.yaml 的下载上限。bitnami 那份约 27MB，留一倍余量，超了多半是地址填错或被网关灌了页。</summary>
        const long MaxIndexBytes = 64 * 1024 * 1024;

        // 仓库索引是一个普通 HTTP 文件，两个 client 常驻复用：agent 是要跑几个月的进程，
        // 每次 new HttpClient 会把用完的 socket 一直攒着。
        // 「不校验证书」单独开一条，因为那是操作人在仓库上勾的开关，不能因为它把所有仓库都变成不校验。
        static readonly HttpClient IndexHttp = NewIndexClient(false);

        static readonly HttpClient IndexHttpInsecure = NewIndexClient(true);

        static HttpClient NewIndexClient(bool acceptAnyCertificate)
        {
            var handler = new HttpClientHandler();
            if (acceptAnyCertificate)
            {
                handler.ServerCertificateCustomValidationCallback = (_, _, _, _) => true;
            }
            return new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(60) };
        }

        public HelmCapability CheckHelmAvailability(HelmCapabilityRequest request)
        {
            var res = new HelmCapability();
            try
            {
                var run = RunHelm(["version", "--short"]);
                res.Ready = run.ExitCode == 0;
                res.HelmVersion = run.StdOut.Trim();
                res.Error = res.Ready ? "" : HelmCli.Tail(run.StdErr.Length > 0 ? run.StdErr : run.StdOut);
            }
            catch (Exception ex)
            {
                // 老镜像里没装 helm 会在这里现形，界面据此提示重新下发 agent，而不是每次装应用都撞墙
                res.Error = ex.Message;
            }
            return res;
        }

        public List<HelmRelease> ListHelmReleases(HelmListReleasesRequest request)
        {
            var args = new List<string> { "list", "--output", "json", "--max", "512" };
            if (string.IsNullOrWhiteSpace(request.Namespace))
            {
                // 界面默认看整个集群：「哪些应用是我装的」本来就不按命名空间想
                args.Add("-A");
            }
            else
            {
                args.Add("-n");
                args.Add(request.Namespace.Trim());
            }

            // 不加 --uninstalled 这类状态开关：helm list 的默认集合（deployed/pending/failed/superseded）
            // 正是操作人想看到的，被 --keep-history 摘掉的那种不该冒出来
            return ParseJsonArray(RunHelmOk(args), ReleaseOf);
        }

        public List<HelmRevision> GetHelmHistory(GetHelmHistoryRequest request)
        {
            var ns = RequireNamespace(request.Namespace, "查看发布历史");
            var name = RequireReleaseName(request.Name);
            var args = new List<string> { "history", name, "-n", ns, "--output", "json", "--max", "100" };
            return ParseJsonArray(RunHelmOk(args), RevisionOf);
        }

        /// <summary>
        /// 一个 release 的详情 = 修订表里的某一行 + 那一行的 values/manifest/notes。
        /// <para>
        /// 身份信息一律从 helm history 取，不用 helm status：status 的 JSON 把 chart 摊成
        /// 一个嵌套对象（chart.metadata.name 之类），不同版本挪过位置，而 history 每行都是平的。
        /// 值、清单、说明则用 helm get 的三条子命令分别取，它们本来就把这三样原样打印出来。
        /// </para>
        /// </summary>
        public HelmReleaseDetail GetHelmRelease(GetHelmReleaseRequest request)
        {
            var ns = RequireNamespace(request.Namespace, "查看应用详情");
            var name = RequireReleaseName(request.Name);
            var history = GetHelmHistory(new GetHelmHistoryRequest { Namespace = ns, Name = name, ClustName = request.ClustName });

            var detail = new HelmReleaseDetail { Name = name, Namespace = ns };
            // Revision 0 表示「看当前」，也就是修订号最大的那一行
            var row = request.Revision > 0
                ? history.FirstOrDefault(h => h.Revision == request.Revision)
                : history.OrderByDescending(h => h.Revision).FirstOrDefault();
            if (row == null && history.Count > 0)
            {
                throw new ArgumentException($"修订 {request.Revision} 已经不在了（可能被 --history-max 挤掉），现有修订：{string.Join(",", history.Select(h => h.Revision))}");
            }
            if (row != null)
            {
                detail.Revision = row.Revision;
                detail.Status = row.Status;
                detail.Chart = row.Chart;
                detail.Version = row.Version;
                detail.AppVersion = row.AppVersion;
            }

            detail.Manifest = RunGetOk(["get", "manifest", name, "-n", ns], request.Revision);
            // 取不到就留空：老 release 没写 NOTES.txt 是常事，不该让整页打不开
            detail.Values = RunGet(["get", "values", name, "-n", ns, "--all"], request.Revision).StdOut.Trim();
            detail.Notes = RunGet(["get", "notes", name, "-n", ns], request.Revision).StdOut.Trim();
            return detail;
        }

        public List<HelmChart> ListHelmCharts(ListHelmChartsRequest request)
        {
            var repo = RepoRoot(request.RepoUrl);
            var yaml = FetchIndex(repo + "/index.yaml", request.Username, request.Password, request.Insecure);
            return ChartIndex.Parse(yaml, repo, request.Query, request.MaxCharts, request.MaxVersions);
        }

        public string RenderHelmTemplate(RenderHelmTemplateRequest request)
        {
            var ns = RequireNamespace(request.Namespace, "预览 chart");
            var chart = RequireChart(request.Chart);
            var name = string.IsNullOrWhiteSpace(request.Name) ? "preview" : request.Name.Trim();

            var args = new List<string> { "template", name, chart, "-n", ns };
            if (!string.IsNullOrWhiteSpace(request.ChartVersion)) args.AddRange(["--version", request.ChartVersion.Trim()]);
            AppendRepoArgs(args, request.RepoUrl, request.Username, request.Password, request.Insecure);
            if (request.SkipCrds) args.Add("--skip-crds");
            var stdin = AppendValues(args, request.Values) ? request.Values : null;

            // template 纯客户端渲染，不碰集群，所以这份 YAML 只用来让操作人看清「装下去会变成什么」
            return RunHelmOk(args, stdin);
        }

        public HelmOperation InstallHelmChart(InstallHelmChartRequest request)
        {
            var ns = RequireNamespace(request.Namespace, "安装应用");
            var name = RequireReleaseName(request.Name);
            var chart = RequireChart(request.Chart);

            var args = new List<string> { "install", name, chart, "-n", ns };
            if (request.CreateNamespace) args.Add("--create-namespace");
            if (!string.IsNullOrWhiteSpace(request.ChartVersion)) args.AddRange(["--version", request.ChartVersion.Trim()]);
            AppendRepoArgs(args, request.RepoUrl, request.Username, request.Password, request.Insecure);
            if (request.RollbackOnFailure) args.Add("--rollback-on-failure");
            // Wait 默认关：等就绪会把一次 RPC 挂几分钟，界面宁可刷新列表看 pending-install → deployed 的流转
            if (request.Wait || request.RollbackOnFailure) args.Add("--wait");
            if (request.WaitForJobs) args.Add("--wait-for-jobs");
            var timeout = HelmTimeout(request.TimeoutSec);
            if (timeout != null) args.AddRange(["--timeout", timeout]);
            var stdin = AppendValues(args, request.Values) ? request.Values : null;

            return OperationFromText(RunHelm(args, stdin), name, ns, chart, request.ChartVersion);
        }

        public HelmOperation UpgradeHelmChart(UpgradeHelmChartRequest request)
        {
            var ns = RequireNamespace(request.Namespace, "升级应用");
            var name = RequireReleaseName(request.Name);
            var chart = RequireChart(request.Chart);

            var args = new List<string> { "upgrade", name, chart, "-n", ns };
            if (!string.IsNullOrWhiteSpace(request.ChartVersion)) args.AddRange(["--version", request.ChartVersion.Trim()]);
            AppendRepoArgs(args, request.RepoUrl, request.Username, request.Password, request.Insecure);
            // 不给 --install：release 不存在时 upgrade 就该明确失败，让操作人回去点「安装」，而不是被它悄悄装一个新的
            args.Add(request.ReuseValues ? "--reuse-values" : "--reset-values");
            if (request.HistoryMax > 0) args.AddRange(["--history-max", request.HistoryMax.ToString()]);
            if (request.RollbackOnFailure)
            {
                // helm 4 用这个取代了 --atomic；--cleanup-on-fail 是 atomic 语义的另一半，一起给才等价
                args.Add("--rollback-on-failure");
                args.Add("--cleanup-on-fail");
            }
            if (request.Wait || request.RollbackOnFailure) args.Add("--wait");
            var timeout = HelmTimeout(request.TimeoutSec);
            if (timeout != null) args.AddRange(["--timeout", timeout]);
            var stdin = AppendValues(args, request.Values) ? request.Values : null;

            return OperationFromText(RunHelm(args, stdin), name, ns, chart, request.ChartVersion);
        }

        public HelmOperation RollbackHelmChart(RollbackHelmChartRequest request)
        {
            var ns = RequireNamespace(request.Namespace, "回滚应用");
            var name = RequireReleaseName(request.Name);

            var args = new List<string> { "rollback", name };
            // 参数留空交给 helm，它自己回到上一个修订
            if (request.Revision > 0) args.Add(request.Revision.ToString());
            args.AddRange(["-n", ns, "--cleanup-on-fail"]);
            if (request.Wait) args.Add("--wait");
            var timeout = HelmTimeout(request.TimeoutSec);
            if (timeout != null) args.AddRange(["--timeout", timeout]);

            var run = RunHelm(args);
            var op = OperationFromText(run, name, ns, "", "");
            if (run.ExitCode == 0)
            {
                // helm 回滚成功只回一句「Happy Helming」，操作人真正要的是回滚之后的状态，补读一次
                var after = QueryRelease(name, ns);
                if (after != null)
                {
                    op.Status = after.Status;
                    op.Revision = after.Revision;
                    op.Chart = after.Chart;
                    op.Version = after.Version;
                }
            }
            return op;
        }

        public HelmOperation UninstallHelmChart(UninstallHelmChartRequest request)
        {
            var ns = RequireNamespace(request.Namespace, "卸载应用");
            var name = RequireReleaseName(request.Name);

            // --ignore-not-found：界面上点到的 release 可能已经被别人摘掉了，重复一次卸载不该报错
            var args = new List<string> { "uninstall", name, "-n", ns, "--ignore-not-found" };
            if (request.KeepHistory) args.Add("--keep-history");
            // 这一路的 RPC 窗口是 60s，所以不给 helm 留 5 分钟的默认时限：
            // 宁可让它自己超时并讲清楚卡在哪个钩子上，也不要让服务端等出一句 RPC 超时
            var timeout = HelmTimeout(request.TimeoutSec > 0 ? request.TimeoutSec : 50);
            if (timeout != null) args.AddRange(["--timeout", timeout]);

            var run = RunHelm(args);
            var op = OperationFromText(run, name, ns, "", "");
            if (run.ExitCode == 0)
            {
                // 资源已删；--keep-history 只决定 helm 的账还在不在，界面上要把这两件事分开说
                op.Status = "uninstalled";
                op.Output = $"{(request.KeepHistory ? "已删除资源并保留发布记录" : "已删除资源与发布记录")}：{HelmCli.Tail(run.StdOut, 5)}";
            }
            return op;
        }

        // ---- 进程与参数 ----

        /// <summary>跑一路 helm 命令：kubeconfig 每次现合成、用完即删，因为里面是服务账户令牌。</summary>
        HelmCli.HelmOutput RunHelm(IEnumerable<string> args, string? stdin = null)
        {
            var kubeconfig = helm.BuildKubeconfig();
            try
            {
                return helm.RunAsync(kubeconfig, args, stdin).GetAwaiter().GetResult();
            }
            finally
            {
                helm.RemoveKubeconfig(kubeconfig);
            }
        }

        string RunHelmOk(List<string> args, string? stdin = null)
        {
            var run = RunHelm(args, stdin);
            if (run.ExitCode != 0)
            {
                throw new InvalidOperationException(HelmCli.Tail(run.StdErr.Length > 0 ? run.StdErr : run.StdOut));
            }
            return run.StdOut;
        }

        /// <summary>helm get 的一路子命令，失败当空返回（没写 notes 的 chart 是正常情况）。</summary>
        HelmCli.HelmOutput RunGet(List<string> args, int revision)
        {
            if (revision > 0) args.AddRange(["--revision", revision.ToString()]);
            return RunHelm(args);
        }

        string RunGetOk(List<string> args, int revision)
        {
            var run = RunGet(args, revision);
            if (run.ExitCode != 0)
            {
                throw new InvalidOperationException(HelmCli.Tail(run.StdErr.Length > 0 ? run.StdErr : run.StdOut));
            }
            return run.StdOut.Trim();
        }

        /// <summary>仓库地址与凭据由服务端注入（浏览器只带 repoId），所以到这里时它们已经过一次校验。</summary>
        static void AppendRepoArgs(List<string> args, string? repoUrl, string? username, string? password, bool insecure)
        {
            if (string.IsNullOrWhiteSpace(repoUrl)) return;

            var url = repoUrl.Trim();
            args.Add("--repo");
            args.Add(url);
            if (!string.IsNullOrWhiteSpace(username)) args.AddRange(["--username", username.Trim()]);
            if (!string.IsNullOrWhiteSpace(password)) args.AddRange(["--password", password]);
            // helm 默认坚持 TLS，内网的 http 镜像仓库要自己说清楚
            if (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) args.Add("--plain-http");
            if (insecure) args.Add("--insecure-skip-tls-verify");
        }

        /// <summary>values 从 stdin 喂：helm 认 -f -，于是一个中间文件都不用落，也不会有清理不掉的残留。</summary>
        static bool AppendValues(List<string> args, string? values)
        {
            if (string.IsNullOrWhiteSpace(values)) return false;
            args.Add("-f");
            args.Add("-");
            return true;
        }

        /// <summary>
        /// helm 自己的 --timeout 不能长过代理端这条命令的墙钟上限，否则先动手杀进程的是我们，
        /// 操作人看到的是一句「超过 290s 没有退出」，而不是 helm 那条讲清楚卡在哪个资源上的报错。
        /// </summary>
        static string? HelmTimeout(int sec)
        {
            if (sec <= 0) return null;
            return $"{Math.Min(sec, HelmCli.HardLimitSec - 30)}s";
        }

        static string RequireNamespace(string ns, string what)
        {
            if (string.IsNullOrWhiteSpace(ns)) throw new ArgumentException($"{what} 必须指定命名空间");
            return ns.Trim();
        }

        static string RequireReleaseName(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("必须指定 release 名");
            return name.Trim();
        }

        static string RequireChart(string chart)
        {
            if (string.IsNullOrWhiteSpace(chart)) throw new ArgumentException("必须指定 chart");
            return chart.Trim();
        }

        /// <summary>仓库根地址：填根地址最常见，一路填到 index.yaml 的也接受。</summary>
        static string RepoRoot(string repoUrl)
        {
            if (string.IsNullOrWhiteSpace(repoUrl)) throw new ArgumentException("必须指定 chart 仓库地址");
            var url = repoUrl.Trim().TrimEnd('/');
            if (url.EndsWith("/index.yaml", StringComparison.OrdinalIgnoreCase))
            {
                url = url[..^"/index.yaml".Length].TrimEnd('/');
            }
            if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException($"chart 仓库地址要用 http(s) 开头：{repoUrl}");
            }
            return url;
        }

        static string FetchIndex(string url, string? username, string? password, bool insecure)
        {
            var client = insecure ? IndexHttpInsecure : IndexHttp;
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            if (!string.IsNullOrWhiteSpace(username) || !string.IsNullOrWhiteSpace(password))
            {
                // 凭据只进这一路请求的头，不进 URL：URL 会被上游网关原样打进访问日志
                var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{username}:{password}"));
                req.Headers.TryAddWithoutValidation("Authorization", $"Basic {basic}");
            }

            using var resp = client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult();
            if (!resp.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"仓库索引取不到：HTTP {(int)resp.StatusCode} {resp.ReasonPhrase}（{url}）");
            }

            using var stream = resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult();
            var body = new MemoryStream();
            var buffer = new byte[64 * 1024];
            while (true)
            {
                var read = stream.Read(buffer, 0, buffer.Length);
                if (read <= 0) break;
                if (body.Length + read > MaxIndexBytes)
                {
                    throw new InvalidOperationException($"仓库索引超过 {MaxIndexBytes / 1024 / 1024}MB，拒绝了：{url}");
                }
                body.Write(buffer, 0, read);
            }
            return Encoding.UTF8.GetString(body.ToArray());
        }

        // ---- helm 输出到契约模型 ----

        /// <summary>
        /// JsonElement 只是文档上的游标，离开 using 就废了，所以投影必须在解析这一趟里做完。
        /// </summary>
        static List<T> ParseJsonArray<T>(string json, Func<JsonElement, T> project)
        {
            if (string.IsNullOrWhiteSpace(json)) return [];
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];
            return doc.RootElement.EnumerateArray().Select(project).ToList();
        }

        static HelmRelease ReleaseOf(JsonElement e)
        {
            var (chart, version) = HelmText.SplitChart(Field(e, "chart"), Field(e, "chart_version"));
            return new HelmRelease
            {
                Name = Field(e, "name"),
                Namespace = Field(e, "namespace"),
                Revision = IntField(e, "revision"),
                Updated = Field(e, "updated"),
                Status = Field(e, "status"),
                Chart = chart,
                Version = version,
                AppVersion = Field(e, "app_version"),
                Description = Field(e, "description"),
            };
        }

        static HelmRevision RevisionOf(JsonElement e)
        {
            var (chart, version) = HelmText.SplitChart(Field(e, "chart"), Field(e, "chart_version"));
            return new HelmRevision
            {
                Revision = IntField(e, "revision"),
                Updated = Field(e, "updated"),
                Status = Field(e, "status"),
                Chart = chart,
                Version = version,
                AppVersion = Field(e, "app_version"),
                Description = Field(e, "description"),
            };
        }

        /// <summary>回滚之后补读状态。用 list --filter 而不是 status：前者是平的一行，后者是嵌套对象。</summary>
        HelmRelease? QueryRelease(string name, string ns)
        {
            try
            {
                var args = new List<string> { "list", "-n", ns, "--output", "json", "--filter", $"^{Regex.Escape(name)}$" };
                var hit = ParseJsonArray(RunHelmOk(args), ReleaseOf).FirstOrDefault(r => r.Name == name);
                return hit;
            }
            catch (Exception ex)
            {
                // 回滚本身已经成了，只是补读失败——别把这个成功覆盖成失败
                logger.LogWarning($"[helm] 回滚后补读 {ns}/{name} 状态失败：{ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// 写操作不传 -o json，用 helm 默认那段文本：里面本来就有 STATUS/REVISION 两行，
        /// 而 NOTES 段（chart 作者写的「装完之后请做这三步」）是给操作人看的，转成 JSON 反倒要丢掉。
        /// </summary>
        static HelmOperation OperationFromText(HelmCli.HelmOutput run, string name, string ns, string chart, string? version)
        {
            var op = new HelmOperation
            {
                Name = name,
                Namespace = ns,
                Chart = chart,
                Version = version ?? "",
                Output = HelmCli.Tail(run.StdOut.Length > 0 ? run.StdOut : run.StdErr, 40),
            };

            var status = HelmText.Value(run.StdOut, "STATUS");
            if (run.ExitCode != 0)
            {
                op.Message = HelmCli.Tail(run.StdErr.Length > 0 ? run.StdErr : run.StdOut);
                op.Status = status.Length > 0 ? status : "failed";
                return op;
            }

            op.Status = status.Length > 0 ? status : "deployed";
            op.Revision = int.TryParse(HelmText.Value(run.StdOut, "REVISION"), out var r) ? r : 0;
            return op;
        }

        static string Field(JsonElement e, string name)
        {
            if (e.ValueKind != JsonValueKind.Object) return "";
            foreach (var p in e.EnumerateObject())
            {
                if (string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase))
                {
                    return p.Value.ValueKind switch
                    {
                        JsonValueKind.String => p.Value.GetString() ?? "",
                        JsonValueKind.Number => p.Value.GetRawText(),
                        JsonValueKind.True => "true",
                        JsonValueKind.False => "false",
                        _ => "",
                    };
                }
            }
            return "";
        }

        static int IntField(JsonElement e, string name) => int.TryParse(Field(e, name), out var v) ? v : 0;
    }
}
