using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Text;
using System.Threading.Channels;

namespace KubeSpoke.Server.Controllers
{
    /// <summary>
    /// 容器文件下载的出口。列目录、建目录、删除都归 /api/Cluster/{method} 那套反射分发，
    /// 唯独下载不行：它要把 agent 推回来的 base64 帧直接续成响应体，
    /// 过一层 JsonResult 等于把整个文件先读进内存、再乘上 base64 的 4/3 倍序列化出去。
    /// </summary>
    [Authorize]
    public class PodFileController : BaseController
    {
        IAgentApis agentApis;
        ILogger<PodFileController> logger;

        public PodFileController(ILogger<PodFileController> logger, IAgentApis agentApis)
        {
            this.logger = logger;
            this.agentApis = agentApis;
        }

        /// <summary>
        /// 把容器里的一个文件当附件发回浏览器。参数名沿用 /api/Cluster 那套 PascalCase，
        /// 前端拼的是普通 GET，所以这里也只能是 GET——浏览器新标签页打开的就是这根 URL。
        /// </summary>
        [HttpGet]
        public async Task Download(string ClustName, string Namespace, string Name, string Container, string Path)
        {
            if (string.IsNullOrWhiteSpace(ClustName))
            {
                throw new Exception("未选择集群");
            }

            var stream = agentApis.DownloadPodFile(new DownloadPodFileRequest
            {
                ClustName = ClustName,
                Name = Name,
                Namespace = Namespace,
                Container = Container,
                Path = Path,
            });

            // 先等第一帧，再动响应头：读不出来（没权限、路径是个目录、容器里没 cat）的时候
            // 一个字节都还没写出去，还能还一份像样的错误，而不是给用户落一个打不开的空文件
            string? first;
            try
            {
                first = await NextFrameAsync(stream);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, $"[下载失败] {Namespace}/{Name} {Path}");
                throw new Exception($"读取 {Path} 失败：{ex.Message}");
            }

            var fileName = System.IO.Path.GetFileName(Path.TrimEnd('/'));
            if (string.IsNullOrEmpty(fileName))
            {
                fileName = "download";
            }

            Response.ContentType = "application/octet-stream";
            // 中文名靠 filename* 那份，filename 只给不支持 RFC 5987 的老浏览器兜底
            Response.Headers.ContentDisposition =
                $"attachment; filename=\"{AsciiFallback(fileName)}\"; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";

            var received = 0L;
            for (var frame = first; frame != null; frame = await NextFrameAsync(stream))
            {
                // 每帧是一段完整 base64，切在哪个字节上都补得回来，所以整帧解一次就写
                byte[] decoded;
                try
                {
                    decoded = Convert.FromBase64String(frame);
                }
                catch (FormatException)
                {
                    throw new Exception($"下载分片格式不对，{Path} 只收到了 {received} 字节");
                }

                await Response.Body.WriteAsync(decoded, 0, decoded.Length, HttpContext.RequestAborted);
                received += decoded.Length;
            }
        }

        /// <summary>读下一帧；流尽了回 null，agent 那边报错则由 WaitToReadAsync 把异常抛上来。</summary>
        static async Task<string?> NextFrameAsync(ChannelReader<string> stream)
        {
            while (await stream.WaitToReadAsync())
            {
                if (stream.TryRead(out var frame))
                {
                    return frame;
                }
            }

            return null;
        }

        /// <summary>filename 那一份只准出现 ASCII，非 ASCII 和引号一律换成下划线。</summary>
        static string AsciiFallback(string name)
        {
            var sb = new StringBuilder(name.Length);
            foreach (var c in name)
            {
                sb.Append(c < 128 && c != '"' && c != '\\' && c != '/' && !char.IsControl(c) ? c : '_');
            }

            return sb.ToString();
        }
    }
}
