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

        public static IList<ClusterAgent> OnlineUsers = new List<ClusterAgent>();
    }
}
