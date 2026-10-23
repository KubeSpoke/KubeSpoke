using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Server;
using KubeSpoke.Server.Hubs;
using KubeSpoke.Server.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Connections.Features;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using System.Collections.Concurrent;
using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Threading.Channels;

namespace KubeSpoke.ServerTests
{
    /// <summary>
    /// FileHub 的上传与落位逻辑测试。FileHub 的会话表和 Global 都是进程级静态状态，
    /// 所以每个用例都用全新的连接 id 和会话 id，Global 的两处状态在用例前后存取还原。
    /// </summary>
    [TestClass]
    public class FileHubTests
    {
        const string Cluster = "test-cluster";
        const string AgentConn = "agent-conn-1";

        FakeAgentApis apis = null!;
        IAgentApis agentApis = null!;
        FakeAgentHubContext hubCtx = null!;
        TestableFileHub hub = null!;
        IHubContext<ClusterAgentHub> prevHubContext = null!;
        IList<ClusterAgent> prevOnline = null!;

        [TestInitialize]
        public void SetUp()
        {
            (apis, agentApis) = FakeAgentApis.Create();
            hubCtx = new FakeAgentHubContext();
            prevHubContext = Global.hubContext;
            prevOnline = Global.OnlineUsers;
            Global.hubContext = hubCtx;
            Global.OnlineUsers = new List<ClusterAgent> { new() { Name = Cluster, ConnectionId = AgentConn } };

            var http = new DefaultHttpContext();
            http.Request.QueryString = new QueryString($"?clusterId={Cluster}&podName=p1&Namespace=ns1&container=c1");
            http.Connection.RemoteIpAddress = IPAddress.Loopback;

            hub = new TestableFileHub(NullLogger<FileHub>.Instance, agentApis, ThrowingScopeFactory.Instance)
            {
                Context = new TestHubCallerContext(http, "admin"),
            };
        }

        [TestCleanup]
        public void TearDown()
        {
            Global.hubContext = prevHubContext;
            Global.OnlineUsers = prevOnline;
        }

        async Task<string> StartUpload(string path = "/tmp/note.txt")
        {
            await hub.OnConnectedAsync();
            return await hub.StartUpload(path);
        }

        StartPodUploadRequest TakeStartCall()
        {
            Assert.IsTrue(apis.StartCalls.TryDequeue(out var start), "StartPodUpload 应该已经被调用");
            return start;
        }

        [TestMethod]
        public async Task StartUpload_RejectsRelativePath_BeforeTouchingAgent()
        {
            await hub.OnConnectedAsync();

            var ex = await Assert.ThrowsExceptionAsync<Exception>(() => hub.StartUpload("tmp/note.txt"));

            StringAssert.Contains(ex.Message, "容器内的绝对路径");
            Assert.AreEqual(0, apis.StartCalls.Count, "路径不合法不该惊动 agent");
        }

        [TestMethod]
        public async Task StartUpload_RejectsBareRoot()
        {
            await hub.OnConnectedAsync();

            var ex = await Assert.ThrowsExceptionAsync<Exception>(() => hub.StartUpload("/"));

            StringAssert.Contains(ex.Message, "没有要写入的文件名");
        }

        [TestMethod]
        public async Task StartUpload_NormalizesSlashes_AndHandsTempPathToAgent()
        {
            await StartUpload("//tmp//note.txt");

            var start = TakeStartCall();
            StringAssert.StartsWith(start.TempPath, "/tmp/note.txt.kubespoke-");
            Assert.AreEqual(Cluster, start.ClustName);
            Assert.AreEqual("ns1", start.Namespace);
            Assert.AreEqual("p1", start.Name);
            Assert.AreEqual("c1", start.Container);
        }

        [TestMethod]
        public async Task StartUpload_AgentFailure_PropagatesAndLeavesNoSession()
        {
            apis.OnStart = _ => throw new Exception("容器里没有 sh");

            await hub.OnConnectedAsync();
            var ex = await Assert.ThrowsExceptionAsync<Exception>(() => hub.StartUpload("/tmp/note.txt"));

            StringAssert.Contains(ex.Message, "容器里没有 sh");
            var ex2 = await Assert.ThrowsExceptionAsync<Exception>(() => hub.FinishUpload(Guid.NewGuid().ToString()));
            StringAssert.Contains(ex2.Message, "上传会话不存在");
        }

