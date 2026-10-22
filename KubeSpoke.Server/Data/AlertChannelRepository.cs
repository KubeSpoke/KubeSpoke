using Microsoft.EntityFrameworkCore;

namespace KubeSpoke.Server.Data
{
    /// <summary>
    /// 告警推送渠道的增删查。渠道数量就是个位数，每次采集直接全读，不用分页。
    /// </summary>
    public class AlertChannelRepository(AppDbContext db)
    {
        public async Task<List<AlertChannelEntity>> ListAsync() =>
            await db.AlertChannels.OrderBy(c => c.Id).ToListAsync();

        public async Task<AlertChannelEntity> AddAsync(string url)
        {
            var trimmed = url?.Trim() ?? "";
            // 收下一个奇怪的地址只会在每轮采集里默默失败，不如当场退回给操作人
            if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var parsed)
                || (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
                throw new ArgumentException("通知地址要填完整的 http(s) 链接");
            if (trimmed.Length > 500)
                throw new ArgumentException("通知地址过长");

            var channel = new AlertChannelEntity { Kind = "webhook", Url = trimmed };
            db.AlertChannels.Add(channel);
            await db.SaveChangesAsync();
            return channel;
        }

        public async Task<bool> RemoveAsync(long id) =>
            await db.AlertChannels.Where(c => c.Id == id).ExecuteDeleteAsync() > 0;
    }
}
