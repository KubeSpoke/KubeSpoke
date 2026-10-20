using k8s.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class CreateIngressRequest : BaseRequest
    {
        public string Name { get; set; }

        public string Namespace { get; set; }

        public string IngressClassName { get; set; }

        public IList<V1IngressTLS>? Tls { get; set; }

        public List<V1IngressRule> Rules { get; set; }

        /// <summary>描述，写入注解 kubesphere.io/description</summary>
        public string Description { get; set; }

        /// <summary>用户标签，合并进 metadata.labels</summary>
        public Dictionary<string, string> Labels { get; set; }
    }
}
