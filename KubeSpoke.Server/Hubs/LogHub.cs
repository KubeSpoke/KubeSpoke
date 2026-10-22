using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Contracts;
using KubeSpoke.Server.Extensions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using System.Text.Json;
using KubeSpoke.Contracts.Models;
using System.Collections.Concurrent;

namespace KubeSpoke.Server.Hubs
{
    [Authorize(AuthenticationSchemes = UserAuthExtensions.ConsoleScheme)]
    public class LogHub : Hub
    {
        string ConnectionId => Context.ConnectionId;
        ILogger<LogHub> logger;
        IAgentApis agentApis;
        public LogHub(ILogger<LogHub> logger, IAgentApis agentApis)
        {
            this.logger = logger;
            this.agentApis = agentApis;
        }

        /// <summary>浏览器连接 → 它的取消源、对应那一路 agent 侧日志流的会话 id、所属集群</summary>
        static ConcurrentDictionary<string, (CancellationTokenSource Cts, Guid SessionId, string Cluster)> keyValuePairs = new();

        public override Task OnConnectedAsync()
        {
            var query = Context.GetHttpContext().Request.Query;

            query.TryGetValue("clusterId", out var clusterId);
            query.TryGetValue("podName", out var podName);
            query.TryGetValue("Namespace", out var Namespace);

            var client = Clients.Client(ConnectionId);

            // 会话 id 在这里定：agent 侧那路推流要靠它被点名关掉
            var sessionId = Guid.NewGuid();
            var cts = new CancellationTokenSource();
            keyValuePairs[ConnectionId] = (cts, sessionId, clusterId);

            var registration = cts.Token.Register(() =>
            {
                logger.LogInformation($"[连接关闭]");
            });

            Task.Run(async () =>
            {
                logger.LogInformation($"[监听日志]：{Namespace}/{podName} 会话 {sessionId}");
                try
                {
                    var stream = agentApis.ReadPodLog(new ReadPodLogRequest
                    {
                        ClustName = clusterId,
                        Name = podName,
                        Namespace = Namespace,
                        SessionId = sessionId
                    });

                    while (await stream.WaitToReadAsync(cts.Token))
                    {
                        while (stream.TryRead(out var item))
                        {
                            await client.SendAsync("LogWrite", item);
                        }
                    }
                }
                catch (OperationCanceledException)
                {
                    // 浏览器先断开，正常收摊
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "监听异常");
                }
                finally
                {
                    logger.LogInformation($"[结束监听]：{Namespace}/{podName} 会话 {sessionId}");

                    // 必须通知 agent 停手：它那边的读循环不会知道服务端已经没人再读了，
                    // 而它不结束，服务端 RpcCallStreamBack 占着的那个 invocation 槽位就永远还不回来
                    CloseAgentStream(clusterId, sessionId);

                    keyValuePairs.TryRemove(ConnectionId, out _);
                    registration.Dispose();
                    cts.Dispose();
                }
            });

            return Task.CompletedTask;
        }

        public override Task OnDisconnectedAsync(Exception? exception)
        {
            // 先摘表再取消：摘不到说明读循环已经自己走完了收尾，这时候 cts 可能已经被 Dispose
            if (keyValuePairs.TryRemove(ConnectionId, out var mine))
            {
                try
                {
                    mine.Cts.Cancel();
                }
                catch (ObjectDisposedException)
                {
                    // 上面那个 finally 抢先收摊了，没什么可做的
                }
            }

            return Task.CompletedTask;
        }

        /// <summary>
        /// 让 agent 关掉这路日志推流。单向 SendAsync，绝不走 RPC 等回执：
        /// 最需要关流的恰恰是回执通道堵住的时候——等它回话就是自锁。
        /// 集群已经不在线也不用发——它那路会话随连接一起没了。
        /// </summary>
        void CloseAgentStream(string cluster, Guid sessionId)
        {
            var connectionId = Global.FindAgentConnection(cluster);
            if (connectionId == null)
            {
                return;
            }

            Global.hubContext.Clients.Client(connectionId).SendAsync(ConstString.AGENT_LOG_CLOSE, sessionId)
                .ContinueWith(t => logger.LogDebug(t.Exception, "[通知 agent 关日志流失败]"), TaskContinuationOptions.OnlyOnFaulted);
        }
    }
}
