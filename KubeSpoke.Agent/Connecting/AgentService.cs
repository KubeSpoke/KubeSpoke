using KubeSpoke.Contracts;
using Microsoft.AspNetCore.SignalR.Client;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace KubeSpoke.Agent.Connecting
{
    internal class AgentService
    {
        SignalRConnection connection;

        public AgentService(SignalRConnection connection)
        {
            this.connection = connection;
        }

        //internal void Handle(HubConnection connection, CancellationToken cancellationToken)
        //{
        //    // 发消息
        //    try
        //    {
        //        connection.InvokeAsync("SendMessage", new AgentMsg()
        //        {
        //            Cmd = "test"
        //        }, cancellationToken: cancellationToken).Wait();
        //    }
        //    catch (Exception ex)
        //    {
        //        Console.WriteLine(ex.Message);
        //    }
        //}

        internal void Start(CancellationToken cancellationToken)
        {
            connection.OnRecive += Connection_OnRecive;
            connection.Start(cancellationToken);
        }

        private void Connection_OnRecive(object? sender, AgentMsg e)
        {

        }

        internal async Task StopAsync(CancellationToken cancellationToken)
        {
            await connection.StopAsync(cancellationToken);
        }
    }
}
