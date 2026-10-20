using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class RPCResponse
    {
        public object? ReturnData { get; set; }

        public Guid RequestId { get; set; }

        public string Exception { get; set; }
    }
}
