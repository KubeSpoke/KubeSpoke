using k8s;
using k8s.Autorest;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace KubeSpoke.Agent.Connecting
{
    /// <summary>一次性 exec 的结果：容器里那条命令的全部 stdout，以及它为什么没成。</summary>
    public class PodExecResult
    {
        public bool Ok { get; init; }

        public string StdOut { get; init; } = "";

        /// <summary>失败原因，优先 stderr，其次 error 通道里的 Status JSON，最后兜底一句退出码非零</summary>
        public string Error { get; init; } = "";
    }

    /// <summary>
    /// 在容器里跑一条一次性命令并收全输出——文件浏览的列目录、建目录、删除都建在这上面。
    /// <para>
    /// 命令按 argv 直接交给 exec，不经过 shell，所以路径里的空格、引号、分号都不用转义。
    /// 唯一需要 shell 的场景是上传时的重定向，那种地方用 <see cref="Quote"/> 自己拼。
    /// </para>
    /// <para>
    /// 退出码不靠解析输出：tty=false 时 API Server 会在 error 通道（3 号）回一个 k8s Status，
    /// 成功是 {"status":"Success"}，非零退出是 Failure 带 reason/code，所以三条流都得读完再判。
    /// </para>
    /// </summary>
    public static class PodExecPipe
    {
        /// <summary>一次性命令最长跑这么久。服务端 RPC 窗口 15s，这里留 3s 收尾，免得超时后 agent 还挂着一条 exec</summary>
        static readonly TimeSpan RunLimit = TimeSpan.FromSeconds(12);

        public static async Task<PodExecResult> RunAsync(ExecKubernetes exec, string ns, string pod,
            string container, string[] command, CancellationToken outerCt)
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(outerCt);
            cts.CancelAfter(RunLimit);

            WebSocket socket;
            try
            {
                // 一次性命令不需要 resize 通道，直接谈 v4，省掉终端那趟 v5 失败回退的握手
                socket = await exec.ConnectExecAsync(ns, pod, container, command, tty: false,
                    ExecKubernetes.V4Protocol, 0, 0, cts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                // 容器里没有这个可执行文件、Pod 正在退出等原因，API Server 在握手阶段就以 HTTP 错误回绝
                return new PodExecResult { Ok = false, Error = Describe(ex) };
            }

            string stdout = "", stderr = "", status = "";
            Exception? readError = null;
            using (var muxer = new StreamDemuxer(socket, ownsSocket: true))
            {
                var outStream = muxer.GetStream(ChannelIndex.StdOut, null);
                var errStream = muxer.GetStream(ChannelIndex.StdErr, null);
                var statusStream = muxer.GetStream(ChannelIndex.Error, null);
                muxer.Start();

                try
                {
                    // 三条流并发读：只等 stdout 的话，命令把话全说在 stderr 上会一直收不到尾
                    var tOut = ReadAll(outStream);
                    var tErr = ReadAll(errStream);
                    var tStatus = ReadAll(statusStream);
                    await Task.WhenAll(tOut, tErr, tStatus).ConfigureAwait(false);
                    stdout = tOut.Result;
                    stderr = tErr.Result;
                    status = tStatus.Result;
                }
                catch (Exception ex)
                {
                    readError = ex;
                }
            }

            if (readError != null)
            {
                return new PodExecResult { Ok = false, StdOut = stdout, Error = Describe(readError) };
            }

            if (Succeeded(status))
            {
                return new PodExecResult { Ok = true, StdOut = stdout, Error = stderr };
            }

            var detail = stderr.Trim();
            if (string.IsNullOrEmpty(detail))
            {
                detail = FailureMessage(status);
            }
            if (string.IsNullOrEmpty(detail))
            {
                detail = "容器里的命令以非零状态退出";
            }
            return new PodExecResult { Ok = false, StdOut = stdout, Error = detail };
        }

        /// <summary>
        /// 在容器里跑一条命令并把 stdout 一段段交出去——下载走这条，
        /// 所以文件大小不受任何限制：agent 内存里始终只有一帧。
        /// <para>不设 <see cref="RunLimit"/>：传一个几百兆的文件本来就该跑几分钟。</para>
        /// </summary>
        public static async Task StreamAsync(ExecKubernetes exec, string ns, string pod, string container,
            string[] command, Func<byte[], int, Task> onData, CancellationToken outerCt)
        {
            var socket = await exec.ConnectExecAsync(ns, pod, container, command, tty: false,
                ExecKubernetes.V4Protocol, 0, 0, outerCt).ConfigureAwait(false);

            using var muxer = new StreamDemuxer(socket, ownsSocket: true);
            var stdout = muxer.GetStream(ChannelIndex.StdOut, null);
            var stderr = muxer.GetStream(ChannelIndex.StdErr, null);
            var statusStream = muxer.GetStream(ChannelIndex.Error, null);
            muxer.Start();

            var tErr = Task.Run(async () => await ReadAll(stderr).ConfigureAwait(false));
            var tStatus = Task.Run(async () => await ReadAll(statusStream).ConfigureAwait(false));

            var buffer = new byte[64 * 1024];
            int count;
            while ((count = await stdout.ReadAsync(buffer, 0, buffer.Length, outerCt).ConfigureAwait(false)) > 0)
            {
                await onData(buffer, count).ConfigureAwait(false);
            }

            var status = await tStatus.ConfigureAwait(false);
            if (Failed(status))
            {
                var detail = (await tErr).Trim();
                throw new IOException(string.IsNullOrEmpty(detail) ? FailureMessage(status) : detail);
            }
        }

        static async Task<string> ReadAll(Stream stream)
        {
            using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: false,
                leaveOpen: true);
            try
            {
                return await reader.ReadToEndAsync().ConfigureAwait(false);
            }
            catch (Exception)
            {
                // 通道被取消打断时读到一半，已经拿到的部分照样有用（ls 的表头、cat 的前半截）
                return "";
            }
        }

        /// <summary>
        /// error 通道没回话按成功算：只有非零退出才会塞一个 Failure Status 进来，
        /// 而个别老集群在成功时也会把这条通道直接关掉不给字。
        /// </summary>
        static bool Succeeded(string status) => !Failed(status);

        public static bool Failed(string status)
        {
            if (string.IsNullOrWhiteSpace(status))
            {
                return false;
            }

            return status.Contains("\"Failure\"");
        }

        public static string FailureMessage(string status)
        {
            if (string.IsNullOrWhiteSpace(status))
            {
                return "";
            }

            try
            {
                using var doc = JsonDocument.Parse(status);
                if (doc.RootElement.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String)
                {
                    return m.GetString() ?? "";
                }
            }
            catch (JsonException)
            {
                // Status 不是合法 JSON 就把原文交给用户，比吞掉强
            }

            return status.Trim();
        }

        public static string Describe(Exception? ex)
        {
            var detail = (ex as HttpOperationException)?.Response?.Content ?? ex?.Message ?? "";
            return detail.Trim();
        }

        /// <summary>
        /// 包一层给 sh -c 用的单引号转义：' 换成 '\''. 只在必须用重定向的时候用得着，
        /// 其余命令一律走 argv，压根不需要经过 shell。
        /// </summary>
        public static string Quote(string value)
        {
            return "'" + value.Replace("'", @"'\''") + "'";
        }
    }
}
