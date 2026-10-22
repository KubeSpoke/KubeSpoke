using k8s;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace KubeSpoke.Agent.Connecting
{
    /// <summary>
    /// 控制台打开的容器终端会话表。服务端在浏览器断开时会往这根 agent 连接推 ExecClose，
    /// 靠的是会话 id 而不是 RPC 请求 id，所以会话必须在 agent 侧留一份可寻址的注册表。
    /// </summary>
    public static class ExecSessions
    {
        class Entry
        {
            public IStreamDemuxer Muxer;
            public WebSocket Socket;
            public CancellationTokenSource Cts;
            public ChannelWriter<string> Output;

            /// <summary>
            /// 发往容器的帧先在这里排队。SignalR 对同一根连接上先后到达的调用是并发派发的，
            /// 直接在 handler 里 await 发送，按键就会在 socket 上互相穿插——终端里看到的是一行乱码。
            /// 入队发生在 handler 的同步前缀里，顺序即到达顺序，由一个泵串行发出去。
            /// </summary>
            public readonly Channel<Func<Task>> Outbox = Channel.CreateUnbounded<Func<Task>>(new UnboundedChannelOptions { SingleReader = true });

            /// <summary>握手谈成 v5 才有 resize 通道；v4 集群上这路终端只能保持打开那一刻的尺寸。</summary>
            public bool CanResize;
        }

        static readonly ConcurrentDictionary<Guid, Entry> sessions = new();

        /// <summary>先把会话登记好，exec 握手期间也能被 Close 掉，否则失败的会话会挂着一根没人读的通道。</summary>
        public static (ChannelReader<string> Reader, CancellationTokenSource Cts, ChannelWriter<string> Output) Open(Guid id)
        {
            var channel = Channel.CreateUnbounded<string>();
            var cts = new CancellationTokenSource();
            var entry = new Entry { Cts = cts, Output = channel.Writer };
            sessions[id] = entry;

            Task.Run(async () =>
            {
                while (await entry.Outbox.Reader.WaitToReadAsync())
                {
                    while (entry.Outbox.Reader.TryRead(out var frame))
                    {
                        try
                        {
                            await frame();
                        }
                        catch (Exception)
                        {
                            // 写不进容器就是这路终端到头了（shell 已退出、连接被集群收走），
                            // 留着只会让浏览器对着一个不再回话的面板打字
                            Remove(id);
                            return;
                        }
                    }
                }
            });

            return (channel.Reader, cts, channel.Writer);
        }

        /// <summary>握手成功后补上 exec 通道。会话此时已被关掉的话，立刻把刚开的连接收掉。</summary>
        public static bool Attach(Guid id, IStreamDemuxer muxer, WebSocket socket, bool canResize)
        {
            if (!sessions.TryGetValue(id, out var entry))
            {
                muxer.Dispose();
                return false;
            }

            entry.Muxer = muxer;
            entry.Socket = socket;
            entry.CanResize = canResize;
            return true;
        }

        /// <summary>把键盘输入排进这路会话的下行队列。会话不存在或 base64 不合法回 false，由服务端结束终端。</summary>
        public static bool Write(Guid id, string base64)
        {
            if (!TryGet(id, out var entry))
            {
                return false;
            }

            byte[] data;
            try
            {
                data = Convert.FromBase64String(base64);
            }
            catch (FormatException)
            {
                return false;
            }

            return entry.Outbox.Writer.TryWrite(() => Send(entry, (byte)ChannelIndex.StdIn, data));
        }

        /// <summary>
        /// 改 PTY 尺寸：v5 把尺寸当 JSON 塞进 resize 通道。
        /// 服务端新老两套字段名都认（Width/Height 是老版的，Cols/Rows 是 kubectl 现在发的），一起写过去最省事。
        /// </summary>
        public static bool Resize(Guid id, int cols, int rows)
        {
            if (!TryGet(id, out var entry) || !entry.CanResize)
            {
                return false;
            }

            var payload = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { Cols = cols, Rows = rows, Width = cols, Height = rows }));
            return entry.Outbox.Writer.TryWrite(() => Send(entry, (byte)ChannelIndex.Resize, payload));
        }

        /// <summary>
        /// 直接按协议发帧，不用库里那套 MuxedStream：它发完一帧不把 endOfMessage 置上，
        /// 于是每个按键都是一条永远收不到尾的 WebSocket 消息。
        /// </summary>
        static async Task Send(Entry entry, byte channel, byte[] payload)
        {
            var buffer = new byte[payload.Length + 1];
            buffer[0] = channel;
            Buffer.BlockCopy(payload, 0, buffer, 1, payload.Length);
            await entry.Socket.SendAsync(new ArraySegment<byte>(buffer), WebSocketMessageType.Binary, true, entry.Cts.Token)
                .ConfigureAwait(false);
        }

        static bool TryGet(Guid id, out Entry entry)
        {
            entry = null;
            if (!sessions.TryGetValue(id, out var found) || found.Socket == null)
            {
                return false;
            }

            entry = found;
            return true;
        }

        /// <summary>幂等清理：谁先到（浏览器断开、容器里 exit、读循环结束）都调用它。</summary>
        public static void Remove(Guid id)
        {
            if (!sessions.TryRemove(id, out var entry))
            {
                return;
            }

            entry.Outbox.Writer.TryComplete();
            entry.Cts.Cancel();
            try { entry.Muxer?.Dispose(); } catch { }
            entry.Cts.Dispose();
            // 不带异常完成：出错原因已经以文本帧发给终端了，通道再抛一次只会多一条没人处理的堆栈
            entry.Output.TryComplete();
        }
    }
}
