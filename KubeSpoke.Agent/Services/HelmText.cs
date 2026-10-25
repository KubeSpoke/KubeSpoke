using System;
using System.Collections.Generic;

namespace KubeSpoke.Agent.Services
{
    /// <summary>
    /// helm 文本输出里的两处形态。这两段规则都是从 helm 的输出格式反推出来的，
    /// 单独放一个静态类里才能在没有集群、没有 helm 的机器上把它们验住。
    /// </summary>
    public static class HelmText
    {
        /// <summary>
        /// helm 的 list 与 history 把 chart 打成 "nginx-1.2.3" 这样一个串（名与版本之间没有分隔字段），
        /// 界面上要分开显示就只能从最后一个 - 处切。切出来的尾巴必须是数字或 v数字开头，
        /// 否则 "bitnami-common" 这种名字会被切坏。
        /// </summary>
        public static (string Chart, string Version) SplitChart(string chart, string explicitVersion)
        {
            if (!string.IsNullOrWhiteSpace(explicitVersion)) return (chart, explicitVersion);

            var idx = chart.LastIndexOf('-');
            if (idx <= 0 || idx >= chart.Length - 1) return (chart, "");

            var tail = chart[(idx + 1)..];
            if (char.IsDigit(tail[0]) || (tail[0] == 'v' && tail.Length > 1 && char.IsDigit(tail[1])))
            {
                return (chart[..idx], tail);
            }
            return (chart, "");
        }

        /// <summary>
        /// 从 helm 的 KEY: value 行里取值。只认行首，因为 NOTES 段正文里满是 "1. Get the URL: http://…"
        /// 这种带冒号的句子，按子串找会捞回一串操作说明。
        /// </summary>
        public static string Value(string text, string key)
        {
            if (string.IsNullOrEmpty(text)) return "";
            foreach (var line in text.Replace("\r\n", "\n").Split('\n'))
            {
                if (line.StartsWith(key + ":", StringComparison.OrdinalIgnoreCase))
                {
                    return line[(key.Length + 1)..].Trim();
                }
            }
            return "";
        }
    }
}
