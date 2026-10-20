using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Models
{
    public class K8sResource
    {
        /// <summary>
        /// 资源名称
        /// </summary>
        public string Name { get; set; }

        /// <summary>
        /// 资源所属命名空间
        /// </summary>
        public string Namespace { get; set; }

        /// <summary>
        /// 注解
        /// </summary>
        public IDictionary<string, string> Annotations { get; set; }

        /// <summary>
        /// 标签
        /// </summary>
        public IDictionary<string, string> Labels { get; set; }

        /// <summary>
        /// 创建时间
        /// </summary>
        public DateTime? CreationTime { get; set; }
    }
}
