using System.Globalization;
using KubeSpoke.Server.Data;

namespace KubeSpoke.Server.Services
{
    /// <summary>
    /// 把这一轮新出现和刚恢复的告警 POST 给配置的 webhook。
    /// 一个集群一次请求，firing / resolved 各一个数组，接收方按数组是否为空分流就行。
    /// 送不出去不影响采集，但每次尝试都落一条回执，页面上能看到当时到底送到没送到。
    /// </summary>
    public class AlertNotifier(
        IHttpClientFactory httpFactory,
        AlertChannelRepository channels,
        AlertNotifyRepository receipts,
        ILogger<AlertNotifier> logger)
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

        public async Task NotifyAsync(string cluster, List<AlertEntity> firing, List<AlertEntity> resolved)
        {
            if (firing.Count == 0 && resolved.Count == 0) return;

            var targets = await channels.ListAsync();
            if (targets.Count == 0) return;

            var payload = new
            {
                source = "KubeSpoke",
                cluster,
                firing = firing.Select(Brief).ToList(),
                resolved = resolved.Select(Brief).ToList(),
            };
            // 时间戳一律带 Z：库里存的是 UTC，但读回来的 Kind 未必还是，直接序列化会让接收方猜时区
            var body = System.Text.Json.JsonSerializer.Serialize(payload, new System.Text.Json.JsonSerializerOptions
            {
                PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            });

            foreach (var channel in targets)
            {
                var (ok, message) = await SendAsync(channel.Url, body);
                if (!ok) logger.LogWarning($"[告警通知未送达 {channel.Url}]：{message}");

                try
                {
                    await receipts.RecordAsync(new AlertNotifyLogEntity
                    {
                        TimeUtc = DateTime.UtcNow,
                        ChannelId = channel.Id,
                        Url = Trim(channel.Url, 500),
                        Cluster = Trim(cluster, 128),
                        Firing = firing.Count,
                        Resolved = resolved.Count,
                        Success = ok,
                        Message = Trim(message, 300),
                    });
                }
                catch (Exception ex)
                {
                    // 回执写不进去只意味着页面上少一条记录，不该把已经发出去的推送算成失败
                    logger.LogWarning(ex, "[告警回执落库失败]");
                }
            }
        }

        private async Task<(bool Ok, string Message)> SendAsync(string url, string body)
        {
            try
            {
                var http = httpFactory.CreateClient("alert-webhook");
                using var content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
                using var cts = new CancellationTokenSource(Timeout);
                var reply = await http.PostAsync(url, content, cts.Token);
                return reply.IsSuccessStatusCode
                    ? (true, $"HTTP {(int)reply.StatusCode}")
                    : (false, $"HTTP {(int)reply.StatusCode}");
            }
            catch (Exception ex)
            {
                return (false, ex.Message);
            }
        }

        private static string Trim(string value, int max) =>
            string.IsNullOrEmpty(value) || value.Length <= max ? value ?? "" : value[..max];

        private static object Brief(AlertEntity a) => new
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
            firstSeen = Iso(a.FirstSeenUtc),
            lastSeen = Iso(a.LastSeenUtc),
            resolvedAt = Iso(a.ResolvedUtc),
        };

        private static string? Iso(DateTime? utc) => utc is null
            ? null
            : DateTime.SpecifyKind(utc.Value, DateTimeKind.Utc).ToString("O", CultureInfo.InvariantCulture);
    }
}
