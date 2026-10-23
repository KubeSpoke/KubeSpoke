using KubeSpoke.Agent.Connecting;
using KubeSpoke.Contracts.Dtos;
using Microsoft.Extensions.Logging;
using System.Globalization;
using System.Net.WebSockets;
using System.Text;
using System.Threading.Channels;

namespace KubeSpoke.Agent.Apis
{
    /// <summary>
    /// 容器内文件浏览与传输。全部建在 exec 之上（和 kubectl cp 是同一件事），
    /// 所以容器里只要有 sh / ls / cat 就够了，不需要 sshfs、不需要挂载、不需要往集群里塞常驻组件。
    /// <para>
    /// 这些方法都是同步返回的——RPC 派发是反射调用方法本身，不会 await，所以里面直接
    /// GetAwaiter().GetResult() 等到底层 exec 跑完。等待窗口由 [MaxWaitSec] 在服务端放宽到 15s，
    /// agent 侧再靠 <see cref="PodExecPipe"/> 的自带超时兜一层，不会真的挂死。
    /// </para>
    /// </summary>
    public partial class AgentApiImpl
    {
        ExecKubernetes RequireExec()
        {
            if (client is not ExecKubernetes exec)
            {
                throw new InvalidOperationException($"agent 注册的 k8s 客户端不是 {nameof(ExecKubernetes)}，操作不了容器文件");
            }

            return exec;
        }

        /// <summary>
        /// 归一容器内路径：必须绝对、折叠重复斜杠、去掉结尾斜杠。
        /// 故意不动 ".."——路径是按 argv 直接交给 ls/cat 的，不过 shell，没有拼注入的风险，
        /// 而提前把 ".." 化掉反而会在软链接上算出另一个目录。
        /// </summary>
        static string RequireAbsolute(string path, string what)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException($"{what}不能为空");
            }

            var trimmed = path.Trim();
            if (!trimmed.StartsWith('/'))
            {
                throw new ArgumentException($"{what}必须是绝对路径：{trimmed}");
            }

