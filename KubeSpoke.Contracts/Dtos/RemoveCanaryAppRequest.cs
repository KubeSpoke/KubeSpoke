using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class RemoveCanaryAppRequest : BaseNamespacedRequest
    {
        public string Name { get; set; }

        public bool NoAlert { get; set; }
    }
}
