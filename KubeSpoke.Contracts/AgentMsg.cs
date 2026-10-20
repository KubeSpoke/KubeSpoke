using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts
{
    public class AgentMsg
    {
        public string Cmd { get; set; }

        public object Data { get; set; }

        public enum CmdEnum
        {

        }
    }
}
