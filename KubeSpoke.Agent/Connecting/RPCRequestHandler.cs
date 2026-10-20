using KubeSpoke.Agent.Models;
using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace KubeSpoke.Agent.Connecting
{
    public class RPCRequestHandler
    {
        IAgentApis agentApis;
        ILogger<RPCRequestHandler> logger;

        public RPCRequestHandler(IAgentApis agentApis, ILogger<RPCRequestHandler> logger)
        {
            this.logger = logger;
            this.agentApis = agentApis;
        }

        public object Handler(RPCRequest message, out bool isStram)
        {
            this.logger.LogDebug($"[{message.MethodName}] start");
            var methodInfo = agentApis.GetType().GetMethod(message.MethodName);
            if (methodInfo == null)
                throw new InvalidOperationException($"method not found {message.MethodName}");

            isStram = methodInfo.GetCustomAttributes(false).Any(x => x is IsStream);

            var paramJson = JsonSerializer.Serialize(message.Args[0]);
            var paramType = methodInfo.GetParameters()[0].ParameterType;

            var request = JsonSerializer.Deserialize(paramJson, paramType);

            var res = methodInfo.Invoke(agentApis, new object[] { request });
            this.logger.LogDebug($"[{message.MethodName}] end success");
            return res;
        }
    }
}
