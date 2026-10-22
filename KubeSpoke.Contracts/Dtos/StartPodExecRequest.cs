using System;
using System.Collections.Generic;

namespace KubeSpoke.Contracts.Dtos
{
    /// <summary>
    /// 打开一个容器终端会话。会话 id 由服务端生成——服务端要靠它在 agent 连接上
    /// 定位这根 exec 流，把键盘输入和关闭指令送回去。
    /// </summary>
    public class StartPodExecRequest : BaseNamespacedRequest
    {
        public Guid SessionId { get; set; }

        public string Name { get; set; }

        public string Container { get; set; }

        /// <summary>要起的程序，容器里没有 bash 就换 /bin/sh。</summary>
        public string Command { get; set; }

        /// <summary>终端初始宽高，交给 API Server 设定 PTY。</summary>
        public int Cols { get; set; } = 100;

        public int Rows { get; set; } = 30;
    }
}
