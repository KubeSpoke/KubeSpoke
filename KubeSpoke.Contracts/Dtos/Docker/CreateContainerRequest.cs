using Docker.DotNet.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos.Docker
{
    public class CreateContainerRequest : BaseRequest
    {
        public CreateContainerParameters Container { get; set; }
    }
}
