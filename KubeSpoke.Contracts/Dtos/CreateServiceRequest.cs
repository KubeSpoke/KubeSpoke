using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class CreateServiceRequest : BaseRequest
    {
        public string Name { get; set; }

        public string AppName { get; set; }

        public string Namespace { get; set; }

        /// <summary>
        /// ClusterIP NodePort
        /// </summary>
        public string Type { get; set; }

        public int Port { get; set; } = 80;

        /// <summary>描述，写入注解 kubesphere.io/description</summary>
        public string Description { get; set; }

        /// <summary>用户标签，合并进 metadata.labels；app 键保留给 selector，不可覆盖</summary>
        public Dictionary<string, string> Labels { get; set; }
    }
}
