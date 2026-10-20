using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class DeletePodRequest : BaseRequest
    {
        public string Namespace { get; set; }

        public string PodName { get; set; }
    }
}
