using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Contracts.Extensions;
using KubeSpoke.Contracts.Models;
using k8s;
using k8s.Autorest;
using k8s.Models;
using Microsoft.AspNetCore.JsonPatch;
using Microsoft.IdentityModel.Tokens;
using System.Collections.Generic;
using System.Data;
using System.Net.Http.Headers;
using System.Reflection.Emit;
using System.Runtime.Intrinsics.Arm;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Text.Unicode;
using System.Threading.Channels;
using System.Xml.Linq;
using static KubeSpoke.Contracts.Models.Service;
using static System.Net.Mime.MediaTypeNames;
using KubeSpoke.Agent.Connecting;
using KubeSpoke.Agent.Models;
using Microsoft.Extensions.Logging;

namespace KubeSpoke.Agent.Apis
{
    public partial class AgentApiImpl : IAgentApis
    {
        Kubernetes client;
        IAlertor? alertor;
        ILogger<AgentApiImpl> logger;

        public AgentApiImpl(Kubernetes clusterCtl, IAlertor? alertor, ILogger<AgentApiImpl> logger)
        {
            this.client = clusterCtl;
            this.alertor = alertor;
            this.logger = logger;
        }

        void Alert(IAlertor.Level level, string title, string msg)
        {
            alertor?.Alert(level, title, msg);
        }

        public V1Pod DeletePod(DeletePodRequest request)
        {
            var res = client.CoreV1.DeleteNamespacedPod(request.PodName, request.Namespace);
            res.Metadata.ManagedFields = null;
            Alert(IAlertor.Level.Noarmal, "销毁POD", $"{request.Namespace}/{request.PodName}");
            return res;
        }

        /// <summary>
        /// 获取集群所有节点信息
        /// </summary>
        /// <param name="request"></param>
        /// <returns></returns>
        public IEnumerable<V1Node> GetNodes(GetNodesRequest request)
        {
            var nodes = client.CoreV1.ListNode();
            return nodes.Items;
        }

        /// <summary>
        /// 获取集群所有命名空间信息
        /// </summary>
        /// <param name="request"></param>
        /// <returns></returns>
        public IEnumerable<Namespace> GetNamespaces(GetNamespaceRequest request)
        {
            var namespaces = client.CoreV1.ListNamespace();
            return namespaces.Items.Select(x => new Namespace
            {
                Name = x.Name(),
                CreationTime = x.CreationTimestamp(),
            });
        }

        public Namespace CreateNamespace(CreateNamespaceRequest request)
        {
            var res = client.CoreV1.CreateNamespace(new V1Namespace
            {
                ApiVersion = "v1",
                Kind = "Namespace",
                Metadata = new V1ObjectMeta
                {
                    Name = request.Name,
                }
            });

            return new Namespace
            {
                Name = res.Metadata.Name,
                CreationTime = res.CreationTimestamp(),
            };
        }

        public bool DeleteNamespace(CreateNamespaceRequest request)
        {
            var res = client.CoreV1.DeleteNamespace(request.Name);
            return res.Code == 0;
        }

        /// <summary>
        /// 获取命名空间下的所有Pod信息，
        /// 当命名空间名称不传，则获取所有pod信息
        /// </summary>
        /// <param name="request"></param>
        /// <returns></returns>
        public IEnumerable<V1Pod> GetPods(GetPodsRequest request)
        {
            var podList = client.CoreV1.ListNamespacedPod(request.Namespace);
            return podList.Items.Select(x => new V1Pod
            {
                Metadata = new V1ObjectMeta
                {
                    Name = x.Metadata.Name,
                    NamespaceProperty = x.Metadata.Namespace(),
                    CreationTimestamp = x.CreationTimestamp(),
                    Labels = x.Metadata.Labels
                },
                Spec = new V1PodSpec
                {
                    Containers = x.Spec.Containers.Select(y => new V1Container
                    {
                        Image = y.Image,
                    }).ToList()
                },
                Status = new V1PodStatus
                {
                    HostIP = x.Status.HostIP,
                    PodIP = x.Status.PodIP,
                    Phase = x.Status.Phase
                },
            });

            // TODO:不知道数据哪里有问题还是会导致服务端异常关闭连接
            //foreach (var item in podList.Items)
            //{
            //    item.Metadata.ManagedFields = null;
            //}

            //return podList.Items;
        }

        public V1Deployment GetDeployment(GetDeploymentRequest request)
        {
            if (string.IsNullOrEmpty(request.Namespace))
            {
                request.Namespace = "default";
            }

            var deployment = client.AppsV1.ReadNamespacedDeployment(request.Name, request.Namespace);
            deployment.Metadata.ManagedFields = null;
            return deployment;
        }

