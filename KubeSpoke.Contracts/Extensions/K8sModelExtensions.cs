using k8s.Models;
using k8s;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Extensions
{
    public static class K8sModelExtensions
    {
        public static string NamespaceOrDefault(this IMetadata<V1ObjectMeta> obj) => obj?.Metadata?.NamespaceProperty ?? "default";
    }
}
