using System.Collections.Generic;

namespace KubeSpoke.Contracts.Dtos
{
    /// <summary>
    /// FastTunnel 客户端配置，结构对齐 FastTunnel.Client 的 appsettings.json 中 "FastTunnel" 节。
    /// agent 会把它摊平成 FastTunnel__* 环境变量注入容器，覆盖镜像内默认配置。
    /// </summary>
    public class FastTunnelConfig
    {
        public ServerInfo Server { get; set; } = new();

        /// <summary>服务端要求的登录令牌，为空表示服务端未开启校验。</summary>
        public string? Token { get; set; }

        /// <summary>HTTP 子域名穿透：${SubDomain}.${服务端 WebDomain} 访问内网 web 服务。</summary>
        public IList<Web> Webs { get; set; } = new List<Web>();

        /// <summary>TCP/UDP 端口转发：访问服务端 RemotePort 转发到内网 LocalIp:LocalPort。</summary>
        public IList<Forward> Forwards { get; set; } = new List<Forward>();

        public class ServerInfo
        {
            public string ServerAddr { get; set; } = "";
            public int ServerPort { get; set; }
        }

        public class Web
        {
            public string LocalIp { get; set; } = "";
            public int LocalPort { get; set; }
            public string SubDomain { get; set; } = "";
        }

        public class Forward
        {
            public string LocalIp { get; set; } = "";
            public int LocalPort { get; set; }
            public int RemotePort { get; set; }

            /// <summary>TCP 或 UDP，默认 TCP。</summary>
            public string Protocol { get; set; } = "TCP";
        }
    }
}
