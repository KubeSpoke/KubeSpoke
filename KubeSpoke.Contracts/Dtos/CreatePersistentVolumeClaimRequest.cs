using k8s.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class CreatePersistentVolumeClaimRequest : BaseRequest
    {
        public V1PersistentVolumeClaim Pvc { get; set; }
    }
}
