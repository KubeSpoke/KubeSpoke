using k8s.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class CreateCanaryAppResponse
    {
        public CreateCanaryAppResponse(V1Deployment canaryDeployment, V1Service canaryService, V1Ingress canaryIngress)
        {
            CanaryDeployment = canaryDeployment;
            CanaryService = canaryService;
            CanaryIngress = canaryIngress;
        }

        public V1Deployment CanaryDeployment { get; }
        public V1Service CanaryService { get; }
        public V1Ingress CanaryIngress { get; }
    }
}
