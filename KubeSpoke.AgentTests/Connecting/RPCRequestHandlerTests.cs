using Microsoft.VisualStudio.TestTools.UnitTesting;
using KubeSpoke.Agent.Connecting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using KubeSpoke.Agent.Api;
using k8s;
using KubeSpoke.Contracts.Dtos;
using k8s.Models;
using Microsoft.Extensions.Logging;
using KubeSpoke.Agent.Services;
using KubeSpoke.Agent.Apis;
using Microsoft.Extensions.DependencyInjection;

namespace KubeSpoke.Agent.Connecting.Tests
{
    [TestClass()]
    public class RPCRequestHandlerTests
    {
        RPCRequestHandler Handler;

        public RPCRequestHandlerTests()
        {
            IServiceCollection service = new ServiceCollection();
            service.AddLogging();

            // Kubernetes sdk
            var config = KubernetesClientConfiguration.BuildConfigFromConfigFile();
            var client = new Kubernetes(config);

            var provider = service.BuildServiceProvider();

            var log = provider.GetRequiredService<ILogger<AgentApiImpl>>();

            var impl = new AgentApiImpl(client, null, new HelmCli(provider.GetRequiredService<ILogger<HelmCli>>()), log);

            var f = LoggerFactory.Create(x => { });
            Handler = new RPCRequestHandler(impl, f.CreateLogger<RPCRequestHandler>());
        }

        [TestMethod()]
        public void HandlerGetConfigMapsTest()
        {
            try
            {
                var res = Handler.Handler(new RPCRequest
                {
                    MethodName = "GetPods",
                    RequestId = new Guid(),
                    Args = new object[] { new GetPodsRequest {
                        Namespace = "default"
                    } }
                }, out _);
            }
            catch (Exception ex)
            {

                throw;
            }
        }

        [TestMethod()]
        public void HandlerTest()
        {
            var request = new CreateIngressRequest
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
            };

            try
            {
                Handler.Handler(new RPCRequest
                {
                    MethodName = nameof(AgentApiImpl.GetPods),
                    RequestId = new Guid(),
                    Args = new object[] { request }
                }, out _);
            }
            catch (Exception ex)
            {

                throw;
            }

            Assert.Fail();
        }
    }
}