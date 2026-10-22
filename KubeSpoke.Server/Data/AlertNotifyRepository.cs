using Microsoft.EntityFrameworkCore;

namespace KubeSpoke.Server.Data
{
    /// <summary>
    /// 告警推送的投递回执：每次真的往某个渠道发过，就留一条结果。
    /// 没人点查看时它只是躺着，采集和推送的判断都不依赖它。
    /// </summary>
    public class AlertNotifyRepository(AppDbContext db)
    {
        public async Task RecordAsync(AlertNotifyLogEntity log)
        {
            db.AlertNotifyLogs.Add(log);
            await db.SaveChangesAsync();
        }

        /// <summary>最近若干条，新的在前。弹窗里就想知道「刚才那次到底送出去没有」。</summary>
        public async Task<List<AlertNotifyLogEntity>> RecentAsync(int take) =>
            await db.AlertNotifyLogs.OrderByDescending(l => l.Id).Take(Math.Clamp(take, 1, 200)).ToListAsync();
    }
}
