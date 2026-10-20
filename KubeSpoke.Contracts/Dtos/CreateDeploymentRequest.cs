using k8s.Models;
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    public class CreateDeploymentRequest : BaseRequest
    {
        public string Name { get; set; }

        public string Namespace { get; set; }

        public int Replicas { get; set; }

        [MinLength(1)]
        public Container[] Containers { get; set; }

        public string[] ImagePullSecrets { get; set; }

        public IList<V1Volume> Volumes { get; set; }

        /// <summary>描述，写入 Deployment 注解 kubesphere.io/description</summary>
        public string Description { get; set; }

        /// <summary>用户标签，合并进 Deployment 与 Pod 模板 labels；app 键保留给选择器，忽略外部传入</summary>
        public Dictionary<string, string> Labels { get; set; }

        public class Container
        {
            public string Image { get; set; }

            public string ContainerName { get; set; }

            public int ContainerPort { get; set; }

            public int? HostPort { get; set; }

            public IList<V1EnvFromSource>? EnvFrom { get; set; }

            public IList<V1EnvVar>? Env { get; set; }

            public IList<V1VolumeMount> VolumeMounts { get; set; }
        }
    }
}