        public IEnumerable<Deployment> GetDeployments(GetDeploymentsRequest request)
        {
            if (string.IsNullOrEmpty(request.Namespace))
            {
                request.Namespace = "default";
            }

            var deploymentList = client.AppsV1.ListNamespacedDeployment(request.Namespace);

            return deploymentList.Items.Select(x => new Deployment
            {
                Name = x.Metadata.Name,
                Namespace = x.Metadata.Namespace(),
                Annotations = x.Annotations(),
                Labels = x.Labels(),
                Status = new Deployment.DeploymentStatus { ReadyReplicas = x.Status?.ReadyReplicas ?? 0, Replicas = x.Status?.Replicas ?? 0 },
                CreationTime = x.CreationTimestamp(),
                Images = x.Spec.Template.Spec.Containers.Select(x => x.Image).ToArray()
            });
        }

        public bool DeleteDeployment(DeleteDeploymentRequest request)
        {
            var res = client.AppsV1.DeleteNamespacedDeployment(request.Name, request.Namespace);
            Alert(IAlertor.Level.Warning, "销毁应用", $"{request.Namespace}/{request.Name}");
            return res.Code == 0;
        }

        public Deployment CreateDeployment(CreateDeploymentRequest request)
        {
            //---
            //apiVersion: apps/v1
            //kind: Deployment
            //metadata:
            //  name: sdada-{{ .AppStack.envName }}
            //  labels:
            //    run: sdada-{{ .AppStack.envName }}
            //  # 命名空间配置：
            //  # 建议每个环境使用不同的Kubernetes集群命名空间，以便达到环境隔离效果
            //  # 部署时云效会将占位符{{ .Values.namespace }}替换成右侧设置的实际值
            //  namespace: {{ .Values.namespace }}
            //spec:
            //  replicas: 1
            //  selector:
            //    matchLabels:
            //      run: sdada-{{ .AppStack.envName }}
            //  template:
            //    metadata:
            //      labels:
            //        run: sdada-{{ .AppStack.envName }}
            //    spec:
            //      containers:
            //        - name: main
            //          # 镜像配置：
            //          # 部署时云效会将预置占位符{{ .AppStack.image.backend }}替换成实际部署时的镜像
            //          # 支持在新建部署单时手动输入镜像地址，也支持接收流水线的上游构建产物
            //          # 另外，在右侧镜像占位符处添加多个镜像，可以支持SideCar或InitContainer等多容器场景
            //          image: {{ .AppStack.image.backend }}
            //          # 端口配置：
            //          ports:
            //            - containerPort: 8080
            //          # 资源规格配置：
            //          # 当不同环境有不同的CPU或内存资源规格要求时，可以定义占位符搭配变量组使用
            //          # 如，设置{{ .Values.cpuLimit }}占位符，部署时云效会将占位符{{ .Values.cpuLimit }}替换成右侧设置的实际值
            //          resources:
            //            limits:
            //              cpu: {{ .Values.cpuLimit }}
            //              memory: {{ .Values.memoryLimit }}
            //            requests:
            //              cpu: {{ .Values.cpuRequest }}
            //              memory: {{ .Values.memoryRequest }}
            //          # 生命周期配置：
            //          #lifecycle:
            //          #  preStop:
            //          #    exec:
            //          #      command: [ "/bin/bash", "-c", "sleep 10" ]
            //          # 探活配置：
            //          #livenessProbe:
            //          #  initialDelaySeconds: 10
            //          #  failureThreshold: 3
            //          #  periodSeconds: 5
            //          #  successThreshold: 1
            //          #  timeoutSeconds: 2
            //          #  httpGet:
            //          #    scheme: HTTP
            //          #    path: /health
            //          #    port: 7002
            //          # 就绪探测配置：
            //          #readinessProbe:
            //          #  initialDelaySeconds: 60
            //          #  failureThreshold: 4
            //          #  periodSeconds: 10
            //          #  successThreshold: 1
            //          #  timeoutSeconds: 3
            //          #  httpGet:
            //          #    scheme: HTTP
            //          #    port: 7002
            //          #    path: /health

            var dpName = request.Name;
            var nameSpace = request.Namespace;
            var Replicas = request.Replicas;

            // 用户标签合并进 labels，app 键保留给选择器（最后写入，外部无法覆盖）
            var labels = new Dictionary<string, string>();
            if (request.Labels != null)
            {
                foreach (var kv in request.Labels)
                {
                    if (!string.IsNullOrWhiteSpace(kv.Key) && kv.Key != "app")
                        labels[kv.Key] = kv.Value ?? string.Empty;
                }
            }
            labels["app"] = dpName;

            var annotations = new Dictionary<string, string>();
            if (!string.IsNullOrWhiteSpace(request.Description))
                annotations["kubesphere.io/description"] = request.Description;

            var dp = new V1Deployment
            {
                Status = new V1DeploymentStatus(),
                ApiVersion = "apps/v1",
                Kind = "Deployment",
                Metadata = new V1ObjectMeta
                {
                    Name = dpName,
                    Labels = new Dictionary<string, string>(labels),
                    Annotations = annotations.Count > 0 ? annotations : null,
                    NamespaceProperty = nameSpace,
                },
                Spec = new V1DeploymentSpec
                {
                    Replicas = Replicas,
                    Selector = new V1LabelSelector()
                    {
                        MatchLabels = new Dictionary<string, string> {
                            { "app", dpName}
                        }
                    },
                    Template = new V1PodTemplateSpec
                    {
                        Metadata = new V1ObjectMeta()
                        {
                            Labels = new Dictionary<string, string>(labels),
                        },
                        Spec = new V1PodSpec
                        {
                            ImagePullSecrets = request.ImagePullSecrets?.Select(x => new V1LocalObjectReference(x)).ToList(),
                            Containers = request.Containers.Select(x =>
                            {
                                return new V1Container
                                {
                                    Env = x.Env,
                                    EnvFrom = x.EnvFrom,
                                    Name = x.ContainerName,
                                    Image = x.Image,//  "springhgui/hello-aspnetcore:latest",
                                    Ports = new List<V1ContainerPort>() {
                                            new V1ContainerPort() {
                                                ContainerPort = x.ContainerPort, // 80
                                                HostPort = x.HostPort
                                            }
                                        },
                                    //Resources = new V1ResourceRequirements
                                    //{
                                    //    Limits = new Dictionary<string, ResourceQuantity>{
                                    //            { "cpu", new ResourceQuantity ("1") },
                                    //            { "memory", new ResourceQuantity ("1024Mi") }
                                    //        },
                                    //    Requests = new Dictionary<string, ResourceQuantity>
                                    //        {
                                    //            { "cpu", new ResourceQuantity ("0.01")},
                                    //            { "memory", new ResourceQuantity ("32Mi")}
                                    //        }
                                    //},
                                    VolumeMounts = x.VolumeMounts
                                };
                            }).ToList(),
                            Volumes = request.Volumes
                        }
                    }
                },
            };
            dp.Validate();

            var res = client.AppsV1.CreateNamespacedDeployment(dp, nameSpace);

            return new Deployment
            {
                Name = res.Name(),
                Labels = res.Labels(),
                Annotations = res.Annotations(),
                CreationTime = res.CreationTimestamp(),
                Namespace = res.NamespaceOrDefault(),
                Status = new Deployment.DeploymentStatus
                {
                    ReadyReplicas = res.Status?.ReadyReplicas ?? 0,
                    Replicas = res.Status?.Replicas ?? 0,
                }
            };
        }

