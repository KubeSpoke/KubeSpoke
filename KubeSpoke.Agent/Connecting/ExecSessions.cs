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

            /// <summary>
            /// 握手是否谈成 v5。谈成才既有多余的 resize 通道，也有半关信号 [0xFF, 通道号]：
            /// v4 的收帧循环只认「通道号 + 载荷」，见都没见过这个信号，收到只会当非法通道丢掉。
            /// 上传靠它给容器里的 cat 一个 EOF，所以只肯用 v5 开；终端谈不成 v5 也能用，只是尺寸固定在打开那一刻。
            /// </summary>
            public bool V5;

            /// <summary>v5 的半关信号：整帧就两字节，第一个是 0xFF（不是通道号），第二个才是要关的通道。</summary>
            public const byte StreamClose = 0xFF;

            /// <summary>
            /// exec 握手完成的信号。握手要几百毫秒，这期间到达的按键/上传分片不能算落空——
            /// 上传的第一片尤其不能丢，丢了整个文件就少一截，所以让它们全部在队列里等这一下。
            /// </summary>
            public readonly TaskCompletionSource Attached = new(TaskCreationOptions.RunContinuationsAsynchronously);

            /// <summary>等到的最长时限：超过就是这路会话起不来了，交给泵去收掉。</summary>
            public const int AttachWaitSec = 15;
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
                        catch (Exception ex)
                        {
                            // 写不进容器就是这路会话到头了（shell 已退出、连接被集群收走），
                            // 留着只会让浏览器对着一个不再回话的面板打字。
                            // 原因必须写成帧交回去：上传那边看到通道空着结束会当成"容器已经写完"，
                            // 半途断线就是这么被说成成功的。
                            entry.Output.TryWrite($"容器输入通道已断开：{ex.Message}");
                            Remove(id);
                            return;
                        }
                    }
                }
            });

            return (channel.Reader, cts, channel.Writer);
        }

        /// <summary>握手成功后补上 exec 通道。会话此时已被关掉的话，立刻把刚开的连接收掉。</summary>
        public static bool Attach(Guid id, IStreamDemuxer muxer, WebSocket socket, bool v5)
        {
            if (!sessions.TryGetValue(id, out var entry))
            {
                muxer.Dispose();
                return false;
            }

            entry.Muxer = muxer;
            entry.Socket = socket;
            entry.V5 = v5;
            entry.Attached.TrySetResult();
            return true;
        }

        /// <summary>把键盘输入排进这路会话的下行队列。会话不存在或 base64 不合法回 false，由服务端结束终端。</summary>
        public static bool Write(Guid id, string base64)
        {
            if (!sessions.TryGetValue(id, out var entry))
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
        /// 给容器侧的 stdin 一个 EOF：发 v5 的半关信号，只收掉 stdin 这一路，
        /// stdout/stderr/error 三根通道照旧——容器里的 cat 就是靠这个 EOF 才退出，
        /// 而它退出的成败要从 error 通道读回来，所以绝不能图省事直接关整条连接。
        /// 会话不存在、或这路压根不是 v5（半关信号发出去也没人认）时回 false。
        /// </summary>
        public static bool CloseStdIn(Guid id)
        {
            if (!sessions.TryGetValue(id, out var entry) || !entry.V5)
            {
                return false;
            }

            return entry.Outbox.Writer.TryWrite(() => SendRaw(entry, new byte[] { Entry.StreamClose, (byte)ChannelIndex.StdIn }));
        }

        /// <summary>
        /// 改 PTY 尺寸：v5 把尺寸当 JSON 塞进 resize 通道。
        /// 服务端新老两套字段名都认（Width/Height 是老版的，Cols/Rows 是 kubectl 现在发的），一起写过去最省事。
        /// </summary>
        public static bool Resize(Guid id, int cols, int rows)
        {
            if (!TryGet(id, out var entry) || !entry.V5)
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
            await SendRaw(entry, buffer);
        }

        /// <summary>
        /// 排进队列的帧可能到得比握手还早，所以这里先等它谈成。
        /// 上传的第一片尤其不能丢——丢了整个文件就少一截。
        /// </summary>
        static async Task SendRaw(Entry entry, byte[] frame)
        {
            await entry.Attached.Task.WaitAsync(TimeSpan.FromSeconds(Entry.AttachWaitSec), entry.Cts.Token)
                .ConfigureAwait(false);

            await entry.Socket.SendAsync(new ArraySegment<byte>(frame), WebSocketMessageType.Binary, true, entry.Cts.Token)
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
            // 握手还没谈成就被关掉：让排在队列里等 Attach 的帧立刻散掉，别吊着一个永远不回来的泵
            entry.Attached.TrySetCanceled();
            entry.Cts.Cancel();
            try { entry.Muxer?.Dispose(); } catch { }
            entry.Cts.Dispose();
            // 不带异常完成：出错原因已经以文本帧发给终端了，通道再抛一次只会多一条没人处理的堆栈
            entry.Output.TryComplete();
        }
    }
}
