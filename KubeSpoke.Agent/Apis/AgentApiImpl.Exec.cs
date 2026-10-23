using KubeSpoke.Agent.Connecting;
using KubeSpoke.Contracts.Dtos;
using k8s;
using k8s.Autorest;
using Microsoft.Extensions.Logging;
using System.Net.WebSockets;
using System.Text;
using System.Threading.Channels;

namespace KubeSpoke.Agent.Apis
{
    public partial class AgentApiImpl
    {
        /// <summary>
        /// 开一个容器终端。输出以 base64 帧推给服务端（JSON 通道装不下裸字节，半截 UTF-8 会乱码），
        /// 输入和改尺寸不走这套请求/回执 RPC，而是服务端直接往 agent 连接上推消息。
        /// </summary>
        public ChannelReader<string> StartPodExec(StartPodExecRequest request)
        {
            var (reader, cts, output) = ExecSessions.Open(request.SessionId);
            var command = string.IsNullOrWhiteSpace(request.Command) ? "/bin/sh" : request.Command;

            Task.Run(async () =>
            {
                try
                {
                    if (client is not ExecKubernetes exec)
                    {
                        throw new InvalidOperationException($"agent 注册的 k8s 客户端不是 {nameof(ExecKubernetes)}，开不了终端");
                    }

                    // 先按 v5 谈，这条才带得出改尺寸的通道。v5 是 1.31 才有的，老集群握手时会把它否掉，
                    // 那就退回 v4：终端照样能用，只是尺寸固定在打开那一刻
                    WebSocket socket;
                    var canResize = true;
                    try
                    {
                        socket = await Connect(exec, request, command, ExecKubernetes.V5Protocol, cts.Token)
                            .ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        throw;
                    }
                    catch (Exception v5ex)
                    {
                        logger.LogDebug($"[exec v5 握手不成，退回 v4] {v5ex.Message}");
                        socket = await Connect(exec, request, command, ExecKubernetes.V4Protocol, cts.Token)
                            .ConfigureAwait(false);
                        canResize = false;
                    }

                    var muxer = new StreamDemuxer(socket, ownsSocket: true);
                    var stdout = muxer.GetStream(ChannelIndex.StdOut, null);
                    muxer.Start();

                    logger.LogInformation($"[exec 已握手] {request.Namespace}/{request.Name} 会话 {request.SessionId} 协议={(canResize ? "v5" : "v4")}");

                    // 会话在握手期间被关掉的话 Attach 已经把连接收走了，这里不能再碰
                    if (!ExecSessions.Attach(request.SessionId, muxer, socket, canResize))
                    {
                        return;
                    }

                    // 打开时的宽高由这里补发：浏览器在连上那一刻就把 Resize 推过来，
                    // 那时这根 exec 通道还没握手完，会被当成落空丢掉，PTY 就一直停在 0x0
                    if (canResize)
                    {
                        ExecSessions.Resize(request.SessionId, request.Cols, request.Rows);
                    }

                    var buffer = new byte[4096];
                    while (true)
                    {
                        var count = await stdout.ReadAsync(buffer, 0, buffer.Length, cts.Token).ConfigureAwait(false);
                        if (count == 0)
                        {
                            // 容器里的 shell 退了（exit、OOM、Pod 收尾），这条通道到此为止
                            break;
                        }

                        await output.WriteAsync(Convert.ToBase64String(buffer, 0, count), cts.Token).ConfigureAwait(false);
                    }
                }
                catch (OperationCanceledException)
                {
                    // 浏览器断开，正常收摊
                }
                catch (Exception ex)
                {
                    // 容器里没这个 shell、Pod 正在退出等原因要写在终端里给用户看见，
                    // 不然他只会对着一个空白面板反复点
                    var detail = (ex as HttpOperationException)?.Response?.Content ?? ex.Message;
                    logger.LogError(ex, $"[exec 失败] {request.Namespace}/{request.Name} {request.Container}");
                    var text = $"\r\x1b[31m终端连接失败：{detail}\x1b[0m\r\n";
                    output.TryWrite(Convert.ToBase64String(Encoding.UTF8.GetBytes(text)));
                }
                finally
                {
                    ExecSessions.Remove(request.SessionId);
                }
            });

            return reader;
        }

        static Task<WebSocket> Connect(ExecKubernetes exec, StartPodExecRequest request, string command,
            string protocol, CancellationToken cancellationToken)
        {
            return exec.ConnectExecAsync(request.Namespace, request.Name, request.Container, new[] { command },
                tty: true, protocol, request.Cols, request.Rows, cancellationToken);
        }
    }
}
