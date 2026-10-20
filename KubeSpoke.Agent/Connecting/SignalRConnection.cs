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
        public event EventHandler<AgentMsg> OnRecive;

        public SignalRConnection(AgentServiceConfigProvider agentServiceConfigProvider, ILogger<SignalRConnection> logger, RPCRequestHandler requestHandler)
        {
            this.requestHandler = requestHandler;
            this.logger = logger;
            this.agentServiceConfigProvider = agentServiceConfigProvider;
        }

        internal void Start(CancellationToken cancellationToken)
        {
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

            connection.Closed += async (ex) =>
            {
                logger.LogError(ex, "[SignalR连接关闭] 5s后重试");
                ConnectWithRetryAsync(cancellationToken).Wait();
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

            // 开始连接
            ConnectWithRetryAsync(cancellationToken).Wait();

            logger.LogInformation("[SignalR启动成功]");
        }

        JsonSerializerOptions serializerOptions = new JsonSerializerOptions() { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

        private async Task onReceiveAsync(RPCRequest message)
        {
            try
            {
                using var _ = LogContext.PushProperty("RequestId", $"{Guid.NewGuid().ToString()}");

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
