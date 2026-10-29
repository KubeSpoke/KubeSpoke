using KubeSpoke.Server;
using KubeSpoke.Server.Hubs;
using KubeSpoke.Server.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Connections.Features;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using System.Security.Claims;

namespace KubeSpoke.ServerTests
{
    /// <summary>
    /// agent 的推流连接（role=stream）不能进在线表：RPC 只能投到那根控制连接上。
    /// 这里钉住 OnConnectedAsync 的按 Identity 覆盖逻辑——它原本会把同集群的旧连接摘掉，
    /// 要是推流连接也走这条路，一根只出不进的空连接就会把唯一的投递目标挤掉。
    /// </summary>
    [TestClass]
    public class ClusterAgentHubStreamRoleTests
    {
        const string Identity = "cluster-identity-1";
        const string Cluster = "test-cluster";

        IList<ClusterAgent> prevOnline = null!;

        [TestInitialize]
        public void SetUp()
        {
            prevOnline = Global.OnlineUsers;
            Global.OnlineUsers = new List<ClusterAgent>();
        }

        [TestCleanup]
        public void TearDown() => Global.OnlineUsers = prevOnline;

        static ClusterAgentHub HubWithRole(string? role)
        {
            var http = new DefaultHttpContext();
            // 安装指令给的地址形如 /cluster-agent?uuid=..&name=..，推流连接在这后面追加 role=stream
            http.Request.QueryString = new QueryString(role == null ? $"?name={Cluster}" : $"?name={Cluster}&role={role}");

            return new ClusterAgentHub(NullLogger<ClusterAgentHub>.Instance)
            {
                Context = new AgentLikeContext(http, "agent-conn-" + Guid.NewGuid().ToString("N")[..8]),
            };
        }

        [TestMethod]
        public async Task ControlConnectionRegistersOnline()
        {
            var hub = HubWithRole(null);
            await hub.OnConnectedAsync();

            Assert.AreEqual(1, Global.OnlineUsers.Count);
            Assert.AreEqual(Cluster, Global.OnlineUsers[0].Name);
            Assert.AreEqual(hub.Context.ConnectionId, Global.OnlineUsers[0].ConnectionId);
        }

        [TestMethod]
        public async Task StreamConnectionIsNotRegisteredAndDoesNotEvictControl()
        {
            var control = HubWithRole(null);
            await control.OnConnectedAsync();

            var stream = HubWithRole("stream");
            await stream.OnConnectedAsync();

            Assert.AreEqual(1, Global.OnlineUsers.Count, "推流连接不该进在线表");
            Assert.AreEqual(control.Context.ConnectionId, Global.OnlineUsers[0].ConnectionId,
                "同 Identity 的推流连接更不能把控制连接从在线表里挤掉");
        }

        [TestMethod]
        public async Task StreamConnectionDisconnectKeepsControlOnline()
        {
            var control = HubWithRole(null);
            await control.OnConnectedAsync();

            var stream = HubWithRole("stream");
            await stream.OnConnectedAsync();
            await stream.OnDisconnectedAsync(null);

            Assert.AreEqual(1, Global.OnlineUsers.Count);
            Assert.AreEqual(control.Context.ConnectionId, Global.OnlineUsers[0].ConnectionId);
        }

        /// <summary>
        /// 认证处理器把集群 UUID 塞在 ClaimTypes.NameIdentifier 上，hub 的 IdentityName 就认这个；
        /// FileHubTests 那个替身只放 Name，所以这里另做一个。
        /// </summary>
        sealed class AgentLikeContext : HubCallerContext
        {
            readonly ClaimsPrincipal user;

            public AgentLikeContext(HttpContext http, string connectionId)
            {
                user = new ClaimsPrincipal(new ClaimsIdentity(new[]
                {
                    new Claim(ClaimTypes.NameIdentifier, Identity),
                    new Claim(ClaimTypes.Name, Identity),
                }, "agent-test"));

                Features = new FeatureCollection();
                Features.Set<IHttpContextFeature>(new HttpContextFeature { HttpContext = http });
                ConnectionId = connectionId;
            }

            public override string ConnectionId { get; }
            public override ClaimsPrincipal? User => user;
            public override IFeatureCollection Features { get; }
            public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();
            public override CancellationToken ConnectionAborted => CancellationToken.None;
            public override string? UserIdentifier => Identity;

            public override void Abort() { }

            sealed class HttpContextFeature : IHttpContextFeature
            {
                public HttpContext HttpContext { get; set; } = null!;
            }
        }
    }
}
