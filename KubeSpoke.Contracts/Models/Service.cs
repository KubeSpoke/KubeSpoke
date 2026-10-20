using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Models
{
    public class Service
    {
        public string Name { get; set; }

        public string Namespace { get; set; }

        public string Type { get; set; }

        public string[] ClusterIPs { get; set; }

        public string[] ExternalIPs { get; set; }

        public IDictionary<string, string> Labels { get; set; }

        public DateTime? CreationTime { get; set; }

        public IDictionary<string, string> Annotations { get; set; }

        public ServicePort[] Ports { get; set; }

        public class ServicePort
        {
            public int Port { get; set; }

            public string Protocol { get; set; }

            public int? NodePort { get; set; }

            public string Name { get; set; }

            public string TargetPort { get; set; }
        }
    }
}
