using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class ListReplicaSetRequest : BaseNamespacedRequest
    {
        public string LabelSelector { get; set; }
    }
}
