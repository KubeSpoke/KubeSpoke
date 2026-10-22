using KubeSpoke.Contracts.Dtos;
using k8s;
using k8s.Models;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.Linq;

namespace KubeSpoke.Agent.Apis
{
    public partial class AgentApiImpl
    {
        /// <summary>一次 RPC 最多回多少条，免得一个大集群把 JSON 通道塞满</summary>
        const int AlertSignalLimit = 200;

        /// <summary>
        /// 容器 Waiting 里只有这几种原因值得叫醒人，PodInitializing 之类的正常流程不算问题
        /// </summary>
        static readonly HashSet<string> FatalWaitingReasons = new(StringComparer.Ordinal)
        {
            "CrashLoopBackOff",
            "ImagePullBackOff",
            "ErrImagePull",
            "CreateContainerConfigError",
            "InvalidImageName",
            "RunContainerError",
            "StartError",
        };

        /// <summary>ContainerCreating 太常见，只有 Pending 超过这么久才算卡住</summary>
        static readonly TimeSpan ContainerCreatingGrace = TimeSpan.FromMinutes(10);

        /// <summary>控制器日常刷的 Warning 事件，全是噪音，服务端那边也拿不到有用的指纹</summary>
        static readonly HashSet<string> NoisyWarningEventReasons = new(StringComparer.Ordinal)
        {
            "ToDelete",
            "LeaderElection",
            "SuccessfulCreate",
            "SuccessfulDelete",
            "Scheduled",
            "Pulled",
            "Created",
            "Started",
        };

        /// <summary>
        /// 探测集群里值得告警的异常。每个探测自己 try/catch：某类 API 问不通只丢那一类信号，
        /// 不能把整次 RPC 带崩，服务端要的是一份尽量全的清单
        /// </summary>
        public List<AlertSignal> GetAlertSignals(GetAlertSignalsRequest request)
        {
            var now = DateTime.UtcNow;
            var signals = new List<AlertSignal>();

            void Probe(string name, Func<List<AlertSignal>> collect)
            {
                try
                {
                    var part = collect();
                    if (part != null && part.Count > 0)
                    {
                        signals.AddRange(part);
                    }
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, $"[告警探测失败] {name}");
                }
            }

            Probe("节点未就绪", () => CollectNodeAlerts(now));

            // 容器的两类探测共用一次全命名空间 Pod 列表：这一发最贵，问两遍不值当。
            // 列表本身问不到，下面两个探测就都只留日志，不影响节点/部署/事件那三路
            List<V1Pod>? pods = null;
            try
            {
                pods = client.CoreV1.ListPodForAllNamespaces().Items.ToList();
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "[告警探测失败] 列出 Pod");
            }

            if (pods != null)
            {
                var podList = pods;
                Probe("容器起不来", () => CollectWaitingContainerAlerts(podList, now));
                Probe("Pod 失败", () => CollectFailedPodAlerts(podList, now));
            }

            Probe("副本不足", () => CollectDeploymentAlerts(now));
            Probe("Warning 事件", () => CollectWarningEventAlerts(now));

