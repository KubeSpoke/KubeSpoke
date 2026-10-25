using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class ReplaceImageRequest : BaseRequest
    {
        public string Name { get; set; }

        public string Namespace { get; set; }

        public string Image { get; set; }

        /// <summary>要改哪个容器；留空则改第一个（历史行为）</summary>
        public string ContainerName { get; set; }
    }
}
