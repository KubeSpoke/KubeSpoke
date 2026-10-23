using System.Text.Json;
using YamlDotNet.Serialization;

namespace KubeSpoke.Server.Services
{
    /// <summary>
    /// 删除前的对象快照：把读回来的 K8s 对象洗成能重新 apply 的 YAML。
    /// 集群自己填的字段（uid、resourceVersion、status、属主引用…）必须剥掉，
    /// 留着的话 apiserver 会直接拒绝这次创建。
    /// </summary>
    public static class ObjectSnapshot
    {
        /// <summary>超过这个大小就不存了，回收站不该为一个巨型 CR 把库撑起来。</summary>
        public const int MaxYamlChars = 256 * 1024;

        /// <summary>这些字段是集群运行期的产物，还原时用不上还会引起冲突。</summary>
        private static readonly string[] DroppedMetadata =
            ["uid", "resourceVersion", "creationTimestamp", "deletionTimestamp",
             "deletionGracePeriodSeconds", "managedFields", "generation", "selfLink", "ownerReferences"];

        /// <summary>kubectl / 控制台自己塞的注解，整份对象原文都在里面，还原不需要它。</summary>
        private static readonly string[] DroppedAnnotations =
            ["kubectl.kubernetes.io/last-applied-configuration"];

        /// <summary>
        /// 不收进回收站的种类：Pod 和 ReplicaSet 是控制器的产物，单独还原只会和属主打架；
        /// Namespace、Node 一删是连带一堆东西，一条快照兑现不了「恢复」；
        /// Secret 的 data 是明文可逆的，不该抄进控制台自己的库。
        /// </summary>
        private static readonly string[] NotRestorable =
            ["Pod", "ReplicaSet", "Namespace", "Node", "Secret"];

        public static bool IsRestorable(string? kind) => !string.IsNullOrEmpty(kind) && !NotRestorable.Contains(kind);

        /// <summary>读回来的对象转成可还原的 YAML；洗不出东西就返回 null，让调用方照常删。</summary>
        public static string? Build(object? raw)
        {
            if (raw is null) return null;

            object? cleaned;
            try
            {
                using var doc = JsonDocument.Parse(JsonSerializer.Serialize(raw));
                cleaned = Clean(doc.RootElement, null);
            }
            catch (Exception)
            {
                return null;
            }

            if (cleaned is null) return null;
            var yaml = new SerializerBuilder().Build().Serialize(cleaned);
            return yaml.Length > MaxYamlChars ? null : yaml;
        }

        /// <param name="key">这个节点在父对象里对应的字段名，用来认出 metadata 和顶层 status。</param>
        private static object? Clean(JsonElement node, string? key) => node.ValueKind switch
        {
            JsonValueKind.Object => CleanObject(node, key),
            JsonValueKind.Array => node.EnumerateArray().Select(item => Clean(item, key))
                .Where(value => value is not null).ToList(),
            JsonValueKind.String => node.GetString(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => node.TryGetInt64(out var l) ? l : node.GetDouble(),
            _ => null,
        };

        private static object? CleanObject(JsonElement node, string? key)
        {
            var inMetadata = key == "metadata";
            var map = new Dictionary<object, object>();
            foreach (var prop in node.EnumerateObject())
            {
                // 空字段一律丢掉：YAML 里写一串 null 既难看，也可能被 apiserver 当成显式赋值
                if (prop.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) continue;
                if (key is null && prop.NameEquals("status")) continue;
                if (inMetadata && DroppedMetadata.Contains(prop.Name)) continue;

                if (inMetadata && prop.NameEquals("annotations") && prop.Value.ValueKind == JsonValueKind.Object)
                {
                    var kept = prop.Value.EnumerateObject()
                        .Where(a => a.Value.ValueKind == JsonValueKind.String && !DroppedAnnotations.Contains(a.Name))
                        .ToDictionary(a => (object)a.Name, a => (object)a.Value.GetString());
                    if (kept.Count > 0) map["annotations"] = kept;
                    continue;
                }

                var value = Clean(prop.Value, prop.Name);
                if (value is not null) map[prop.Name] = value;
            }
            return map.Count > 0 ? map : null;
        }
    }
}
