using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts
{
    public class ConstString
    {
        public const string HEADER_CLUSTER_ID = "cluster-id";
        public const string HEADER_CLUSTER_NAME = "cluster-name";
        public const string HEADER_CLUSTER_SECRET = "cluster-secret";
        public const string TEST_LUSTER_NAME = "6be0fdd6-7418-4a34-8c92-d9482ba9b8c8";

        public const string AGENT_RECIVE_METHOD = "ReceiveMessage";

        public const string AGENT_RECIVE_METHOD_RPC = "RPC";

        /// <summary>服务端→agent：往某次 exec 会话的 stdin 写一帧（base64），单向不回收执</summary>
        public const string AGENT_EXEC_INPUT = "ExecInput";

        /// <summary>服务端→agent：关掉某次 exec 会话，浏览器断开时必须发，否则容器里的 shell 会一直挂着</summary>
        public const string AGENT_EXEC_CLOSE = "ExecClose";

        /// <summary>服务端→agent：改终端宽高，转成 JSON 写进 exec 的 error 通道</summary>
        public const string AGENT_EXEC_RESIZE = "ExecResize";

        /// <summary>
        /// 服务端→agent：关掉某一路日志推流。浏览器断开日志面板时必须发，
        /// 否则 agent 的读循环会一直往一条没人读的通道里塞日志，服务端那侧占着的 invocation 槽位也永远还不回来。
        /// </summary>
        public const string AGENT_LOG_CLOSE = "LogClose";

        /// <summary>
        /// 服务端→agent：这条连接的 RPC 回执连续超时，判定它已经不可信，让 agent 主动断开重连。
        /// 走单向投递不等回执——要重建的正是这条回执通道，等它回话等于自锁。
        /// </summary>
        public const string AGENT_RECONNECT = "Reconnect";
    }
}
