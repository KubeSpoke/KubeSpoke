using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class CreateDockerSecretRequest : BaseRequest
    {
        public string Name { get; set; }

        public string Namespace { get; set; } = "default";

        public string Domain { get; set; }

        public string Password { get; set; }

        public string UserName { get; set; }

        /// <summary>描述，写入注解 kubesphere.io/description</summary>
        public string Description { get; set; }

        /// <summary>用户标签，合并进 metadata.labels</summary>
        public Dictionary<string, string> Labels { get; set; }
    }
}
