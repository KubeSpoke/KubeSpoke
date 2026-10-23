using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Server.Data;
using KubeSpoke.Server.Extensions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using System.Collections.Concurrent;
using System.Threading.Channels;

namespace KubeSpoke.Server.Hubs
{
    /// <summary>
    /// 容器文件上传通道。下载走普通 HTTP（一次 GET 就够），上传不行：
    /// 字节要从浏览器一片一片喂进容器里的 cat，而这条链路既没有请求体上限，也不该有——
    /// HTTP 那侧要撑住大文件就得改 Kestrel 的全局限制、还要处理半截连接，
    /// 不如单开一根 SignalR，把每片当成一帧，尺寸限制天然按帧算。
    /// <para>
    /// 容器侧的会话表直接复用终端那套 <see cref="ConstString.AGENT_EXEC_INPUT"/>：
    /// 上行也是「往某路 exec 会话的 stdin 写一帧 base64」，是同一件事，没必要再教 agent 认一套新消息。
    /// </para>
    /// </summary>
    [Authorize(AuthenticationSchemes = UserAuthExtensions.ConsoleScheme)]
    public class FileHub : Hub
    {
        ILogger<FileHub> logger;
        IAgentApis agentApis;
        IServiceScopeFactory scopeFactory;

        public FileHub(ILogger<FileHub> logger, IAgentApis agentApis, IServiceScopeFactory scopeFactory)
        {
            this.logger = logger;
            this.agentApis = agentApis;
            this.scopeFactory = scopeFactory;
        }

        /// <summary>这根连接是从哪个容器开出来的，StartUpload 时拿来填请求。</summary>
        class Target
        {
            public string Cluster = "";
            public string Pod = "";
            public string Namespace = "";
            public string Container = "";
            public string Actor = "";
            public string Ip = "";
        }

        class Upload
        {
            public Guid Id;
            public Target Target;
            public string Path = "";

            /// <summary>容器里 cat 实际写入的文件，搬到位才算上传成功。</summary>
            public string TempPath = "";
            public DateTime StartedAt;

            /// <summary>推给容器的字节数，落位前拿去和容器里 wc -c 的结果对账。</summary>
            public long Received;

            /// <summary>容器里的 cat 收到 EOF 退出（agent 那路会话流尽）时置上，带过去就是失败原因。</summary>
            public readonly TaskCompletionSource<string> Done = new(TaskCreationOptions.RunContinuationsAsynchronously);
        }

        static readonly ConcurrentDictionary<string, Target> targets = new();

        /// <summary>会话按 id 存，另按连接索引一份，浏览器断开时才知道该收掉哪几路。</summary>
        static readonly ConcurrentDictionary<Guid, Upload> uploads = new();

        static readonly ConcurrentDictionary<string, List<Guid>> perConnection = new();

        /// <summary>等容器里 cat 收 EOF 后退出的时限：正常几秒；给到 60s 是留给慢盘和大文件的最后一帧。虚的只为让测试子类缩短它。</summary>
        protected virtual TimeSpan FinishWait => TimeSpan.FromSeconds(60);

        string ConnectionId => Context.ConnectionId;

        public override Task OnConnectedAsync()
        {
            var query = Context.GetHttpContext().Request.Query;
            targets[ConnectionId] = new Target
            {
                Cluster = query["clusterId"].ToString(),
                Pod = query["podName"].ToString(),
                Namespace = query["Namespace"].ToString(),
                Container = query["container"].ToString(),
                Actor = Context.User?.Identity?.Name ?? "",
                Ip = Context.GetHttpContext()?.Connection.RemoteIpAddress?.ToString() ?? "",
            };
            perConnection[ConnectionId] = new List<Guid>();

            return base.OnConnectedAsync();
        }

