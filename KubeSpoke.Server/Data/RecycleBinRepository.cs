using Microsoft.EntityFrameworkCore;

namespace KubeSpoke.Server.Data
{
    /// <summary>
    /// 回收站的读写：删除前存一条快照，恢复时取出来重新 apply，过期记录随查询顺手清掉。
    /// </summary>
    public class RecycleBinRepository(AppDbContext db)
    {
        /// <summary>快照留在库里的天数，到点下一次有人翻回收站时删掉。</summary>
        public const int KeepDays = 7;

        public class Query
        {
            public string Cluster = "";
            public string Kind = "";
            public string Keyword = "";
        }

        public async Task RecordAsync(DeletedObjectEntity item)
        {
            db.DeletedObjects.Add(item);
            await db.SaveChangesAsync();
        }

        public async Task<(List<DeletedObjectEntity> Items, int Total)> ListAsync(Query query, int take, int skip)
        {
            await PruneExpiredAsync();

            var q = db.DeletedObjects.AsQueryable();
            if (!string.IsNullOrWhiteSpace(query.Cluster))
                q = q.Where(d => d.Cluster == query.Cluster.Trim());
            if (!string.IsNullOrWhiteSpace(query.Kind))
                q = q.Where(d => d.Kind == query.Kind.Trim());
            if (!string.IsNullOrWhiteSpace(query.Keyword))
            {
                var kw = query.Keyword.Trim();
                q = q.Where(d => d.Name.Contains(kw) || d.Namespace.Contains(kw) || d.Kind.Contains(kw)
                    || d.Actor.Contains(kw));
            }

            var total = await q.CountAsync();
            // 列表不带 YAML：一个 Deployment 的原文几十 KB，翻页时没必要全捞出来
            var items = await q.OrderByDescending(d => d.Id).Skip(skip).Take(take).ToListAsync();
            return (items, total);
        }

        public Task<DeletedObjectEntity?> FindAsync(long id) =>
            db.DeletedObjects.FirstOrDefaultAsync(d => d.Id == id);

        public async Task MarkRestoredAsync(long id)
        {
            var item = await FindAsync(id);
            if (item is null) return;
            item.RestoredUtc = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        /// <summary>手动丢掉一条：回收站不该只能等过期，误删的东西也可能只是不想再看见。</summary>
        public async Task<bool> DropAsync(long id)
        {
            var item = await FindAsync(id);
            if (item is null) return false;
            db.DeletedObjects.Remove(item);
            await db.SaveChangesAsync();
            return true;
        }

        private async Task PruneExpiredAsync()
        {
            var now = DateTime.UtcNow;
            var expired = await db.DeletedObjects.Where(d => d.ExpiresUtc < now).ToListAsync();
            if (expired.Count == 0) return;
            db.DeletedObjects.RemoveRange(expired);
            await db.SaveChangesAsync();
        }
    }
}