            return "/" + string.Join('/', trimmed.Split('/', StringSplitOptions.RemoveEmptyEntries));
        }

        public PodFileListResult ListPodFiles(ListPodFilesRequest request)
        {
            var dir = RequireAbsolute(request.Path, "目录");
            var exec = RequireExec();

            // -- 挡住以 - 开头的文件名被 ls 当成选项；路径走 argv 不过 shell，所以不用转义
            var res = PodExecPipe.RunAsync(exec, request.Namespace, request.Name, request.Container,
                new[] { "ls", "-la", "--", dir }, CancellationToken.None).GetAwaiter().GetResult();

            if (!res.Ok)
            {
                throw new Exception(string.IsNullOrWhiteSpace(res.Error) ? $"读取目录失败：{dir}" : $"{dir}：{res.Error}");
            }

            var result = new PodFileListResult { Path = dir };
            foreach (var raw in res.StdOut.Split('\n'))
            {
                var entry = ParseLsLine(raw.TrimEnd('\r'), dir);
                if (entry != null)
                {
                    result.Items.Add(entry);
                }
            }

            return result;
        }

        /// <summary>
        /// 解析 ls -l 的一行。GNU 和 busybox 字段顺序一致，只是对齐方式和日期呈现不同：
        /// 最近的文件给 "Oct 21 09:12"，一年前的给 "Jan  1  1970"。
        /// </summary>
        static PodFileEntry? ParseLsLine(string line, string dir)
        {
            if (string.IsNullOrWhiteSpace(line) || line.StartsWith("total "))
            {
                return null;
            }

            var fields = line.Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
            // 模式 链接数 属主 属组 大小 月 日 时间或年，名字是剩下的全部
            if (fields.Length < 9)
            {
                return null;
            }

            var mode = fields[0];
            if (mode.Length < 10 || "bcdlpPs-".IndexOf(mode[0]) < 0)
            {
                return null;
            }

            // 名字里可以有空格，也可以和属主同名，所以只能按"跳过前 8 段"定位，不能拿字符串去找
            var name = line[SkipFields(line, 8)..].Trim();
            string? link = null;

            var arrow = name.IndexOf(" -> ", StringComparison.Ordinal);
            if (arrow >= 0)
            {
                link = name[(arrow + 4)..];
                name = name[..arrow];
            }

            if (name == "." || name == "..")
            {
                return null;
            }

            long.TryParse(fields[4], out var size);

            return new PodFileEntry
            {
                Name = name,
                Type = mode[0] switch
                {
                    'd' => "dir",
                    'l' => "link",
                    '-' => "file",
                    _ => "other",
                },
                Size = size,
                Modified = ParseLsDate(fields[5], fields[6], fields[7]),
                Mode = fields[0],
                Owner = fields[2],
                Group = fields[3],
                Link = link,
            };
        }

        /// <summary>返回第 n 个空白分段之后第一个字符的下标</summary>
        static int SkipFields(string line, int count)
        {
            var i = 0;
            for (var seen = 0; seen < count && i < line.Length; )
            {
                while (i < line.Length && char.IsWhiteSpace(line[i]))
                {
                    i++;
                }
                while (i < line.Length && !char.IsWhiteSpace(line[i]))
                {
                    i++;
                }
                seen++;
            }

            while (i < line.Length && char.IsWhiteSpace(line[i]))
            {
                i++;
            }

            return i;
        }

        /// <summary>
        /// ls 打的是容器本地时间，绝大多数镜像没设 TZ 也就是 UTC，这里按 UTC 解释。
        /// 只给到分钟、不给年份的那种（"Oct 21 09:12"）用当前年补齐——ls 本身就把年份丢了。
        /// </summary>
        static DateTime ParseLsDate(string month, string day, string timeOrYear)
        {
            var ci = CultureInfo.InvariantCulture;
            var d = int.TryParse(day, out var dd) ? dd : 1;

            if (timeOrYear.Contains(':'))
            {
                if (DateTime.TryParseExact($"{month} {d} {DateTime.UtcNow.Year} {timeOrYear}", "MMM d yyyy HH:mm", ci,
                        DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var t))
                {
                    return t;
                }
            }
            else if (DateTime.TryParseExact($"{month} {d} {timeOrYear}", "MMM d yyyy", ci,
                        DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var y))
            {
                return y;
            }

            return DateTime.UnixEpoch;
        }

        public ChannelReader<string> DownloadPodFile(DownloadPodFileRequest request)
        {
            var path = RequireAbsolute(request.Path, "文件");
            var exec = RequireExec();
            var channel = Channel.CreateUnbounded<string>();

            Task.Run(async () =>
            {
                try
                {
                    await PodExecPipe.StreamAsync(exec, request.Namespace, request.Name, request.Container,
                        new[] { "cat", "--", path },
                        async (buffer, count) => await channel.Writer
                            .WriteAsync(Convert.ToBase64String(buffer, 0, count), CancellationToken.None)
                            .ConfigureAwait(false),
                        CancellationToken.None).ConfigureAwait(false);

                    channel.Writer.TryComplete();
                }
                catch (Exception ex)
                {
                    // 以异常收尾：服务端在写出第一个字节之前接住它，就能还一个像样的错误码，
                    // 而不是给用户一个 0 字节的文件
                    logger.LogError(ex, $"[下载失败] {request.Namespace}/{request.Name} {path}");
                    channel.Writer.TryComplete(ex);
                }
            });

            return channel.Reader;
        }

        /// <summary>
        /// 开一路上传。容器侧只跑 <c>cat &gt; 临时文件</c>：搬到目标路径是服务端在确认字节全部到位之后
        /// 单独下的一道 <see cref="MovePodFile"/> 指令。
        /// <para>
        /// 之所以不让 cat 自己 mv：浏览器中途关掉时这根 exec 会断，cat 收到 EOF 以 0 退出，
        /// 脚本里的 mv 就照做了——目标文件被一个只写了一半的临时文件覆盖。
        /// 半途失败因此只多留下一个临时文件，原有同名文件一动不动。
        /// </para>
        /// <para>
        /// 返回的通道要等 cat 退出才流尽，服务端就靠这个判断字节是否全部落到了临时文件里。
        /// 成功时它一帧都不发，任何一帧都是给人看的错误说明。
        /// </para>
        /// </summary>
        public ChannelReader<string> StartPodUpload(StartPodUploadRequest request)
        {
            var tmp = RequireAbsolute(request.TempPath, "临时文件");
            var exec = RequireExec();
            var (reader, cts, output) = ExecSessions.Open(request.SessionId);
            var script = $"cat > {PodExecPipe.Quote(tmp)}";

            Task.Run(async () =>
            {
                try
                {
                    // tty 必须关掉：PTY 的行规程会把 \n 翻成 \r\n、把控制字符当信号，二进制字节流过去必坏
                    // 协议只认 v5：上传要在不关连接的前提下给 stdin 一个 EOF，只有 v5 有半关信号，
                    // v4 集群上谈不成这路上传（终端退到 v4 照样能用，因为终端不需要结束输入）
                    WebSocket socket;
                    try
                    {
                        socket = await exec.ConnectExecAsync(request.Namespace, request.Name, request.Container,
                            new[] { "sh", "-c", script }, tty: false, ExecKubernetes.V5Protocol, 0, 0, cts.Token)
                            .ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        throw;
                    }
                    catch (Exception v5ex)
                    {
                        throw new Exception($"这个集群的 exec 谈不成 v5 协议，传不了文件（v5 才有「输入结束」信号，1.30 起支持）：{v5ex.Message}");
                    }

                    var muxer = new k8s.StreamDemuxer(socket, ownsSocket: true);
                    var stdout = muxer.GetStream(k8s.ChannelIndex.StdOut, null);
                    var stderr = muxer.GetStream(k8s.ChannelIndex.StdErr, null);
                    var status = muxer.GetStream(k8s.ChannelIndex.Error, null);
                    muxer.Start();

                    if (!ExecSessions.Attach(request.SessionId, muxer, socket, v5: true))
                    {
                        return;
                    }

                    // cat 不往 stdout 写字，这三路读全只是为了等容器里的进程结束
                    var tErr = Task.Run(async () => await new StreamReader(stderr).ReadToEndAsync(cts.Token));
                    var tStatus = Task.Run(async () => await new StreamReader(status).ReadToEndAsync(cts.Token));
                    var sink = new byte[4096];
                    while (await stdout.ReadAsync(sink, 0, sink.Length, cts.Token) > 0)
                    {
                    }

                    var statusText = await tStatus;
                    if (PodExecPipe.Failed(statusText))
                    {
                        var detail = (await tErr).Trim();
                        output.TryWrite($"上传失败：{(string.IsNullOrEmpty(detail) ? PodExecPipe.FailureMessage(statusText) : detail)}");
                    }
                }
                catch (OperationCanceledException)
                {
                    // 服务端推过 ExecClose，正常收摊
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, $"[上传会话失败] {request.Namespace}/{request.Name} {tmp}");
                    output.TryWrite($"上传失败：{PodExecPipe.Describe(ex)}");
                }
                finally
                {
                    ExecSessions.Remove(request.SessionId);
                }
            });

            return reader;
        }

        /// <summary>
        /// 把写完的临时文件搬到目标路径。mv 在同一文件系统里是改目录项，跟文件大小无关，几毫秒就回。
        /// <para>
        /// 搬之前按字节数复核一次：exec 半途被收走时容器里的 cat 同样收到 EOF 并以 0 退出，
        /// 光看它退没退分不出"写完了"和"只写了一半"，而差一个字节都不许盖掉原有的目标文件。
        /// </para>
        /// </summary>
        public bool MovePodFile(MovePodFileRequest request)
        {
            var from = RequireAbsolute(request.From, "临时文件");
            var to = RequireAbsolute(request.To, "目标文件");
            var exec = RequireExec();

            var check = PodExecPipe.RunAsync(exec, request.Namespace, request.Name, request.Container,
                new[] { "wc", "-c", "--", from }, CancellationToken.None).GetAwaiter().GetResult();

            if (!check.Ok)
            {
                throw new Exception($"上传收尾时找不到临时文件 {from}：{check.Error}".Trim());
            }

            var received = ParseByteCount(check.StdOut);
            if (received != request.ExpectBytes)
            {
                throw new Exception($"容器里只收到 {received} 字节，应当是 {request.ExpectBytes} 字节，这次上传没有写完");
            }

            var res = PodExecPipe.RunAsync(exec, request.Namespace, request.Name, request.Container,
                new[] { "mv", "-f", "--", from, to }, CancellationToken.None).GetAwaiter().GetResult();

            if (!res.Ok)
            {
                throw new Exception($"文件落位失败：{from} → {to} {res.Error}".Trim());
            }

            return true;
        }

        /// <summary>wc -c 回的是 "&lt;字节数&gt; &lt;路径&gt;"，取第一段。</summary>
        static long ParseByteCount(string wcOutput)
        {
            var first = wcOutput.Split((char[])null, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            if (!long.TryParse(first, out var bytes))
            {
                throw new Exception($"读不出容器里的文件字节数：{wcOutput.Trim()}");
            }

            return bytes;
        }

        public bool MakePodDirectory(MakePodDirectoryRequest request)
        {
            var dir = RequireAbsolute(request.Path, "目录");
            var exec = RequireExec();

            var res = PodExecPipe.RunAsync(exec, request.Namespace, request.Name, request.Container,
                new[] { "mkdir", "-p", "--", dir }, CancellationToken.None).GetAwaiter().GetResult();

            if (!res.Ok)
            {
                throw new Exception($"创建目录失败：{dir} {res.Error}".Trim());
            }

            return true;
        }

        public bool RemovePodFiles(RemovePodFilesRequest request)
        {
            if (request.Paths == null || request.Paths.Count == 0)
            {
                throw new ArgumentException("没有要删除的路径");
            }

            var exec = RequireExec();
            var command = new List<string> { "rm", "-rf", "--" };
            foreach (var path in request.Paths)
            {
                var absolute = RequireAbsolute(path, "路径");
                if (absolute == "/")
                {
                    throw new ArgumentException("不允许删除根目录");
                }

                command.Add(absolute);
            }

            var res = PodExecPipe.RunAsync(exec, request.Namespace, request.Name, request.Container,
                command.ToArray(), CancellationToken.None).GetAwaiter().GetResult();

            if (!res.Ok)
            {
                throw new Exception($"删除失败：{res.Error}".Trim());
            }

            return true;
        }
    }
}
