using KubeSpoke.Agent.Models;
using KubeSpoke.Contracts.Dtos;
using k8s;
using k8s.Autorest;
using k8s.Models;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace KubeSpoke.Agent.Apis
{
    /// <summary>
    /// 通用 K8s 资源读写（覆盖 KubeSphere「集群管理」下尚未有专属接口的资源类型）。
    /// 内置类型走类型化 API，确保 core 组与常见组稳定可用；未知组回落到 CustomObjects，
    /// 从而支持任意自定义资源（CR）。
    /// </summary>
    public partial class AgentApiImpl
    {
        // group=="" 表示 core 组。key 用 $"{group}/{plural}"，namespaced 由调用方是否带命名空间决定。
        public object ListResources(ListResourcesRequest request)
        {
            var group = request.Group ?? "";
            var ns = request.Namespace;
            var namespaced = !string.IsNullOrEmpty(ns);
            var key = $"{group}/{request.Plural}";

            try
            {
                switch (key)
                {
                    case "/pods": return namespaced ? client.CoreV1.ListNamespacedPod(ns).Items : client.CoreV1.ListPodForAllNamespaces().Items;
                    case "/services": return namespaced ? client.CoreV1.ListNamespacedService(ns).Items : client.CoreV1.ListServiceForAllNamespaces().Items;
                    case "/serviceaccounts": return namespaced ? client.CoreV1.ListNamespacedServiceAccount(ns).Items : client.CoreV1.ListServiceAccountForAllNamespaces().Items;
                    case "/persistentvolumes": return client.CoreV1.ListPersistentVolume().Items;
                    case "/persistentvolumeclaims": return namespaced ? client.CoreV1.ListNamespacedPersistentVolumeClaim(ns).Items : client.CoreV1.ListPersistentVolumeClaimForAllNamespaces().Items;
                    case "/configmaps": return namespaced ? client.CoreV1.ListNamespacedConfigMap(ns).Items : client.CoreV1.ListConfigMapForAllNamespaces().Items;
                    case "/secrets": return namespaced ? client.CoreV1.ListNamespacedSecret(ns).Items : client.CoreV1.ListSecretForAllNamespaces().Items;
                    case "apps/deployments": return namespaced ? client.AppsV1.ListNamespacedDeployment(ns).Items : client.AppsV1.ListDeploymentForAllNamespaces().Items;
                    case "apps/statefulsets": return namespaced ? client.AppsV1.ListNamespacedStatefulSet(ns).Items : client.AppsV1.ListStatefulSetForAllNamespaces().Items;
                    case "apps/daemonsets": return namespaced ? client.AppsV1.ListNamespacedDaemonSet(ns).Items : client.AppsV1.ListDaemonSetForAllNamespaces().Items;
                    case "apps/replicasets": return namespaced ? client.AppsV1.ListNamespacedReplicaSet(ns).Items : client.AppsV1.ListReplicaSetForAllNamespaces().Items;
                    case "batch/jobs": return namespaced ? client.BatchV1.ListNamespacedJob(ns).Items : client.BatchV1.ListJobForAllNamespaces().Items;
                    case "batch/cronjobs": return namespaced ? client.BatchV1.ListNamespacedCronJob(ns).Items : client.BatchV1.ListCronJobForAllNamespaces().Items;
                    case "networking.k8s.io/ingresses": return namespaced ? client.NetworkingV1.ListNamespacedIngress(ns).Items : client.NetworkingV1.ListIngressForAllNamespaces().Items;
                    case "storage.k8s.io/storageclasses": return client.StorageV1.ListStorageClass().Items;
                    case "rbac.authorization.k8s.io/roles": return namespaced ? client.RbacAuthorizationV1.ListNamespacedRole(ns).Items : client.RbacAuthorizationV1.ListRoleForAllNamespaces().Items;
                    case "rbac.authorization.k8s.io/clusterroles": return client.RbacAuthorizationV1.ListClusterRole().Items;
                    case "rbac.authorization.k8s.io/rolebindings": return namespaced ? client.RbacAuthorizationV1.ListNamespacedRoleBinding(ns).Items : client.RbacAuthorizationV1.ListRoleBindingForAllNamespaces().Items;
                    case "rbac.authorization.k8s.io/clusterrolebindings": return client.RbacAuthorizationV1.ListClusterRoleBinding().Items;
                    case "apiextensions.k8s.io/customresourcedefinitions": return client.ApiextensionsV1.ListCustomResourceDefinition().Items;
                }
            }
            catch (HttpOperationException ex)
            {
                // 资源在该集群不存在对应 CRD / 权限不足：回落到通用接口再试一次
                logger?.LogWarning("ListResources typed failed for {Key}: {Msg}", key, ex.Message);
            }

            // 通用回落（自定义资源组等）
            return namespaced
                ? client.CustomObjects.ListNamespacedCustomObject(group, request.Version, ns, request.Plural)
                : client.CustomObjects.ListClusterCustomObject(group, request.Version, request.Plural);
        }

        public object ReadResource(DeleteResourceRequest request)
        {
            var group = request.Group ?? "";
            var key = $"{group}/{request.Plural}";
            // 对内置常见资源做类型化单读，返回完整 spec/status（如 Pod 详情需要容器与环境变量）
            try
            {
                switch (key)
                {
                    case "/pods": return client.CoreV1.ReadNamespacedPod(request.Name, request.Namespace);
                    case "/services": return client.CoreV1.ReadNamespacedService(request.Name, request.Namespace);
                    case "/configmaps": return client.CoreV1.ReadNamespacedConfigMap(request.Name, request.Namespace);
                    case "/secrets": return client.CoreV1.ReadNamespacedSecret(request.Name, request.Namespace);
                    case "apps/deployments": return client.AppsV1.ReadNamespacedDeployment(request.Name, request.Namespace);
                    case "apps/statefulsets": return client.AppsV1.ReadNamespacedStatefulSet(request.Name, request.Namespace);
                    case "apps/daemonsets": return client.AppsV1.ReadNamespacedDaemonSet(request.Name, request.Namespace);
                    case "batch/cronjobs": return client.BatchV1.ReadNamespacedCronJob(request.Name, request.Namespace);
                    case "batch/jobs": return client.BatchV1.ReadNamespacedJob(request.Name, request.Namespace);
                    case "networking.k8s.io/ingresses": return client.NetworkingV1.ReadNamespacedIngress(request.Name, request.Namespace);
                }
            }
            catch (HttpOperationException)
            {
                // 落到通用读取
            }

            var items = ListResources(new ListResourcesRequest
            {
                ClustName = request.ClustName,
                Group = request.Group,
                Version = request.Version,
                Plural = request.Plural,
                Namespace = request.Namespace,
            });

            // 未命中不能再回落成整个列表：否则详情页会把全部对象当成目标对象展示
            return FindByName(items, request.Name);
        }

        public bool DeleteResource(DeleteResourceRequest request)
        {
            var group = request.Group ?? "";
            var ns = request.Namespace;
            var key = $"{group}/{request.Plural}";
            var handled = true;

            try
            {
                switch (key)
                {
                    case "/pods": client.CoreV1.DeleteNamespacedPod(request.Name, ns); break;
                    case "/services": client.CoreV1.DeleteNamespacedService(request.Name, ns); break;
                    case "/serviceaccounts": client.CoreV1.DeleteNamespacedServiceAccount(request.Name, ns); break;
                    case "/persistentvolumes": client.CoreV1.DeletePersistentVolume(request.Name); break;
                    case "/persistentvolumeclaims": client.CoreV1.DeleteNamespacedPersistentVolumeClaim(request.Name, ns); break;
                    case "/configmaps": client.CoreV1.DeleteNamespacedConfigMap(request.Name, ns); break;
                    case "/secrets": client.CoreV1.DeleteNamespacedSecret(request.Name, ns); break;
                    case "apps/deployments": client.AppsV1.DeleteNamespacedDeployment(request.Name, ns); break;
                    case "apps/statefulsets": client.AppsV1.DeleteNamespacedStatefulSet(request.Name, ns); break;
                    case "apps/daemonsets": client.AppsV1.DeleteNamespacedDaemonSet(request.Name, ns); break;
                    case "batch/jobs": client.BatchV1.DeleteNamespacedJob(request.Name, ns); break;
                    case "batch/cronjobs": client.BatchV1.DeleteNamespacedCronJob(request.Name, ns); break;
                    case "networking.k8s.io/ingresses": client.NetworkingV1.DeleteNamespacedIngress(request.Name, ns); break;
                    case "storage.k8s.io/storageclasses": client.StorageV1.DeleteStorageClass(request.Name); break;
                    case "rbac.authorization.k8s.io/roles": client.RbacAuthorizationV1.DeleteNamespacedRole(request.Name, ns); break;
                    case "rbac.authorization.k8s.io/clusterroles": client.RbacAuthorizationV1.DeleteClusterRole(request.Name); break;
                    case "apiextensions.k8s.io/customresourcedefinitions": client.ApiextensionsV1.DeleteCustomResourceDefinition(request.Name); break;
                    default: handled = false; break;
                }
            }
            catch (HttpOperationException ex) when (ex.Response != null && ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                return true; // 已不存在，视为删除成功
            }

            if (!handled)
            {
                if (!string.IsNullOrEmpty(ns))
                    client.CustomObjects.DeleteNamespacedCustomObject(group, request.Version, ns, request.Plural, request.Name);
                else
                    client.CustomObjects.DeleteClusterCustomObject(group, request.Version, request.Plural, request.Name);
            }

            Alert(IAlertor.Level.Warning, "删除资源", $"{request.Plural}/{request.Name}");
            return true;
        }

        public bool ApplyResource(ApplyResourceRequest request)
        {
            var docs = KubernetesYaml.LoadAllFromString(request.Yaml);
            foreach (var item in docs)
            {
                var meta = GetMetadata(item);
                var hasVersion = meta != null && !string.IsNullOrEmpty(ReadProp(meta, "ResourceVersion"));
                ApplyOne(item, hasVersion);
            }
            return true;
        }

        public IEnumerable<Corev1Event> GetResourceEvents(GetResourceEventsRequest request)
        {
            var ns = request.Namespace;
            var all = string.IsNullOrEmpty(ns);
            IEnumerable<Corev1Event> list = all
                ? client.CoreV1.ListEventForAllNamespaces().Items
                : client.CoreV1.ListNamespacedEvent(ns).Items;
            return list
                .Where(e => e.InvolvedObject != null
                    && string.Equals(e.InvolvedObject.Name, request.Name, StringComparison.Ordinal)
                    && (string.IsNullOrEmpty(request.Kind)
                        || string.Equals(e.InvolvedObject.Kind, request.Kind, StringComparison.OrdinalIgnoreCase)))
                .ToList();
        }

        public object GetClusterInfo(ClusterInfoRequest request)
        {
            var nodes = client.CoreV1.ListNode().Items;
            var ns = client.CoreV1.ListNamespace().Items;
            var firstInfo = nodes.FirstOrDefault(x => x.Status?.NodeInfo != null)?.Status?.NodeInfo;
            return new
            {
                nodes = nodes.Count,
                readyNodes = nodes.Count(x => x.Status?.Conditions?.Any(c => c.Type == "Ready" && c.Status == "True") == true),
                namespaces = ns.Count,
                kubernetesVersion = firstInfo?.KubeletVersion ?? "-",
                os = firstInfo?.OsImage ?? "-",
                arch = firstInfo?.Architecture ?? "-",
                runtime = firstInfo?.ContainerRuntimeVersion ?? "-",
            };
        }

        // ---------- 内部辅助 ----------

        private static object GetMetadata(object item) => item.GetType().GetProperty("Metadata")?.GetValue(item);

        private static string ReadProp(object obj, string prop) => obj?.GetType().GetProperty(prop)?.GetValue(obj) as string;

        private static string NameOf(object item)
        {
            if (item is JsonElement je)
            {
                if (je.ValueKind != JsonValueKind.Object) return null;
                if (je.TryGetProperty("metadata", out var meta) && meta.ValueKind == JsonValueKind.Object
                    && meta.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String)
                    return n.GetString();
                return null;
            }
            var metaObj = GetMetadata(item);
            var name = ReadProp(metaObj, "Name");
            if (name != null) return name;
            // 字典形态兜底
            if (item is IDictionary<string, object> dict
                && dict.TryGetValue("metadata", out var m)
                && m is IDictionary<string, object> mm
                && mm.TryGetValue("name", out var n2))
                return n2 as string;
            if (item is Newtonsoft.Json.Linq.JObject jo)
                return jo["metadata"]?["name"]?.ToString();
            return null;
        }

        private static string NsOf(object item)
        {
            if (item is JsonElement je
                && je.TryGetProperty("metadata", out var meta) && meta.ValueKind == JsonValueKind.Object
                && meta.TryGetProperty("namespace", out var ns) && ns.ValueKind == JsonValueKind.String)
                return ns.GetString();
            var v = ReadProp(GetMetadata(item), "NamespaceProperty") ?? ReadProp(GetMetadata(item), "Namespace");
            return string.IsNullOrEmpty(v) ? "default" : v;
        }

        private static object FindByName(object list, string name)
        {
            // CustomObjects 回落返回 JsonElement 形态的列表对象
            if (list is JsonElement je)
            {
                JsonElement arr;
                if (je.ValueKind == JsonValueKind.Array) arr = je;
                else if (je.TryGetProperty("items", out arr) && arr.ValueKind == JsonValueKind.Array) { }
                else return null;
                foreach (var o in arr.EnumerateArray())
                {
                    if (string.Equals(NameOf(o), name, StringComparison.Ordinal)) return o;
                }
                return null;
            }
            if (list is System.Collections.IEnumerable en)
            {
                foreach (var o in en)
                {
                    try { if (string.Equals(NameOf(o), name, StringComparison.Ordinal)) return o; }
                    catch { /* 匿名对象等无 Metadata，忽略 */ }
                }
            }
            // 带 items 属性的列表对象：继续在 items 里按名字挑
            var itemsProp = list?.GetType().GetProperty("items") ?? list?.GetType().GetProperty("Items");
            if (itemsProp?.GetValue(list) is System.Collections.IEnumerable itemsEn)
            {
                foreach (var o in itemsEn)
                {
                    try { if (string.Equals(NameOf(o), name, StringComparison.Ordinal)) return o; }
                    catch { /* 无 Metadata 形态的对象忽略 */ }
                }
            }
            return null;
        }

        private void ApplyOne(object item, bool replace)
        {
            var t = item.GetType().Name;
            var ns = NsOf(item);
            var nm = NameOf(item);

            void Do(string op, Func<object> create, Func<object> doReplace)
            {
                try
                {
                    if (replace) doReplace();
                    else create();
                }
                catch (HttpOperationException ex) when (ex.Response != null && ex.Response.StatusCode == System.Net.HttpStatusCode.Conflict)
                {
                    // 已存在则替换；不存在则创建
                    if (replace) create(); else doReplace();
                }
            }

            switch (t)
            {
                case nameof(V1Deployment): Do("deploy", () => client.AppsV1.CreateNamespacedDeployment((V1Deployment)item, ns), () => client.AppsV1.ReplaceNamespacedDeployment((V1Deployment)item, nm, ns)); break;
                case nameof(V1StatefulSet): Do("sts", () => client.AppsV1.CreateNamespacedStatefulSet((V1StatefulSet)item, ns), () => client.AppsV1.ReplaceNamespacedStatefulSet((V1StatefulSet)item, nm, ns)); break;
                case nameof(V1DaemonSet): Do("ds", () => client.AppsV1.CreateNamespacedDaemonSet((V1DaemonSet)item, ns), () => client.AppsV1.ReplaceNamespacedDaemonSet((V1DaemonSet)item, nm, ns)); break;
                case nameof(V1Job): Do("job", () => client.BatchV1.CreateNamespacedJob((V1Job)item, ns), () => client.BatchV1.ReplaceNamespacedJob((V1Job)item, nm, ns)); break;
                case nameof(V1CronJob): Do("cron", () => client.BatchV1.CreateNamespacedCronJob((V1CronJob)item, ns), () => client.BatchV1.ReplaceNamespacedCronJob((V1CronJob)item, nm, ns)); break;
                case nameof(V1Pod): Do("pod", () => client.CoreV1.CreateNamespacedPod((V1Pod)item, ns), () => throw new Exception("Pod 不可原地替换，请删除后重建")); break;
                case nameof(V1Service): Do("svc", () => client.CoreV1.CreateNamespacedService((V1Service)item, ns), () => client.CoreV1.ReplaceNamespacedService((V1Service)item, nm, ns)); break;
                case nameof(V1ServiceAccount): Do("sa", () => client.CoreV1.CreateNamespacedServiceAccount((V1ServiceAccount)item, ns), () => client.CoreV1.ReplaceNamespacedServiceAccount((V1ServiceAccount)item, nm, ns)); break;
                case nameof(V1ConfigMap): Do("cm", () => client.CoreV1.CreateNamespacedConfigMap((V1ConfigMap)item, ns), () => client.CoreV1.ReplaceNamespacedConfigMap((V1ConfigMap)item, nm, ns)); break;
                case nameof(V1Secret): Do("secret", () => client.CoreV1.CreateNamespacedSecret((V1Secret)item, ns), () => client.CoreV1.ReplaceNamespacedSecret((V1Secret)item, nm, ns)); break;
                case nameof(V1PersistentVolumeClaim): Do("pvc", () => client.CoreV1.CreateNamespacedPersistentVolumeClaim((V1PersistentVolumeClaim)item, ns), () => client.CoreV1.ReplaceNamespacedPersistentVolumeClaim((V1PersistentVolumeClaim)item, nm, ns)); break;
                case nameof(V1PersistentVolume): Do("pv", () => client.CoreV1.CreatePersistentVolume((V1PersistentVolume)item), () => client.CoreV1.ReplacePersistentVolume((V1PersistentVolume)item, nm)); break;
                case nameof(V1Ingress): Do("ing", () => client.NetworkingV1.CreateNamespacedIngress((V1Ingress)item, ns), () => client.NetworkingV1.ReplaceNamespacedIngress((V1Ingress)item, nm, ns)); break;
                case nameof(V1StorageClass): Do("sc", () => client.StorageV1.CreateStorageClass((V1StorageClass)item), () => client.StorageV1.ReplaceStorageClass((V1StorageClass)item, nm)); break;
                case nameof(V1Namespace): Do("ns", () => client.CoreV1.CreateNamespace((V1Namespace)item), () => client.CoreV1.ReplaceNamespace((V1Namespace)item, nm)); break;
                default:
                    ApplyCustomObject(item, replace, ns, nm);
                    break;
            }
        }

        /// <summary>未知类型（自定义资源 CR）走 CustomObjects，按 apiVersion 拆分 group/version。</summary>
        private void ApplyCustomObject(object item, bool replace, string ns, string nm)
        {
            var apiVersion = ReadProp(item, "ApiVersion") ?? "";
            var kind = ReadProp(item, "Kind") ?? "";
            var idx = apiVersion.IndexOf('/');
            var group = idx > 0 ? apiVersion[..idx] : "";
            var version = idx > 0 ? apiVersion[(idx + 1)..] : apiVersion;
            var plural = Pluralize(kind);

            try
            {
                if (replace)
                {
                    if (!string.IsNullOrEmpty(ns))
                        client.CustomObjects.ReplaceNamespacedCustomObject(item, group, version, ns, plural, nm);
                    else
                        client.CustomObjects.ReplaceClusterCustomObject(item, group, version, plural, nm);
                }
                else
                {
                    if (!string.IsNullOrEmpty(ns))
                        client.CustomObjects.CreateNamespacedCustomObject(item, group, version, ns, plural);
                    else
                        client.CustomObjects.CreateClusterCustomObject(item, group, version, plural);
                }
            }
            catch (HttpOperationException ex) when (ex.Response != null && ex.Response.StatusCode == System.Net.HttpStatusCode.Conflict)
            {
                // 冲突时反向尝试一次
                if (!string.IsNullOrEmpty(ns))
                    client.CustomObjects.CreateNamespacedCustomObject(item, group, version, ns, plural);
                else
                    client.CustomObjects.CreateClusterCustomObject(item, group, version, plural);
            }
        }

        private static string Pluralize(string kind)
        {
            var lower = (kind ?? "").ToLowerInvariant();
            if (lower.EndsWith("s")) return lower + "es";
            if (lower.EndsWith("y")) return lower[..^1] + "ies";
            return lower + "s";
        }

        /// <summary>
        /// 合并用户标签到 metadata.labels。appKey 非空时把该键固定为 appValue 且不可被用户覆盖
        /// （Service/Deployment 的选择器依赖它）。
        /// </summary>
        private static Dictionary<string, string> BuildLabels(
            IDictionary<string, string> user, string appKey = null, string appValue = null)
        {
            var labels = new Dictionary<string, string>();
            if (user != null)
            {
                foreach (var kv in user)
                {
                    if (string.IsNullOrWhiteSpace(kv.Key)) continue;
                    if (appKey != null && kv.Key == appKey) continue; // 保留键不让覆盖
                    labels[kv.Key] = kv.Value ?? string.Empty;
                }
            }
            if (appKey != null) labels[appKey] = appValue ?? string.Empty;
            return labels;
        }

        /// <summary>描述写入 kubesphere.io/description 注解；空则返回 null（不产生空注解对象）。</summary>
        private static Dictionary<string, string> BuildAnnotations(string description)
        {
            if (string.IsNullOrWhiteSpace(description)) return null;
            return new Dictionary<string, string> { ["kubesphere.io/description"] = description };
        }
    }
}
