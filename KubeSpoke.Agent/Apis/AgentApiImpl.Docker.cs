using Docker.DotNet;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Docker.DotNet.Models;
using KubeSpoke.Contracts.Dtos.Docker;
using System.Text.RegularExpressions;
using KubeSpoke.Agent.Models;
using System.Threading.Channels;
using System.Threading;
using System.IO;

namespace KubeSpoke.Agent.Apis
{
    public partial class AgentApiImpl
    {
        public IList<ContainerListResponse> GetContainerList(GetContainerListRequest request)
        {
            using DockerClient client = new DockerClientConfiguration()
                   .CreateClient();

            return client.Containers.ListContainersAsync(
                    new ContainersListParameters()
                    {
                        Limit = 10,
                    }).Result;
        }

        public CreateContainerResponse CreateContainer(CreateContainerRequest request)
        {
            using DockerClient client = new DockerClientConfiguration()
                 .CreateClient();

            return client.Containers.CreateContainerAsync(request.Container).Result;
        }

        public bool RemoveContainer(RemoveContainerRequest request)
        {
            using DockerClient client = new DockerClientConfiguration()
                 .CreateClient();

            client.Containers.RemoveContainerAsync(request.Id, new ContainerRemoveParameters { }).Wait();
            return true;
        }

        public bool StopContainer(RemoveContainerRequest request)
        {
            using DockerClient client = new DockerClientConfiguration()
                 .CreateClient();

            client.Containers.StopContainerAsync(request.Id, new ContainerStopParameters { }).Wait();
            return true;
        }

        public ChannelReader<string> GetContainerLogs(GetContainerLogsRequest request)
        {
            var channel = Channel.CreateUnbounded<string>();

            Task.Run(async () =>
              {
                  using DockerClient client = new DockerClientConfiguration()
                   .CreateClient();

                  Exception localException = null;
                  var writer = channel.Writer;
                  try
                  {
                      var stream = await client.Containers.GetContainerLogsAsync(request.Id, false,
                          new ContainerLogsParameters
                          {
                              ShowStderr = true,
                              ShowStdout = true,
                          }).ConfigureAwait(false);

                      int offset = 0;
                      byte[] output = new byte[1024];

                      while (true)
                      {
                          var res = await stream.ReadOutputAsync(output, offset, output.Length, CancellationToken.None).ConfigureAwait(false);
                          var str = Encoding.UTF8.GetString(output, 0, res.Count);
                          await writer.WriteAsync(str);
                          if (res.EOF)
                          {
                              break;
                          }
                      }
                  }
                  catch (Exception ex)
                  {
                      localException = ex;
                  }
                  finally
                  {
                      writer.Complete(localException);
                  }
              });

            return channel.Reader;
        }
    }
}
