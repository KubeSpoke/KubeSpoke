using k8s.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class CreateConfigMapRequest : BaseRequest
    {
        public V1ConfigMap ConfigMap { get; set; }

        public string Namespace { get; set; }
    }
}
