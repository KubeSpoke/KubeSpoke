using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Server.Data;
using KubeSpoke.Server.Extensions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using System.Collections.Concurrent;
using System.Text;
using System.Threading.Channels;

namespace KubeSpoke.Server.Hubs
{
    /// <summary>
    /// 容器终端通道。输出复用日志那套 ChannelReader 反向流（agent 推 base64 帧），
    /// 输入反过来：浏览器按键 → 本 Hub 的 Input → 直接往集群 agent 那根连接推 ExecInput，
    /// 不等回执——终端要的是打字即时有反馈，而不是每个键一次 RPC 往返。
    /// </summary>
    [Authorize(AuthenticationSchemes = UserAuthExtensions.ConsoleScheme)]
    public class ExecHub : Hub
    {
        ILogger<ExecHub> logger;
        IAgentApis agentApis;
        IServiceScopeFactory scopeFactory;

        public ExecHub(ILogger<ExecHub> logger, IAgentApis agentApis, IServiceScopeFactory scopeFactory)
        {
            this.logger = logger;
            this.agentApis = agentApis;
            this.scopeFactory = scopeFactory;
        }

        class Session
        {
            public Guid Id;
            public string Cluster;
            public CancellationTokenSource Cts;
            public DateTime StartedAt;

            /// <summary>
            /// 谁开的、从哪开的，在连接还在的时候先抄下来：
            /// 关终端那条留痕是在请求结束之后写的，那时候再碰 Context 只会拿到已释放的对象。
            /// </summary>
            public string Actor = "";
            public string Ip = "";

            /// <summary>
            /// 下行帧的发送队列。SignalR 对同一根连接上先后到达的多次 Invoke 是并发派发的，
            /// 拿锁只能保证不并发，保证不了谁先抢到——两次按键就会换着个落到容器里。
            /// 这里只在本线程 TryWrite，入队顺序即按键顺序，由一个泵串行投递。
            /// </summary>
            public readonly Channel<Func<Task>> Outbox =
                Channel.CreateUnbounded<Func<Task>>(new UnboundedChannelOptions { SingleReader = true });
        }

        static readonly ConcurrentDictionary<string, Session> sessions = new();

        string ConnectionId => Context.ConnectionId;

        public override Task OnConnectedAsync()
        {
            var query = Context.GetHttpContext().Request.Query;
            var cluster = query["clusterId"].ToString();
            var pod = query["podName"].ToString();
            var ns = query["Namespace"].ToString();
            var container = query["container"].ToString();
            var command = query["command"].ToString();
            var cols = int.TryParse(query["cols"], out var c) ? c : 100;
            var rows = int.TryParse(query["rows"], out var r) ? r : 30;
            var client = Clients.Client(ConnectionId);
            var cts = new CancellationTokenSource();
            var session = new Session
            {
                Id = Guid.NewGuid(),
                Cluster = cluster,
                Cts = cts,
                StartedAt = DateTime.UtcNow,
                Actor = Context.User?.Identity?.Name ?? "",
                Ip = Context.GetHttpContext()?.Connection.RemoteIpAddress?.ToString() ?? "",
            };
            sessions[ConnectionId] = session;

            logger.LogInformation($"[打开终端]：{ns}/{pod} {container} 会话 {session.Id}");
            Record(session, "StartPodExec", ns, pod, container, true, "", $"终端 {cols}x{rows}");

            // 一个泵串行投递这路会话的所有下行帧，按键顺序才不会在 agent 连接上打乱
            Task.Run(async () =>
            {
                while (await session.Outbox.Reader.WaitToReadAsync())
                {
                    while (session.Outbox.Reader.TryRead(out var frame))
                    {
                        try
                        {
                            await frame();
                        }
                        catch (Exception ex)
                        {
                            logger.LogDebug(ex, "[终端下行帧投递失败]");
                        }
                    }
                }
            });

            Task.Run(async () =>
            {
                string failure = "";
                try
                {
                    var reader = agentApis.StartPodExec(new StartPodExecRequest
                    {
                        ClustName = cluster,
                        SessionId = session.Id,
                        Name = pod,
                        Namespace = ns,
                        Container = container,
                        Command = string.IsNullOrWhiteSpace(command) ? "/bin/sh" : command,
                        Cols = cols,
                        Rows = rows,
                    });

                    while (await reader.WaitToReadAsync(cts.Token))
                    {
                        while (reader.TryRead(out var frame))
                        {
                            await client.SendAsync("ExecOutput", frame);
                        }
                    }
                }
                catch (OperationCanceledException)
                {
                    // 浏览器先断开，正常收摊
                }
                catch (Exception ex)
                {
                    // 集群掉线、Agent 报错这些都要落到终端面板上，前端弹 toast 用户看不见全文
                    logger.LogError(ex, "[终端通道异常]");
                    failure = ex.Message;
                    var text = $"\r\x1b[31m终端连接失败：{ex.Message}\x1b[0m\r\n";
                    await SafeSendAsync(client, "ExecOutput", Convert.ToBase64String(Encoding.UTF8.GetBytes(text)));
                }
                finally
                {
                    logger.LogInformation($"[关闭终端]：{ns}/{pod} 会话 {session.Id}");
                    Record(session, "StopPodExec", ns, pod, container, failure.Length == 0, failure,
                        $"会话 {session.Id}，用了 {(int)(DateTime.UtcNow - session.StartedAt).TotalSeconds} 秒");
                    await SafeSendAsync(client, "ExecClosed");
                    // 会话一定要通知 agent：容器里的 shell 不会自己知道没人看了，
                    // 攒下去就是集群里一堆僵住的 bash
                    PushToAgent(session, (proxy, id) => proxy.SendAsync(ConstString.AGENT_EXEC_CLOSE, id));
                    sessions.TryRemove(ConnectionId, out _);
                    session.Outbox.Writer.TryComplete();
                    cts.Dispose();
                }
            });

            return Task.CompletedTask;
        }

