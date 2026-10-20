using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Models
{
    public class Deployment
    {
        public string Name { get; set; }

        public string Namespace { get; set; }

        public IDictionary<string, string> Annotations { get; set; }

        public IDictionary<string, string> Labels { get; set; }

        public DateTime? CreationTime { get; set; }

        public DeploymentStatus Status { get; set; }

        public string[] Images { get; set; }

        public class DeploymentStatus
        {
            public int ReadyReplicas { get; set; }

            public int Replicas { get; set; }
        }
    }
}
