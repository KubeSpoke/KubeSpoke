namespace KubeSpoke.Server.Models
{
    public class ClusterAgent
    {
        /// <summary>
        /// 集群标识
        /// </summary>
        public string Identity { get; set; }

        /// <summary>
        /// 集群别名
        /// </summary>
        public string Name { get; set; }

        /// <summary>
        /// 这条 agent 连接的 SignalR ConnectionId，RPC 只能按它投递
        /// </summary>
        public string ConnectionId { get; set; }
    }
}
