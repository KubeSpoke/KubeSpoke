using KubeSpoke.Agent.Models;
using KubeSpoke.Contracts.Dtos;
using k8s;
using k8s.Autorest;
using k8s.Models;
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace KubeSpoke.Agent.Apis
{
    /// <summary>
    /// 内网穿透：把 FastTunnel 客户端配置以环境变量注入，在集群里拉起一个 fasttunnel-client Pod。
    /// Pod 起来后自行连接外部 FastTunnel 服务端注册隧道，agent 不常驻任何穿透进程。
    /// </summary>
    public partial class AgentApiImpl
    {
        /// <summary>服务端没下发镜像时的兜底值，正常路径由服务端按配置解析后填进请求。</summary>
        private const string DefaultFastTunnelClientImage = "springhgui/fasttunnel-client:latest";

        public V1Pod CreateFastTunnelClient(CreateFastTunnelClientRequest request)
        {
            if (request.FastTunnel == null)
                throw new ArgumentException("缺少 FastTunnel 配置");
            if (string.IsNullOrWhiteSpace(request.FastTunnel.Server?.ServerAddr))
                throw new ArgumentException("FastTunnel 服务端地址不能为空");

            var image = string.IsNullOrWhiteSpace(request.Image) ? DefaultFastTunnelClientImage : request.Image!.Trim();
            var ns = string.IsNullOrWhiteSpace(request.Namespace) ? "default" : request.Namespace!.Trim();
            var podName = $"ftclient-{Guid.NewGuid():N}"[..20];

            var env = new List<V1EnvVar>();
            foreach (var (key, value) in FlattenConfig(request.FastTunnel))
                env.Add(new V1EnvVar { Name = $"FastTunnel__{key}", Value = value });

            var pod = new V1Pod
            {
                ApiVersion = "v1",
                Kind = "Pod",
                Metadata = new V1ObjectMeta
                {
                    Name = podName,
                    Labels = new Dictionary<string, string>
                    {
                        { "app", "fasttunnel-client" },
                        { "app.kubernetes.io/managed-by", "kubespoke" },
                    },
                },
                Spec = new V1PodSpec
                {
                    RestartPolicy = "Always",
                    Containers = new List<V1Container>
                    {
                        new V1Container
                        {
                            Name = "fasttunnel-client",
                            Image = image,
                            ImagePullPolicy = "IfNotPresent",
                            Env = env,
                        },
                    },
                },
            };

            var created = client.CoreV1.CreateNamespacedPod(pod, ns);
            created.Metadata.ManagedFields = null;
            Alert(IAlertor.Level.Noarmal, "创建内网穿透", $"{ns}/{created.Metadata.Name} → {request.FastTunnel.Server.ServerAddr}:{request.FastTunnel.Server.ServerPort}");
            return created;
        }

        /// <summary>
        /// 把配置对象摊平成 .NET 环境变量约定的 key（双下划线分层、数组按下标），
        /// 例如 Server.ServerAddr → Server__ServerAddr，Webs[0].LocalIp → Webs__0__LocalIp。
        /// </summary>
        private static IEnumerable<KeyValuePair<string, string>> FlattenConfig(FastTunnelConfig config)
        {
            var json = JsonSerializer.Serialize(config, new JsonSerializerOptions
            {
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            });
            using var doc = JsonDocument.Parse(json);
            var result = new List<KeyValuePair<string, string>>();
            Walk(doc.RootElement, "", result);
            return result;
        }

        private static void Walk(JsonElement element, string prefix, List<KeyValuePair<string, string>> output)
        {
            switch (element.ValueKind)
            {
                case JsonValueKind.Object:
                    foreach (var prop in element.EnumerateObject())
                        Walk(prop.Value, prefix.Length == 0 ? prop.Name : $"{prefix}__{prop.Name}", output);
                    break;
                case JsonValueKind.Array:
                    var index = 0;
                    foreach (var item in element.EnumerateArray())
                        Walk(item, $"{prefix}__{index++}", output);
                    break;
                default:
                    output.Add(new KeyValuePair<string, string>(prefix, element.ToString()));
                    break;
            }
        }
    }
}
