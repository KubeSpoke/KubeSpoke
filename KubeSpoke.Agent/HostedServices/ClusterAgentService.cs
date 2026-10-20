using KubeSpoke.Agent.Connecting;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Agent.HostedServices
{
    internal class ClusterAgentService : IHostedService
    {
        ILogger<ClusterAgentService> logger;
        AgentService agentService;

        public ClusterAgentService(ILogger<ClusterAgentService> logger, AgentService agentService)
        {
            this.agentService = agentService;
            this.logger = logger;
        }

        public Task StartAsync(CancellationToken cancellationToken)
        {
            this.logger.LogInformation("[ClusterAgentService StartAsync]");
            foreach (DictionaryEntry item in Environment.GetEnvironmentVariables())
            {
                logger.LogInformation($"[ENV]: {item.Key} ：{item.Value}");
            }

            agentService.Start(cancellationToken);
            return Task.CompletedTask;
        }

        public async Task StopAsync(CancellationToken cancellationToken)
        {
            this.logger.LogInformation("[ClusterAgentService StopAsync]");
            await agentService.StopAsync(cancellationToken);
        }
    }
}