            // 现查出来的状态就是「本轮才见到」，时间戳统一打 now；事件用事件自己的时间，
            // 这样排序时当下还坏着的排在前面，被 200 条截断掉的是那些早就没动静的事件
            return signals
                .OrderByDescending(x => x.LastSeenUtc ?? DateTime.MinValue)
                .Take(AlertSignalLimit)
                .ToList();
        }

        /// <summary>Ready 条件不是 True 的节点（含压根没上报 Ready 条件的）</summary>
        List<AlertSignal> CollectNodeAlerts(DateTime now)
        {
            var list = new List<AlertSignal>();
            var nodes = client.CoreV1.ListNode();

            foreach (var node in nodes.Items)
            {
                var name = node.Metadata?.Name ?? "";
                var ready = node.Status?.Conditions?
                    .FirstOrDefault(c => string.Equals(c.Type, "Ready", StringComparison.OrdinalIgnoreCase));

                var status = string.IsNullOrEmpty(ready?.Status) ? "Unknown" : ready!.Status;
                if (string.Equals(status, "True", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                list.Add(new AlertSignal
                {
                    Kind = "NodeNotReady",
                    Severity = "critical",
                    Namespace = "",
                    Resource = name,
                    Reason = status,
                    Message = FirstAlertText(ready?.Message, ready?.Reason, $"节点 {name} Ready={status}"),
                    Count = 1,
                    LastSeenUtc = now,
                });
            }

            return list;
        }

        /// <summary>
        /// 卡在致命 Waiting 原因的容器。Count 用重启次数，ContainerCreating 只在 Pending
        /// 超过十分钟时才报，否则每个滚动发布的 Pod 都会叫一次
        /// </summary>
        List<AlertSignal> CollectWaitingContainerAlerts(List<V1Pod> pods, DateTime now)
        {
            var list = new List<AlertSignal>();

            foreach (var pod in pods)
            {
                var statuses = pod.Status?.ContainerStatuses;
                if (statuses == null || statuses.Count == 0)
                {
                    continue;
                }

                var created = AlertUtc(pod.Metadata?.CreationTimestamp);
                var pendingTooLong = created != null
                    && string.Equals(pod.Status?.Phase, "Pending", StringComparison.OrdinalIgnoreCase)
                    && now - created.Value > ContainerCreatingGrace;

                foreach (var cs in statuses)
                {
                    var waiting = cs.State?.Waiting;
                    var reason = waiting?.Reason;
                    if (string.IsNullOrEmpty(reason))
                    {
                        continue;
                    }

                    if (!FatalWaitingReasons.Contains(reason)
                        && !(string.Equals(reason, "ContainerCreating", StringComparison.Ordinal) && pendingTooLong))
                    {
                        continue;
                    }

                    list.Add(new AlertSignal
                    {
                        Kind = "PodContainerWaiting",
                        Severity = "critical",
                        Namespace = pod.Metadata?.NamespaceProperty ?? "",
                        Resource = pod.Metadata?.Name ?? "",
                        Reason = reason,
                        Message = FirstAlertText(waiting!.Message, reason),
                        Count = cs.RestartCount,
                        LastSeenUtc = now,
                    });
                }
            }

            return list;
        }

        List<AlertSignal> CollectFailedPodAlerts(List<V1Pod> pods, DateTime now)
        {
            var list = new List<AlertSignal>();

            foreach (var pod in pods)
            {
                if (!string.Equals(pod.Status?.Phase, "Failed", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var name = pod.Metadata?.Name ?? "";
                list.Add(new AlertSignal
                {
                    Kind = "PodFailed",
                    Severity = "warning",
                    Namespace = pod.Metadata?.NamespaceProperty ?? "",
                    Resource = name,
                    Reason = pod.Status?.Reason ?? "",
                    Message = FirstAlertText(pod.Status?.Message, $"Pod {name} 已失败"),
                    Count = 1,
                    LastSeenUtc = now,
                });
            }

            return list;
        }

        List<AlertSignal> CollectDeploymentAlerts(DateTime now)
        {
            var list = new List<AlertSignal>();
            var deployments = client.AppsV1.ListDeploymentForAllNamespaces();

            foreach (var deployment in deployments.Items)
            {
                var desired = deployment.Spec?.Replicas ?? 1;
                var ready = deployment.Status?.ReadyReplicas ?? 0;
                if (ready >= desired)
                {
                    continue;
                }

                list.Add(new AlertSignal
                {
                    Kind = "DeploymentUnderReplicas",
                    Severity = "warning",
                    Namespace = deployment.Metadata?.NamespaceProperty ?? "",
                    Resource = deployment.Metadata?.Name ?? "",
                    Reason = "ReplicasNotReady",
                    Message = $"{ready}/{desired} 就绪",
                    Count = desired - ready,
                    LastSeenUtc = now,
                });
            }

            return list;
        }

        /// <summary>
        /// Warning 事件按「命名空间 + 对象 + 原因」收敛成一条，不然同一个镜像拉不下来
        /// 一分钟能刷出几十条一模一样的
        /// </summary>
        List<AlertSignal> CollectWarningEventAlerts(DateTime now)
        {
            var list = new List<AlertSignal>();
            var events = client.CoreV1.ListEventForAllNamespaces(fieldSelector: "type=Warning");

            var groups = events.Items
                .Where(e => !string.IsNullOrEmpty(e?.Reason)
                    && !string.IsNullOrEmpty(e.InvolvedObject?.Name)
                    && !NoisyWarningEventReasons.Contains(e.Reason))
                .GroupBy(e => new
                {
                    Namespace = e.InvolvedObject?.NamespaceProperty ?? e.Metadata?.NamespaceProperty ?? "",
                    Resource = e.InvolvedObject?.Name ?? "",
                    Reason = e.Reason,
                });

            foreach (var group in groups)
            {
                var newest = group.OrderByDescending(e => AlertEventTime(e) ?? DateTime.MinValue).First();
                var message = newest.Message;

                list.Add(new AlertSignal
                {
                    Kind = "WarningEvent",
                    Severity = "warning",
                    Namespace = group.Key.Namespace,
                    Resource = group.Key.Resource,
                    Reason = group.Key.Reason ?? "",
                    Message = FirstAlertText(message, group.Key.Reason),
                    Count = group.Count(),
                    // 事件可能三个时间戳都没填，那就按本轮探测时间算，别拿一个假时间去排序
                    LastSeenUtc = AlertEventTime(newest) ?? now,
                });
            }

            return list;
        }

        static string FirstAlertText(params string?[] values)
        {
            foreach (var value in values)
            {
                if (!string.IsNullOrWhiteSpace(value))
                {
                    return value;
                }
            }

            return "";
        }

        /// <summary>
        /// 集群里的时间戳种类太杂：KubernetesClient 有时给 Utc、有时给 Local、偶尔给 Unspecified，
        /// 未填的字段还会是 default。统一转成 UTC，转不出来的当没发生
        /// </summary>
        static DateTime? AlertUtc(DateTime? value)
        {
            if (value is not { } time || time == default)
            {
                return null;
            }

            return time.Kind switch
            {
                DateTimeKind.Utc => time,
                DateTimeKind.Local => time.ToUniversalTime(),
                _ => DateTime.SpecifyKind(time, DateTimeKind.Utc),
            };
        }

        /// <summary>新版事件只有 EventTime，老版只有 First/LastTimestamp，挨个兜一遍</summary>
        static DateTime? AlertEventTime(Corev1Event ev) =>
            AlertUtc(ev?.LastTimestamp) ?? AlertUtc(ev?.EventTime) ?? AlertUtc(ev?.FirstTimestamp);
    }
}
