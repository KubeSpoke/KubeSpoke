using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KubeSpoke.Agent.Services.Tests
{
    /// <summary>
    /// helm 子进程的集群身份。盯的是令牌与证书这两份挂载文件到底有没有被每次重读：
    /// 投影令牌会过期，apiserver 定期原地替换这几个文件，而 helm 只认 kubeconfig 不认 SDK 的配置，
    /// 所以代理端必须每跑一次就现合成一份——缓存下来的那份过一会儿就是一条 401。
    /// </summary>
    [TestClass]
    public class HelmCliTests
    {
        public TestContext TestContext { get; set; } = null!;

        string saDir = null!;

        [TestInitialize]
        public void Setup()
        {
            saDir = Path.Combine(Path.GetTempPath(), "ks-helm-sa-" + Guid.NewGuid().ToString("N")[..8]);
            Directory.CreateDirectory(saDir);
        }

        [TestCleanup]
        public void Cleanup()
        {
            try { Directory.Delete(saDir, true); } catch (Exception ex) { TestContext.WriteLine($"临时目录没删掉：{ex.Message}"); }
        }

        HelmCli NewCli() => new HelmCli(NullLogger<HelmCli>.Instance) { SaDirPath = saDir };

        void WriteSa(string token, byte[]? ca)
        {
            File.WriteAllText(Path.Combine(saDir, "token"), token);
            if (ca != null) File.WriteAllBytes(Path.Combine(saDir, "ca.crt"), ca);
            else if (File.Exists(Path.Combine(saDir, "ca.crt"))) File.Delete(Path.Combine(saDir, "ca.crt"));
        }

        [TestMethod]
        public void BuildKubeconfig_WritesServerTokenAndAuthority()
        {
            Environment.SetEnvironmentVariable("KUBERNETES_SERVICE_HOST", "10.96.0.1");
            Environment.SetEnvironmentVariable("KUBERNETES_SERVICE_PORT", "6443");
            WriteSa("eyJhbGciOi.test.jwt", new byte[] { 1, 2, 3, 4 });

            var path = NewCli().BuildKubeconfig();

            Assert.IsNotNull(path, "有挂载令牌时应该合成出文件，让 helm 用 agent 自己的服务账户身份");
            var text = File.ReadAllText(path);
            StringAssert.Contains(text, "server: https://10.96.0.1:6443");
            StringAssert.Contains(text, "token: eyJhbGciOi.test.jwt");
            StringAssert.Contains(text, "certificate-authority-data: " + Convert.ToBase64String(new byte[] { 1, 2, 3, 4 }));
            StringAssert.Contains(text, "current-context: kubespoke");
        }

        [TestMethod]
        public void BuildKubeconfig_ReReadsTheTokenFileEachCall()
        {
            var cli = NewCli();
            WriteSa("first", null);
            var first = File.ReadAllText(cli.BuildKubeconfig()!);

            // apiserver 换令牌就是原地改写这个文件，agent 进程不会重启
            WriteSa("second", null);
            var second = File.ReadAllText(cli.BuildKubeconfig()!);

            StringAssert.Contains(first, "token: first");
            StringAssert.Contains(second, "token: second");
        }

        [TestMethod]
        public void BuildKubeconfig_FallsBackToAmbientConfigWhenNotInCluster()
        {
            WriteSa("", null);

            Assert.IsNull(NewCli().BuildKubeconfig(), "本机跑 agent 时没有挂载令牌，就该让 helm 自己去找 ~/.kube/config");
        }

        [TestMethod]
        public void RemoveKubeconfig_DeletesTheFileHoldingTheToken()
        {
            WriteSa("token-value", new byte[] { 9 });
            var cli = NewCli();
            var path = cli.BuildKubeconfig()!;
            Assert.IsTrue(File.Exists(path));

            cli.RemoveKubeconfig(path);

            Assert.IsFalse(File.Exists(path), "这份文件里是服务账户令牌，用完必须删");
            cli.RemoveKubeconfig(path);
            cli.RemoveKubeconfig(null);
        }

        [TestMethod]
        public void Tail_KeepsTheLastLinesWhereTheReasonLives()
        {
            var text = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nError: rendered manifest error\n";

            var tail = HelmCli.Tail(text, 3);

            Assert.AreEqual("line12\nline13\nError: rendered manifest error", tail, "helm 的失败原因在末尾，前面全是用法回显");
            Assert.AreEqual("", HelmCli.Tail("", 3));
        }

        [TestMethod]
        public void RunAsync_ReportsMissingBinaryAsItsOwnKindOfFailure()
        {
            // 老镜像里没有 helm：这必须是「环境不齐」而不是「这次装应用失败了」，界面才能给出对的下一步
            var cli = new HelmCli(NullLogger<HelmCli>.Instance) { Binary = "helm-that-does-not-exist-xyz" };

            try
            {
                cli.RunAsync(null, ["version"]).GetAwaiter().GetResult();
                Assert.Fail("找不到可执行文件必须抛出来");
            }
            catch (HelmMissingException ex)
            {
                StringAssert.Contains(ex.Message, "helm-that-does-not-exist-xyz");
            }
        }

        [TestMethod]
        public async Task RunAsync_CapturesExitCodeAndStreams()
        {
            // 拿一个真实存在的进程把「起进程、收两路输出、拿退出码」这条管道验通。
            // values 走 stdin 的那一段要连 helm 一起验，留给 minikube E2E，这里不拿假二进制糊过去。
            var cli = new HelmCli(NullLogger<HelmCli>.Instance) { Binary = "dotnet" };

            var ok = await cli.RunAsync(null, ["--version"]);

            Assert.AreEqual(0, ok.ExitCode, $"dotnet --version 本该成功，stderr：{ok.StdErr}");
            StringAssert.Contains(ok.StdOut, "10.", "输出要原样带回来，界面靠它显示版本");

            var bad = await cli.RunAsync(null, ["--version", "--not-a-real-flag"]);
            Assert.AreNotEqual(0, bad.ExitCode, "非 0 退出码不能被当成成功");
        }
    }
}
