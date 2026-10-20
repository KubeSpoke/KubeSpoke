using k8s.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class CreateIngressClassRequest : V1IngressClass
    {
        public string ClustName { get; set; }
#if DEBUG
            = ConstString.TEST_LUSTER_NAME;
#endif
    }
}