        /// <summary>
        /// 起一路上传：让 agent 在容器里开 <c>cat &gt; 临时文件</c>，回一个会话 id。
        /// 后面浏览器按这个 id 逐片推 <see cref="Write"/>，收尾调 <see cref="FinishUpload"/>。
        /// </summary>
        public async Task<string> StartUpload(string path)
        {
            var target = RequireTarget();
            var absolute = RequireAbsolute(path);
            var session = new Upload
            {
                Id = Guid.NewGuid(),
                Target = target,
                Path = absolute,
                // 先写这个，全部字节确认到位后才 mv 到 absolute：半途断掉绝不能把容器里原有的文件截成半截
                TempPath = $"{absolute}.kubespoke-{Guid.NewGuid():N}",
                StartedAt = DateTime.UtcNow,
            };
            uploads[session.Id] = session;
            lock (perConnection[ConnectionId])
            {
                perConnection[ConnectionId].Add(session.Id);
            }

            logger.LogInformation($"[开始上传]：{target.Namespace}/{target.Pod} {target.Container} → {absolute} 会话 {session.Id}");
            Record(session, "StartPodUpload", true, "", "准备写入");

            ChannelReader<string> reader;
            try
            {
                reader = agentApis.StartPodUpload(new StartPodUploadRequest
                {
                    ClustName = target.Cluster,
                    SessionId = session.Id,
                    Name = target.Pod,
                    Namespace = target.Namespace,
                    Container = target.Container,
                    TempPath = session.TempPath,
                });
            }
            catch (Exception ex)
            {
                // 集群掉线、容器里没 sh、路径不合法都在这一步现形，别让用户等到写完才发现
                Drop(session, ex.Message);
                Remove(session);
                throw;
            }

            // agent 那路会话只在容器进程结束时流尽，中间每帧都是一句给人看的失败原因
            _ = Task.Run(async () =>
            {
                var error = "";
                try
                {
                    while (await reader.WaitToReadAsync())
                    {
                        while (reader.TryRead(out var frame))
                        {
                            error = string.IsNullOrEmpty(error) ? frame : error;
                        }
                    }
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }

                Finish(session, error);
            });

            return session.Id.ToString();
        }

        /// <summary>
        /// 推一片。等 SendAsync 是为了让「集群连接已经没了」当场报错回浏览器，
        /// 而不是让用户以为传完了——单向丢出去就没人知道这片的下落了。
        /// </summary>
        public async Task Write(string sessionId, string base64)
        {
            if (!Guid.TryParse(sessionId, out var id) || !uploads.TryGetValue(id, out var session))
            {
                throw new Exception("上传会话不存在，可能已经结束");
            }

            var connectionId = Global.FindAgentConnection(session.Target.Cluster);
            if (connectionId == null)
            {
                Drop(session, "目标集群不在线");
                throw new Exception($"目标集群不在线：{session.Target.Cluster}");
            }

            try
            {
                await Global.hubContext.Clients.Client(connectionId)
                    .SendAsync(ConstString.AGENT_EXEC_INPUT, id, base64);
                Interlocked.Add(ref session.Received, ByteLength(base64));
            }
            catch (Exception ex)
            {
                Drop(session, ex.Message);
                throw new Exception($"上传分片投递失败：{ex.Message}", ex);
            }
        }

