using KubeSpoke.Contracts;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace KubeSpoke.Agent.Connecting
{
    internal class AgentServiceConfigProvider
    {
        IConfiguration configuration;
        ILogger<AgentServiceConfigProvider> logger;

        public AgentServiceConfigProvider(IConfiguration configuration, ILogger<AgentServiceConfigProvider> logger)
        {
            this.logger = logger;
            this.configuration = configuration;
        }

        public AgentServiceConfig GetConfig()
        {
            var SERVER_ADDR = configuration.GetValue<string>("SERVER_ADDR");
            var CLUSTER_UUID = configuration.GetValue<string>("CLUSTER_UUID");
            var CLUSTER_SECRET = configuration.GetValue<string>("CLUSTER_SECRET");
            var CLUSTER_NAME = configuration.GetValue<string>("CLUSTER_NAME");

#if DEBUG
            // 调试默认值仅在未显式提供环境变量时生效
            if (SERVER_ADDR == null)
            {
                CLUSTER_UUID = ConstString.TEST_LUSTER_NAME;
                CLUSTER_NAME = "测试";
                SERVER_ADDR = $"https://localhost:39745/cluster-agent?uuid={CLUSTER_UUID}&name={CLUSTER_NAME}";
            }
#endif
            logger.LogInformation("[ClusterAgentService Created] SERVER_ADDR:{0},installUUID:{1},CLUSTER_NAME:{2}", SERVER_ADDR, CLUSTER_UUID, CLUSTER_NAME);

            if (SERVER_ADDR == null)
                throw new ArgumentNullException(nameof(SERVER_ADDR));

            if (CLUSTER_UUID == null)
                throw new ArgumentNullException(nameof(CLUSTER_UUID));

            return new AgentServiceConfig
            {
                ClusterSecret = CLUSTER_SECRET,
                ClusterUUID = CLUSTER_UUID,
                ServerAddr = SERVER_ADDR,
                ClusterName = CLUSTER_NAME,
            };
        }
    }
}
