using Microsoft.EntityFrameworkCore;

namespace KubeSpoke.Server.Data
{
    /// <summary>
    /// 内网穿透隧道的增删查。隧道数量不多，列表按集群过滤后全读，不分页。
    /// 只存配置与 Pod 坐标，实时状态由控制器按需查 agent，不落库。
    /// </summary>
    public class TunnelRepository(AppDbContext db)
    {
        public async Task<List<TunnelEntity>> ListAsync(string cluster)
        {
            var query = db.Tunnels.AsNoTracking();
            if (!string.IsNullOrWhiteSpace(cluster))
                query = query.Where(t => t.Cluster == cluster);
            return await query.OrderByDescending(t => t.Id).ToListAsync();
        }

        public async Task<TunnelEntity?> GetAsync(long id) =>
            await db.Tunnels.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id);

        public async Task<TunnelEntity> AddAsync(TunnelEntity entity)
        {
            db.Tunnels.Add(entity);
            await db.SaveChangesAsync();
            return entity;
        }

        public async Task<bool> RemoveAsync(long id) =>
            await db.Tunnels.Where(t => t.Id == id).ExecuteDeleteAsync() > 0;
    }
}
