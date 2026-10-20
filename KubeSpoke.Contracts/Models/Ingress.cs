using k8s.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Models
{
    public class Ingress : K8sResource
    {
        public IList<V1IngressRule> Rules { get; set; }
    }
}