        public Service CreateService(CreateServiceRequest request)
        {
            //---
            //apiVersion: v1
            //kind: Service
            //metadata:
            //  name: {{ .AppStack.envName }}
            //  # 命名空间配置：
            //  # 建议每个环境使用不同的Kubernetes集群命名空间，以便达到环境隔离效果
            //  # 部署时云效会将占位符{{ .Values.namespace }}替换成右侧设置的实际值
            //  namespace: {{ .Values.namespace }}
            //spec:
            //  selector:
            //    run: {{ .AppStack.envName }}
            //  ports:
            //    - protocol: TCP
            //      port: 80
            //      targetPort: 8080

            var service = new V1Service
            {
                ApiVersion = "v1",
                Kind = "Service",
                Metadata = new V1ObjectMeta
                {
                    Name = request.Name,
                    NamespaceProperty = request.Namespace,
                    Labels = BuildLabels(request.Labels, "app", request.AppName),
                    Annotations = BuildAnnotations(request.Description),
                },
                Spec = new V1ServiceSpec
                {
                    Type = request.Type, // ClusterIP NodePort
                    Selector = new Dictionary<string, string> { { "app", request.AppName } },
                    Ports = new V1ServicePort[]
                    {
                        new V1ServicePort{
                            //NodePort = 8080,
                            Port = request.Port == 0 ? 80 : request.Port,
                            //TargetPort = 80,
                        }
                    }
                }
            };

            var res = client.CoreV1.CreateNamespacedService(service, request.Namespace);

            return new Service
            {
                Name = res.Name(),
                Namespace = res.NamespaceOrDefault(),
            };
        }

        public bool DeleteService(DeleteServiceRequest request)
        {
            try
            {
                var res = client.CoreV1.DeleteNamespacedService(request.Name, request.Namespace);
                Alert(IAlertor.Level.Warning, "销毁服务", $"{request.Namespace}/{request.Name}");
                return true;
            }
            catch (JsonException jex) { }
            catch (Exception)
            {
                throw;
            }

            return true;
        }

        public IEnumerable<Service> GetServices(GetServicesRequest request)
        {
            var res = client.CoreV1.ListNamespacedService(request.Namespace);
            return res.Items.Select(x => new Service
            {
                Name = x.Name(),
                Namespace = x.NamespaceOrDefault(),
                Type = x.Spec.Type,
                ClusterIPs = x.Spec.ClusterIPs.ToArray(),
                ExternalIPs = x.Spec.ExternalIPs?.ToArray(),
                Ports = x.Spec.Ports.Select(p => new ServicePort
                {
                    Port = p.Port,
                    Protocol = p.Protocol,
                    TargetPort = p.TargetPort.Value,
                    NodePort = p.NodePort,
                    Name = p.Name
                }).ToArray(),
                Labels = x.Metadata.Labels,
                CreationTime = x.Metadata.CreationTimestamp,
                Annotations = x.Metadata.Annotations,
            });
        }

