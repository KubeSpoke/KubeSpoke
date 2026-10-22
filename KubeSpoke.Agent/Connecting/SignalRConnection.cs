using KubeSpoke.Agent.Models;
using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Contracts.Models;
using k8s.Autorest;
using k8s.KubeConfigModels;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Logging;
using Serilog.Context;
using Serilog.Core;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Reflection.Metadata;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace KubeSpoke.Agent.Connecting
{
    internal class SignalRConnection
    {
        HubConnection? connection;
        AgentServiceConfigProvider agentServiceConfigProvider;
        ILogger<SignalRConnection> logger;
        RPCRequestHandler requestHandler;

        /// <summary>0=没有重建在跑，1=有。Closed、服务端重连令、回执投递失败三个入口都会撞进来，只留一个循环</summary>
        int reconnecting;

        /// <summary>Start 传进来的停机令牌，重建循环要用它判断「该退了」</summary>
        CancellationToken stopToken;

        public event EventHandler<AgentMsg> OnRecive;

        public SignalRConnection(AgentServiceConfigProvider agentServiceConfigProvider, ILogger<SignalRConnection> logger, RPCRequestHandler requestHandler)
        {
            this.requestHandler = requestHandler;
            this.logger = logger;
            this.agentServiceConfigProvider = agentServiceConfigProvider;
        }

        internal void Start(CancellationToken cancellationToken)
        {
            stopToken = cancellationToken;

            var conf = agentServiceConfigProvider.GetConfig();
            if (conf == null)
                throw new ArgumentNullException(nameof(conf));

            connection = new HubConnectionBuilder()
              .WithUrl(conf.ServerAddr, options =>
              {
                  //options.HttpMessageHandlerFactory = h =>
                  //{
                  //    var handler = new SocketsHttpHandler()
                  //    {
                  //        ResponseHeaderEncodingSelector = delegate { return Encoding.UTF8; },
                  //        RequestHeaderEncodingSelector = delegate { return Encoding.UTF8; }
                  //    };
                  //    return handler;
                  //};

                  // 名字不是aiisc编码会报错
                  //options.Headers.Add(ConstString.HEADER_CLUSTER_NAME, conf.ClusterName);
                  options.Headers.Add(ConstString.HEADER_CLUSTER_ID, conf.ClusterUUID);
                  options.Headers.Add(ConstString.HEADER_CLUSTER_SECRET, conf.ClusterSecret);
              })
              //.WithAutomaticReconnect() // 自动重连4次，失败后触发 Closed
              .ConfigureLogging(logging =>
              {
                  logging.SetMinimumLevel(LogLevel.Information);
                  logging.AddConsole();
              })
              .Build();

            connection.Closed += (ex) =>
            {
                // 不在这个回调里同步等重连：Closed 是连接自己的收尾路径，
                // 拿 .Wait() 摁住它，后面排队的 Closed/停止事件全堵死，多层重连就是这么叠出来的。
                logger.LogError(ex, "[SignalR连接关闭] 5s后重试");
                _ = ReconnectAsync("连接关闭");
                return Task.CompletedTask;
            };

            connection.Reconnecting += error =>
            {
                // Notify users the connection was lost and the client is reconnecting.
                // Start queuing or dropping messages.
                logger.LogInformation("[Reconnecting]");
                return Task.CompletedTask;
            };

            // 连接
            connection.On<RPCRequest>(ConstString.AGENT_RECIVE_METHOD_RPC, (RPCRequest message) =>
            {
                onReceiveAsync(message).ContinueWith(res =>
                {
                    if (!res.IsCompletedSuccessfully)
                    {
                        logger.LogError(res.Exception, $"[RPC Handle Fail]");
                    }
                });
            });

            // 容器终端的输入/关闭：服务端不通过 RPC 请求-回执这条路走，因为按键要单向低延迟投递，
            // 容器里的 shell 退出后也容不下一次多余的等待。
            // handler 一律同步入队、由会话里的泵串行发出：SignalR 对同一根连接上先后到达的调用是并发派发的，
            // 在 handler 里 await 发送的话按键会在 WebSocket 上互相穿插，终端里就是一行乱码
            connection.On<Guid, string>(ConstString.AGENT_EXEC_INPUT, ExecInput);
            connection.On<Guid>(ConstString.AGENT_EXEC_CLOSE, ExecClose);
            connection.On<Guid, int, int>(ConstString.AGENT_EXEC_RESIZE, ExecResize);

            // 日志面板关掉后服务端会按会话 id 点名收流。不发这一句，agent 的读循环就只能自己猜什么时候该停。
            connection.On<Guid>(ConstString.AGENT_LOG_CLOSE, LogClose);

            // 服务端看门狗判定「我这边收到的请求都执行完了，回执却一条都没到」，于是让这根连接推倒重来。
            // 半死的 WebSocket（下行还在、上行发出去石沉大海）在 agent 侧是完全没有感知的：
            // keep-alive 照常、SendAsync 照样返回成功，只有服务端能看出回执不见了，所以只能由它下这道令。
            connection.On(ConstString.AGENT_RECONNECT, () =>
            {
                logger.LogWarning("[服务端要求重建连接] 该集群近期的 RPC 回执服务端一个都没收到");
                _ = ReconnectAsync("服务端重连令");
                return Task.CompletedTask;
            });


            // 开始连接
            ConnectWithRetryAsync(cancellationToken).Wait();

            logger.LogInformation("[SignalR启动成功]");
        }

        JsonSerializerOptions serializerOptions = new JsonSerializerOptions() { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

        /// <summary>键盘输入投进容器 stdin。写不进去（shell 已退）就顺手收掉这路会话，别让浏览器对着死面板打字。</summary>
        private void ExecInput(Guid sessionId, string base64)
        {
            if (!ExecSessions.Write(sessionId, base64))
            {
                logger.LogWarning($"[exec 输入落空] 会话 {sessionId} 已不存在");
                ExecSessions.Remove(sessionId);
            }
        }

        private void ExecClose(Guid sessionId)
        {
            logger.LogInformation($"[exec 关闭] {sessionId}");
            ExecSessions.Remove(sessionId);
        }

        /// <summary>关掉一路日志推流。会话早就自己收掉了也不亏，Remove 是幂等的。</summary>
        private void LogClose(Guid sessionId)
        {
            logger.LogInformation($"[日志推流关闭] {sessionId}");
            LogSessions.Remove(sessionId);
        }

        private void ExecResize(Guid sessionId, int cols, int rows)
        {
            if (!ExecSessions.Resize(sessionId, cols, rows))
            {
                logger.LogDebug($"[exec 改尺寸落空] 会话 {sessionId}");
            }
        }

        private async Task onReceiveAsync(RPCRequest message)
        {
            try
            {
                using var __scope = LogContext.PushProperty("RequestId", $"{Guid.NewGuid().ToString()}");

                logger.LogInformation($"[RPC Receive] {JsonSerializer.Serialize(message)}");
                var res = requestHandler.Handler(message, out bool isStram);

                if (res is ChannelReader<string>)
                {
                    await connection!.InvokeAsync("RpcCallStreamBack", message.RequestId, res);
                }
                else
                {
                    var json = JsonSerializer.Serialize(res, serializerOptions);
                    await connection!.SendAsync("RpcCallBack", new RPCResponse()
                    {
                        RequestId = message.RequestId,
                        ReturnData = json
                    }).ContinueWith(res =>
                    {
                        if (res.IsCompletedSuccessfully)
                        {
                            logger.LogInformation($"[RPC SendAsync] success");
                        }
                        else
                        {
                            logger.LogError(res.Exception, $"[RPC SendAsync] fail");
                            // 回执发不出去是上行通道断了的确证，不用等服务端攒够三次超时才反应过来
                            _ = ReconnectAsync("回执投递失败");
                        }
                    });
                }
            }
            catch (TargetInvocationException tex)
            {
                var k8sEx = tex.InnerException as HttpOperationException;
                if (k8sEx != null)
                {
                    logger.LogError(k8sEx.Response.Content, "调用K8s接口异常");

                    try
                    {
                        var res = JsonSerializer.Deserialize<Response>(k8sEx.Response.Content);
                        await connection!.SendAsync("RpcCallBack", new RPCResponse()
                        {
                            RequestId = message.RequestId,
                            Exception = $"[{res.reason}]{res.message}"
                        });
                    }
                    catch (Exception ex)
                    {
                        logger.LogError(ex, "异常");
                        await connection!.SendAsync("RpcCallBack", new RPCResponse()
                        {
                            RequestId = message.RequestId,
                            Exception = k8sEx.Response.Content
                        });
                    }
                }
                else
                {
                    throw tex.InnerException ?? tex;
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "调用K8s接口异常");
                await connection!.SendAsync("RpcCallBack", new RPCResponse()
                {
                    RequestId = message.RequestId,
                    Exception = ex.Message,
                });
            }
        }

        /// <summary>
        /// 唯一的重建入口，同一时刻只允许一个循环在跑。
        /// 三个来源会同时撞进来：连接自己报 Closed、服务端下了重连令、回执 SendAsync 直接失败。
        /// 叠两层循环的后果是两个人同时对着同一根连接 StartAsync，后者必抛异常再各睡 5s，日志里就是一串没头没尾的失败。
        /// </summary>
        async Task ReconnectAsync(string reason)
        {
            if (Interlocked.CompareExchange(ref reconnecting, 1, 0) != 0)
            {
                logger.LogDebug($"[重建已在进行] 忽略来自{reason}的重复请求");
                return;
            }

            try
            {
                // 服务端下这道令时连接还是 Connected 状态（下行明明通着），不先 Stop 就 StartAsync 只会抛
                if (connection!.State != HubConnectionState.Disconnected)
                {
                    logger.LogInformation($"[停掉旧连接] 来自{reason}");
                    try
                    {
                        await connection.StopAsync();
                    }
                    catch (Exception ex)
                    {
                        logger.LogDebug(ex, "[停旧连接失败，直接重试启动]");
                    }
                }

                await ConnectWithRetryAsync(stopToken);
            }
            finally
            {
                Volatile.Write(ref reconnecting, 0);
            }
        }

        public async Task<bool> ConnectWithRetryAsync(CancellationToken token)
        {
            if (connection == null)
            {
                throw new ArgumentNullException(nameof(connection));
            }

            // Keep trying to until we can start or the token is canceled.
            while (true)
            {
                try
                {
                    // 开始连接
                    logger.LogInformation("[开始连接]");
                    await connection.StartAsync(token);
                    Debug.Assert(connection.State == HubConnectionState.Connected);

                    logger.LogInformation("[连接成功]");
                    return true;
                }
                catch when (token.IsCancellationRequested)
                {
                    logger.LogError("[Connect Stop because CancellationRequested]");
                    return false;
                }
                catch (Exception ex)
                {
                    logger.LogInformation($"[连接失败] {ex.Message} trying again in 5000 ms");

                    Debug.Assert(connection.State == HubConnectionState.Disconnected);
                    await Task.Delay(5000);
                }
            }
        }

        internal async Task StopAsync(CancellationToken cancellationToken)
        {
            if (connection != null)
            {
                await connection.StopAsync();
                await connection.DisposeAsync();
            }
        }
    }
}
