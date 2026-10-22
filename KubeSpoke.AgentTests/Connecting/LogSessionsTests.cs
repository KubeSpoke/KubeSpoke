using KubeSpoke.Agent.Connecting;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KubeSpoke.Agent.Connecting.Tests
{
    /// <summary>
    /// 日志推流会话表。这里盯的是「那路流到底会不会被关掉」：服务端 RpcCallStreamBack 等的就是 writer 完成，
    /// 少一条收尾路径走到 Remove，那次调用就永远占着这根 agent 连接上的一个 invocation 槽位，攒够整条 RPC 通道瘫掉。
    /// </summary>
    [TestClass]
    public class LogSessionsTests
    {
        [TestMethod]
        public async Task Remove_CompletesReaderSoServerStreamEnds()
        {
            var id = Guid.NewGuid();
            var (reader, _, _) = LogSessions.Open(id);
            var log = new MemoryStream(new byte[] { 1, 2, 3 });

            Assert.IsTrue(LogSessions.Attach(id, log));

            LogSessions.Remove(id);

            Assert.IsFalse(await reader.WaitToReadAsync(), "writer 没被完成的话，服务端那侧会永远等下去");
            Assert.IsFalse(log.CanRead, "k8s 响应流要跟着一起收掉，不然 apiserver 那条连接就悬着");
        }

        [TestMethod]
        public void Remove_AcceptsNoMoreFramesAfterwards()
        {
            var id = Guid.NewGuid();
            var (_, _, output) = LogSessions.Open(id);
            LogSessions.Attach(id, new MemoryStream());

            Assert.IsTrue(output.TryWrite("还在读的一条"));

            LogSessions.Remove(id);

            Assert.IsFalse(output.TryWrite("关掉之后迟到的一条"), "会话已经收掉了，不该再往通道里塞东西");
        }

        [TestMethod]
        public void Remove_CancelsTokenSoReadLoopStops()
        {
            var id = Guid.NewGuid();
            var (_, cts, _) = LogSessions.Open(id);
            LogSessions.Attach(id, new MemoryStream());

            Assert.IsFalse(cts.IsCancellationRequested);

            LogSessions.Remove(id);

            Assert.IsTrue(cts.IsCancellationRequested, "读循环靠这个令牌醒过来，不取消它就会一直挂在 ReadAsync 上");
        }

        [TestMethod]
        public async Task Remove_IsIdempotent()
        {
            var id = Guid.NewGuid();
            var (reader, _, _) = LogSessions.Open(id);
            LogSessions.Attach(id, new MemoryStream());

            // 自然读完和 LogClose 撞在一起是常态，两边都得走到这里
            LogSessions.Remove(id);
            LogSessions.Remove(id);

            Assert.IsFalse(await reader.WaitToReadAsync());
        }

        [TestMethod]
        public void Remove_UnknownSessionDoesNothing()
        {
            LogSessions.Remove(Guid.NewGuid());
        }

        [TestMethod]
        public void Attach_OnAlreadyClosedSession_DisposesStreamAndRefuses()
        {
            var id = Guid.NewGuid();
            LogSessions.Open(id);
            LogSessions.Remove(id);

            var log = new MemoryStream(new byte[] { 9 });

            Assert.IsFalse(LogSessions.Attach(id, log));
            Assert.IsFalse(log.CanRead, "取日志这段时间里面板已经关掉了，刚拿到的响应流不能留下");
        }

        [TestMethod]
        public async Task Remove_OnlyClosesTheNamedSession()
        {
            var a = Guid.NewGuid();
            var b = Guid.NewGuid();
            var (readerA, _, _) = LogSessions.Open(a);
            var (readerB, _, outputB) = LogSessions.Open(b);

            LogSessions.Remove(a);

            Assert.IsFalse(await readerA.WaitToReadAsync());

            // 另一个读者的会话不能被牵连：写进去还能读出来
            Assert.IsTrue(outputB.TryWrite("b 还在读"));
            Assert.IsTrue(await readerB.WaitToReadAsync());
            Assert.AreEqual("b 还在读", await readerB.ReadAsync());

            LogSessions.Remove(b);
        }
    }
}
