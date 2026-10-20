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

        static ConcurrentDictionary<string, CancellationTokenSource> keyValuePairs = new ConcurrentDictionary<string, CancellationTokenSource>();

        public override Task OnConnectedAsync()
        {
            var query = Context.GetHttpContext().Request.Query;

            query.TryGetValue("clusterId", out var clusterId);
            query.TryGetValue("podName", out var podName);
            query.TryGetValue("Namespace", out var Namespace);

            var client = Clients.Client(ConnectionId);

            var cts = new CancellationTokenSource();
            keyValuePairs.TryAdd(ConnectionId, cts);

            cts.Token.Register(() =>
            {
                logger.LogInformation($"[连接关闭]");
            });

            Task.Run(async () =>
            {
                logger.LogInformation($"[监听日志]：{Namespace}/{podName}");
                try
                {
                    var stream = agentApis.ReadPodLog(new ReadPodLogRequest
                    {
                        ClustName = clusterId,
                        Name = podName,
                        Namespace = Namespace
                    });

                    while (await stream.WaitToReadAsync(cts.Token))
                    {
                        while (stream.TryRead(out var item))
                        {
                            await client.SendAsync("LogWrite", item);
                        }
                    }
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "监听异常");
                }
                finally
                {
                    logger.LogInformation($"[结束监听]：{Namespace}/{podName}");
                }
            });

            return Task.CompletedTask;
        }

        public override Task OnDisconnectedAsync(Exception? exception)
        {
            if (keyValuePairs.TryGetValue(ConnectionId, out var cts))
            {
                cts.Cancel();
            }

            return Task.CompletedTask;
        }
    }
}
