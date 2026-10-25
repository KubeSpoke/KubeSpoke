using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class ListImageTagsRequest : BaseRequest
    {
        /// <summary>
        /// 镜像全名，含仓库地址与 tag（tag 可省）：registry.cn-hangzhou.aliyuncs.com/ns/app:1.2.3
        /// </summary>
        public string Image { get; set; }

        /// <summary>
        /// 去哪个命名空间找拉取凭证（imagePullSecrets 里的 dockerconfigjson），找不到就匿名拉
        /// </summary>
        public string Namespace { get; set; } = "default";
    }
}
