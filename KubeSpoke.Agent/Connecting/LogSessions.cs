using System.Collections.Concurrent;
using System.Threading.Channels;

namespace KubeSpoke.Agent.Connecting
{
    /// <summary>
    /// 日志面板的推流会话表。和终端那套同一个道理：服务端在浏览器断开时得能点名关掉这一路，
    /// 光靠 agent 自己「读到头了自然收尾」不够——apiserver 挂住、或者服务端不再往下读而把流堵在
    /// SignalR 的发送缓冲上时，那个读循环永远不会走到收尾，它占的服务端 invocation 槽位也就永远还不回来。
    /// </summary>
    public static class LogSessions
    {
        class Entry
        {
            public CancellationTokenSource Cts;
            public ChannelWriter<string> Output;

            /// <summary>k8s 那条日志响应流，握手期间可能还没拿到，所以清理时要判空</summary>
            public Stream Log;
        }

        static readonly ConcurrentDictionary<Guid, Entry> sessions = new();

        /// <summary>
        /// 先登记再动手：日志请求发出去之前这路会话就得可寻址，
        /// 否则浏览器秒开秒关的时候，Close 会落在一个还没登记的 id 上，留下一条没人读的通道。
        /// </summary>
        public static (ChannelReader<string> Reader, CancellationTokenSource Cts, ChannelWriter<string> Output) Open(Guid id)
        {
            var channel = Channel.CreateUnbounded<string>();
            var cts = new CancellationTokenSource();
            sessions[id] = new Entry { Cts = cts, Output = channel.Writer };

            return (channel.Reader, cts, channel.Writer);
        }

        /// <summary>日志流拿到了再补上。会话此时已被关掉的话，顺手把这条响应流收掉并回 false。</summary>
        public static bool Attach(Guid id, Stream log)
        {
            if (!sessions.TryGetValue(id, out var entry))
            {
                try { log.Dispose(); } catch { }
                return false;
            }

            entry.Log = log;
            return true;
        }

        /// <summary>幂等清理：自然读完、被服务端关掉、读流出错，三条路都走到这里。</summary>
        public static void Remove(Guid id)
        {
            if (!sessions.TryRemove(id, out var entry))
            {
                return;
            }

            entry.Cts.Cancel();
            try { entry.Log?.Dispose(); } catch { }
            entry.Cts.Dispose();

            // 一定要完成这个 writer：服务端 RpcCallStreamBack 等的就是它，
            // 不完成就等于每开一次日志面板永久吃掉一个该连接的 RPC 槽位
            entry.Output.TryComplete();
        }
    }
}
