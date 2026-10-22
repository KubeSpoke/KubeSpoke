using KubeSpoke.Server.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KubeSpoke.Server.Controllers
{
    /// <summary>
    /// 告警的查询口：在告的、已恢复的，外加一个给导航栏角标用的未确认条数。
    /// </summary>
    [Authorize]
    public class AlertController : BaseController
    {
        private readonly AlertRepository alerts;
        private readonly AlertChannelRepository channels;
        private readonly AlertNotifyRepository receipts;

        public AlertController(AlertRepository alerts, AlertChannelRepository channels, AlertNotifyRepository receipts)
        {
            this.alerts = alerts;
            this.channels = channels;
            this.receipts = receipts;
        }

        [HttpGet]
        public async Task<object> List([FromQuery] string? state, [FromQuery] string? cluster,
            [FromQuery] string? severity, [FromQuery] int take = 100, [FromQuery] int skip = 0)
        {
            var parsed = Enum.TryParse<AlertRepository.State>(state, true, out var s) ? s : AlertRepository.State.Active;
            var (items, total) = await alerts.ListAsync(parsed, cluster ?? "", severity ?? "",
                Math.Clamp(take, 1, 500), Math.Max(skip, 0));

            return new
            {
                total,
                items = items.Select(a => new
                {
                    a.Id,
                    a.Cluster,
                    a.Kind,
                    a.Namespace,
                    a.Resource,
                    a.Reason,
                    a.Message,
                    a.Severity,
                    a.Count,
                    firstSeen = a.FirstSeenUtc.ToLocalTime(),
                    lastSeen = a.LastSeenUtc.ToLocalTime(),
                    resolvedAt = a.ResolvedUtc?.ToLocalTime(),
                    muteUntil = a.MuteUntilUtc?.ToLocalTime(),
                    a.Acked,
                    a.AckedBy,
                    ackedAt = a.AckedAt?.ToLocalTime(),
                }),
            };
        }

        [HttpGet]
        public async Task<int> UnackedCount() => await alerts.UnackedActiveCountAsync();

        /// <summary>确认只是把这条从「要人看」里摘出去，不代表集群里的问题好了。</summary>
        [HttpPost]
        public async Task<bool> Ack([FromQuery] long id) => await alerts.AckAsync(id, User.Identity?.Name ?? "");

        /// <summary>
        /// 静默一段时间（分钟，最长 7 天），传 0 取消。
        /// 静默只压对外推送和角标，库里这条照旧更新，恢复也会照常记录。
        /// </summary>
        [HttpPost]
        public async Task<bool> Mute([FromQuery] long id, [FromQuery] int minutes) => await alerts.MuteAsync(id, minutes);

        /// <summary>通知渠道就那几条，整份返回，不分页。</summary>
        [HttpGet]
        public async Task<object> Channels() => new { items = (await channels.ListAsync()).Select(c => new { c.Id, c.Url }) };

        [HttpPost]
        public async Task<object> AddChannel([FromQuery] string? url)
        {
            var added = await channels.AddAsync(url ?? "");
            return new { added.Id, added.Url };
        }

        [HttpPost]
        public async Task<bool> RemoveChannel([FromQuery] long id) => await channels.RemoveAsync(id);

        /// <summary>最近几次推送的结果，新的在前；渠道删掉了这些记录也还在，能查清当时发去了哪。</summary>
        [HttpGet]
        public async Task<object> NotifyLogs([FromQuery] int take = 20)
        {
            var items = await receipts.RecentAsync(Math.Clamp(take, 1, 200));
            return new
            {
                items = items.Select(l => new
                {
                    l.Id,
                    time = l.TimeUtc.ToLocalTime(),
                    l.Cluster,
                    l.Url,
                    l.Firing,
                    l.Resolved,
                    l.Success,
                    l.Message,
                }),
            };
        }
    }
}
