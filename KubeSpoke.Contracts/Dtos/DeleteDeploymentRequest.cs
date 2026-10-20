using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class DeleteDeploymentRequest : BaseRequest
    {
        public string Name { get; set; }

        public string Namespace { get; set; }
    }
}