        /// <summary>
        /// 等于以下命令
        /// kubectl create secret docker-registry harbor-secret --namespace=default --docker-server=<your-harbor> --docker-username=<user> --docker-password=<password> --dry-run -o yaml
        /// </summary>
        /// <param name="request"></param>
        /// <returns></returns>
        public Secret CreateDockerRegistrySecret(CreateDockerSecretRequest request)
        {
            // apiVersion: v1
            // data:
            //   .dockerconfigjson: <base64 of your docker config json>
            // kind: Secret
            // metadata:
            //   creationTimestamp: null
            //   name: harbor-secret
            //   namespace: default
            // type: kubernetes.io/dockerconfigjson

            var config = new DockerConfig
            {
                auths = new Dictionary<string, DockerConfig.RegistryAuth>() { {
                    request.Domain, new DockerConfig.RegistryAuth { password = request.Password, username = request.UserName } } }
            };

            var res = client.CoreV1.CreateNamespacedSecret(new V1Secret
            {
                ApiVersion = "v1",
                Kind = "Secret",
                Type = "kubernetes.io/dockerconfigjson",
                Metadata = new V1ObjectMeta
                {
                    Name = request.Name,
                    NamespaceProperty = request.Namespace,
                    Labels = BuildLabels(request.Labels),
                    Annotations = BuildAnnotations(request.Description),
                },
                Data = new Dictionary<string, byte[]>() { { ".dockerconfigjson", Encoding.UTF8.GetBytes(JsonSerializer.Serialize(config)) } }
            }, request.Namespace);

            return new Secret
            {
                Name = res.Name(),
                Namespace = res.NamespaceOrDefault(),
                CreationTime = res.CreationTimestamp(),
                Type = res.Type,
                Data = res.Data
            };
        }

        public V1Secret CreateTlsSecret(CreateTlsSecretRequest request)
        {
            var rawData = Convert.FromBase64String(request.Base64PfxFile);
            var pass = string.IsNullOrEmpty(request.PassWord) ? null : request.PassWord;

            X509Certificate2 x509 = X509CertificateLoader.LoadPkcs12(rawData, pass, X509KeyStorageFlags.Exportable);
            var rsaPri = x509.GetRSAPrivateKey();
            if (rsaPri == null)
            {
                throw new Exception("读取私钥失败");
            }

            var cert = Convert.ToBase64String(x509.GetRawCertData());
            var pkcs8Pri = Convert.ToBase64String(rsaPri.ExportPkcs8PrivateKey());

            var sb = new StringBuilder();
            sb.AppendLine("-----BEGIN CERTIFICATE-----");
            AppendBody(sb, cert);
            sb.AppendLine("-----END CERTIFICATE-----");

            cert = sb.ToString();

            sb.Clear();
            sb.AppendLine("-----BEGIN RSA PRIVATE KEY-----");
            AppendBody(sb, pkcs8Pri);
            sb.AppendLine("-----END RSA PRIVATE KEY-----");
            pkcs8Pri = sb.ToString();

            var secret = client.CoreV1.CreateNamespacedSecret(new V1Secret
            {
                ApiVersion = "v1",
                Kind = "Secret",
                Type = "kubernetes.io/tls",
                Metadata = new V1ObjectMeta
                {
                    Name = request.Name,
                    NamespaceProperty = request.Namespace,
                    Labels = BuildLabels(request.Labels),
                    Annotations = BuildAnnotations(request.Description),
                },
                Data = new Dictionary<string, byte[]>() {
                    { "tls.crt", Encoding.UTF8.GetBytes(cert)},
                    { "tls.key", Encoding.UTF8.GetBytes(pkcs8Pri) }
                }
            }, request.Namespace);

            return secret;
        }

        private static void AppendBody(StringBuilder sb, string key)
        {
            var count = Convert.ToInt32(Math.Ceiling(key.Length * 1.0 / 64));
            for (int i = 0; i < count; i++)
            {
                var start = i * 64;
                var end = start + 64;
                if (end >= key.Length)
                {
                    end = key.Length;
                }
                sb.AppendLine(key[start..end]);
            }
        }

        public bool DeleteSecret(DeleteSecretRequest request)
        {
            var status = client.CoreV1.DeleteNamespacedSecret(request.Name, request.Namespace);
            Alert(IAlertor.Level.Warning, "删除密钥", $"{request.Namespace}/{request.Name}");
            return status.Code == 0;
        }

        public IEnumerable<Secret> GetSecrets(GetSecretsRequest request)
        {
            var res = client.CoreV1.ListNamespacedSecret(request.Namespace);
            return res.Items.Select(x => new Secret
            {
                Name = x.Name(),
                Namespace = x.NamespaceOrDefault(),
                CreationTime = x.CreationTimestamp(),
                Type = x.Type,
                Data = x.Data
            });
        }

