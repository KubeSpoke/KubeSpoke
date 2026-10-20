using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Contracts.Models;
using KubeSpoke.Server;
using KubeSpoke.Server.Helper;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using System.Reflection;
using System.Reflection.Emit;
using System.Text.Json;
using System.Xml.Linq;

namespace KubeSpoke.Server.Hubs
{
    public class AgentApiProxy : DispatchProxy
    {
        IHubContext<ClusterAgentHub> hubContext => Global.hubContext;

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            LogHelper.LogDebug($"开始执行 {targetMethod?.Name}");
            var request = args![0] as BaseRequest;
            var name = request!.ClustName;
            int waitSec = 3;

            var adttrs = targetMethod.GetCustomAttributes<MaxWaitSecAttribute>();
            if (adttrs.Any())
            {
                LogHelper.LogDebug($"[自定义等待时间]：{adttrs.First().Sec}s");
                waitSec = adttrs.First().Sec > 0 ? adttrs.First().Sec : waitSec;
            }

            var id = Guid.NewGuid();
            var invokeInfo = new RPCRequest
            {
                MethodName = targetMethod!.Name,
                Args = args,
                RequestId = id
            };

            // 投递目标是这条 agent 连接的 ConnectionId。不能用 Clients.User(集群名)：SignalR 默认按
            // DefaultUserIdProvider 取 ClaimTypes.NameIdentifier 当用户标识，也就是认证处理器塞的
            // cluster-id 头（集群 UUID），和在线表用的集群名不是同一个键，永远匹配不上——
            // 消息会被静默丢掉，每个接口都退化成一次满窗超时。
            string connectionId;
            lock (Global.OnlineLock)
            {
                var onlineAgent = Global.OnlineUsers.FirstOrDefault(x => x.Name == name);
                if (onlineAgent == null)
                {
                    var online = Global.OnlineUsers.Count == 0 ? "无" : string.Join("、", Global.OnlineUsers.Select(x => x.Name));
                    throw new Exception($"cluster {name} not online（当前在线：{online}）");
                }
                connectionId = onlineAgent.ConnectionId;
            }

            var agent = hubContext.Clients.Client(connectionId);

            LogHelper.LogDebug($"[请求代理]：{JsonSerializer.Serialize(invokeInfo)}");

            // 等回执的线程是同步阻塞的 ASP.NET 线程，续跑不能内联到 SetResult 的那个连接线程上
            TaskCompletionSource<RPCResponse> completionSource = new TaskCompletionSource<RPCResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
            Global.RpcRequest[id] = completionSource;

            RPCResponse res;
            try
            {
                // 不 await 的话投递失败完全看不见
                agent.SendAsync(ConstString.AGENT_RECIVE_METHOD_RPC, invokeInfo).GetAwaiter().GetResult();

                completionSource.Task.WaitAsync(TimeSpan.FromSeconds(waitSec)).GetAwaiter().GetResult();
                res = completionSource.Task.Result;
            }
            catch (TimeoutException)
            {
                throw new Exception($"Agent 未在 {waitSec}s 内回执：{targetMethod.Name}（集群 {name}，连接 {connectionId}，请求 {id}）");
            }
            finally
            {
                // 超时后 Agent 的迟到回执仍会命中这个 id，不清理就永久堆积
                Global.RpcRequest.TryRemove(id, out _);
            }

            LogHelper.LogDebug($"[代理返回]：{res.RequestId}");
            if (res.Exception != null)
            {
                LogHelper.LogError($"[代理异常]：{res.Exception}");
                throw new Exception("Agent Error:" + res.Exception);
            }

            object result;
            if (res.ReturnData is JsonElement)
            {
                result = JsonSerializer.Deserialize(res.ReturnData.ToString(), targetMethod.ReturnType);
            }
            else
            {
                result = res.ReturnData;
            }

            LogHelper.LogDebug($"执行完成 {targetMethod.Name}");
            return result;
        }
    }
}
