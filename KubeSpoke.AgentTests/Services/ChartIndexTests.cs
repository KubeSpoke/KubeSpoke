using KubeSpoke.Agent.Services;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KubeSpoke.Agent.Services.Tests
{
    /// <summary>
    /// chart 仓库索引的解析。这里盯的是「一个脏字段会不会让整个市场打不开」：
    /// index.yaml 是各家仓库自己生成的，字段有无、写法是否加引号、时间精度都不可控，
    /// 而市场页是一路 HTTP 拉一份大文件就完事，没有第二次机会兜底。
    /// 所以断言都按真实仓库的样子来，而不是按最容易写的样子。
    /// </summary>
    [TestClass]
    public class ChartIndexTests
    {
        /// <summary>照 kubernetes.github.io/ingress-nginx/index.yaml 的真实形状缩编：没有 apiVersion 与 generated，
        /// description 是折行续写的，created 带纳秒，annotations 是嵌套映射。</summary>
        const string RealLike = """
        apiVersion: v1
        entries:
          ingress-nginx:
          - annotations:
              artifacthub.io/changes: |
                - Update controller-v1.15.1
            apiVersion: v2
            appVersion: 1.15.1
            created: "2026-03-19T21:16:17.141043059Z"
            description: Ingress controller for Kubernetes using NGINX as a reverse proxy
              and load balancer
            digest: 3eff0bd18151d6e6b1c441463410571443dda1ac78292cb189346628de784f0c
            home: https://github.com/kubernetes/ingress-nginx
            icon: https://upload.wikimedia.org/wikipedia/commons/c/c5/Nginx_logo.svg
            keywords:
            - ingress
            - nginx
            kubeVersion: '>=1.25.0-0'
            name: ingress-nginx
            type: application
            urls:
            - https://github.com/kubernetes/ingress-nginx/charts/ingress-nginx-1.15.1.tgz
            version: 1.15.1
          - name: ingress-nginx
            version: 1.15.0
            appVersion: 1.15.0
            created: "2026-01-02T03:04:05Z"
          "cert-manager":
          - name: cert-manager
            version: 1.0.3
            appVersion: v1.0.3
            deprecated: true
            description: cloud native certificate management
        """;

        [TestMethod]
        public void Parse_ReadsLatestVersionAndFlatFields()
        {
            var charts = ChartIndex.Parse(RealLike, "https://kubernetes.github.io/ingress-nginx", null, 300, 30);

            Assert.AreEqual(2, charts.Count);
            var nginx = charts.Single(c => c.Name == "ingress-nginx");
            Assert.AreEqual("1.15.1", nginx.Version, "卡片要显示最新一版，也就是 entries 列表的第一条");
            Assert.AreEqual("1.15.1", nginx.AppVersion);
            Assert.AreEqual("https://github.com/kubernetes/ingress-nginx", nginx.Home);
            Assert.AreEqual(">=1.25.0-0", nginx.KubeVersion, "kubeVersion 约束要在装之前就让人看见");
            Assert.AreEqual("application", nginx.Type);
            Assert.AreEqual(2, nginx.Versions.Count);
            Assert.IsFalse(nginx.Deprecated);
            CollectionAssert.AreEqual(new List<string> { "ingress", "nginx" }, nginx.Keywords);
        }

        [TestMethod]
        public void Parse_JoinsFoldedDescription()
        {
            var charts = ChartIndex.Parse(RealLike, "r", null, 300, 30);
            var nginx = charts.Single(c => c.Name == "ingress-nginx");

            // YAML 的折行续写必须在解析阶段合上，否则界面卡片上会出现一个突然断掉的半句
            StringAssert.Contains(nginx.Description, "reverse proxy and load balancer");
        }

        [TestMethod]
        public void Parse_QuotedChartKeyAndDeprecatedFlag()
        {
            var charts = ChartIndex.Parse(RealLike, "r", null, 300, 30);
            var cert = charts.Single(c => c.Name == "cert-manager");

            Assert.AreEqual("cert-manager", cert.Name, "键写成 \"cert-manager\" 也要认");
            Assert.IsTrue(cert.Deprecated, "deprecated 是以字符串带回来的，只认字面值会漏标");
        }

        [TestMethod]
        public void Parse_KeepsChartWithDirtyEntriesInsteadOfThrowing()
        {
            // 一个大仓库里只要有一条脏数据，任何「先映射成强类型再筛」的写法都会让整页打不开
            const string Dirty = """
            entries:
              good:
              - name: good
                version: 1.0.0
              broken-fields:
              - name: broken-fields
                keywords: not-a-list
                maintainers: "someone"
              empty-list: []
              null-ish:
            """;

            var charts = ChartIndex.Parse(Dirty, "r", null, 300, 30);

            Assert.AreEqual(2, charts.Count, "空列表与 null 条目要跳过，但缺字段的 chart 本身还能装");
            var broken = charts.Single(c => c.Name == "broken-fields");
            Assert.AreEqual("", broken.Version, "没写版本的条目照收，交给界面显示空值——直接丢掉会让操作人以为仓库里没这个 chart");
            Assert.AreEqual(0, broken.Keywords.Count, "keywords 写成标量时不该炸，也不该把它当成一个关键字");
        }

        [TestMethod]
        public void Parse_FiltersByQueryAndCapsCounts()
        {
            var all = ChartIndex.Parse(RealLike, "r", null, 300, 30);
            Assert.AreEqual("cert-manager", all[0].Name, "按名称排序，同一仓库每次刷新顺序才稳定");

            var only = ChartIndex.Parse(RealLike, "r", "nginx", 300, 30);
            Assert.AreEqual(1, only.Count);

            // 关键字命中也要算：市场搜索常用的是 "ingress" 这种词而不是完整 chart 名
            var byKeyword = ChartIndex.Parse(RealLike, "r", "certificate", 300, 30);
            Assert.AreEqual(1, byKeyword.Count);

            var capped = ChartIndex.Parse(RealLike, "r", null, 1, 1);
            Assert.AreEqual(1, capped.Count);
            Assert.AreEqual(1, capped[0].Versions.Count, "版本条数上限兜的是回传载荷，bitnami 一个 chart 有几百个版本");
        }

        [TestMethod]
        public void Parse_CutsLongDescription()
        {
            var longDesc = new string('描', 900);
            var yaml = $"entries:\n  big:\n  - name: big\n    version: 1.0.0\n    description: {longDesc}\n";

            var chart = ChartIndex.Parse(yaml, "r", null, 300, 30).Single();

            Assert.IsTrue(chart.Description.Length <= 401, $"说明要截断（{chart.Description.Length}）");
        }

        [TestMethod]
        public void Parse_ReportsNonYamlAsAddressProblem()
        {
            // 仓库地址填错、或者被网关挡回来一个 HTML 错误页时，报的必须是一句能照着改的话
            foreach (var body in new[] { "<html><body>404</body></html>", "just a string", "" })
            {
                try
                {
                    ChartIndex.Parse(body, "r", null, 300, 30);
                    Assert.Fail($"不该解析成功：{body}");
                }
                catch (InvalidOperationException ex)
                {
                    StringAssert.Contains(ex.Message, "索引");
                }
            }
        }
    }
}