        public IEnumerable<Ingress> GetIngressList(GetIngressListRequest request)
        {
            var ingressList = client.NetworkingV1.ListNamespacedIngress(request.Namespace);
            return ingressList.Items.Select(x => new Ingress
            {
                Name = x.Name(),
                Namespace = x.NamespaceOrDefault(),
                Labels = x.Labels(),
                Annotations = x.Annotations(),
                CreationTime = x.CreationTimestamp(),
                Rules = x.Spec.Rules
            });
        }

        public bool DeleteIngress(DeleteIngressRequest request)
        {
            var res = client.NetworkingV1.DeleteNamespacedIngress(request.Name, request.Namespace);
            Alert(IAlertor.Level.Warning, "删除Ingress", $"{request.Namespace}/{request.Name}");
            return res.Code == 0;
        }

        public V1Ingress CreateIngress(CreateIngressRequest request)
        {
            var ingress = client.NetworkingV1.CreateNamespacedIngress(new V1Ingress
            {
                ApiVersion = "networking.k8s.io/v1",
                Kind = "Ingress",
                Metadata = new V1ObjectMeta
                {
                    Name = request.Name,
                    Labels = BuildLabels(request.Labels),
                    Annotations = BuildAnnotations(request.Description),
                },
                Spec = new V1IngressSpec
                {
                    Tls = request.Tls,
                    IngressClassName = request.IngressClassName,
                    Rules = request.Rules
                },
            }, request.Namespace);

            return ingress;
        }

        public IEnumerable<V1IngressClass> GetIngressClassList(GetIngressClassListRequest request)
        {
            return client.NetworkingV1.ListIngressClass().Items;
        }

        public V1IngressClass CreateIngressClass(CreateIngressClassRequest request)
        {
            return client.NetworkingV1.CreateIngressClass(request);
        }

        public bool DeleteIngressClass(DeleteIngressClassRequest request)
        {
            var res = client.NetworkingV1.DeleteIngressClass(request.Name);
            return res.Code == 0;
        }

        public Secret CreateSecret(CreateDockerSecretRequest request)
        {
            throw new NotImplementedException();
        }

        public IList<V1PersistentVolumeClaim> GetPersistentVolumeClaimList(GetPersistentVolumeClaimListRequest request)
        {
            return client.CoreV1.ListNamespacedPersistentVolumeClaim(request.Namespace).Items;
        }

        public V1PersistentVolumeClaim CreatePersistentVolumeClaim(CreatePersistentVolumeClaimRequest request)
        {
            return client.CoreV1.CreateNamespacedPersistentVolumeClaim(request.Pvc, request.Pvc.NamespaceOrDefault());
        }

        public V1PersistentVolumeClaim DeletePersistentVolumeClaim(DeletePersistentVolumeClaimRequest request)
        {
            return client.CoreV1.DeleteNamespacedPersistentVolumeClaim(request.Name, request.Namespace);
        }

        public IEnumerable<V1PersistentVolume> GetPersistentVolumeList(GetPersistentVolumeListRequest request)
        {
            return client.CoreV1.ListPersistentVolume().Items;
        }

        public IEnumerable<V1StorageClass> GetStorageClassList(GetStorageClassListRequest request)
        {
            return client.StorageV1.ListStorageClass().Items;
        }

        #region 应用

        private bool ApplyYaml(string yaml, bool delete)
        {
            var list = KubernetesYaml.LoadAllFromString(yaml);
            foreach (var item in list)
            {
                if (item is V1ServiceAccount)
                {
                    var svca = (V1ServiceAccount)item;
                    if (delete)
                        client.CoreV1.DeleteNamespacedServiceAccount(svca.Name(), svca.NamespaceOrDefault());
                    else
                        client.CoreV1.ReplaceNamespacedServiceAccount(svca, svca.Namespace(), svca.Namespace());
                }
                else if (item is V1Service)
                {
                    var svc = (V1Service)item;
                    if (delete)
                        client.CoreV1.DeleteNamespacedService(svc.Name(), svc.NamespaceOrDefault());
                    else
                        client.CoreV1.CreateNamespacedService(svc, svc.NamespaceOrDefault());
                }
                else if (item is V1Deployment)
                {
                    var dep = item as V1Deployment;
                    if (delete)
                        client.AppsV1.DeleteNamespacedDeployment(dep.Name(), dep.NamespaceOrDefault());
                    else
                        client.AppsV1.CreateNamespacedDeployment(dep, dep.NamespaceOrDefault());
                }
                else if (item is V1ClusterRole)
                {
                    var cr = item as V1ClusterRole;
                    if (delete)
                        client.RbacAuthorizationV1.DeleteClusterRole(cr.Name());
                    else
                        client.RbacAuthorizationV1.CreateClusterRole(cr);
                }
                else if (item is V1ClusterRoleBinding)
                {
                    var crb = item as V1ClusterRoleBinding;
                    if (delete)
                        client.RbacAuthorizationV1.DeleteClusterRoleBinding(crb.Name());
                    else
                        client.RbacAuthorizationV1.CreateClusterRoleBinding(crb);
                }
                else if (item is V1Role)
                {
                    var role = item as V1Role;
                    if (delete)
                        client.RbacAuthorizationV1.DeleteNamespacedRole(role.Name(), role.NamespaceOrDefault());
                    else
                        client.RbacAuthorizationV1.CreateNamespacedRole(role, role.NamespaceOrDefault());
                }
                else if (item is V1RoleBinding)
                {
                    var rb = item as V1RoleBinding;
                    if (delete)
                        client.RbacAuthorizationV1.DeleteNamespacedRoleBinding(rb.Name(), rb.NamespaceOrDefault());
                    else
                        client.RbacAuthorizationV1.CreateNamespacedRoleBinding(rb, rb.NamespaceOrDefault());
                }
                else if (item is V1StorageClass)
                {
                    var sc = item as V1StorageClass;
                    if (delete)
                        client.StorageV1.DeleteStorageClass(sc.Name());
                    else
                        client.StorageV1.CreateStorageClass(sc);
                }
                else if (item is V1Pod)
                {
                    var pd = item as V1Pod;
                    if (delete)
                        client.CoreV1.DeleteNamespacedPod(pd.Name(), pd.NamespaceOrDefault());
                    else
                        client.CoreV1.CreateNamespacedPod(pd, pd.NamespaceOrDefault());
                }
                else if (item is V1PersistentVolumeClaim)
                {
                    var pvc = item as V1PersistentVolumeClaim;
                    if (delete)
                        client.CoreV1.DeleteNamespacedPersistentVolumeClaim(pvc.Name(), pvc.NamespaceOrDefault());
                    else
                        client.CoreV1.CreateNamespacedPersistentVolumeClaim(pvc, pvc.NamespaceOrDefault());
                }
                else
                {
                    throw new Exception($"未实现：{item.GetType().Name}");
                }
            }

            return true;
        }


