using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using KubeSpoke.Contracts.Models;
using YamlDotNet.Serialization;

namespace KubeSpoke.Agent.Services
{
    /// <summary>
    /// 解析 chart 仓库的 index.yaml。
    /// <para>
    /// 之所以在代理端解析而不是让 helm 自己列：helm 的目录能力全长在 <c>helm repo add</c> 的本地状态上，
    /// 而 agent 容器是随时可能被重建的一次性环境，往里塞仓库状态既留不住也要额外权限。
    /// index.yaml 就是仓库的一个普通 HTTP 文件，直接拉直接解析，内网镜像仓库同样适用。
    /// </para>
    /// <para>
    /// 解析走 YamlDotNet 的 untyped 通道（<c>Deserialize(..., typeof(object))</c>），拿到的是
    /// 字典/列表/字符串三层嵌套。这里不做强类型映射有两个原因：index.yaml 的字段各家仓库给得不全，
    /// 而且所有标量都会以字符串回来（<c>deprecated: true</c> 是字符串 "true"），
    /// 逐字段容错比让反序列化器在第一处缺字段时抛异常更划算——一个大仓库里只要有一条脏数据，
    /// 强类型方案就是整个市场打不开。
    /// </para>
    /// </summary>
    public static class ChartIndex
    {
        /// <summary>单个 chart 的说明截断长度：市场卡片只要一句话，bitnami 的 README 级描述有上千字。</summary>
        const int MaxDescriptionChars = 400;

        /// <summary>
        /// 把 index.yaml 摊成市场卡片。
        /// <para>
        /// repo 是回显给前端的仓库地址，安装时要原样带回给 helm --repo；query 是名称/关键字/描述的子串过滤，空则不过滤；
        /// maxCharts 与 maxVersions 是带回条数的上限（按名称排序后截取，保证同一仓库每次刷新顺序一致），
        /// 上限是必须的：bitnami 一份索引两千多个 chart、三万多个版本，全带回去这一路 RPC 就出不去了。
        /// </para>
        /// </summary>
        public static List<HelmChart> Parse(string indexYaml, string? repo, string? query, int maxCharts, int maxVersions)
        {
            var root = Deserialize(indexYaml);
            var entries = AsDict(Get(root, "entries"));
            if (entries == null) return new List<HelmChart>();

            var needle = (query ?? "").Trim();
            var charts = new List<HelmChart>();

            foreach (DictionaryEntry group in entries)
            {
                // entries 的键是 chart 名；值是一个版本列表，helm 写索引时已按版本从新到旧排好
                var chartName = group.Key as string ?? group.Value?.ToString() ?? "";
                var versions = AsList(group.Value);
                if (versions == null || versions.Count == 0) continue;

                var chart = new HelmChart { Repo = repo ?? "", Name = chartName };
                foreach (var item in versions)
                {
                    var v = AsDict(item);
                    if (v == null) continue;

                    chart.Versions.Add(new HelmChartVersion
                    {
                        Version = Str(v, "version"),
                        AppVersion = Str(v, "appVersion"),
                        Deprecated = IsTrue(Str(v, "deprecated")),
                        Created = Str(v, "created"),
                    });
                }

                if (chart.Versions.Count == 0) continue;

                // 卡片本身展示最新版本；索引万一不是新在前（有些仓库自己生成），列表顺序照搬即可，
                // 用户在安装表单里还能从 Versions 里选
                var head = AsDict(versions[0]);
                chart.Version = Str(head, "version");
                chart.AppVersion = Str(head, "appVersion");
                chart.Description = Cut(Str(head, "description"), MaxDescriptionChars);
                chart.Icon = Str(head, "icon");
                chart.Home = FirstUrl(head, "home");
                chart.KubeVersion = Str(head, "kubeVersion");
                chart.Type = Str(head, "type");
                // 一个 chart 只要有一个版本被标了 deprecated 就算废弃版本，卡片上要打标
                chart.Deprecated = IsTrue(Str(head, "deprecated")) || chart.Versions.Any(v => v.Deprecated);
                chart.Keywords = AsList(Get(head, "keywords"))?.OfType<object>()
                    .Select(k => k?.ToString() ?? "").Where(s => s.Length > 0).ToList() ?? new List<string>();

                if (needle.Length > 0 && !Matches(chart, needle)) continue;

                if (chart.Versions.Count > maxVersions)
                {
                    chart.Versions = chart.Versions.Take(Math.Max(maxVersions, 1)).ToList();
                }

                charts.Add(chart);
            }

            return charts.OrderBy(c => c.Name, StringComparer.OrdinalIgnoreCase).Take(Math.Max(maxCharts, 1)).ToList();
        }

        static bool Matches(HelmChart chart, string needle)
        {
            return chart.Name.Contains(needle, StringComparison.OrdinalIgnoreCase)
                || chart.Description.Contains(needle, StringComparison.OrdinalIgnoreCase)
                || chart.Keywords.Any(k => k.Contains(needle, StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>
        /// index.yaml 摊成字典。空文档或不是映射的内容（比如仓库挂了一个 HTML 错误页）在这里就失败，
        /// 不等到下面逐字段取时才拿一堆 null。
        /// </summary>
        static IDictionary Deserialize(string indexYaml)
        {
            if (string.IsNullOrWhiteSpace(indexYaml))
            {
                throw new InvalidOperationException("仓库索引是空的（index.yaml 没有内容）");
            }

            object? raw;
            try
            {
                // 不带类型的反序列化：标量一律回来成字符串，字段缺失只是取不到，不会抛
                raw = new DeserializerBuilder().Build().Deserialize(new StringReader(indexYaml), typeof(object));
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"仓库索引解析失败：{ex.Message.Split('\n')[0]}");
            }

            var map = AsDict(raw);
            if (map == null)
            {
                throw new InvalidOperationException("仓库索引不是 YAML 映射，多半是地址写错了或者被网关挡了回来一个错误页");
            }

            return map;
        }

        static object? Get(IDictionary? map, string key)
        {
            if (map == null) return null;
            foreach (DictionaryEntry e in map)
            {
                if (string.Equals(e.Key as string, key, StringComparison.OrdinalIgnoreCase)) return e.Value;
            }
            return null;
        }

        static IDictionary? AsDict(object? value) => value as IDictionary;

        static IList? AsList(object? value) => value as IList;

        static string Str(IDictionary? map, string key)
        {
            var v = Get(map, key);
            // 列表/映射型字段被当字符串取时不给异常，空串比炸掉整个市场好
            if (v is IDictionary || v is IList) return "";
            return v?.ToString() ?? "";
        }

        /// <summary>helm 索引里布尔是以字符串带回来的，只认 true/1/yes 三个写法，其余一律当 false。</summary>
        static bool IsTrue(string text) =>
            text.Equals("true", StringComparison.OrdinalIgnoreCase)
            || text.Equals("1", StringComparison.OrdinalIgnoreCase)
            || text.Equals("yes", StringComparison.OrdinalIgnoreCase);

        static string FirstUrl(IDictionary? map, string key)
        {
            var direct = Str(map, key);
            if (direct.Length > 0) return direct;
            // 有些仓库把主页写在 sources 列表的第一项
            var sources = AsList(Get(map, "sources"));
            return sources?.Count > 0 ? sources[0]?.ToString() ?? "" : "";
        }

        static string Cut(string text, int max) =>
            string.IsNullOrEmpty(text) || text.Length <= max ? (text ?? "") : text[..max] + "…";
    }
}
