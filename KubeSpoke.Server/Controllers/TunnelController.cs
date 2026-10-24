using System.Text.Json;
using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Server.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KubeSpoke.Server.Controllers
{
    /// <summary>
    /// 内网穿透隧道的管理口：隧道配置落库（重启不丢、可审计），
    /// 实际穿透由 agent 在目标集群拉起的 fasttunnel-client Pod 连接外部 FastTunnel 服务端完成。
    /// 实时状态按需查 Pod，不落库。
    /// </summary>
    [Authorize]
    public class TunnelController : BaseController
    {
        private const string DefaultClientImage = "springhgui/fasttunnel-client:latest";

        private readonly TunnelRepository tunnels;
        private readonly IAgentApis agentApis;
        private readonly IConfiguration configuration;
        private readonly ILogger<TunnelController> logger;

        public TunnelController(TunnelRepository tunnels, IAgentApis agentApis,
            IConfiguration configuration, ILogger<TunnelController> logger)
        {
            this.tunnels = tunnels;
            this.agentApis = agentApis;
            this.configuration = configuration;
            this.logger = logger;
        }

        private static readonly JsonSerializerOptions JsonOpts = new()
        {
            PropertyNamingPolicy = null,
        };

        /// <summary>新建隧道的请求体。ClustName 决定下发到哪个集群的 agent。</summary>
        public class TunnelCreateRequest
        {
            public string ClustName { get; set; } = "";
            public string Name { get; set; } = "";
            public string Namespace { get; set; } = "default";
            public string? Image { get; set; }
            public string ServerAddr { get; set; } = "";
            public int ServerPort { get; set; } = 1270;
            public string? Token { get; set; }
            public List<FastTunnelConfig.Web> Webs { get; set; } = new();
            public List<FastTunnelConfig.Forward> Forwards { get; set; } = new();
        }

        /// <summary>列出隧道（按集群过滤）。Token 不回传，只回一个 hasToken 标记。</summary>
        [HttpGet]
        public async Task<object> List([FromQuery] string? cluster)
        {
            var rows = await tunnels.ListAsync(cluster ?? "");
            return new { items = rows.Select(Project) };
        }

        /// <summary>
        /// 查一条隧道的实时 Pod 状态。agent 不在线或 Pod 已不在时回 phase=Unknown，不抛给前端。
        /// </summary>
        [HttpGet]
        public async Task<object> Status([FromQuery] long id)
        {
            var row = await tunnels.GetAsync(id);
            if (row == null) throw new ArgumentException("隧道不存在");

            try
            {
                var pod = agentApis.GetPodStatus(new ReadPodLogRequest
                {
                    ClustName = row.Cluster,
                    Name = row.PodName,
                    Namespace = row.Namespace,
                });
                var ready = pod.Status?.ContainerStatuses?.All(c => c.Ready) ?? false;
                return new
                {
                    id,
                    podName = row.PodName,
                    phase = pod.Status?.Phase ?? "Unknown",
                    ready,
                    startTime = pod.Status?.StartTime,
                    podIp = pod.Status?.PodIP,
                };
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "[查隧道状态失败] {PodName}", row.PodName);
                return new { id, podName = row.PodName, phase = "Unknown", ready = false, startTime = (DateTime?)null, podIp = "" };
            }
        }

        /// <summary>
        /// 新建隧道：先让 agent 把 fasttunnel-client Pod 建起来，拿到 Pod 名后再落库。
        /// agent 建 Pod 失败会抛异常（被 BXExceptionFilter 包成 success:false），此时不落库。
        /// </summary>
        [HttpPost]
        public async Task<object> Create([FromBody] TunnelCreateRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.ClustName))
                throw new ArgumentNullException(nameof(req.ClustName), "缺少 ClustName（未选择集群？）");
            if (string.IsNullOrWhiteSpace(req.ServerAddr))
                throw new ArgumentException("FastTunnel 服务端地址不能为空");
            if (req.ServerPort <= 0 || req.ServerPort > 65535)
                throw new ArgumentException("FastTunnel 服务端端口不合法");
            if (req.Webs.Count == 0 && req.Forwards.Count == 0)
                throw new ArgumentException("至少要配置一条 Web 穿透或端口转发");
            if (string.IsNullOrWhiteSpace(req.Name))
                throw new ArgumentException("隧道名称不能为空");

            var ns = string.IsNullOrWhiteSpace(req.Namespace) ? "default" : req.Namespace.Trim();
            var image = string.IsNullOrWhiteSpace(req.Image)
                ? (configuration["FastTunnelClientImage"] ?? DefaultClientImage)
                : req.Image!.Trim();

            var config = new FastTunnelConfig
            {
                Server = new FastTunnelConfig.ServerInfo { ServerAddr = req.ServerAddr.Trim(), ServerPort = req.ServerPort },
                Token = string.IsNullOrWhiteSpace(req.Token) ? null : req.Token.Trim(),
                Webs = req.Webs,
                Forwards = req.Forwards,
            };

            var pod = agentApis.CreateFastTunnelClient(new CreateFastTunnelClientRequest
            {
                ClustName = req.ClustName,
                FastTunnel = config,
                Image = image,
                Namespace = ns,
            });

            var entity = new TunnelEntity
            {
                Cluster = req.ClustName,
                Name = req.Name.Trim(),
                Namespace = ns,
                PodName = pod.Metadata?.Name ?? "",
                Image = image,
                ServerAddr = config.Server.ServerAddr,
                ServerPort = config.Server.ServerPort,
                Token = config.Token ?? "",
                WebsJson = JsonSerializer.Serialize(req.Webs, JsonOpts),
                ForwardsJson = JsonSerializer.Serialize(req.Forwards, JsonOpts),
                CreatedBy = User.Identity?.Name ?? "",
            };
            await tunnels.AddAsync(entity);
            return Project(entity);
        }

        /// <summary>删除隧道：先删集群里的 Pod（Pod 可能已不在，忽略其异常），再删库记录。</summary>
        [HttpPost]
        public async Task<bool> Delete([FromQuery] long id)
        {
            var row = await tunnels.GetAsync(id);
            if (row == null) return false;

            try
            {
                agentApis.DeletePod(new DeletePodRequest
                {
                    ClustName = row.Cluster,
                    Namespace = row.Namespace,
                    PodName = row.PodName,
                });
            }
            catch (Exception ex)
            {
                // Pod 已经不在了（手动删过、集群重建过）不该挡住库记录清理
                logger.LogWarning(ex, "[删隧道 Pod 失败，继续删库记录] {PodName}", row.PodName);
            }

            return await tunnels.RemoveAsync(id);
        }

        /// <summary>新建表单的默认值：镜像取自服务端配置，前端预填后可编辑。</summary>
        [HttpGet]
        public object Defaults() => new
        {
            image = configuration["FastTunnelClientImage"] ?? DefaultClientImage,
            serverPort = 1270,
        };

        /// <summary>把库记录投影成前端契约：Token 一律抹掉，Webs/Forwards 反序列化回数组。</summary>
        private static object Project(TunnelEntity t) => new
        {
            id = t.Id,
            cluster = t.Cluster,
            name = t.Name,
            @namespace = t.Namespace,
            podName = t.PodName,
            image = t.Image,
            serverAddr = t.ServerAddr,
            serverPort = t.ServerPort,
            hasToken = t.Token.Length > 0,
            webs = Deserialize<List<FastTunnelConfig.Web>>(t.WebsJson),
            forwards = Deserialize<List<FastTunnelConfig.Forward>>(t.ForwardsJson),
            createdBy = t.CreatedBy,
            createdAt = t.CreatedUtc.ToLocalTime(),
        };

        private static T Deserialize<T>(string json) where T : new()
        {
            try
            {
                return JsonSerializer.Deserialize<T>(json, JsonOpts) ?? new T();
            }
            catch (JsonException)
            {
                return new T();
            }
        }
    }
}
