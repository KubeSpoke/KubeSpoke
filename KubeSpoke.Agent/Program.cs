using KubeSpoke.Agent.Apis;
using KubeSpoke.Agent.Connecting;
using KubeSpoke.Agent.HostedServices;
using KubeSpoke.Agent.Models;
using KubeSpoke.Agent.Services;
using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using k8s;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Serilog;
using Serilog.Events;
using System.Text.Json;

namespace KubeSpoke.Agent
{
    internal class Program
    {
        public static void Main(string[] args)
        {
            // 每条在途 RPC 都在同步等 k8s 返回，要占住一条线程池线程。默认下限只有核数，
            // 超了之后 .NET 每 500ms 才补 1~2 条，并发一高就是整片的 500ms 台阶
            ThreadPool.GetMinThreads(out _, out int minIo);
            ThreadPool.SetMinThreads(Math.Max(128, Environment.ProcessorCount * 16), minIo);

            Log.Logger = new LoggerConfiguration()
                .MinimumLevel.Override("Microsoft", LogEventLevel.Information)
                .Enrich.FromLogContext()
                .WriteTo.Console()
                .CreateBootstrapLogger();

            try
            {
                CreateHostBuilder(args).Build().Run();
            }
            catch (Exception ex)
            {
                Log.Fatal(ex, "Host terminated unexpectedly");
            }
            finally
            {
                Log.CloseAndFlush();
            }
        }

        public static IHostBuilder CreateHostBuilder(string[] args) =>
            Host.CreateDefaultBuilder(args)
                .UseSerilog((context, services, loggerConfiguration) =>
                {
                    loggerConfiguration.ReadFrom.Configuration(context.Configuration)
                      .MinimumLevel.Debug()
                      .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
                      .MinimumLevel.Override("Microsoft.Hosting.Lifetime", LogEventLevel.Information)
                      .ReadFrom.Services(services)
                      .Enrich.FromLogContext()
                      .WriteTo.File("Logs/log-.log", LogEventLevel.Verbose, "[{Timestamp:HH:mm:ss} {RequestId} {Level:u3}] {Message:lj}{NewLine}{Exception}", rollingInterval: RollingInterval.Hour)
                      .WriteTo.Console();
                })
                .ConfigureServices((hostContext, services) =>
                {
#if DEBUG
                    // 无参：默认按 KUBECONFIG / ~/.kube/config 查找，本机直连 minikube 也可跑
                    var config = KubernetesClientConfiguration.BuildConfigFromConfigFile();
#else
                    // Kubernetes sdk
                    var config = KubernetesClientConfiguration.InClusterConfig();
#endif
                    var client = new ExecKubernetes(config);

                    services.AddHostedService<ClusterAgentService>()
                        .AddSingleton<Kubernetes>(client)
                        .AddSingleton<AgentServiceConfigProvider>()
                        .AddSingleton<SignalRConnection>()
                        .AddSingleton<RPCRequestHandler>()
                        .AddSingleton<HelmCli>()
                        .AddSingleton<IAgentApis, AgentApiImpl>()
                        .AddSingleton<IAlertor, WeixinWorkRebotAlertor>()
                        .AddSingleton<AgentService>();
                });
    }
}