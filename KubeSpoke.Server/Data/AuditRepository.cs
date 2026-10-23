using Microsoft.EntityFrameworkCore;

namespace KubeSpoke.Server.Data
{
    /// <summary>
    /// 审计留痕的读写。写走请求线程（一次 SQLite 插入，毫秒级），读给控制台的审计页。
    /// 超期的旧留痕由写入路径每 <see cref="PruneEveryWrites"/> 条顺手清一次。
    /// </summary>
    public class AuditRepository(AppDbContext db, ILogger<AuditRepository> logger)
    {
        /// <summary>留痕保留天数，再老的就没有意义了。</summary>
        public const int RetentionDays = 90;

        /// <summary>每写多少条清理一次。仓储是 Scoped，每个请求一个新实例，所以计数只能用静态的。</summary>
        private const int PruneEveryWrites = 500;

        private static int writeCounter;

        public class Query
        {
            public string Cluster = "";
            public string Keyword = "";
            public bool? Success;
        }

        public async Task RecordAsync(string actor, string action, string cluster, string ns,
            string resource, string detail, string ip, bool success, string message)
        {
            db.Audits.Add(new AuditEntity
            {
                TimeUtc = DateTime.UtcNow,
                Actor = Trim(actor, 64),
                Action = Trim(action, 64),
                Cluster = Trim(cluster, 128),
                Namespace = Trim(ns, 128),
                Resource = Trim(resource, 128),
                Detail = Trim(detail, 500),
                Ip = Trim(ip, 64),
                Success = success,
                Message = Trim(message, 500),
            });
            await db.SaveChangesAsync();

            await PruneIfNeededAsync();
        }

        /// <summary>
        /// 表只增不减迟早把库撑大，所以每 PruneEveryWrites 次写入删掉一批超期的行。
        /// 之所以挂在写入路径而不是后台服务：注册 IHostedService 要改 Program.cs，本会话动不了那个文件，惰性清理不用加任何注册。
        /// 走 TimeUtc 的索引，一次 DELETE 的量等于一年里最老那几天，代价可以忽略。
        /// </summary>
        private async Task PruneIfNeededAsync()
        {
            if (Interlocked.Increment(ref writeCounter) % PruneEveryWrites != 0) return;

            try
            {
                var cutoff = DateTime.UtcNow.AddDays(-RetentionDays);
                var removed = await db.Audits.Where(a => a.TimeUtc < cutoff).ExecuteDeleteAsync();
                if (removed > 0) logger.LogInformation("[审计清理] 删除 {Removed} 条超过 {Days} 天的留痕", removed, RetentionDays);
            }
            catch (Exception ex)
            {
                // 清理只是维护动作，绝不能把刚写进去的那条留痕带崩
                logger.LogWarning(ex, "[审计清理失败]");
            }
        }

        public async Task<(List<AuditEntity> Items, int Total)> ListAsync(Query query, int take, int skip)
        {
            var q = Filter(query);
            var total = await q.CountAsync();
            var items = await q.OrderByDescending(a => a.Id).Skip(skip).Take(take).ToListAsync();
            return (items, total);
        }

        private IQueryable<AuditEntity> Filter(Query query)
        {
            var q = db.Audits.AsQueryable();
            if (!string.IsNullOrWhiteSpace(query.Cluster))
                q = q.Where(a => a.Cluster == query.Cluster.Trim());
            if (query.Success is { } success)
                q = q.Where(a => a.Success == success);
            if (!string.IsNullOrWhiteSpace(query.Keyword))
            {
                var kw = query.Keyword.Trim();
                q = q.Where(a => a.Action.Contains(kw) || a.Resource.Contains(kw) || a.Namespace.Contains(kw)
                    || a.Detail.Contains(kw) || a.Message.Contains(kw));
            }
            return q;
        }

        private static string Trim(string value, int max) =>
            string.IsNullOrEmpty(value) || value.Length <= max ? value ?? "" : value[..max];
    }
}
