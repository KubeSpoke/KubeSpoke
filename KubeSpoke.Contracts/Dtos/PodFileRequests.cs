using System;
using System.Collections.Generic;

namespace KubeSpoke.Contracts.Dtos
{
    /// <summary>
    /// 容器内文件浏览。Path 由浏览器给，agent 侧一律当不可信输入处理。
    /// </summary>
    public class ListPodFilesRequest : BaseNamespacedRequest
    {
        /// <summary>Pod 名</summary>
        public string Name { get; set; }

        public string Container { get; set; }

        /// <summary>要列的目录，绝对路径</summary>
        public string Path { get; set; }
    }

    public class PodFileEntry
    {
        public string Name { get; set; }

        /// <summary>dir / file / link / other，由 ls 的模式位首字符判定</summary>
        public string Type { get; set; }

        public long Size { get; set; }

        /// <summary>已归一到 UTC ISO8601；ls 只给到分钟且不带年份的用当前年补齐</summary>
        public DateTime Modified { get; set; }

        /// <summary>ls 的原样模式串，如 drwxr-xr-x</summary>
        public string Mode { get; set; }

        public string Owner { get; set; }

        public string Group { get; set; }

        /// <summary>符号链接指向的目标，非链接为空</summary>
        public string? Link { get; set; }
    }

    public class PodFileListResult
    {
        /// <summary>回显实际列出的目录，浏览器据此校正面包屑</summary>
        public string Path { get; set; }

        public List<PodFileEntry> Items { get; set; } = new List<PodFileEntry>();
    }

    /// <summary>
    /// 从容器下载一个文件。返回的是文件字节帧（每帧 base64），
    /// 服务端解一帧写一帧到 HTTP 响应，所以大小不设上限。
    /// </summary>
    public class DownloadPodFileRequest : BaseNamespacedRequest
    {
        public string Name { get; set; }

        public string Container { get; set; }

        public string Path { get; set; }
    }

    /// <summary>
    /// 开一个上传会话：容器侧起一条 cat 写到临时路径，字节由服务端推 ExecInput 灌进 stdin。
    /// 会话 id 由服务端生成，和终端一样靠它在 agent 连接上定位这根 exec 流。
    /// <para>
    /// 容器侧只做 cat，不做 mv：半途断开时 cat 会正常收到 EOF 并以 0 退出，
    /// 把 mv 也写进这条脚本的话，一个只写了一半的临时文件就被当成"成功"覆盖到目标路径上了。
    /// 落位交给服务端在确认写完之后单独调 <see cref="IAgentApis.MovePodFile"/>。
    /// </para>
    /// </summary>
    public class StartPodUploadRequest : BaseNamespacedRequest
    {
        public Guid SessionId { get; set; }

        public string Name { get; set; }

        public string Container { get; set; }

        /// <summary>容器里要写进的临时文件绝对路径，由服务端生成</summary>
        public string TempPath { get; set; }
    }

    /// <summary>上传收尾：把已写完的临时文件挪到目标路径，覆盖原有同名文件。</summary>
    public class MovePodFileRequest : BaseNamespacedRequest
    {
        public string Name { get; set; }

        public string Container { get; set; }

        /// <summary>临时文件</summary>
        public string From { get; set; }

        /// <summary>目标文件</summary>
        public string To { get; set; }

        /// <summary>服务端推给容器的字节数。容器里的 cat 半途断线时同样以 0 退出，只有按字节数复核才分得清"写完了"和"没写完"。</summary>
        public long ExpectBytes { get; set; }
    }

    public class MakePodDirectoryRequest : BaseNamespacedRequest
    {
        public string Name { get; set; }

        public string Container { get; set; }

        public string Path { get; set; }
    }

    public class RemovePodFilesRequest : BaseNamespacedRequest
    {
        public string Name { get; set; }

        public string Container { get; set; }

        public List<string> Paths { get; set; } = new List<string>();
    }
}
