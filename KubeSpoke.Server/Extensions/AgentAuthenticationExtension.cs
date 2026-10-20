using KubeSpoke.Server.Extensions.AgentAuthentication;
using Microsoft.AspNetCore.Authentication;

namespace KubeSpoke.Server.Extensions
{
    public static class AgentAuthenticationExtension
    {
        public static void AddAgentAuthentication(this AuthenticationBuilder builder)
        {
            builder.AddScheme<AgentAuthenticationSchemeOptions, AgentAuthenticationHandler>(AgentAuthSchemeConstants.AuthenticationScheme, options =>
            {
                // nothing
            });
        }
    }
}
