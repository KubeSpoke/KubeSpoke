using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class RPCRequest
    {
        public string MethodName { get; set; }

        public object?[]? Args { get; set; }

        public Guid RequestId { get; set; }
    }
}