        public bool InstallNfsProvisioner(InstallNfsProvisionerRequest request)
        {
            var yaml = File.ReadAllText("Apps/nfs-provisioner/deployment.yaml");
            ApplyYaml(yaml, false);
            var test = File.ReadAllText("Apps/nfs-provisioner/test.yaml");
            ApplyYaml(test, false);
            return true;
        }

        #endregion
        /// <summary>
        /// 获取deployment详情
        /// </summary>
        /// <param name="request"></param>
        /// <returns></returns>
        public V1Deployment ReadNamespacedDeployment(ReadNamespacedDeploymentRequest request)
        {
            return client.AppsV1.ReadNamespacedDeployment(request.Name, request.Namespace);
        }

        public V1ReplicaSetList ListNamespacedReplicaSet()
        {
            return client.AppsV1.ListNamespacedReplicaSet("kubespoke");
        }

        public V1ConfigMap CreateConfigMap(CreateConfigMapRequest request)
        {
            return client.CoreV1.CreateNamespacedConfigMap(request.ConfigMap, request.Namespace);
        }

        public V1ConfigMap GetConfigMap(GetConfigMapRequest request)
        {
            return client.CoreV1.ReadNamespacedConfigMap(request.Name, request.Namespace);
        }

        public bool DeleteConfigMap(DeleteConfigMapRequest request)
        {
            Alert(IAlertor.Level.Warning, "删除CongigMap", $"{request.Namespace}/{request.Name}");
            return client.CoreV1.DeleteNamespacedConfigMap(
                request.Name, request.Namespace).Code == 0;
        }

        public IEnumerable<V1ConfigMap> GetConfigMaps(GetConfigMapsRequest request)
        {
            return client.CoreV1.ListNamespacedConfigMap(request.Namespace).Items;
        }

        public V1Deployment ReplaceImage(ReplaceImageRequest request)
        {
            var deploy = client.AppsV1.ReadNamespacedDeployment(request.Name, request.Namespace);
            var oldVersion = deploy.Spec.Template.Spec.Containers.First().Image;

            Alert(IAlertor.Level.Warning, "镜像版本变更", $"{request.Namespace}/{request.Name}: {oldVersion} -> {request.Image}");

            deploy.Spec.Template.Spec.Containers.First().Image = request.Image;
            return client.AppsV1.ReplaceNamespacedDeployment(deploy, request.Name, request.Namespace);
        }

