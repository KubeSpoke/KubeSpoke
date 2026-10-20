using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class BaseRequest
    {
        /// <summary>
        /// 服务端调用时必须传，用于过滤集群id，客户端则一般用不到该字段
        /// </summary>
        public string ClustName { get; set; }
#if DEBUG
            = ConstString.TEST_LUSTER_NAME;
#endif
    }
}