        /// <summary>
        /// 收尾：给容器里的 cat 一个 EOF，等它退出，然后把临时文件挪到目标路径。
        /// 返回 null 代表文件真的落盘了，返回字符串就是失败原因——浏览器拿这个决定提示成功还是提示重试。
        /// </summary>
        public async Task<string?> FinishUpload(string sessionId)
        {
            var session = RequireSession(sessionId);
            var error = "";
            try
            {
                await PushToAgent(session, (proxy, id) => proxy.SendAsync(ConstString.AGENT_EXEC_CLOSE_STDIN, id));

                var finished = await Task.WhenAny(session.Done.Task, Task.Delay(FinishWait));
                error = finished == session.Done.Task ? await session.Done.Task : "容器没有在该等的时间内写完这个文件";

                if (error.Length == 0)
                {
                    // 落位单独下一道指令，不跟 cat 挤在一条脚本里：浏览器中途关掉时 cat 也是收到 EOF 后 0 退出，
                    // 那会儿字节只有一半，让 cat 自己 mv 就等于用半截文件盖掉原来的
                    error = await Commit(session);
                }
            }
            catch (Exception ex)
            {
                error = ex.Message;
            }
            finally
            {
                Finish(session, error);
                Remove(session);
            }

            var secs = (int)(DateTime.UtcNow - session.StartedAt).TotalSeconds;
            Record(session, "StopPodUpload", error.Length == 0, error, $"收尾用了 {secs} 秒");
            // 空串在 SignalR 的 JSON 里是 ""，前端要的是 null=成功这一个判据，别让它再去猜空串的含义
            return string.IsNullOrEmpty(error) ? null : error;
        }

        /// <summary>把写满的临时文件挪到目标路径；挪不动就把临时文件清掉再把原因抛回去。</summary>
        async Task<string> Commit(Upload session)
        {
            try
            {
                await Task.Run(() => agentApis.MovePodFile(new MovePodFileRequest
                {
                    ClustName = session.Target.Cluster,
                    Name = session.Target.Pod,
                    Namespace = session.Target.Namespace,
                    Container = session.Target.Container,
                    From = session.TempPath,
                    To = session.Path,
                    ExpectBytes = Interlocked.Read(ref session.Received),
                }));
                return "";
            }
            catch (Exception ex)
            {
                CleanupTemp(session, "落位失败");
                return ex.Message;
            }
        }

        /// <summary>用户中途取消：关掉这路 exec，并把已经写了一半的临时文件删掉。</summary>
        public async Task AbortUpload(string sessionId)
        {
            if (!Guid.TryParse(sessionId, out var id) || !uploads.TryGetValue(id, out var session))
            {
                return;
            }

            try
            {
                await PushToAgent(session, (proxy, connId) => proxy.SendAsync(ConstString.AGENT_EXEC_CLOSE, connId));
            }
            finally
            {
                Drop(session, "用户取消");
                Remove(session);
                CleanupTemp(session, "用户取消");
            }
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            if (perConnection.TryRemove(ConnectionId, out var mine))
            {
                List<Guid> ids;
                lock (mine)
                {
                    ids = new List<Guid>(mine);
                }

                // 浏览器没了，容器里的 cat 不能跟着悬着——它会一直等一个再也不会来的 stdin
                foreach (var id in ids)
                {
                    if (uploads.TryGetValue(id, out var session))
                    {
                        try
                        {
                            await PushToAgent(session, (proxy, connId) => proxy.SendAsync(ConstString.AGENT_EXEC_CLOSE, connId));
                        }
                        catch (Exception ex)
                        {
                            logger.LogDebug(ex, "[终端断开时通知 agent 失败]");
                        }

                        Drop(session, "浏览器断开", record: false);
                        Remove(session);
                        CleanupTemp(session, "浏览器断开");
                    }
                }
            }

            targets.TryRemove(ConnectionId, out _);
            await base.OnDisconnectedAsync(exception);
        }

        Target RequireTarget()
        {
            if (!targets.TryGetValue(ConnectionId, out var target))
            {
                throw new Exception("文件通道还没建立，请重新打开面板");
            }

            return target;
        }

        Upload RequireSession(string sessionId)
        {
            if (!Guid.TryParse(sessionId, out var id) || !uploads.TryGetValue(id, out var session))
            {
                throw new Exception("上传会话不存在，可能已经结束");
            }

            return session;
        }