        public ChannelReader<string> ReadPodLog(ReadPodLogRequest request)
        {
            // 没带会话 id 就现造一个：宁可这条流暂时不可寻址，也不能让两个会话抢同一个键互相踢
            var sessionId = request.SessionId == Guid.Empty ? Guid.NewGuid() : request.SessionId;

            // 先登记再取流：取流这段时间里浏览器可能已经关掉了面板，那时 LogClose 得有个会话可关
            var (reader, cts, output) = LogSessions.Open(sessionId);
            var token = cts.Token;

            try
            {
                // 取流留在调用线程上做：pod 不存在、权限不够这些错要照 RPC 回执原路回给调用方，
                // 挪进后台任务就成了静默失败——日志面板只会显示一片空白。
                var stream = client.CoreV1.ReadNamespacedPodLog(request.Name, request.Namespace);

                // 会话已经被关掉了的话 Attach 顺手把这条响应流收走
                if (!LogSessions.Attach(sessionId, stream))
                {
                    return reader;
                }

                Task.Run(async () =>
                {
                    try
                    {
                        byte[] buffer = new byte[4096];
                        while (true)
                        {
                            var count = await stream.ReadAsync(buffer, token).ConfigureAwait(false);
                            if (count == 0) { break; }
                            var logs = Encoding.UTF8.GetString(buffer, 0, count);
                            await output.WriteAsync(logs, token).ConfigureAwait(false);
                        }
                    }
                    catch (OperationCanceledException)
                    {
                        // 面板关了，正常收摊
                    }
                    catch (ObjectDisposedException)
                    {
                        // 被关掉的同时响应流也 Dispose 了，读循环从这边醒过来同样是正常收摊
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(ex, $"[日志推流中断] {request.Namespace}/{request.Name}");
                    }
                    finally
                    {
                        LogSessions.Remove(sessionId);
                    }
                });

                return reader;
            }
            catch
            {
                // 半途失败也必须把 writer 完成掉：服务端那侧等的是 stream.Completion，
                // 不落地就等于每开一次日志面板永久吃掉一个该连接的 invocation 槽位，攒够就整条 RPC 通道瘫掉
                LogSessions.Remove(sessionId);
                throw;
            }
        }

        public V1Pod GetPodStatus(ReadPodLogRequest request)
        {
            var pod = client.CoreV1.ReadNamespacedPodStatus(request.Name, request.Namespace);
            pod.Metadata.ManagedFields = null;
            return pod;
        }

        public IEnumerable<Corev1Event> GetEvents(GetEventsRequest request)
        {
            var events = client.CoreV1.ListNamespacedEvent(request.Namespace).Items;
            foreach (var ev in events)
            {
                //ev.Metadata.ManagedFields = null;
                ev.Metadata = null;
                ev.InvolvedObject = null;
            }

            return events;
        }

        public IEnumerable<PodMetrics> GetPodsMetrics(GetPodsMetricsRequest request)
        {
            var NodeMetricsList = client.GetKubernetesPodsMetricsAsync().ConfigureAwait(false).GetAwaiter().GetResult();
            return NodeMetricsList.Items;
        }

        public IEnumerable<NodeMetrics> GetNodesMetrics(GetPodsMetricsRequest request)
        {
            var NodeMetricsList = client.GetKubernetesNodesMetricsAsync().ConfigureAwait(false).GetAwaiter().GetResult();
            return NodeMetricsList.Items;
        }

        public V1Scale GetReplicaSetScale(GetReplicaSetScaleRequest request)
        {
            return client.AppsV1.ReadNamespacedReplicaSetScale(request.Name, request.Namespace, true);
        }

        public V1ReplicaSet GetReplicaSet(GetReplicaSetScaleRequest request)
        {
            return client.AppsV1.ReadNamespacedReplicaSet(request.Name, request.Namespace, true);
        }

        public IList<V1ReplicaSet> ListReplicaSet(ListReplicaSetRequest request)
        {
            return client.AppsV1.ListNamespacedReplicaSet(request.Namespace, labelSelector: request.LabelSelector).Items;
        }

        public bool RemoveCanaryApp(RemoveCanaryAppRequest request)
        {
            var canaryName = $"{request.Name}{CANARY}";

            try
            {
                client.NetworkingV1.DeleteNamespacedIngress(canaryName, request.Namespace);
            }
            catch (Exception ex)
            {
            }

            try
            {
                client.CoreV1.DeleteNamespacedService(canaryName, request.Namespace);
            }
            catch (Exception ex)
            {
            }

            try
            {
                client.AppsV1.DeleteNamespacedDeployment(canaryName, request.Namespace);
            }
            catch (Exception ex)
            {
            }

            if (!request.NoAlert)
            {
                Alert(IAlertor.Level.Noarmal, "取消灰度发布", $"{request.Namespace}/{request.Name}");
            }

            return true;
        }

        /// <summary>
        /// 金丝雀
        /// </summary>
        const string CANARY = "-canary";

