using System;

namespace KubeSpoke.Contracts.Dtos
{
    /// <summary>通用 K8s 资源列表请求：Group 为空表示 core 组</summary>
    public class ListResourcesRequest : BaseRequest
    {
        /// <summary>API 组，core 资源传空字符串</summary>
        public string Group { get; set; }
        public string Version { get; set; }
        public string Plural { get; set; }
        /// <summary>命名空间，集群级资源可空</summary>
        public string Namespace { get; set; }
    }

    /// <summary>通用 K8s 资源删除请求</summary>
    public class DeleteResourceRequest : ListResourcesRequest
    {
        public string Name { get; set; }
    }

    /// <summary>以 YAML 创建 / 替换任意资源（KubeSphere「编辑 YAML / 使用模板创建」）</summary>
    public class ApplyResourceRequest : BaseRequest
    {
        public string Yaml { get; set; }
    }

    /// <summary>集群版本 / 基本信息（概览页用）</summary>
    public class ClusterInfoRequest : BaseRequest
    {
    }

    /// <summary>查询某对象的关联事件（保留 involvedObject，供详情页「事件」标签用）</summary>
    public class GetResourceEventsRequest : BaseNamespacedRequest
    {
        /// <summary>目标对象 Kind，如 Pod / Node</summary>
        public string Kind { get; set; }
        /// <summary>目标对象 Name；Kind=Node 时 Namespace 留空即可</summary>
        public string Name { get; set; }
    }
}
