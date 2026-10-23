using k8s;
using k8s.Models;
using KubeSpoke.Server.Services;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using System.Text.Json;
using YamlDotNet.Serialization;

namespace KubeSpoke.ServerTests
{
    /// <summary>
    /// 回收站快照的清洗规则。这里盯的是「还原出来的 YAML 必须还能被集群接受」：
    /// uid / resourceVersion / status / 属主引用这类运行期字段一旦留着，apiserver 会直接拒绝创建。
    /// </summary>
    [TestClass]
    public class ObjectSnapshotTests
    {
        private static V1Deployment Sample() => new()
        {
            ApiVersion = "apps/v1",
            Kind = "Deployment",
            Metadata = new V1ObjectMeta
            {
                Name = "nginx-demo",
                NamespaceProperty = "sample-app",
                Uid = "3b0409f8-1689-49c2-b2f2-71a5272d52cd",
                ResourceVersion = "104403",
                Generation = 3,
                CreationTimestamp = new DateTime(2026, 10, 18, 1, 2, 3, DateTimeKind.Utc),
                ManagedFields = [new V1ManagedFieldsEntry { Manager = "kubectl", Operation = "Update" }],
                Labels = new Dictionary<string, string> { ["app"] = "nginx" },
                Annotations = new Dictionary<string, string>
                {
                    ["kubectl.kubernetes.io/last-applied-configuration"] = """{"apiVersion":"apps/v1","kind":"Deployment"}""",
                    ["kubespoke.io/restartedAt"] = "2026-10-20T00:00:00Z",
                },
            },
            Spec = new V1DeploymentSpec
            {
                Replicas = 2,
                Selector = new V1LabelSelector { MatchLabels = new Dictionary<string, string> { ["app"] = "nginx" } },
                Template = new V1PodTemplateSpec
                {
                    Metadata = new V1ObjectMeta { Labels = new Dictionary<string, string> { ["app"] = "nginx" } },
                    Spec = new V1PodSpec { Containers = [new V1Container { Name = "nginx", Image = "nginx:1.25" }] },
                },
            },
            Status = new V1DeploymentStatus { Replicas = 2, ReadyReplicas = 2, AvailableReplicas = 2 },
        };

        [TestMethod]
        public void Build_剥掉运行期字段并留下业务字段()
        {
            var yaml = ObjectSnapshot.Build(Sample());

            Assert.IsNotNull(yaml, "正常对象该洗出快照");
            foreach (var gone in new[] { "uid:", "resourceVersion:", "generation:", "managedFields:",
                "creationTimestamp: 2026", "status:", "last-applied-configuration" })
                Assert.IsFalse(yaml!.Contains(gone), $"还原用的 YAML 里不该出现 {gone}");

            Assert.IsTrue(yaml!.Contains("kind: Deployment"));
            Assert.IsTrue(yaml.Contains("apiVersion: apps/v1"));
            Assert.IsTrue(yaml.Contains("replicas: 2"));
            Assert.IsTrue(yaml.Contains("image: nginx:1.25"));
            // 用户自己打的注解要留住，控制台的重启时间戳也是状态的一部分
            Assert.IsTrue(yaml.Contains("kubespoke.io/restartedAt"));
        }

        [TestMethod]
        public void Build_产物能被Agent的YAML解析接住()
        {
            var yaml = ObjectSnapshot.Build(Sample())!;

            // ApplyResource 走的就是这条解析路径，接不住就等于还原必然失败
            var docs = KubernetesYaml.LoadAllFromString(yaml);
            Assert.IsInstanceOfType(docs.Single(), typeof(V1Deployment));
            var dep = (V1Deployment)docs.Single();
            Assert.AreEqual("nginx-demo", dep.Metadata.Name);
            Assert.AreEqual(2, dep.Spec.Replicas);
            Assert.AreEqual("nginx:1.25", dep.Spec.Template.Spec.Containers[0].Image);
            Assert.IsNull(dep.Metadata.Uid, "还原时不该带着原来那个 uid");
        }

        [TestMethod]
        public void Build_通用资源回落成JsonElement也能洗()
        {
            // CustomObjects 读回来的自定义资源是 JsonElement，回收站同样要收
            using var doc = JsonDocument.Parse("""
                {"apiVersion":"example.com/v1","kind":"Widget",
                 "metadata":{"name":"w1","namespace":"demo","uid":"x","resourceVersion":"9"},
                 "spec":{"size":3},"status":{"phase":"Ready"}}
                """);
            var yaml = ObjectSnapshot.Build(doc.RootElement.Clone());

            Assert.IsNotNull(yaml);
            Assert.IsFalse(yaml!.Contains("uid:"));
            Assert.IsFalse(yaml.Contains("phase: Ready"), "顶层 status 该被丢掉");
            Assert.IsTrue(yaml.Contains("size: 3"));
        }

        [TestMethod]
        public void Build_洗不出东西时返回空让调用方照常删()
        {
            Assert.IsNull(ObjectSnapshot.Build(null));
            Assert.IsNull(ObjectSnapshot.Build(new { }));
        }

        [TestMethod]
        public void IsRestorable_按拍板的口径放行()
        {
            foreach (var kind in new[] { "Pod", "ReplicaSet", "Namespace", "Node", "Secret" })
                Assert.IsFalse(ObjectSnapshot.IsRestorable(kind), $"{kind} 不该进回收站");
            foreach (var kind in new[] { "Deployment", "StatefulSet", "ConfigMap", "Ingress", "Widget" })
                Assert.IsTrue(ObjectSnapshot.IsRestorable(kind), $"{kind} 该能还原");
        }

        [TestMethod]
        public void Build_巨型对象不进回收站()
        {
            var huge = Sample();
            huge.Metadata.Annotations["blob"] = new string('a', ObjectSnapshot.MaxYamlChars + 10);

            Assert.IsNull(ObjectSnapshot.Build(huge), "超过上限就不该往库里塞");
        }

        [TestMethod]
        public void Build_产物是合法YAML映射()
        {
            var graph = new DeserializerBuilder().Build()
                .Deserialize<Dictionary<object, object>>(new StringReader(ObjectSnapshot.Build(Sample())!));

            Assert.AreEqual("Deployment", graph["kind"]);
            Assert.IsFalse(graph.ContainsKey("status"));
        }
    }
}
