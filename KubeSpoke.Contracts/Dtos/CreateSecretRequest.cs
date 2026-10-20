using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class CreateTlsSecretRequest : BaseRequest
    {
        public string Namespace { get; set; }

        public string Name { get; set; }

        public string Base64PfxFile { get; set; }

        public string PassWord { get; set; }

        /// <summary>描述，写入注解 kubesphere.io/description</summary>
        public string Description { get; set; }

        /// <summary>用户标签，合并进 metadata.labels</summary>
        public Dictionary<string, string> Labels { get; set; }
    }
}
