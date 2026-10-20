using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Contracts.Dtos.Docker;
using KubeSpoke.Contracts.Models;
using k8s.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace KubeSpoke.Server.Controllers
{
    [Authorize]
    public class ClusterController : BaseController
    {
        IAgentApis agentApis;
        private readonly ILogger<ClusterController> _logger;

        public ClusterController(ILogger<ClusterController> logger, IAgentApis agentApis)
        {
            this.agentApis = agentApis;
            _logger = logger;
        }

        /// <summary>
        /// 接收所有Get请求，因为swagger不能自动生产文档，暂时不使用此方法
        /// </summary>
        /// <param name="method"></param>
        /// <returns></returns>
        [Route("/api/Cluster/{method}", Order = int.MaxValue)]
        [HttpGet]
        public object Get(string method)
        {
            var query = Request.Query;
            var json = JsonSerializer.Serialize(query.ToDictionary(q => q.Key, q => q.Value.ToString()));
            return handleRequest(method, json);
        }

        /// <summary>
        /// 接收所有Post请求，因为swagger不能自动生产文档，暂时不使用此方法
        /// </summary>
        /// <param name="method"></param>
        /// <returns></returns>
        [Route("/api/Cluster/{method}", Order = int.MaxValue)]
        [HttpPost]
        public object Post(string method)
        {
            var json = ReadToEnd(Request.Body);
            return handleRequest(method, json);
        }

        public static string ReadToEnd(Stream stream)
        {
            string empty = string.Empty;
            using StreamReader streamReader = new StreamReader(stream);
            return streamReader.ReadToEndAsync().Result;
        }

        /// <summary>
        /// 
        /// </summary>
        /// <param name="method"></param>
        /// <param name="json">接口参数</param>
        /// <returns></returns>
        /// <exception cref="Exception"></exception>
        /// <exception cref="ArgumentNullException"></exception>
        private object handleRequest(string method, string json)
        {
            // 参数从queryString中获取
            var methodInfo = typeof(IAgentApis).GetMethods().FirstOrDefault(x => x.Name.ToLower() == method.ToLower());
            if (methodInfo == null)
            {
                throw new Exception($"api not implement:{method}");
            }

            var parameterInfos = methodInfo.GetParameters();
            if (parameterInfos.Length != 1)
            {
                throw new Exception("接口参数有且只能有一个");
            }

            var param = JsonSerializer.Deserialize(json, parameterInfos[0].ParameterType, new JsonSerializerOptions
            {
                NumberHandling = JsonNumberHandling.AllowReadingFromString
            });

            var request = param as BaseRequest;
            if (request != null)
            {
                if (string.IsNullOrEmpty(request.ClustName))
                {
                    throw new ArgumentNullException(nameof(request.ClustName), $"/api/Cluster/{method} 缺少 ClustName（未选择集群或集群名不对）");
                }
            }

            return methodInfo.Invoke(agentApis, new object[] { param }) ?? "ok";
        }

        [HttpGet]
        public async Task GetContainerLogs([FromQuery] GetContainerLogsRequest request)
        {
            Response.ContentType = "text/plain";
            StreamWriter sw;

            var stream = agentApis.GetContainerLogs(request);
            await using ((sw = new StreamWriter(Response.Body)).ConfigureAwait(false))
            {
                while (await stream.WaitToReadAsync())
                {
                    while (stream.TryRead(out var item))
                    {
                        await sw.WriteLineAsync(item.ToString()).ConfigureAwait(false);
                        await sw.FlushAsync().ConfigureAwait(false);
                    }
                }
            }
        }

        [HttpGet]
        public IAsyncEnumerable<string> GetWeatherForecastStream()
        {
            async IAsyncEnumerable<string> streamWeatherForecastsAsync()
            {
                for (int daysFromToday = 1; daysFromToday <= 10; daysFromToday++)
                {
                    Thread.Sleep(1000);
                    yield return daysFromToday.ToString();
                };
            };

            return streamWeatherForecastsAsync();
        }

        //[HttpGet]
        //public async Task<EmptyResult> GetContainerLogs([FromQuery] GetContainerLogsRequest request)
        //{
        //    Response.ContentType = "text/plain";
        //    StreamWriter sw;
        //    var stream = agentApis.GetContainerLogs(request);

        //    await using ((sw = new StreamWriter(Response.Body)).ConfigureAwait(false))
        //    {
        //        while (await stream.WaitToReadAsync())
        //        {
        //            while (stream.TryRead(out var item))
        //            {
        //                await sw.WriteAsync(item).ConfigureAwait(false);
        //                await sw.FlushAsync().ConfigureAwait(false);
        //            }
        //        }
        //    }

        //    return new EmptyResult();
        //}

        ///// <summary>
        ///// 获取pod列表
        ///// </summary>
        ///// <param name="request"></param>
        ///// <returns></returns>
        //[HttpGet]
        //public IEnumerable<V1Pod> GetPods([FromQuery] GetPodsRequest request)
        //{
        //    return agentApis.GetPods(request);
        //}

        [HttpPost]
        public Namespace CreateNamspace([FromBody] CreateNamespaceRequest request)
        {
            return agentApis.CreateNamespace(request);
        }

        /// <summary>
        /// 获取命名空间列表
        /// </summary>
        /// <param name="request"></param>
        /// <returns></returns>
        [HttpGet]
        public IEnumerable<Namespace> GetNamespaces([FromQuery] GetNamespaceRequest request)
        {
            return agentApis.GetNamespaces(request);
        }

        ///// <summary>
        ///// 删除pod
        ///// </summary>
        ///// <param name="request"></param>
        ///// <returns></returns>
        //[HttpDelete]
        //public Pod DeletePods([FromQuery] DeletePodRequest request)
        //{
        //    return agentApis.DeletePod(request);
        //}

        [HttpPost]
        public Deployment CreateDeployment([FromBody] CreateDeploymentRequest request)
        {
            return agentApis.CreateDeployment(request);
        }

        [HttpGet]
        public IEnumerable<Deployment> GetDeployments([FromQuery] GetDeploymentsRequest request)
        {
            return agentApis.GetDeployments(request);
        }

        [HttpDelete]
        public ActionResult DeleteDeployment([FromQuery] DeleteDeploymentRequest request)
        {
            agentApis.DeleteDeployment(request);
            return Ok();
        }

        [HttpPost]
        public Service CreateService([FromBody] CreateServiceRequest request)
        {
            return agentApis.CreateService(request);
        }

        [HttpDelete]
        public bool DeleteService([FromQuery] DeleteServiceRequest request)
        {
            return agentApis.DeleteService(request);
        }

        [HttpGet]
        public IEnumerable<Service> GetServices([FromQuery] GetServicesRequest request)
        {
            return agentApis.GetServices(request);
        }

        [HttpGet]
        public IEnumerable<Ingress> GetIngressList([FromQuery] GetIngressListRequest request)
        {
            return agentApis.GetIngressList(request);
        }

        [HttpPost]
        public V1Ingress CreateIngress([FromBody] CreateIngressRequest request)
        {
            return agentApis.CreateIngress(request);
        }

        [HttpPost]
        public bool DeleteIngress([FromBody] DeleteIngressRequest request)
        {
            return agentApis.DeleteIngress(request);
        }

        [HttpPost]
        public Secret CreateDockerRegistrySecret([FromBody] CreateDockerSecretRequest request)
        {
            return agentApis.CreateDockerRegistrySecret(request);
        }

        [HttpGet]
        public IEnumerable<Secret> GetSecrets([FromQuery] GetSecretsRequest request)
        {
            return agentApis.GetSecrets(request);
        }

        [HttpPost]
        public bool DeleteSecret([FromBody] DeleteSecretRequest request)
        {
            return agentApis.DeleteSecret(request);
        }

        [HttpPost]
        public IEnumerable<V1IngressClass> GetIngressClassList([FromQuery] GetIngressClassListRequest request)
        {
            return agentApis.GetIngressClassList(request);
        }

        [HttpPost]
        public V1IngressClass CreateIngressClass([FromBody] CreateIngressClassRequest request)
        {
            return agentApis.CreateIngressClass(request);
        }

        [HttpPost]
        public bool DeleteIngressClass([FromBody] DeleteIngressClassRequest request)
        {
            return agentApis.DeleteIngressClass(request);
        }

        [HttpPost]
        public V1Secret CreateTlsSecret([FromBody] CreateTlsSecretRequest request)
        {
            return agentApis.CreateTlsSecret(request);
        }
    }
}