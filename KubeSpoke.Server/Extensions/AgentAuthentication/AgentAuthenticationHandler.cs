using KubeSpoke.Contracts;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;

namespace KubeSpoke.Server.Extensions.AgentAuthentication
{
    /// <summary>
    /// 自定义认证
    /// </summary>
    public class AgentAuthenticationHandler : AuthenticationHandler<AgentAuthenticationSchemeOptions>
    {
        public AgentAuthenticationHandler(
            IOptionsMonitor<AgentAuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder, ISystemClock clock)
            : base(options, logger, encoder, clock)
        {
        }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            // 验证集群
            if (!Request.Headers.TryGetValue(ConstString.HEADER_CLUSTER_ID, out StringValues clusterID))
            {
                return Task.FromResult(AuthenticateResult.Fail($"Header {ConstString.HEADER_CLUSTER_ID} is Required"));
            };

            Request.Headers.TryGetValue(ConstString.HEADER_CLUSTER_SECRET, out StringValues clusterSecret);
            var name = Request.Query.ContainsKey("name") ? Request.Query["name"].ToString() : "";

            var claims = new[] {
                new Claim(ClaimTypes.NameIdentifier, clusterID),
                new Claim(ClaimTypes.Name, name )
            };

            var claimsIdentity = new ClaimsIdentity(claims, nameof(AgentAuthenticationHandler));
            var ticket = new AuthenticationTicket(new ClaimsPrincipal(claimsIdentity), Scheme.Name);

            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }
}