        public CreateCanaryAppResponse CreateCanaryApp(CreateCanaryAppRequest request)
        {
            var canaryName = $"{request.Name}{CANARY}";

            // 创建ingress
            var ingress = client.NetworkingV1.ReadNamespacedIngress(request.Name, request.Namespace);
            if (ingress == null)
            {
                throw new Exception($"ingress不存在，不支持金丝雀发布:{request.Namespace}/{request.Name}");
            }

            // 创建deployment
            var deployment = client.AppsV1.ReadNamespacedDeployment(request.Name, request.Namespace);
            if (deployment == null)
            {
                throw new Exception($"应用不存在:{request.Namespace}/{request.Name}");
            }

            deployment.Metadata.ResourceVersion = null;
            deployment.Metadata.Annotations.Clear();

            deployment.Metadata.Name = canaryName;
            deployment.Metadata.Labels.Remove("app");
            deployment.Metadata.Labels.Add("app", canaryName);

            deployment.Spec.Selector.MatchLabels.Remove("app");
            deployment.Spec.Selector.MatchLabels.Add("app", canaryName);

            deployment.Spec.Template.Metadata.Labels.Remove("app");
            deployment.Spec.Template.Metadata.Labels.Add("app", canaryName);
            if (deployment.Spec.Template.Spec.Containers.Count > 1)
            {
                throw new Exception("暂不支持多个镜像的deployment");
            }

            deployment.Spec.Template.Spec.Containers[0].Image = request.Image;

            // 创建service app=web-admin
            var service = client.CoreV1.ReadNamespacedService(request.Name, request.Namespace);
            if (service == null)
            {
                throw new Exception($"service不存在:{request.Namespace}/{request.Name}");
            }

            service.Metadata.ResourceVersion = null;
            service.Metadata.Name = canaryName;
            service.Spec.Selector.Remove("app");
            service.Spec.Selector.Add("app", canaryName);
            service.Spec.ClusterIPs = null;
            service.Spec.ClusterIP = null;

            ingress.Metadata.ResourceVersion = null;
            ingress.Metadata.Name = canaryName;
            ingress.Metadata.Annotations.Add("nginx.ingress.kubernetes.io/canary", "true");
            ingress.Metadata.Annotations.Add("nginx.ingress.kubernetes.io/canary-weight", request.Weight.ToString());

            foreach (var rule in ingress.Spec.Rules)
            {
                foreach (var path in rule.Http.Paths)
                {
                    if (path.Backend.Service.Name == request.Name)
                    {
                        path.Backend.Service.Name = canaryName;
                    }
                }
            }

            var canaryDeployment = client.AppsV1.CreateNamespacedDeployment(deployment, request.Namespace);
            var canaryService = client.CoreV1.CreateNamespacedService(service, request.Namespace);
            var canaryIngress = client.NetworkingV1.CreateNamespacedIngress(ingress, request.Namespace);

            Alert(IAlertor.Level.Warning, "创建灰度发布", $"{request.Namespace}/{request.Name} 比重：{request.Weight}");
            return new CreateCanaryAppResponse(canaryDeployment, canaryService, canaryIngress);
        }

        public CreateCanaryAppResponse GetCanaryApp(RemoveCanaryAppRequest request)
        {
            var canaryName = $"{request.Name}{CANARY}";

            V1Deployment canaryDeployment = null;
            try
            {
                canaryDeployment = client.AppsV1.ReadNamespacedDeployment(canaryName, request.Namespace);
            }
            catch (Exception ex)
            {
            }

            V1Service canaryService = null;
            try
            {
                canaryService = client.CoreV1.ReadNamespacedService(canaryName, request.Namespace);
            }
            catch (Exception ex)
            {
            }

            V1Ingress canaryIngress = null;
            try
            {
                canaryIngress = client.NetworkingV1.ReadNamespacedIngress(canaryName, request.Namespace);
            }
            catch (Exception ex)
            {
            }

            return new CreateCanaryAppResponse(canaryDeployment, canaryService, canaryIngress);
        }

        public bool ChangeCanaryWeight(ChangeCanaryWeightRequest request)
        {
            var canaryName = $"{request.Name}{CANARY}";
            if (request.Weight <= 0 || request.Weight > 100)
            {
                throw new Exception($"Weight有效范围为 0~100");
            }

            if (request.Weight == 100)
            {
                return FullCanary(request);
            }

            var canaryIngress = client.NetworkingV1.ReadNamespacedIngress(canaryName, request.Namespace);
            canaryIngress.Metadata.Annotations.Remove("nginx.ingress.kubernetes.io/canary-weight");
            canaryIngress.Metadata.Annotations.Add("nginx.ingress.kubernetes.io/canary-weight", request.Weight.ToString());

            client.NetworkingV1.ReplaceNamespacedIngress(canaryIngress, canaryName, request.Namespace);
            Alert(IAlertor.Level.Noarmal, "修改灰度比例", $"{request.Namespace}/{request.Name} 比重：{request.Weight}");
            return true;
        }

        bool FullCanary(ChangeCanaryWeightRequest request)
        {
            var canaryName = $"{request.Name}{CANARY}";

            // 删除金丝雀实例，获取金丝雀实例的镜像版本
            var canaryDeployment = client.AppsV1.ReadNamespacedDeployment(canaryName, request.Namespace);
            var targetImage = canaryDeployment.Spec.Template.Spec.Containers[0].Image;

            RemoveCanaryApp(new RemoveCanaryAppRequest
            {
                NoAlert = true,
                Name = request.Name,
                Namespace = request.Namespace
            });

            // 将非金丝雀版本的镜像换成金丝雀版本的
            var deployment = client.AppsV1.ReadNamespacedDeployment(request.Name, request.Namespace);
            deployment.Spec.Template.Spec.Containers[0].Image = targetImage;
            client.AppsV1.ReplaceNamespacedDeployment(deployment, request.Name, request.Namespace);

            Alert(IAlertor.Level.Warning, "灰度转全量发布", $"{request.Namespace}/{request.Name}");
            return true;
        }
    }
}
