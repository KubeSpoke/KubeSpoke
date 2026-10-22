using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Server.Extensions.AgentAuthentication;
using KubeSpoke.Server.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using System.Security.Claims;
using System.Threading.Channels;

namespace KubeSpoke.Server.Hubs
{
    [Authorize(AuthenticationSchemes = AgentAuthSchemeConstants.AuthenticationScheme)]
    public class ClusterAgentHub : Hub
    {
        ILogger<ClusterAgentHub> logger;

        string IdentityName
        {
            get
            {
                var claim = Context.User?.FindFirst(x => x.Type == ClaimTypes.NameIdentifier);
                if (claim == null)
                {
                    return null;
                }
                else
                {
                    return claim.Value;
                }
            }
        }

        string ClusterName
        {
            get
            {
                var name = Context.GetHttpContext().Request.Query["name"];
                return name;
            }
        }

        public ClusterAgentHub(ILogger<ClusterAgentHub> logger)
        {
            this.logger = logger;
        }

        public async Task SendMessage(AgentMsg message)
        {
            await Clients.All.SendAsync("ReceiveMessage", message);
        }

        public Task RpcCallBack(RPCResponse message)
        {
            if (Global.RpcRequest.TryGetValue(message.RequestId, out TaskCompletionSource<RPCResponse>? task))
            {
                // TrySetResult 而不是 SetResult：agent 重发同一条回执时后者会直接抛，
                // 一个已经拿到答案的请求不该把这条连接弄成异常
                if (!task.TrySetResult(message))
                {
                    logger.LogWarning("[回执重复] 请求 {RequestId} 已被完成过（连接 {Conn}）",
                        message.RequestId, Context.ConnectionId);
                }

                return Task.CompletedTask;
            }

            // 走到这里说明发起方已经超时撤单。整条链路只有这一行能证明「agent 确实把回执发出来了」，
            // 静默丢掉的话，超时到底是丢包还是没被派发永远分不清——上一轮排查就是卡在这。
            if (Global.TryTakeLateRpc(message.RequestId, out var method, out var timedOutAt))
            {
                var lateMs = (int)(DateTime.UtcNow - timedOutAt).TotalMilliseconds;
                logger.LogWarning("[回执迟到] {Method} 请求 {RequestId} 已超时撤单，{LateMs}ms 后才到达（连接 {Conn}）。"
                    + "延迟集中在超时后一小段=派发排队；永远不到=传输丢帧",
                    method, message.RequestId, lateMs, Context.ConnectionId);
            }
            else
            {
                logger.LogWarning("[回执无人认领] 请求 {RequestId} 从未登记或已清理（连接 {Conn}）",
                    message.RequestId, Context.ConnectionId);
            }

            return Task.CompletedTask;
        }

        public async Task RpcCallStreamBack(Guid RequestId, ChannelReader<string> stream)
        {
            if (Global.RpcRequest.TryGetValue(RequestId, out TaskCompletionSource<RPCResponse>? task))
            {
                task.TrySetResult(new RPCResponse
                {
                    RequestId = RequestId,
                    ReturnData = stream,
                });

                // 这里必须等待，直到异步数据传输完毕，否则这里直接结束掉
                await stream.Completion;
            }
        }

        public override Task OnConnectedAsync()
        {
            if (IdentityName != null)
            {
                logger.LogInformation($"[集群连接]：{ClusterName} {IdentityName} SignalRUserId={Context.UserIdentifier ?? "<null>"} ConnectionId={Context.ConnectionId}");
                lock (Global.OnlineLock)
                {
                    // 同一个集群重连会留下旧连接，按 Identity 覆盖，否则 RPC 会投到已断的 ConnectionId 上
                    for (var i = Global.OnlineUsers.Count - 1; i >= 0; i--)
                    {
                        if (Global.OnlineUsers[i].Identity == IdentityName)
                        {
                            Global.OnlineUsers.RemoveAt(i);
                        }
                    }

                    Global.OnlineUsers.Add(new ClusterAgent
                    {
                        Identity = IdentityName,
                        Name = ClusterName,
                        ConnectionId = Context.ConnectionId,
                    });
                }
            }

            return base.OnConnectedAsync();
        }

        public override Task OnDisconnectedAsync(Exception? exception)
        {
            if (IdentityName != null)
            {
                logger.LogInformation($"[集群断开]：{ClusterName} {IdentityName}");
                lock (Global.OnlineLock)
                {
                    // 只摘掉这条连接自己，旧连接晚到的断开事件不能把重连后的新记录删掉
                    var cluster = Global.OnlineUsers.FirstOrDefault(x => x.ConnectionId == Context.ConnectionId);
                    if (cluster != null)
                    {
                        Global.OnlineUsers.Remove(cluster);
                    }

                    // 计数按 ConnectionId 存，连接没了就是死数据
                    Global.ForgetConnection(Context.ConnectionId);
                }
            }

            return base.OnDisconnectedAsync(exception);
        }
    }
}