        [TestMethod]
        public async Task FinishUpload_Success_CommitsWithReconciledByteCount()
        {
            var id = await StartUpload();

            await hub.Write(id, "YWJj");      // 3 字节
            await hub.Write(id, "aGVsbG8=");  // 5 字节
            await hub.Write(id, "eA==");      // 1 字节

            // agent 那路 exec 会话流尽 = 容器里的 cat 收到 EOF 正常退出
            apis.UploadChannel.Writer.TryComplete();

            var err = await hub.FinishUpload(id);

            Assert.IsNull(err);
            Assert.IsTrue(hubCtx.Sent.Any(s =>
                s.Method == ConstString.AGENT_EXEC_CLOSE_STDIN && s.ConnectionId == AgentConn &&
                s.Args.Length == 1 && s.Args[0] is Guid g && g.ToString() == id),
                "收尾必须先把 stdin 半关，让 cat 拿到 EOF");

            var start = TakeStartCall();
            Assert.IsTrue(apis.MoveCalls.TryDequeue(out var move), "字节对账一致就该落位");
            Assert.AreEqual(start.TempPath, move.From);
            Assert.AreEqual("/tmp/note.txt", move.To);
            Assert.AreEqual(9, move.ExpectBytes, "推给容器的字节数要按 base64 还原后累计");
            Assert.AreEqual(Cluster, move.ClustName);

            var ex = await Assert.ThrowsExceptionAsync<Exception>(() => hub.Write(id, "eA=="));
            StringAssert.Contains(ex.Message, "上传会话不存在", "落位后会话必须回收");
        }

        [TestMethod]
        public async Task FinishUpload_ReaderErrorFrame_FailsWithoutCommit()
        {
            var id = await StartUpload();

            // 模拟 exec 流早死：agent 侧把原因写成帧交回来（半截断线就是这个样子）
            apis.UploadChannel.Writer.TryWrite("容器输入通道已断开：连接被集群收走");
            apis.UploadChannel.Writer.TryComplete();

            var err = await hub.FinishUpload(id);

            Assert.AreEqual("容器输入通道已断开：连接被集群收走", err);
            Assert.AreEqual(0, apis.MoveCalls.Count, "通道报错绝不能把半截文件搬到位");
        }

        [TestMethod]
        public async Task FinishUpload_TimesOutWhenContainerNeverFinishes()
        {
            var id = await StartUpload();
            hub.FinishWaitOverride = TimeSpan.FromMilliseconds(100);

            // 不完成通道：容器里的 cat 一直等一个不会来的 EOF
            var err = await hub.FinishUpload(id);

            Assert.AreEqual("容器没有在该等的时间内写完这个文件", err);
            Assert.AreEqual(0, apis.MoveCalls.Count);
        }

        [TestMethod]
        public async Task FinishUpload_MoveFailure_ReturnsReasonAndCleansTemp()
        {
            var id = await StartUpload();
            apis.OnMove = _ => throw new Exception("mv: 目标目录没了");

            await hub.Write(id, "YWJj");
            apis.UploadChannel.Writer.TryComplete();

            var err = await hub.FinishUpload(id);

            StringAssert.Contains(err, "mv: 目标目录没了");
            Assert.IsTrue(await apis.RemoveSignal.WaitAsync(TimeSpan.FromSeconds(2)), "落位失败必须回头清掉临时文件");
            Assert.IsTrue(apis.RemoveCalls.TryDequeue(out var remove));
            Assert.AreEqual(1, remove.Paths.Count);
            Assert.AreEqual(TakeStartCall().TempPath, remove.Paths[0]);
        }

        [TestMethod]
        public async Task FinishUpload_UnknownSession_Throws()
        {
            var ex = await Assert.ThrowsExceptionAsync<Exception>(() => hub.FinishUpload(Guid.NewGuid().ToString()));

            StringAssert.Contains(ex.Message, "上传会话不存在");
        }

        [TestMethod]
        public async Task Write_UnknownSession_Throws()
        {
            var ex = await Assert.ThrowsExceptionAsync<Exception>(() => hub.Write(Guid.NewGuid().ToString(), "YWJj"));

            StringAssert.Contains(ex.Message, "上传会话不存在");
        }

