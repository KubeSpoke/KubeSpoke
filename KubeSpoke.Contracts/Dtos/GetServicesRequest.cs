using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class GetServicesRequest : BaseRequest
    {
        /// <summary>
        /// Service所属命名空间
        /// 为空时返回所有Pod
        /// </summary>
        public string Namespace { get; set; } = "default";
    }
}
