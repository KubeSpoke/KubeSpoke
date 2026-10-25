using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KubeSpoke.Agent.Services.Tests
{
    /// <summary>
    /// helm 文本输出的两处形态：chart 名与版本挤在同一个串里，写操作的结果靠 KEY: value 行。
    /// 这两个规则一旦切错，界面上要么出现 "bitnami" 这种被砍掉后缀的 chart，要么修订号一直是 0。
    /// </summary>
    [TestClass]
    public class HelmTextTests
    {
        [TestMethod]
        public void SplitChart_CutsOnlyVersionLookingTails()
        {
            Assert.AreEqual(("nginx-ingress", "1.2.3"), HelmText.SplitChart("nginx-ingress-1.2.3", ""));
            Assert.AreEqual(("cert-manager", "v1.11.0"), HelmText.SplitChart("cert-manager-v1.11.0", ""), "带 v 前缀的版本要整段留下，去掉 v 就装不到那个版本了");

            // 名字本身带 - 的 chart 占了一大半，尾巴不是数字就不能切
            Assert.AreEqual(("bitnami-common", ""), HelmText.SplitChart("bitnami-common", ""));
            Assert.AreEqual(("kube-prometheus-stack", ""), HelmText.SplitChart("kube-prometheus-stack", ""));
            Assert.AreEqual(("redis", ""), HelmText.SplitChart("redis", ""));
            Assert.AreEqual(("", ""), HelmText.SplitChart("", ""));

            // 有的仓库就是会单独给一个版本字段，那种情况不该再去猜
            Assert.AreEqual(("prometheus", "25.8.0"), HelmText.SplitChart("prometheus", "25.8.0"));
        }

        [TestMethod]
        public void Value_ReadsOnlyLineHeads()
        {
            const string Out = """
            NAME: shop
            LAST DEPLOYED: 2026-10-25 09:00:00.123456789 +0800 CST m=+0.5
            NAMESPACE: shop
            STATUS: deployed
            REVISION: 4
            TEST SUITE: None
            NOTES:
            1. Get the application URL by running these commands:
              http://shop.local/ :80
            """;

            Assert.AreEqual("deployed", HelmText.Value(Out, "STATUS"));
            Assert.AreEqual("4", HelmText.Value(Out, "REVISION"));
            Assert.AreEqual("shop", HelmText.Value(Out, "NAME"));
            Assert.AreEqual("", HelmText.Value(Out, "CHART"), "没有这一行就是空，别拿别的行凑");
            Assert.AreEqual("", HelmText.Value("", "STATUS"));
        }

        [TestMethod]
        public void Value_SkipsIndentedNotesBody()
        {
            // NOTES 正文是缩进排版的，即使里面出现 "STATUS:" 字样也不能被当成字段
            const string Out = "NOTES:\n  STATUS: 这句是 chart 作者写的说明\nSTATUS: deployed\n";

            Assert.AreEqual("deployed", HelmText.Value(Out, "STATUS"));
        }
    }
}