        [TestMethod]
        public async Task Write_ClusterOffline_ThrowsAndNeverCommits()
        {
            var id = await StartUpload();

            Global.OnlineUsers = new List<ClusterAgent>();

            var ex = await Assert.ThrowsExceptionAsync<Exception>(() => hub.Write(id, "YWJj"));

            StringAssert.Contains(ex.Message, "目标集群不在线");

            // 会话已经带着失败原因躺平：再收尾不会落位，而是把同一个原因还回去
            var err = await hub.FinishUpload(id);
            StringAssert.Contains(err, "目标集群不在线");
            Assert.AreEqual(0, apis.MoveCalls.Count, "离线投递绝不能落位");

            var ex2 = await Assert.ThrowsExceptionAsync<Exception>(() => hub.FinishUpload(id));
            StringAssert.Contains(ex2.Message, "上传会话不存在");
        }

        [TestMethod]
        public async Task AbortUpload_ClosesExecAndCleansTemp()
        {
            var id = await StartUpload("/tmp/big.bin");
            await hub.Write(id, "YWJj");

            await hub.AbortUpload(id);

            Assert.IsTrue(hubCtx.Sent.Any(s => s.Method == ConstString.AGENT_EXEC_CLOSE && s.ConnectionId == AgentConn));
            Assert.IsTrue(await apis.RemoveSignal.WaitAsync(TimeSpan.FromSeconds(2)), "取消必须清掉写了一半的临时文件");
            Assert.IsTrue(apis.RemoveCalls.TryDequeue(out var remove));
            Assert.AreEqual(TakeStartCall().TempPath, remove.Paths[0]);
            Assert.AreEqual(0, apis.MoveCalls.Count, "取消绝不能落位");

            var ex = await Assert.ThrowsExceptionAsync<Exception>(() => hub.Write(id, "eA=="));
            StringAssert.Contains(ex.Message, "上传会话不存在");
        }

        [TestMethod]
        public async Task OnDisconnectedAsync_ClosesExecAndCleansTemp()
        {
            var id = await StartUpload("/tmp/big.bin");
            await hub.Write(id, "YWJj");

            await hub.OnDisconnectedAsync(null);

            Assert.IsTrue(hubCtx.Sent.Any(s => s.Method == ConstString.AGENT_EXEC_CLOSE && s.ConnectionId == AgentConn));
            Assert.IsTrue(await apis.RemoveSignal.WaitAsync(TimeSpan.FromSeconds(2)), "浏览器断开必须清掉临时文件");
            Assert.IsTrue(apis.RemoveCalls.TryDequeue(out var remove));
            Assert.AreEqual(TakeStartCall().TempPath, remove.Paths[0]);
            Assert.AreEqual(0, apis.MoveCalls.Count);

            var ex = await Assert.ThrowsExceptionAsync<Exception>(() => hub.FinishUpload(id));
            StringAssert.Contains(ex.Message, "上传会话不存在");
        }
    }

    /// <summary>FileHub 的 agent 替身：只拦文件三接口，其余 RPC 一调用就炸，逼着测试把 hub 的真实行为全走一遍。</summary>
    public class FakeAgentApis : DispatchProxy
    {
        public readonly ConcurrentQueue<StartPodUploadRequest> StartCalls = new();
        public readonly ConcurrentQueue<MovePodFileRequest> MoveCalls = new();
        public readonly ConcurrentQueue<RemovePodFilesRequest> RemoveCalls = new();
        public readonly SemaphoreSlim RemoveSignal = new(0);

        /// <summary>agent 侧 exec 会话的输出通道：测试往里塞错误帧或直接完结，模拟容器里 cat 的退出。</summary>
        public Channel<string> UploadChannel { get; set; } = Channel.CreateUnbounded<string>();

        public Func<StartPodUploadRequest, ChannelReader<string>>? OnStart;
        public Func<MovePodFileRequest, bool>? OnMove;

        protected override object? Invoke(MethodInfo targetMethod, object?[] args)
        {
            switch (targetMethod.Name)
            {
                case nameof(IAgentApis.StartPodUpload):
                    var start = (StartPodUploadRequest)args[0]!;
                    StartCalls.Enqueue(start);
                    return OnStart != null ? OnStart(start) : UploadChannel.Reader;

                case nameof(IAgentApis.MovePodFile):
                    var move = (MovePodFileRequest)args[0]!;
                    MoveCalls.Enqueue(move);
                    return OnMove != null ? OnMove(move) : true;

                case nameof(IAgentApis.RemovePodFiles):
                    RemoveCalls.Enqueue((RemovePodFilesRequest)args[0]!);
                    RemoveSignal.Release();
                    return true;

                default:
                    throw new NotSupportedException($"FileHub 调用了没打桩的 agent 接口：{targetMethod.Name}");
            }
        }