        /// <summary>临时文件的最终名是这里拼的，所以路径必须以 / 开头，否则容器里会写出一个相对位置的文件。</summary>
        static string RequireAbsolute(string path)
        {
            var trimmed = (path ?? "").Trim();
            if (!trimmed.StartsWith('/'))
            {
                throw new Exception($"文件路径必须是容器内的绝对路径：{trimmed}");
            }

            var normalized = "/" + string.Join('/', trimmed.Split('/', StringSplitOptions.RemoveEmptyEntries));
            if (normalized.Length == 1)
            {
                throw new Exception("没有要写入的文件名");
            }

            return normalized;
        }

        /// <summary>base64 还原成字节数，不必解码：每 4 个字符 3 字节，去掉尾部补位即可。</summary>
        static int ByteLength(string base64)
        {
            if (string.IsNullOrEmpty(base64))
            {
                return 0;
            }

            var padding = base64.EndsWith("==", StringComparison.Ordinal) ? 2 : base64.EndsWith("=", StringComparison.Ordinal) ? 1 : 0;
            return base64.Length / 4 * 3 - padding;
        }

        /// <summary>
        /// 尽力删掉这路没写完的临时文件。删不掉只是多留一个垃圾文件，不值得让取消或断开卡在上面，
        /// 所以丢给后台，失败只记日志。
        /// </summary>
        void CleanupTemp(Upload session, string reason)
        {
            _ = Task.Run(() =>
            {
                try
                {
                    agentApis.RemovePodFiles(new RemovePodFilesRequest
                    {
                        ClustName = session.Target.Cluster,
                        Name = session.Target.Pod,
                        Namespace = session.Target.Namespace,
                        Container = session.Target.Container,
                        Paths = new List<string> { session.TempPath },
                    });
                    logger.LogInformation($"[未完成的上传已清理]：{reason} {session.Target.Namespace}/{session.Target.Pod} {session.TempPath}");
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, $"[临时文件清理失败] {session.Target.Namespace}/{session.Target.Pod} {session.TempPath}");
                }
            });
        }

        /// <summary>会话到此为止，把原因交给还在等的人；已经在收尾的无所谓，TrySetResult 自己会否掉重复。</summary>
        void Drop(Upload session, string reason, bool record = true)
        {
            Finish(session, reason);
            if (record)
            {
                Record(session, "StopPodUpload", false, reason, "上传中断");
            }
        }

        void Finish(Upload session, string reason)
        {
            session.Done.TrySetResult(reason ?? "");
        }

        void Remove(Upload session)
        {
            uploads.TryRemove(session.Id, out _);
            if (perConnection.TryGetValue(ConnectionId, out var mine))
            {
                lock (mine)
                {
                    mine.Remove(session.Id);
                }
            }
        }

        async Task PushToAgent(Upload session, Func<IClientProxy, Guid, Task> send)
        {
            var connectionId = Global.FindAgentConnection(session.Target.Cluster);
            if (connectionId == null)
            {
                throw new Exception($"目标集群不在线：{session.Target.Cluster}");
            }

            // 参数一律由调用方逐个写死：传 object[] 会被绑成「一个数组参数」，agent 端按 Guid 绑定直接失败
            await send(Global.hubContext.Clients.Client(connectionId), session.Id);
        }

        /// <summary>
        /// 上传的开与关各留一条痕。库写在单独的作用域里：会话活得比本次 Hub 调用长，
        /// 借它的 DbContext 会在下一次写入时撞上已释放的连接。
        /// </summary>
        void Record(Upload session, string action, bool success, string message, string detail)
        {
            var actor = session.Target.Actor;
            var ip = session.Target.Ip;
            var target = session.Target;
            var path = session.Path;
            _ = Task.Run(async () =>
            {
                try
                {
                    using var scope = scopeFactory.CreateScope();
                    await scope.ServiceProvider.GetRequiredService<AuditRepository>().RecordAsync(
                        actor, action, target.Cluster, target.Namespace, target.Pod,
                        $"{target.Container} {path} {detail}", ip, success, message);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "[上传审计落库失败]");
                }
            });
        }
    }
}
