namespace KubeSpoke.Contracts.Dtos
{
    /// <summary>
    /// 在目标集群拉起一个 fasttunnel-client Pod，由它主动连接外部 FastTunnel 服务端建立穿透。
    /// 服务端（KubeSpoke.Server）负责隧道落库，agent 只负责按此请求建 Pod。
    /// </summary>
    public class CreateFastTunnelClientRequest : BaseRequest
    {
        public FastTunnelConfig FastTunnel { get; set; } = new();

        /// <summary>fasttunnel-client 镜像，由服务端解析后下发；留空则用 agent 内置默认值。</summary>
        public string? Image { get; set; }

        /// <summary>Pod 所在命名空间，留空则用 default。</summary>
        public string? Namespace { get; set; }
    }
}
