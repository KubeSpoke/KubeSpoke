using Microsoft.VisualStudio.TestTools.UnitTesting;
using System;
using System.Collections.Generic;
using System.Linq;
using k8s;
using k8s.Models;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using KubeSpoke.Agent.Services;
using KubeSpoke.Agent.Apis;
using KubeSpoke.Contracts.Dtos;

namespace KubeSpoke.Agent.Api.Tests
{
    /// <summary>
    /// 活集群集成测试：验证「新增」的创建接口（Description/Labels 落到真实对象）
    /// 与通用资源/事件接口在 minikube 上确实工作。用完即删，避免污染 default 命名空间。
    /// 运行前需 kubectl current-context 指向一个可写的集群（本机为 minikube）。
    /// </summary>
    [TestClass]
    public class AgentApiImplLiveTests
    {
        const string Ns = "default";
        AgentApiImpl impl;
        Kubernetes client;
        string svcName;

        [TestInitialize]
        public void Setup()
        {
            var config = KubernetesClientConfiguration.BuildDefaultConfig();
            client = new Kubernetes(config);

            IServiceCollection services = new ServiceCollection();
            services.AddLogging();
            var provider = services.BuildServiceProvider();
            var log = provider.GetRequiredService<ILogger<AgentApiImpl>>();

            impl = new AgentApiImpl(client, null, new HelmCli(provider.GetRequiredService<ILogger<HelmCli>>()), log);
            svcName = "ks-live-svc-" + Guid.NewGuid().ToString("N")[..8];
        }

        [TestCleanup]
        public void Teardown()
        {
            try { client.CoreV1.DeleteNamespacedService(svcName, Ns); } catch { }
        }

        [TestMethod]
        public void CreateService_Persists_Description_And_Labels_On_Cluster()
        {
            var res = impl.CreateService(new CreateServiceRequest
            {
                Name = svcName,
                AppName = "myapp",
                Namespace = Ns,
                Type = "ClusterIP",
                Port = 80,
                Description = "svc 描述",
                Labels = new Dictionary<string, string>
                {
                    ["env"] = "prod",
                    ["app"] = "should-be-reserved", // 保留键，必须被 AppName 覆盖
                },
            });
            Assert.IsNotNull(res);

            // 直接读线上对象，绕开任何 mock，证明字段真的写进了集群
            var svc = client.CoreV1.ReadNamespacedService(svcName, Ns);

            Assert.AreEqual("myapp", svc.Metadata.Labels["app"],
                "保留键 app 必须等于 AppName，不能被用户覆盖");
            Assert.AreEqual("prod", svc.Metadata.Labels["env"], "用户自定义标签应落库");
            Assert.AreEqual("svc 描述", svc.Metadata.Annotations["kubesphere.io/description"],
                "描述应写入 kubesphere.io/description 注解");
            Assert.AreEqual("myapp", svc.Spec.Selector["app"]);
        }

        [TestMethod]
        public void ListResources_And_Events_And_ClusterInfo_DoNotThrow()
        {
            var svcs = impl.ListResources(new ListResourcesRequest
            {
                Group = "", Version = "v1", Plural = "services", Namespace = Ns,
            });
            Assert.IsNotNull(svcs);

            var info = impl.GetClusterInfo(new ClusterInfoRequest());
            Assert.IsNotNull(info);

            var events = impl.GetResourceEvents(new GetResourceEventsRequest
            {
                Namespace = Ns, Kind = "Service", Name = "kubernetes",
            });
            Assert.IsNotNull(events);
        }
    }
}
