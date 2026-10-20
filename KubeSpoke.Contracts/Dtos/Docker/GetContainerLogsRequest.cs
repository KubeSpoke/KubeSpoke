using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos.Docker
{
    public class GetContainerLogsRequest : BaseRequest
    {
        public string Id { get; set; }
    }
}
