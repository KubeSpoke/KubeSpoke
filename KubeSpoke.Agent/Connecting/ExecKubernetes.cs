using k8s;
using System.Net.WebSockets;
using System.Text;

namespace KubeSpoke.Agent.Connecting
{
    /// <summary>
    /// 比 Kubernetes 多一个能力：按自己拼的 URL 连 exec 的 WebSocket。
    /// 库上开放的那几个 exec 接口既不让你加查询参数，也只肯谈 v4——而 v4 里没有改尺寸的通道，
    /// 终端一开就固定在 80x24，所以协议版本和初始尺寸都得自己掌握。
    /// </summary>
    public class ExecKubernetes : Kubernetes
    {
        public ExecKubernetes(KubernetesClientConfiguration config) : base(config)
        {
        }

        public const string V4Protocol = "v4.channel.k8s.io";

        /// <summary>v5 只比 v4 多一条 resize 通道，但这条通道是 1.31 才有的，老集群握手时会直接拒掉</summary>
        public const string V5Protocol = "v5.channel.k8s.io";

        /// <summary>开一个 exec 通道。tty 下 stderr 和 stdout 是同一条流，所以不带 stderr 参数。</summary>
        public Task<WebSocket> ConnectExecAsync(string ns, string pod, string container, string command,
            string protocol, int cols, int rows, CancellationToken cancellationToken)
        {
            var query = new StringBuilder();
            query.Append("command=").Append(Uri.EscapeDataString(command));
            query.Append("&stdout=1&stdin=1&tty=1");
            if (!string.IsNullOrEmpty(container))
            {
                query.Append("&container=").Append(Uri.EscapeDataString(container));
            }

            // 这两位的唯一作用是给刚开出来的 PTY 定尺寸：v4 之后再也改不了，v5 也要等第一帧 resize
            query.Append("&cols=").Append(cols).Append("&rows=").Append(rows);

            var scheme = BaseUri.Scheme == "https" ? "wss" : "ws";
            var path = BaseUri.AbsolutePath.TrimEnd('/');
            var uri = new Uri($"{scheme}://{BaseUri.Authority}{path}/api/v1/namespaces/{ns}/pods/{pod}/exec?{query}");

            return StreamConnectAsync(uri, protocol, null, cancellationToken);
        }
    }
}
