using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Agent.Connecting
{
    internal class AgentServiceConfig
    {
        /// <summary>
        /// DevOps服务地址
        /// </summary>
        public string ServerAddr { get; set; }

        /// <summary>
        /// 集群编号
        /// </summary>
        public string ClusterUUID { get; set; }

        /// <summary>
        /// 集群密钥
        /// </summary>
        public string ClusterSecret { get; set; }

        public string ClusterName { get; set; }
    }
}
