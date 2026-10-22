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
            // 默认时限在系统设置里，改完当场生效
            int waitSec = Global.RpcTimeoutSec;

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
                // 先把这条挂账，等迟到的回执来自首：只有它能证明回执到底是丢了还是没被派发
                Global.MarkRpcTimedOut(id, targetMethod.Name);
                var streak = Global.RecordRpcTimeout(connectionId);
                HealStalledConnection(name, connectionId, streak);

                throw new Exception($"Agent 未在 {waitSec}s 内回执：{targetMethod.Name}（集群 {name}，连接 {connectionId}，请求 {id}，连续第 {streak} 次）");
            }
            finally
            {
                // 超时后 Agent 的迟到回执仍会命中这个 id，不清理就永久堆积
                Global.RpcRequest.TryRemove(id, out _);
            }

            Global.RecordRpcSuccess(connectionId);
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

        /// <summary>
        /// 连续无回执攒够 <see cref="Global.SuspectConnectionStreak"/> 条就点名，并要求 agent 重建这条连接。
        /// 只在看门狗这层动手，不碰业务调用：调用方该拿的超时异常照样拿，自愈只是顺带换掉根子上那条坏连接——
        /// 重连会新建一根连接，服务端这侧被卡死的 invocation 派发队列和在线表里的旧 ConnectionId 一起作废，
        /// 比给单个接口加重试干净得多。
        /// </summary>
        void HealStalledConnection(string clusterName, string connectionId, int streak)
        {
            // 只在刚好跨过阈值的那一次发令，判据挪到 Global.ShouldRebuildConnection 里好被单测钉住
            if (!Global.ShouldRebuildConnection(streak))
            {
                return;
            }

            LogHelper.LogWarn($"[连接疑似失效]：集群 {clusterName} 连接 {connectionId} 连续 {streak} 次 RPC 无回执，"
                + $"要求 agent 重建连接。反复出现就查两件事：中间代理是否掐了空闲 WebSocket、agent 侧流式请求是否泄漏。");

            try
            {
                // 单向投递不等回执：要修的正是这条回执通道，等它回话等于自锁。
                // 也不在这里阻塞——已经在超时路径上了，再挂一次会把这次请求的耗时翻倍。
                hubContext.Clients.Client(connectionId).SendAsync(ConstString.AGENT_RECONNECT)
                    .ContinueWith(t => LogHelper.LogDebug($"[重连令投递失败]：{t.Exception?.GetBaseException().Message}"),
                        TaskContinuationOptions.OnlyOnFaulted);
            }
            catch (Exception ex)
            {
                // 连接彻底没了这步必然失败，自愈退化成等 agent 自己的 Closed 重连兜底，不影响调用方拿超时
                LogHelper.LogDebug($"[重连令发送异常]：{ex.Message}");
            }
        }
    }
}
