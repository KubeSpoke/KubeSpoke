using System.Collections.Concurrent;
using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Contracts.Models;
using KubeSpoke.Server.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KubeSpoke.Server.Controllers
{
    /// <summary>
    /// Helm 应用的控制台入口：仓库配置、应用市场、已安装应用的装升回滚卸载。
    /// <para>
    /// 这一层存在的理由是凭据的去向。仓库口令只存在服务端库里，浏览器只带 repoId，
    /// 由这里取出来注入给 agent——口令因此不进 URL（URL 会被网关打进访问日志）、
    /// 不进审计摘要（AuditFilter 的白名单里没有 Password）、也不回传给前端。
    /// </para>
    /// <para>
    /// 读接口全走 GET：AuditFilter 把 GET 当只读不落留痕，市场逛一万次也不该淹掉审计页。
    /// </para>
    /// </summary>
    [Authorize]
    public class HelmController(
        HelmRepoRepository repos,
        IAgentApis agentApis,
        ILogger<HelmController> logger) : BaseController
    {
        /// <summary>目录缓存的有效期。上游索引改了版本号要等到过期才看得见，换来的是不用每次都拖一份几十 MB 的 index.yaml。</summary>
        static readonly TimeSpan CatalogTtl = TimeSpan.FromMinutes(10);

        /// <summary>缓存的是某个仓库的全量目录（未按 query 过滤），搜索在服务端做，这样切关键字不会重复拉索引。</summary>
        static readonly ConcurrentDictionary<long, (DateTime FetchedUtc, List<HelmChart> Charts)> CatalogCache = new();

        /// <summary>同一个仓库并发只放一路去拉索引，其余的在锁上等这份结果。</summary>
        static readonly ConcurrentDictionary<long, SemaphoreSlim> CatalogLocks = new();

        /// <summary>缓存里存的是截过上限的全量目录，界面再按 query 过滤，条数上限也按这个来。</summary>
        const int CachedChartCap = 600;

        const int CachedVersionCap = 20;

        // ---- 仓库配置 ----

        public class HelmRepoForm
        {
            public string Name { get; set; } = "";
            public string Url { get; set; } = "";
            public string? Username { get; set; }
            public string? Password { get; set; }
            public bool Insecure { get; set; }
        }

        /// <summary>仓库列表。口令不回传，只回一个 hasPassword 标记，和隧道那条 Token 一样。</summary>
        [HttpGet]
        public async Task<object> Repos()
        {
            var rows = await repos.ListAsync();
            return new
            {
                items = rows.Select(r => new
                {
                    r.Id,
                    r.Name,
                    r.Url,
                    r.Username,
                    r.Insecure,
                    hasPassword = r.Password.Length > 0,
                    addedAt = r.CreatedUtc.ToLocalTime(),
                    r.CreatedBy,
                }),
            };
        }

        [HttpPost]
        public async Task<object> AddRepo([FromBody] HelmRepoForm form)
        {
            var row = await repos.AddAsync(new HelmRepoEntity
            {
                Name = form.Name,
                Url = form.Url,
                Username = form.Username ?? "",
                Password = form.Password ?? "",
                Insecure = form.Insecure,
                CreatedBy = User.Identity?.Name ?? "",
            });
            return new { id = row.Id, name = row.Name, url = row.Url };
        }

        /// <summary>删掉仓库只影响市场里还能不能看到它的 chart，已经装出来的 release 不受影响。</summary>
        [HttpPost]
        public async Task<object> RemoveRepo([FromQuery] long id)
        {
            var row = await repos.GetAsync(id);
            if (row == null) throw new ArgumentException("仓库不存在");
            await repos.RemoveAsync(id);
            CatalogCache.TryRemove(id, out _);
            return new { removed = true, name = row.Name };
        }

        // ---- 应用市场 ----

        /// <summary>
        /// 某仓库的 chart 目录。索引由 agent 直接 HTTP 取并解析，所以老镜像里没装 helm 也能逛市场。
        /// 取索引这件事仍然发生在某个 agent 上，因此 cluster 只是这次借用来跑腿的集群，与目录内容无关。
        /// </summary>
        /// <param name="cluster">代为取索引的集群</param>
        /// <param name="repoId">仓库 id</param>
        /// <param name="query">名称/描述/关键字子串过滤</param>
        /// <param name="refresh">忽略缓存，重新拉一次索引</param>
        [HttpGet]
        public async Task<object> Catalog([FromQuery] string? cluster, [FromQuery] long repoId, [FromQuery] string? query, [FromQuery] bool refresh = false)
        {
            var repo = await repos.GetAsync(repoId);
            if (repo == null) throw new ArgumentException("仓库不存在");

            var charts = await CachedCatalog(repo, Required(cluster, "集群"), refresh);
            var needle = (query ?? "").Trim();
            var matched = needle.Length == 0
                ? charts
                : charts.Where(c => c.Name.Contains(needle, StringComparison.OrdinalIgnoreCase)
                    || c.Description.Contains(needle, StringComparison.OrdinalIgnoreCase)
                    || c.Keywords.Any(k => k.Contains(needle, StringComparison.OrdinalIgnoreCase))).ToList();

            return new
            {
                repo = repo.Name,
                repoUrl = repo.Url,
                total = matched.Count,
                fetchedAt = CatalogCache.TryGetValue(repoId, out var hit) ? hit.FetchedUtc.ToLocalTime() : (DateTime?)null,
                items = matched,
            };
        }

        async Task<List<HelmChart>> CachedCatalog(HelmRepoEntity repo, string cluster, bool refresh)
        {
            if (!refresh && CatalogCache.TryGetValue(repo.Id, out var cached)
                && DateTime.UtcNow - cached.FetchedUtc < CatalogTtl)
            {
                return cached.Charts;
            }

            var gate = CatalogLocks.GetOrAdd(repo.Id, _ => new SemaphoreSlim(1, 1));
            await gate.WaitAsync();
            try
            {
                // 拿到锁再判一次：排队期间别人多半已经把这份索引拉回来了
                if (!refresh && CatalogCache.TryGetValue(repo.Id, out var settled)
                    && DateTime.UtcNow - settled.FetchedUtc < CatalogTtl)
                {
                    return settled.Charts;
                }

                var charts = agentApis.ListHelmCharts(new ListHelmChartsRequest
                {
                    ClustName = cluster,
                    RepoUrl = repo.Url,
                    Username = repo.Username.Length > 0 ? repo.Username : null,
                    Password = repo.Password.Length > 0 ? repo.Password : null,
                    Insecure = repo.Insecure,
                    MaxCharts = CachedChartCap,
                    MaxVersions = CachedVersionCap,
                });

                CatalogCache[repo.Id] = (DateTime.UtcNow, charts);
                logger.LogInformation("[chart 目录] 仓库 {Repo} 取到 {Count} 个 chart", repo.Name, charts.Count);
                return charts;
            }
            finally
            {
                gate.Release();
            }
        }

        // ---- 已安装应用 ----

        /// <summary>agent 侧 helm 可执行文件是否齐备。老镜像里没有 helm，界面要能把这句话说清楚。</summary>
        [HttpGet]
        public async Task<object> Capability([FromQuery] string? cluster)
        {
            var res = agentApis.CheckHelmAvailability(new HelmCapabilityRequest { ClustName = Required(cluster, "集群") });
            return new { res.Ready, res.HelmVersion, res.Error };
        }

        /// <summary>release 列表。Namespace 留空看整个集群。</summary>
        [HttpGet]
        public async Task<object> Releases([FromQuery] string? cluster, [FromQuery] string? @namespace)
        {
            var items = agentApis.ListHelmReleases(new HelmListReleasesRequest
            {
                ClustName = Required(cluster, "集群"),
                Namespace = @namespace ?? "",
            });
            return new { total = items.Count, items };
        }

        [HttpGet]
        public async Task<object> History([FromQuery] string? cluster, [FromQuery] string? @namespace, [FromQuery] string? name)
        {
            var items = agentApis.GetHelmHistory(new GetHelmHistoryRequest
            {
                ClustName = Required(cluster, "集群"),
                Namespace = Required(@namespace, "命名空间"),
                Name = Required(name, "release 名"),
            });
            return new { items };
        }

        /// <summary>单个 release 的详情：值、清单、安装说明，revision 为 0 看当前。</summary>
        [HttpGet]
        public async Task<object> Release([FromQuery] string? cluster, [FromQuery] string? @namespace,
            [FromQuery] string? name, [FromQuery] int revision = 0)
        {
            var detail = agentApis.GetHelmRelease(new GetHelmReleaseRequest
            {
                ClustName = Required(cluster, "集群"),
                Namespace = Required(@namespace, "命名空间"),
                Name = Required(name, "release 名"),
                Revision = revision,
            });
            return detail;
        }

        // ---- 写操作 ----

        public class HelmInstallForm
        {
            public string ClustName { get; set; } = "";

            /// <summary>release 名，同时是审计里的资源名</summary>
            public string Name { get; set; } = "";

            public string Namespace { get; set; } = "";

            /// <summary>chart 名，或者一个可直接交给 helm 的引用（.tgz 地址、oci:// 路径）</summary>
            public string Chart { get; set; } = "";

            public string? ChartVersion { get; set; }

            /// <summary>留空表示 Chart 自带来源，不查仓库表</summary>
            public long? RepoId { get; set; }

            public string? Values { get; set; }

            public bool CreateNamespace { get; set; } = true;

            public bool Wait { get; set; }

            public bool WaitForJobs { get; set; }

            public bool RollbackOnFailure { get; set; }

            public int TimeoutSec { get; set; }
        }

        [HttpPost]
        public async Task<object> Install([FromBody] HelmInstallForm form)
        {
            var repo = await ResolveRepo(form.RepoId);
            var op = agentApis.InstallHelmChart(new InstallHelmChartRequest
            {
                ClustName = form.ClustName,
                Namespace = form.Namespace,
                Name = form.Name,
                Chart = form.Chart,
                ChartVersion = form.ChartVersion,
                Values = form.Values,
                CreateNamespace = form.CreateNamespace,
                Wait = form.Wait,
                WaitForJobs = form.WaitForJobs,
                RollbackOnFailure = form.RollbackOnFailure,
                TimeoutSec = form.TimeoutSec,
                RepoUrl = repo?.Url,
                Username = Cred(repo?.Username),
                Password = Cred(repo?.Password),
                Insecure = repo?.Insecure ?? false,
            });

            return Operation(op);
        }

        public class HelmUpgradeForm
        {
            public string ClustName { get; set; } = "";
            public string Name { get; set; } = "";
            public string Namespace { get; set; } = "";
            public string Chart { get; set; } = "";
            public string? ChartVersion { get; set; }
            public long? RepoId { get; set; }
            public string? Values { get; set; }

            /// <summary>沿用线上值，而不是以本次提交为完整覆盖</summary>
            public bool ReuseValues { get; set; }

            public int HistoryMax { get; set; } = 10;

            public bool Wait { get; set; }

            public bool RollbackOnFailure { get; set; }

            public int TimeoutSec { get; set; }
        }

        [HttpPost]
        public async Task<object> Upgrade([FromBody] HelmUpgradeForm form)
        {
            var repo = await ResolveRepo(form.RepoId);
            var op = agentApis.UpgradeHelmChart(new UpgradeHelmChartRequest
            {
                ClustName = form.ClustName,
                Namespace = form.Namespace,
                Name = form.Name,
                Chart = form.Chart,
                ChartVersion = form.ChartVersion,
                Values = form.Values,
                ReuseValues = form.ReuseValues,
                HistoryMax = form.HistoryMax,
                Wait = form.Wait,
                RollbackOnFailure = form.RollbackOnFailure,
                TimeoutSec = form.TimeoutSec,
                RepoUrl = repo?.Url,
                Username = Cred(repo?.Username),
                Password = Cred(repo?.Password),
                Insecure = repo?.Insecure ?? false,
            });

            return Operation(op);
        }

        public class HelmRollbackForm
        {
            public string ClustName { get; set; } = "";
            public string Name { get; set; } = "";
            public string Namespace { get; set; } = "";

            /// <summary>目标修订，来自 History；0 让 helm 自己回到上一个</summary>
            public int Revision { get; set; }

            public bool Wait { get; set; }

            public int TimeoutSec { get; set; }
        }

        [HttpPost]
        public async Task<object> Rollback([FromBody] HelmRollbackForm form)
        {
            var op = agentApis.RollbackHelmChart(new RollbackHelmChartRequest
            {
                ClustName = form.ClustName,
                Namespace = form.Namespace,
                Name = form.Name,
                Revision = form.Revision,
                Wait = form.Wait,
                TimeoutSec = form.TimeoutSec,
            });
            return Operation(op);
        }

        public class HelmUninstallForm
        {
            public string ClustName { get; set; } = "";
            public string Name { get; set; } = "";
            public string Namespace { get; set; } = "";

            /// <summary>资源照删，只把 release 记录留在集群里</summary>
            public bool KeepHistory { get; set; }

            public int TimeoutSec { get; set; }
        }

        [HttpPost]
        public async Task<object> Uninstall([FromBody] HelmUninstallForm form)
        {
            var op = agentApis.UninstallHelmChart(new UninstallHelmChartRequest
            {
                ClustName = form.ClustName,
                Namespace = form.Namespace,
                Name = form.Name,
                KeepHistory = form.KeepHistory,
                TimeoutSec = form.TimeoutSec,
            });
            return Operation(op);
        }

        public class HelmTemplateForm
        {
            public string ClustName { get; set; } = "";

            /// <summary>渲染用的假想 release 名，会出现在资源名里，所以要和真装时填的一致才看得出问题</summary>
            public string Name { get; set; } = "";

            public string Namespace { get; set; } = "";
            public string Chart { get; set; } = "";
            public string? ChartVersion { get; set; }
            public long? RepoId { get; set; }
            public string? Values { get; set; }
            public bool SkipCrds { get; set; }
        }

        /// <summary>
        /// 装之前把 chart 渲染成多文档 YAML 给操作人看。走 POST 是因为 values 是一段正文，
        /// 塞进 query 会连口令一样被网关访问日志收走——虽然这里没有口令，但这个口子不该开。
        /// </summary>
        [HttpPost]
        public async Task<object> Template([FromBody] HelmTemplateForm form)
        {
            var repo = await ResolveRepo(form.RepoId);
            var yaml = agentApis.RenderHelmTemplate(new RenderHelmTemplateRequest
            {
                ClustName = form.ClustName,
                Namespace = form.Namespace,
                Name = form.Name,
                Chart = form.Chart,
                ChartVersion = form.ChartVersion,
                Values = form.Values,
                SkipCrds = form.SkipCrds,
                RepoUrl = repo?.Url,
                Username = Cred(repo?.Username),
                Password = Cred(repo?.Password),
                Insecure = repo?.Insecure ?? false,
            });
            return new { yaml };
        }

        // ---- 公共 ----

        record HelmRepoRef(string Url, string? Username, string? Password, bool Insecure);

        /// <summary>repoId 为空表示 chart 引用自带来源（.tgz / oci://），不去查仓库表。</summary>
        async Task<HelmRepoRef?> ResolveRepo(long? repoId)
        {
            if (repoId is not { } id || id <= 0) return null;
            var row = await repos.GetAsync(id);
            if (row == null) throw new ArgumentException("chart 仓库不存在，可能刚被删掉");
            return new HelmRepoRef(row.Url, Cred(row.Username), Cred(row.Password), row.Insecure);
        }

        static string? Cred(string? text) => string.IsNullOrWhiteSpace(text) ? null : text;

        static object Operation(HelmOperation op) => new
        {
            op.Name,
            op.Namespace,
            op.Revision,
            op.Status,
            op.Chart,
            op.Version,
            op.Message,
            op.Output,
        };

        static string Required(string? value, string what)
        {
            if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException($"必须指定{what}");
            return value.Trim();
        }
    }
}