        /// <summary>浏览器键盘输入，一帧 base64。原样投给该集群的 agent，不等回执。</summary>
        public Task Input(string base64)
        {
            if (sessions.TryGetValue(ConnectionId, out var session))
            {
                PushToAgent(session, (proxy, id) => proxy.SendAsync(ConstString.AGENT_EXEC_INPUT, id, base64));
            }

            return Task.CompletedTask;
        }

        /// <summary>面板尺寸变了就同步给容器里的 PTY，不然 vim/htop 会一直按打开那一刻的宽高画。</summary>
        public Task Resize(int cols, int rows)
        {
            if (sessions.TryGetValue(ConnectionId, out var session))
            {
                PushToAgent(session, (proxy, id) => proxy.SendAsync(ConstString.AGENT_EXEC_RESIZE, id, cols, rows));
            }

            return Task.CompletedTask;
        }

        public override Task OnDisconnectedAsync(Exception? exception)
        {
            if (sessions.TryGetValue(ConnectionId, out var session))
            {
                session.Cts.Cancel();
                PushToAgent(session, (proxy, id) => proxy.SendAsync(ConstString.AGENT_EXEC_CLOSE, id));
                sessions.TryRemove(ConnectionId, out _);
                session.Outbox.Writer.TryComplete();
            }

            return base.OnDisconnectedAsync(exception);
        }

        /// <summary>
        /// 终端的开与关各留一条痕。库写在单独的作用域里：这路会话的收发循环活得比本次 Hub 调用长，
        /// 借它的 DbContext 会在下一次写入时撞上已释放的连接。
        /// </summary>
        void Record(Session session, string action, string ns, string pod, string container,
            bool success, string message, string detail)
        {
            var actor = session.Actor;
            var ip = session.Ip;
            _ = Task.Run(async () =>
            {
                try
                {
                    using var scope = scopeFactory.CreateScope();
                    await scope.ServiceProvider.GetRequiredService<AuditRepository>().RecordAsync(
                        actor, action, session.Cluster, ns, pod, $"{container} {detail}", ip, success, message);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "[终端审计落库失败]");
                }
            });
        }

        /// <summary>
        /// 排一行投递任务：投给这集群的 agent；集群掉线就收掉这路会话，别让浏览器对着一个不再回话的面板打字。
        /// 参数一律由调用方逐个写死：传 object[] 会被绑成「一个数组参数」，agent 端按 Guid 绑定直接失败。
        /// </summary>
        void PushToAgent(Session session, Func<IClientProxy, Guid, Task> send)
        {
            session.Outbox.Writer.TryWrite(async () =>
            {
                var connectionId = Global.FindAgentConnection(session.Cluster);
                if (connectionId == null)
                {
                    logger.LogWarning($"[终端目标集群不在线]：{session.Cluster}");
                    session.Cts.Cancel();
                    return;
                }

                await send(Global.hubContext.Clients.Client(connectionId), session.Id);
            });
        }

        /// <summary>连接已经断了还去发通知，异常对调用方没有意义，记一行就够。</summary>
        async Task SafeSendAsync(IClientProxy client, string method, string? arg = null)
        {
            try
            {
                if (arg == null)
                {
                    await client.SendAsync(method);
                }
                else
                {
                    await client.SendAsync(method, arg);
                }
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, $"[推送{method}失败]");
            }
        }
    }
}
