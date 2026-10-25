using Microsoft.EntityFrameworkCore;

namespace KubeSpoke.Server.Data
{
    /// <summary>
    /// chart 仓库的增删查。仓库就是个位数，列表全读，不分页。
    /// <para>
    /// 地址在这里就验掉：一个连不上的仓库进了库，症状是市场页每次刷新都转几秒然后报一句
    /// 上游的 HTTP 状态码，操作人很难想到根因是当初填错了一个字符。
    /// </para>
    /// </summary>
    public class HelmRepoRepository(AppDbContext db)
    {
        public async Task<List<HelmRepoEntity>> ListAsync() =>
            await db.HelmRepos.AsNoTracking().OrderBy(r => r.Name).ToListAsync();

        public async Task<HelmRepoEntity?> GetAsync(long id) =>
            await db.HelmRepos.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id);

        public async Task<HelmRepoEntity?> FindByNameAsync(string name) =>
            await db.HelmRepos.AsNoTracking().FirstOrDefaultAsync(r => r.Name == name);

        public async Task<HelmRepoEntity> AddAsync(HelmRepoEntity entity)
        {
            var name = entity.Name?.Trim() ?? "";
            if (name.Length == 0) throw new ArgumentException("仓库要有一个名字");
            if (name.Length > 64) throw new ArgumentException("仓库名过长（最多 64 字）");
            if (await db.HelmRepos.AnyAsync(r => r.Name == name)) throw new ArgumentException($"仓库名 {name} 已经用过了");

            var url = entity.Url?.Trim().TrimEnd('/') ?? "";
            // 只收 http(s)：索引是代理端直接 HTTP 取的，其余形态（oci:// 之类）在这里收了也取不出目录
            if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed)
                || (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
                throw new ArgumentException("仓库地址要填完整的 http(s) 链接");
            if (url.Length > 500) throw new ArgumentException("仓库地址过长");

            entity.Name = name;
            entity.Url = url;
            entity.Username = (entity.Username ?? "").Trim();
            entity.Password ??= "";
            if (entity.Username.Length > 200) throw new ArgumentException("仓库用户名过长");
            if (entity.Password.Length > 500) throw new ArgumentException("仓库口令过长");

            db.HelmRepos.Add(entity);
            await db.SaveChangesAsync();
            return entity;
        }

        public async Task<bool> RemoveAsync(long id) =>
            await db.HelmRepos.Where(r => r.Id == id).ExecuteDeleteAsync() > 0;
    }
}
