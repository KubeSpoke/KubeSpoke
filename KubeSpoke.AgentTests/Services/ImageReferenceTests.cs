using KubeSpoke.Agent.Services;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace KubeSpoke.Agent.Services.Tests
{
    /// <summary>
    /// 镜像地址解析与 tag 排序。这两件事直接决定「下拉里排第一的是不是用户以为的最新版」，
    /// 而 registry v2 只给一堆字符串、不给时间，排序口径错了界面就会理直气壮地推荐旧版本。
    /// 断言用的都是真实仓库里见过的写法：ACR 的 3.0.arm64 这类多段 tag、v 前缀、latest。
    /// </summary>
    [TestClass]
    public class ImageReferenceTests
    {
        [TestMethod]
        public void Parse_阿里云镜像_拆出地址与tag()
        {
            var r = ImageReference.Parse("registry.cn-hangzhou.aliyuncs.com/acs/pause:3.9");

            Assert.AreEqual("registry.cn-hangzhou.aliyuncs.com", r.Registry);
            Assert.AreEqual("acs/pause", r.Repository);
            Assert.AreEqual("3.9", r.Tag);
            Assert.AreEqual("registry.cn-hangzhou.aliyuncs.com", ImageReference.ApiHost(r));
        }

        [TestMethod]
        public void Parse_带端口的私有仓库_端口算地址的一部分()
        {
            var r = ImageReference.Parse("harbor.local:5000/team/app:v1.2.3");

            Assert.AreEqual("harbor.local:5000", r.Registry);
            Assert.AreEqual("team/app", r.Repository);
            Assert.AreEqual("v1.2.3", r.Tag);
        }

        [TestMethod]
        public void Parse_dockerhub简写_补library前缀并改走registry1()
        {
            var r = ImageReference.Parse("nginx:1.27");

            Assert.AreEqual("docker.io", r.Registry);
            Assert.AreEqual("library/nginx", r.Repository);
            Assert.AreEqual("registry-1.docker.io", ImageReference.ApiHost(r));
        }

        [TestMethod]
        public void Parse_无tag_按空tag处理不报错()
        {
            var r = ImageReference.Parse("registry.cn-hangzhou.aliyuncs.com/acs/pause");

            Assert.AreEqual("", r.Tag);
            Assert.AreEqual("registry.cn-hangzhou.aliyuncs.com/acs/pause:3.9", ImageReference.WithTag(r, "3.9"));
            Assert.AreEqual("registry.cn-hangzhou.aliyuncs.com/acs/pause", ImageReference.WithTag(r, ""));
        }

        [TestMethod]
        public void Parse_digest地址_单独拆出来好让下拉拒绝()
        {
            var r = ImageReference.Parse("registry.cn-hangzhou.aliyuncs.com/acs/pause@sha256:deadbeef");

            Assert.AreEqual("sha256:deadbeef", r.Digest);
            Assert.AreEqual("acs/pause", r.Repository);
        }

        [TestMethod]
        public void SortDesc_按数值比不是按字典序_3点10在3点9前面()
        {
            // ACR 的 tags/list 原样返回的就是字典序，直接倒排会把 3.9 当成最新
            var tags = new[] { "3.0", "3.1", "3.10", "3.2", "3.5", "3.9", "v3.9" };

            var sorted = ImageReference.SortDesc(tags);

            // v3.9 与 3.9 版本号相同，并列时按原样倒序，口径只为结果稳定
            Assert.AreEqual("3.10,v3.9,3.9,3.5,3.2,3.1,3.0", string.Join(",", sorted));
        }

        [TestMethod]
        public void SortDesc_latest这类浮动tag沉底()
        {
            var sorted = ImageReference.SortDesc(new[] { "latest", "1.4.0", "stable", "1.3.9" });

            Assert.AreEqual("1.4.0,1.3.9,latest,stable", string.Join(",", sorted));
        }

        [TestMethod]
        public void SortDesc_正版tag排在架构变体之前()
        {
            var sorted = ImageReference.SortDesc(new[] { "3.0.arm64", "3.0.amd64", "3.0", "3.1" });

            Assert.AreEqual("3.1,3.0,3.0.arm64,3.0.amd64", string.Join(",", sorted));
        }

        [TestMethod]
        public void SortDesc_去重()
        {
            var sorted = ImageReference.SortDesc(new[] { "1.0", "1.0", "" });

            Assert.AreEqual("1.0", string.Join(",", sorted));
        }

        [TestMethod]
        public void ParseBearer_照ACR的401头解析()
        {
            const string header = """
            Bearer realm="https://dockerauth.cn-hangzhou.aliyuncs.com/auth",service="registry.aliyuncs.com:cn-hangzhou:26842",scope="repository:acs/pause:pull"
            """;

            var c = ImageReference.ParseBearer(header);

            Assert.IsNotNull(c);
            Assert.AreEqual("https://dockerauth.cn-hangzhou.aliyuncs.com/auth", c.Realm);
            Assert.AreEqual("registry.aliyuncs.com:cn-hangzhou:26842", c.Service);
            Assert.AreEqual("repository:acs/pause:pull", c.Scope);
        }

        [TestMethod]
        public void ParseBearer_只给Basic时返回null让调用方另作处理()
        {
            Assert.IsNull(ImageReference.ParseBearer("Basic realm=\"registry\""));
            Assert.IsNull(ImageReference.ParseBearer(""));
        }

        [TestMethod]
        public void ParseNextLink_取rel等于next的那一段()
        {
            const string link = "<https://h/v2/ns/app/tags/list?n=20&last=3.5>; rel=\"next\"";

            Assert.AreEqual("https://h/v2/ns/app/tags/list?n=20&last=3.5", ImageReference.ParseNextLink(link));
            Assert.IsNull(ImageReference.ParseNextLink("<https://h/x>; rel=\"prev\""));
            Assert.IsNull(ImageReference.ParseNextLink(null));
        }
    }
}
