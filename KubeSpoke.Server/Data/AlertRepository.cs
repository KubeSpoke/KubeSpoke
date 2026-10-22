using KubeSpoke.Contracts.Dtos;
using Microsoft.EntityFrameworkCore;

namespace KubeSpoke.Server.Data
{
    /// <summary>
    /// 告警的存储：采集器每轮把某个集群的异常整体交进来，按指纹认人，
    /// 没再出现的置为已恢复（保留在库里当期），重新出现的再打开。
    /// </summary>
    public class AlertRepository(AppDbContext db)
    {
        public enum State
        {
            Active,
            Resolved,
            All,
        }

        /// <summary>
        /// 交回这一轮新出现（含恢复后又坏掉）与刚恢复的两批，供调用方推送；
        /// 一直在告、没变化的那些不在返回值里，不该反复通知。
        /// </summary>
        public async Task<(List<AlertEntity> Firing, List<AlertEntity> Resolved)> ApplyAsync(
            string cluster, IEnumerable<AlertSignal> signals, DateTime nowUtc)
        {
            // 按这一轮的指纹去捞历史，别把该集群所有已恢复的旧告警都读进内存
            var candidates = signals.Select(s => Fingerprint(cluster, s)).Distinct().ToList();
            var rows = await db.Alerts
                .Where(a => a.Cluster == cluster && (a.ResolvedUtc == null || candidates.Contains(a.Fingerprint)))
                .ToListAsync();
            var byFingerprint = new Dictionary<string, AlertEntity>();
            foreach (var row in rows) byFingerprint[row.Fingerprint] = row;

            var firing = new List<AlertEntity>();
            var seen = new HashSet<string>();
            foreach (var signal in signals)
            {
                var fingerprint = Fingerprint(cluster, signal);
                if (!seen.Add(fingerprint)) continue;

                if (byFingerprint.TryGetValue(fingerprint, out var row))
                {
                    // 上一轮判它恢复了、这一轮又出现，说明是真没好；确认状态一并清掉，别让它躲在角标里
                    if (row.ResolvedUtc != null)
                    {
                        row.ResolvedUtc = null;
                        row.Acked = false;
                        row.AckedBy = "";
                        row.AckedAt = null;
                        // 静默期还没过就重新坏掉，仍然算静默中，不往外推
                        if (!Muted(row, nowUtc)) firing.Add(row);
                    }
                    row.Message = Trim(signal.Message);
                    row.Severity = Trim(signal.Severity, 16);
                    row.Count = Math.Max(signal.Count, 1);
                    var seenAgain = SeenAt(signal, nowUtc);
                    row.LastSeenUtc = seenAgain > row.LastSeenUtc ? seenAgain : row.LastSeenUtc;
                    continue;
                }

                var fresh = new AlertEntity
                {
                    Fingerprint = fingerprint,
                    Cluster = Trim(cluster, 128),
                    Kind = Trim(signal.Kind, 32),
                    Namespace = Trim(signal.Namespace, 128),
                    Resource = Trim(signal.Resource, 128),
                    Reason = Trim(signal.Reason, 128),
                    Message = Trim(signal.Message),
                    Severity = string.IsNullOrWhiteSpace(signal.Severity) ? "warning" : Trim(signal.Severity, 16),
                    Count = Math.Max(signal.Count, 1),
                    FirstSeenUtc = SeenAt(signal, nowUtc),
                    LastSeenUtc = nowUtc,
                };
                db.Alerts.Add(fresh);
                firing.Add(fresh);
            }

            var resolved = rows.Where(r => r.ResolvedUtc == null && !seen.Contains(r.Fingerprint)).ToList();
            foreach (var row in resolved) row.ResolvedUtc = nowUtc;

            await db.SaveChangesAsync();
            return (firing, resolved);
        }

        public async Task<(List<AlertEntity> Items, int Total)> ListAsync(State state, string cluster,
            string severity, int take, int skip)
        {
            var q = db.Alerts.AsQueryable();
            q = state switch
            {
                State.Active => q.Where(a => a.ResolvedUtc == null),
                State.Resolved => q.Where(a => a.ResolvedUtc != null),
                _ => q,
            };
            if (!string.IsNullOrWhiteSpace(cluster))
                q = q.Where(a => a.Cluster == cluster.Trim());
            if (!string.IsNullOrWhiteSpace(severity))
                q = q.Where(a => a.Severity == severity.Trim().ToLowerInvariant());

            var total = await q.CountAsync();
            // 在告的排前面，同组里最近见到的先看到
            var items = await q
                .OrderByDescending(a => a.ResolvedUtc == null)
                .ThenByDescending(a => a.LastSeenUtc)
                .Skip(skip).Take(take).ToListAsync();
            return (items, total);
        }

        public async Task<int> UnackedActiveCountAsync() =>
            await db.Alerts.CountAsync(a =>
                a.ResolvedUtc == null && !a.Acked && (a.MuteUntilUtc == null || a.MuteUntilUtc <= DateTime.UtcNow));

        /// <summary>确认只影响在告的那条，已恢复的历史不用人再点。</summary>
        public async Task<bool> AckAsync(long id, string actor)
        {
            var acked = await db.Alerts
                .Where(a => a.Id == id && a.ResolvedUtc == null)
                .ExecuteUpdateAsync(x => x
                    .SetProperty(a => a.Acked, true)
                    .SetProperty(a => a.AckedBy, actor ?? "")
                    .SetProperty(a => a.AckedAt, DateTime.UtcNow));
            return acked > 0;
        }

        /// <summary>
        /// 静默：分钟内不再对外推送这条，也不计进未确认角标，库里当期照旧更新。
        /// 传 0 就是取消静默。同样只对在告的这条有效。
        /// </summary>
        public async Task<bool> MuteAsync(long id, int minutes)
        {
            var nowUtc = DateTime.UtcNow;
            var until = minutes > 0 ? nowUtc.AddMinutes(Math.Min(minutes, 7 * 24 * 60)) : (DateTime?)null;
            var muted = await db.Alerts
                .Where(a => a.Id == id && a.ResolvedUtc == null)
                .ExecuteUpdateAsync(x => x.SetProperty(a => a.MuteUntilUtc, until));
            return muted > 0;
        }

        /// <summary>静默到期时间还没过，这一轮就不用打扰人。</summary>
        private static bool Muted(AlertEntity row, DateTime nowUtc) =>
            row.MuteUntilUtc is { } until && until > nowUtc;

        private static string Fingerprint(string cluster, AlertSignal signal) =>
            Trim($"{cluster}|{signal.Kind}|{signal.Namespace}|{signal.Resource}|{signal.Reason}", 300);

        /// <summary>
        /// JSON 把带 Z 的时间戳反序列化成本机时区的 Kind，整份清单会被挪后一个时区差；
        /// 先还原成 UTC 再用，比本机时钟还往前的当成本轮才见到，免得排序被假时间顶到最前面。
        /// </summary>
        private static DateTime SeenAt(AlertSignal signal, DateTime nowUtc)
        {
            if (signal.LastSeenUtc is not { } at) return nowUtc;
            var utc = at.Kind == DateTimeKind.Local
                ? at.ToUniversalTime()
                : DateTime.SpecifyKind(at, DateTimeKind.Utc);
            return utc <= nowUtc ? utc : nowUtc;
        }

        private static string Trim(string value, int max = 500) =>
            string.IsNullOrEmpty(value) || value.Length <= max ? value ?? "" : value[..max];
    }
}