        public static (FakeAgentApis Stub, IAgentApis Proxy) Create()
        {
            var proxy = DispatchProxy.Create<IAgentApis, FakeAgentApis>();
            return ((FakeAgentApis)proxy, proxy);
        }
    }

    /// <summary>假 agent 连接：记录 FileHub 投出去的每一帧。SendAsync 永远成功——真 SignalR 对不存在的连接也一样。</summary>
    public class FakeAgentHubContext : IHubContext<ClusterAgentHub>
    {
        public readonly ConcurrentQueue<(string Method, string? ConnectionId, object?[] Args)> Sent = new();

        public IHubClients Clients { get; }
        public IGroupManager Groups => throw new NotSupportedException();

        public FakeAgentHubContext() => Clients = new ClientsImpl(this);

        sealed class Proxy : IClientProxy
        {
            readonly FakeAgentHubContext owner;
            readonly string? connectionId;

            public Proxy(FakeAgentHubContext owner, string? connectionId)
            {
                this.owner = owner;
                this.connectionId = connectionId;
            }

            public Task SendCoreAsync(string method, object[] args, CancellationToken cancellationToken = default)
            {
                owner.Sent.Enqueue((method, connectionId, args));
                return Task.CompletedTask;
            }
        }

        sealed class ClientsImpl : IHubClients
        {
            readonly FakeAgentHubContext owner;

            public ClientsImpl(FakeAgentHubContext owner) => this.owner = owner;

            public IClientProxy All => new Proxy(owner, null);
            public IClientProxy AllExcept(IReadOnlyList<string> excludedConnectionIds) => new Proxy(owner, null);
            public IClientProxy Client(string connectionId) => new Proxy(owner, connectionId);
            public IClientProxy Clients(IReadOnlyList<string> connectionIds) => new Proxy(owner, string.Join(",", connectionIds));
            public IClientProxy Group(string groupName) => new Proxy(owner, groupName);
            public IClientProxy GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => new Proxy(owner, groupName);
            public IClientProxy Groups(IReadOnlyList<string> groupNames) => new Proxy(owner, string.Join(",", groupNames));
            public IClientProxy User(string userId) => new Proxy(owner, userId);
            public IClientProxy Users(IReadOnlyList<string> userIds) => new Proxy(owner, string.Join(",", userIds));
        }
    }

    /// <summary>
    /// net10 的 HubCallerContext 是抽象类且不再挂 Connection，GetHttpContext 从 Features 里读，
    /// 所以直接子类化、把 HttpContext 塞进 Features 就够了，不需要真的搭一根连接。
    /// </summary>
    sealed class TestHubCallerContext : HubCallerContext
    {
        readonly ClaimsPrincipal user;

        public TestHubCallerContext(HttpContext http, string actor)
        {
            user = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.Name, actor) }, "test"));
            Features = new FeatureCollection();
            Features.Set<IHttpContextFeature>(new TestHttpContextFeature { HttpContext = http });
        }

        public override string ConnectionId { get; } = "hub-conn-" + Guid.NewGuid();
        public override ClaimsPrincipal? User => user;
        public override IFeatureCollection Features { get; }
        public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();
        public override CancellationToken ConnectionAborted => CancellationToken.None;
        public override string? UserIdentifier => user.Identity?.Name;

        public override void Abort() { }
    }

    sealed class TestHttpContextFeature : IHttpContextFeature
    {
        public HttpContext HttpContext { get; set; } = null!;
    }

    /// <summary>审计落库在测试里不开数据库，让它炸在 Record 自己的 try 里。</summary>
    sealed class ThrowingScopeFactory : IServiceScopeFactory
    {
        public static readonly ThrowingScopeFactory Instance = new();
        public IServiceScope CreateScope() => throw new NotSupportedException("测试里不落审计");
    }

    sealed class TestableFileHub : FileHub
    {
        public TestableFileHub(ILogger<FileHub> logger, IAgentApis apis, IServiceScopeFactory scopeFactory)
            : base(logger, apis, scopeFactory) { }

        public TimeSpan FinishWaitOverride { get; set; } = TimeSpan.FromSeconds(60);

        protected override TimeSpan FinishWait => FinishWaitOverride;
    }
}
