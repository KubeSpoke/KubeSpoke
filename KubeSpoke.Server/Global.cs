using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Server.Hubs;
using KubeSpoke.Server.Models;
using Microsoft.AspNetCore.SignalR;
using System.Collections.Concurrent;

namespace KubeSpoke.Server
{
    public class Global
    {
        public static IHubContext<ClusterAgentHub> hubContext { get; set; }

        public static ConcurrentDictionary<Guid, TaskCompletionSource<RPCResponse>> RpcRequest { get; set; } = new ConcurrentDictionary<Guid, TaskCompletionSource<RPCResponse>>();

        public static readonly object OnlineLock = new object();

        /// <summary>
        /// 等 Agent 回执的秒数，启动时从系统设置里读，改设置当场生效。
        /// 标了 [MaxWaitSec] 的接口用自己的时限，不受这里影响。
        /// </summary>
        public static int RpcTimeoutSec { get; set; } = Data.SystemSettingsRepository.DefaultRpcTimeoutSec;

        public static IList<ClusterAgent> OnlineUsers = new List<ClusterAgent>();

        /// <summary>
        /// 同一根 agent 连接上连续 RPC 超时的次数，键是 ConnectionId。
        /// 一次成功回执清零；累计到 <see cref="SuspectConnectionStreak"/> 就判定这条连接的回执通道不可信。
        /// </summary>
        static readonly ConcurrentDictionary<string, int> RpcTimeoutStreak = new();

        /// <summary>
        /// 连续超时到这个条数就点名并要求 agent 重连。取 3：单个接口偶发一次满窗超时有正常解释
        /// （冷启动、K8s 抖动），连着一串还都卡在同一个 ConnectionId 上，就不是巧合了。
        /// </summary>
        public const int SuspectConnectionStreak = 3;

        /// <summary>
        /// 这条连接现在该不该被判定失效并要求重建。只认「刚好越过阈值」那一次：
        /// 之后计数继续涨但不再重复发令，直到有一次成功回执把计数清零——否则每个后续超时都下一道令，
        /// agent 会被打成周期性抖动。
        /// </summary>
        public static bool ShouldRebuildConnection(int streak) => streak == SuspectConnectionStreak;

        /// <summary>已超时撤单的请求：id → (方法名, 超时时刻)，等迟到回执来认领。见 <see cref="MarkRpcTimedOut"/></summary>
        static readonly ConcurrentDictionary<Guid, (string Method, DateTime At)> TimedOutRpc = new();

        /// <summary>这张表的上限，超了先清 15 分钟前的，防止 agent 永不回话时无界增长</summary>
        const int TimedOutRpcCap = 500;

        /// <summary>记一次超时并返回该连接当前的连续次数</summary>
        public static int RecordRpcTimeout(string connectionId)
        {
            return RpcTimeoutStreak.AddOrUpdate(connectionId, 1, (_, n) => n + 1);
        }

        /// <summary>回执正常到达，说明这条连接还能用，清零</summary>
        public static void RecordRpcSuccess(string connectionId)
        {
            RpcTimeoutStreak.TryRemove(connectionId, out _);
        }

        /// <summary>连接断开时丢掉它的计数，ConnectionId 不复用，留着就是死数据</summary>
        public static void ForgetConnection(string connectionId)
        {
            RpcTimeoutStreak.TryRemove(connectionId, out _);
        }

        /// <summary>
        /// 调用方已经超时撤单，把请求挂到这张表上等迟到的回执来自首。
        /// 迟到回执是唯一能区分「回执丢在路上」和「回执到了但没人派发」的证据，
        /// 不记下来的话下次排查还是只能靠猜。
        /// </summary>
        public static void MarkRpcTimedOut(Guid id, string method)
        {
            if (TimedOutRpc.Count >= TimedOutRpcCap)
            {
                var cutoff = DateTime.UtcNow.AddMinutes(-15);
                foreach (var stale in TimedOutRpc.Where(x => x.Value.At < cutoff))
                {
                    TimedOutRpc.TryRemove(stale.Key, out _);
                }
            }

            TimedOutRpc[id] = (method, DateTime.UtcNow);
        }

        /// <summary>取走一条迟到回执对应的超时记录；回 false 表示这个 id 从没登记过</summary>
        public static bool TryTakeLateRpc(Guid id, out string method, out DateTime timedOutAt)
        {
            if (TimedOutRpc.TryRemove(id, out var entry))
            {
                method = entry.Method;
                timedOutAt = entry.At;
                return true;
            }

            method = null;
            timedOutAt = default;
            return false;
        }

        /// <summary>
        /// 按集群名取这条 agent 连接的 ConnectionId，集群不在线回 null。
        /// RPC 走 AgentApiProxy 里同样的查表，终端输入要单向投递所以借这个入口。
        /// </summary>
        public static string? FindAgentConnection(string clusterName)
        {
            lock (OnlineLock)
            {
                return OnlineUsers.FirstOrDefault(x => x.Name == clusterName)?.ConnectionId;
            }
        }
    }
}
