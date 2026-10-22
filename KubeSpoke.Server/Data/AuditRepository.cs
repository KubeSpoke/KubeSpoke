using Microsoft.EntityFrameworkCore;

namespace KubeSpoke.Server.Data
{
    /// <summary>
    /// 审计留痕的读写。写走请求线程（一次 SQLite 插入，毫秒级），读给控制台的审计页。
    /// </summary>
    public class AuditRepository(AppDbContext db)
    {
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
