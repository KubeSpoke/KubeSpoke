using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Dtos
{
    /// <summary>
    /// 拉取集群里值得告警的信号
    /// </summary>
    public class GetAlertSignalsRequest : BaseRequest
    {
    }

    /// <summary>
    /// 一条归一化后的告警信号：代理端只回这种小扁平对象，不回原始 k8s 资源，
    /// 去重和落库都由服务端负责
    /// </summary>
    public class AlertSignal
    {
        /// <summary>
        /// 信号类型，固定取值：NodeNotReady / PodContainerWaiting / PodFailed /
        /// DeploymentUnderReplicas / WarningEvent
        /// </summary>
        public string Kind { get; set; } = "";

        /// <summary>
        /// 严重程度：critical | warning
        /// </summary>
        public string Severity { get; set; } = "";

        /// <summary>
        /// 命名空间，集群级对象留空
        /// </summary>
        public string Namespace { get; set; } = "";

        /// <summary>
        /// 出问题的对象名
        /// </summary>
        public string Resource { get; set; } = "";

        /// <summary>
        /// 短代码，用作去重指纹的一部分
        /// </summary>
        public string Reason { get; set; } = "";

        /// <summary>
        /// 给人看的一行
        /// </summary>
        public string Message { get; set; } = "";

        public int Count { get; set; } = 1;

        public DateTime? LastSeenUtc { get; set; }
    }
}
