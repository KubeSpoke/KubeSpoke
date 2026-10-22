using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class ReadPodLogRequest : BaseRequest
    {
        public string Name { get; set; }

        public string Namespace { get; set; }

        /// <summary>
        /// 这路日志推流的会话 id。服务端在浏览器断开时按它点名关流（见 ConstString.AGENT_LOG_CLOSE），
        /// 不给的话 agent 会自己造一个，那条流就只能等它自然读完才收得掉。
        /// </summary>
        public Guid SessionId { get; set; }
    }
}
