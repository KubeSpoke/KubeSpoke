using Microsoft.VisualStudio.TestTools.UnitTesting;
using KubeSpoke.Agent.Api;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using k8s;
using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using System.Text.Json;
using k8s.Models;
using System.Security.Cryptography.X509Certificates;
using System.Net;
using KubeSpoke.Agent.Apis;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace KubeSpoke.Agent.Api.Tests
{
    [TestClass()]
    public class AgentApiImplTests
    {
        AgentApiImpl impl;

        public AgentApiImplTests()
        {
            var config = KubernetesClientConfiguration.BuildConfigFromConfigFile();
            var client = new Kubernetes(config);

            // todo:容器
            IServiceCollection service = new ServiceCollection();
            service.AddLogging();

            var provider = service.BuildServiceProvider();

            var log = provider.GetRequiredService<ILogger<AgentApiImpl>>();

            impl = new AgentApiImpl(client, null, log);
        }

        [TestMethod()]
        public void GetNodesTest()
        {
            var res = impl.GetNodes(new Contracts.Dtos.GetNodesRequest { });
            Assert.IsTrue(res.Count() > 0);
        }

        [TestMethod()]
        public void GetNamespacesTest()
        {
            var res = impl.GetNamespaces(new Contracts.Dtos.GetNamespaceRequest { });
            Assert.IsTrue(res.Count() > 0);
        }

        [TestMethod()]
        public void GetPodsTest()
        {
            var res = impl.GetPods(new Contracts.Dtos.GetPodsRequest
            {
                Namespace = "default"
            });

            Assert.IsTrue(res.Count() > 0);
        }


        [TestMethod()]
        public void GetDeploymentTest()
        {
            var res = impl.GetDeployments(new Contracts.Dtos.GetDeploymentsRequest { });
            Assert.Fail();
        }

        [TestMethod()]
        public void CreateDeploymentTest()
        {
            var res = impl.CreateDeployment(new Contracts.Dtos.CreateDeploymentRequest
            {
                Name = "hello-minikube",
                Namespace = "default",
                Replicas = 1,
                Containers = new CreateDeploymentRequest.Container[]
                {
                    new CreateDeploymentRequest.Container
                    {
                        ContainerName= "hello-minikube",
                        Image = "docker.io/nginx:1.23",
                        ContainerPort = 80
                    }
                }
            });

            Assert.Fail();
        }

        [TestMethod()]
        public void CreateServiceTest()
        {
            var service = impl.CreateService(new Contracts.Dtos.CreateServiceRequest { AppName = "test1", Namespace = "test", Name = "test111" });

            Assert.Fail();
        }

        [TestMethod()]
        public void CreateNamspaceTest()
        {
            var res = impl.CreateNamespace(new Contracts.Dtos.CreateNamespaceRequest { Name = "test" });
            Assert.Fail();
        }

        [TestMethod()]
        public void DeleteServiceTest()
        {
            var service = impl.DeleteService(new Contracts.Dtos.DeleteServiceRequest { Name = "hello-minikube", Namespace = "default" });
            Assert.Fail();
        }

        [TestMethod()]
        public void DeleteDeploymentTest()
        {
            impl.DeleteDeployment(new Contracts.Dtos.DeleteDeploymentRequest
            {
                Name = "hello-minikube",
                Namespace = "default",
            });

            Assert.Fail();
        }

        [TestMethod()]
        public void GetServicesTest()
        {
            var res = impl.GetServices(new Contracts.Dtos.GetServicesRequest
            {
            });

            Assert.Fail();
        }

        [TestMethod()]
        public void CreateIngressTest()
        {

            //var data = JsonSerializer.Deserialize<CreateIngressRequest>(json);
            //impl.CreateIngress(data);

            Assert.Fail();
        }

        [TestMethod()]
        public void CreateIngressTest3()
        {
            impl.CreateIngress(new CreateIngressRequest
            {
                IngressClassName = "nginx",
                Name = "dsad",
                Namespace = "default",
                Tls = new List<V1IngressTLS> { new V1IngressTLS {
                    Hosts = new List<string> { "test.example.com"},
                    SecretName = "demo-tls"
                } },
                Rules = new List<V1IngressRule>
                {
                    new V1IngressRule{
                        Host = "test.example.com",
                        Http = new V1HTTPIngressRuleValue{
                            Paths = new List<V1HTTPIngressPath>{
                                new V1HTTPIngressPath {
                                    Path = "/",
                                    PathType = "Prefix",
                                    Backend = new V1IngressBackend {
                                        Service = new V1IngressServiceBackend{
                                            Name = "demo-web",
                                            Port = new V1ServiceBackendPort{
                                                Number = 80,
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            Assert.Fail();
        }


        [TestMethod()]
        public void GetIngressClassListTest()
        {
            var list = impl.GetIngressClassList(new GetIngressClassListRequest { });
            Assert.Fail();
        }

        [TestMethod()]
        public void CreateDockerRegistrySecretTest()
        {
            impl.CreateDockerRegistrySecret(new CreateDockerSecretRequest
            {
                Name = "test-docker",
                Domain = "registry.example.com",
                Password = "change-me",
                UserName = "admin",
            });

            Assert.Fail();
        }

        [TestMethod()]
        public void InstallNfsProvisionerTest()
        {
            var dd = impl.InstallNfsProvisioner(new InstallNfsProvisionerRequest());
            Assert.Fail();
        }
        public void ReadNamespacedDeploymentTest()
        {
            var res = impl.ReadNamespacedDeployment(new ReadNamespacedDeploymentRequest
            {
                Name = "demo-web",
                Namespace = "default"
            });

            Assert.Fail();
        }

        [TestMethod()]
        public void ListNamespacedReplicaSetTest()
        {
            var res = impl.ListNamespacedReplicaSet();
            Assert.Fail();
        }

        [TestMethod()]
        public void GetDeploymentTest1()
        {
            var res = impl.GetDeployment(new GetDeploymentRequest
            {
                Name = "demo-web",
                Namespace = "default"
            });

            Assert.Fail();
        }

        [TestMethod()]
        public void CreateConfigMapTest()
        {
            try
            {
                var res = impl.CreateConfigMap(new CreateConfigMapRequest
                {
                    ConfigMap = new V1ConfigMap
                    {
                        ApiVersion = "v1",
                        Kind = "ConfigMap",
                        Metadata = new V1ObjectMeta
                        {
                            Name = "demo-config1",
                        },
                        Data = new Dictionary<string, string> { { "DB_Server", "db.example.com" } }
                    },
                    Namespace = "demo"
                });
            }
            catch (Exception ex)
            {
                Assert.Fail();
                throw;
            }
        }

        [TestMethod()]
        public void ReplaceImageTest()
        {
            var s = impl.ReplaceImage(new ReplaceImageRequest { });

            Assert.Fail();
        }

        [TestMethod()]
        public async Task ReadPodLogTest()
        {
            try
            {
                var res = impl.ReadPodLog(new ReadPodLogRequest
                {
                    Name = "demo-web1-6d5f8b9c7d-x2kq9",
                    Namespace = "test",
                });

                while (await res.WaitToReadAsync())
                {
                    var str = await res.ReadAsync();

                }
            }
            catch (Exception ex)
            {
                Assert.Fail();
                throw;
            }

        }

        [TestMethod()]
        public void GetPodStatusTest()
        {
            var ss = impl.GetPodStatus(new ReadPodLogRequest
            {
                Name = "hello-minikube-84577cf4c5-cc54c",
                Namespace = "demo"
            });

            Assert.Fail();
        }

        [TestMethod()]
        public void GetPodsMetricsTest()
        {
            var list = impl.GetPodsMetrics(new GetPodsMetricsRequest());

            Assert.Fail();
        }

        [TestMethod()]
        public void GetNodesMetricsTest()
        {
            var list = impl.GetNodesMetrics(new GetPodsMetricsRequest());
            Assert.Fail();
        }

        [TestMethod()]
        public void GetReplicaSetScaleTest()
        {
            var list = impl.GetReplicaSetScale(new GetReplicaSetScaleRequest() { Namespace = "demo", Name = "demo-web-6d5f8b9c7d" });
            Assert.Fail();
        }

        [TestMethod()]
        public void GetReplicaSetTest()
        {
            var list = impl.GetReplicaSet(new GetReplicaSetScaleRequest() { Namespace = "demo", Name = "demo-web-6d5f8b9c7d" });
            Assert.Fail();
        }

        [TestMethod()]
        public void ListReplicaSetTest()
        {
            var list = impl.ListReplicaSet(new ListReplicaSetRequest() { Namespace = "demo", LabelSelector = "app=demo-web" });
            var json = JsonSerializer.Serialize(list);

            Assert.Fail();
        }

        [TestMethod()]
        public void CreateCanaryAppTest()
        {
            impl.CreateCanaryApp(new CreateCanaryAppRequest
            {
                Name = "demo-web",
                Namespace = "demo",
                Image = "registry.example.com/demo/web:1.0.0"
            });

            Assert.Fail();
        }

        [TestMethod()]
        public void RemoveCanaryAppTest()
        {
            impl.RemoveCanaryApp(new RemoveCanaryAppRequest
            {
                Name = "demo-web",
                Namespace = "demo",
            });

            Assert.Fail();
        }
    }
}