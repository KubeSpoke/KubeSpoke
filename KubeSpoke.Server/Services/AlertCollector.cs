using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Server.Data;

namespace KubeSpoke.Server.Services
{
    /// <summary>
    /// 每分钟向每个在线集群要一次异常清单，按指纹写进告警表。
    /// 单个集群这轮问不到就跳过它，下轮再问；采集本身从不拖垮控制台。
    /// </summary>
    public class AlertCollector(
        IServiceScopeFactory scopeFactory,
        IAgentApis agentApis,
        ILogger<AlertCollector> logger) : BackgroundService
    {
        private static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            using var timer = new PeriodicTimer(Interval);
            do
            {
                try
                {
                    await CollectOnceAsync(stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "[告警采集失败]");
                }
            }
            while (await WaitForNextTickAsync(timer, stoppingToken));
        }

        private async Task CollectOnceAsync(CancellationToken ct)
        {
            string[] clusters;
            lock (Global.OnlineLock)
            {
                clusters = Global.OnlineUsers.Select(x => x.Name).Where(n => !string.IsNullOrEmpty(n)).Distinct().ToArray();
            }

            foreach (var cluster in clusters)
            {
                ct.ThrowIfCancellationRequested();

                List<AlertSignal> signals;
                try
                {
                    // 代理是同步阻塞等回执的，放到线程池上跑，别把停机的令牌卡在等待里
                    signals = await Task.Run(() => agentApis.GetAlertSignals(new GetAlertSignalsRequest { ClustName = cluster }), ct);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    logger.LogWarning($"[告警采集跳过 {cluster}]：{ex.Message}");
                    continue;
                }

                if (signals is null || signals.Count == 0)
                {
                    // 空清单也要过一遍：上轮还在的这条这轮没了，就是恢复了
                    signals = [];
                }

                try
                {
                    using var scope = scopeFactory.CreateScope();
                    var (firing, resolved) = await scope.ServiceProvider.GetRequiredService<AlertRepository>()
                        .ApplyAsync(cluster, signals, DateTime.UtcNow);

                    // 推送算采集的尾巴：库已经落了，送不出去只是没通知，不该把这轮判成失败
                    await scope.ServiceProvider.GetRequiredService<AlertNotifier>()
                        .NotifyAsync(cluster, firing, resolved);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, $"[告警落库失败 {cluster}]");
                }
            }
        }

        /// <summary>StopAsync 之后 WaitAsync 会带着 TaskCanceledException 回来，那不算采集失败。</summary>
        private static async Task<bool> WaitForNextTickAsync(PeriodicTimer timer, CancellationToken ct)
        {
            try
            {
                return await timer.WaitForNextTickAsync(ct);
            }
            catch (OperationCanceledException)
            {
                return false;
            }
        }
    }
}
