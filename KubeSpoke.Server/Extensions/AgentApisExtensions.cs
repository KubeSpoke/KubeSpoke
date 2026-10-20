using KubeSpoke.Contracts;
using KubeSpoke.Server.Hubs;
using System.Reflection;

namespace KubeSpoke.Server.Extensions
{
    public static class AgentApisExtensions
    {
        public static void AddAgentApis(this IServiceCollection services)
        {
            // aop
            services.AddSingleton<IAgentApis>(DispatchProxy.Create<IAgentApis, AgentApiProxy>());
        }
    }
}
