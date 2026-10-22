using KubeSpoke.Server;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KubeSpoke.ServerTests
{
    /// <summary>
    /// RPC 看门狗的记账逻辑。Global 是进程级静态状态，所以每个用例都自带一个全新的 ConnectionId 和请求 id：
    /// 这样执行顺序、甚至并行都不影响彼此，也不给后面的用例留脏数据。
    /// </summary>
    [TestClass]
    public class GlobalRpcWatchdogTests
    {
        static string NewConnection() => "conn-" + Guid.NewGuid();

        [TestMethod]
        public void RecordRpcTimeout_CountsConsecutiveTimeoutsOnSameConnection()
        {
            var conn = NewConnection();

            Assert.AreEqual(1, Global.RecordRpcTimeout(conn));
            Assert.AreEqual(2, Global.RecordRpcTimeout(conn));
            Assert.AreEqual(3, Global.RecordRpcTimeout(conn));
        }

        [TestMethod]
        public void RecordRpcTimeout_KeepsConnectionsApart()
        {
            var a = NewConnection();
            var b = NewConnection();

            Global.RecordRpcTimeout(a);
            Global.RecordRpcTimeout(a);

            Assert.AreEqual(1, Global.RecordRpcTimeout(b), "另一根连接的计数不该被牵连");
        }

        [TestMethod]
        public void RecordRpcSuccess_RestartsTheCountFromScratch()
        {
            var conn = NewConnection();

            Global.RecordRpcTimeout(conn);
            Global.RecordRpcTimeout(conn);
            Global.RecordRpcSuccess(conn);

            Assert.AreEqual(1, Global.RecordRpcTimeout(conn), "有过一次成功回执，说明通道还能用，得从头再数");
        }

        [TestMethod]
        public void ForgetConnection_RestartsTheCountFromScratch()
        {
            var conn = NewConnection();

            Global.RecordRpcTimeout(conn);
            Global.RecordRpcTimeout(conn);
            Global.ForgetConnection(conn);

            Assert.AreEqual(1, Global.RecordRpcTimeout(conn));
        }

        [TestMethod]
        public void ShouldRebuildConnection_FiresOnlyOnTheStepThatCrossesTheThreshold()
        {
            Assert.IsFalse(Global.ShouldRebuildConnection(0));
            Assert.IsFalse(Global.ShouldRebuildConnection(Global.SuspectConnectionStreak - 1));
            Assert.IsTrue(Global.ShouldRebuildConnection(Global.SuspectConnectionStreak));

            // 越过去之后不再重复发令：每个后续超时都下一道重连令的话，agent 会被打成周期性抖动
            Assert.IsFalse(Global.ShouldRebuildConnection(Global.SuspectConnectionStreak + 1));
            Assert.IsFalse(Global.ShouldRebuildConnection(Global.SuspectConnectionStreak * 10));
        }

        [TestMethod]
        public void SuspectConnectionStreak_IsThreeTimeouts()
        {
            // 阈值钉在 3：一次满窗超时有正常解释（冷启动、K8s 抖动），连着三条还都卡在同一个 ConnectionId 上
            // 就不是巧合。改这个值要同时想清楚：调大了瘫得更久，调小了容易被正常抖动误触发。
            Assert.AreEqual(3, Global.SuspectConnectionStreak);
        }

        [TestMethod]
        public void MarkRpcTimedOut_LateCallbackIsClaimedExactlyOnce()
        {
            var id = Guid.NewGuid();
            Global.MarkRpcTimedOut(id, "GetNodes");

            Assert.IsTrue(Global.TryTakeLateRpc(id, out var method, out var timedOutAt));
            Assert.AreEqual("GetNodes", method);
            Assert.IsTrue(timedOutAt <= DateTime.UtcNow && timedOutAt >= DateTime.UtcNow.AddMinutes(-1),
                $"超时时刻不该是凭空冒出来的：{timedOutAt:O}");

            // 取走即销账：同一条回执再到达一次不该被记成第二次迟到
            Assert.IsFalse(Global.TryTakeLateRpc(id, out _, out _));
        }

        [TestMethod]
        public void TryTakeLateRpc_DoesNotClaimNeverTimedOutRequest()
        {
            Assert.IsFalse(Global.TryTakeLateRpc(Guid.NewGuid(), out var method, out var timedOutAt));
            Assert.IsNull(method);
            Assert.AreEqual(default(DateTime), timedOutAt);
        }
    }
}
