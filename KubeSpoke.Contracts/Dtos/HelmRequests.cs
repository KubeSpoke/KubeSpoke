using System;
using System.Collections.Generic;

namespace KubeSpoke.Contracts.Dtos
{
    /// <summary>
    /// Helm 请求统一约定：仓库地址与凭据由服务端从库里取出后注入，浏览器只带 repoId，
    /// 所以凭据不进 URL、不进请求体，也不会被审计摘要捞走。
    /// 每个请求各自列一遍 RepoUrl/Username/Password/Insecure，和容器文件那批 DTO 一样不做继承——
    /// 这几个字段将来按接口类型分化（http 仓库要 insecure，OCI 要 --plain-http）时不会互相牵制。
    /// </summary>
    public class HelmCapabilityRequest : BaseRequest
    {
    }

    /// <summary>
    /// 列 release。Namespace 留空表示整个集群（helm list -A），
    /// 界面默认就是全集群——「哪些应用是我装的」本来就不按命名空间想。
    /// </summary>
    public class HelmListReleasesRequest : BaseNamespacedRequest
    {
    }

    /// <summary>安装一个 chart。</summary>
    public class InstallHelmChartRequest : BaseNamespacedRequest
    {
        /// <summary>release 名，安装时由操作人填</summary>
        public string Name { get; set; }

        public string Chart { get; set; }

        /// <summary>留空表示用仓库索引里的最新稳定版</summary>
        public string? ChartVersion { get; set; }

        /// <summary>http(s) chart 仓库地址。留空表示 Chart 已经是可直接交给 helm 的引用
        /// （.tgz 的 https 地址或 oci:// 路径），OCI 分发与打包好的 chart 因此不用另开一套接口。</summary>
        public string? RepoUrl { get; set; }

        public string? Username { get; set; }

        public string? Password { get; set; }

        /// <summary>自建仓库常用自签证书，给了这个开关才不逼用户去挂 CA</summary>
        public bool Insecure { get; set; }

        /// <summary>操作人写的 values.yaml 原文。用 -f - 从子进程 stdin 喂给 helm，不走 --set：
        /// --set 的逗号与点号语义会把嵌套结构和字符串切坏；落成临时文件则要操心清理。</summary>
        public string? Values { get; set; }

        /// <summary>命名空间不存在时顺带创建，等价 --create-namespace</summary>
        public bool CreateNamespace { get; set; } = true;

        /// <summary>等就绪再返回。默认关：等就绪会让一次 RPC 挂几分钟，界面宁可刷新 release 列表看状态流转。</summary>
        public bool Wait { get; set; }

        /// <summary>仅在 Wait 为真时生效，对应 --wait-for-jobs</summary>
        public bool WaitForJobs { get; set; }

        /// <summary>失败自动退回上一个修订。helm 4 把 --atomic 换成了 --rollback-on-failure，
        /// 它会把 --wait 强制设成 watcher，所以勾上这一项就等于让这次 RPC 真等到资源就绪。</summary>
        public bool RollbackOnFailure { get; set; }

        /// <summary>传给 helm 的 --timeout 秒数，0 用 helm 默认（5 分钟）。代理端会把它压进本次 RPC 的窗口内。</summary>
        public int TimeoutSec { get; set; }
    }

    /// <summary>升级一个已存在的 release。</summary>
    public class UpgradeHelmChartRequest : BaseNamespacedRequest
    {
        public string Name { get; set; }

        public string Chart { get; set; }

        public string? ChartVersion { get; set; }

        public string? RepoUrl { get; set; }

        public string? Username { get; set; }

        public string? Password { get; set; }

        public bool Insecure { get; set; }

        public string? Values { get; set; }

        /// <summary>
        /// 沿用线上已有的值（--reuse-values）。false 时以本次提交的 values 为完整覆盖（--reset-values），
        /// 界面「把生效值预填给你改」这个交互成立的前提就是走 reset 这一路。
        /// </summary>
        public bool ReuseValues { get; set; }

        /// <summary>保留的历史修订条数，对应 --history-max；0 用 helm 默认。</summary>
        public int HistoryMax { get; set; } = 10;

        public bool Wait { get; set; }

        /// <summary>同安装：helm 4 的 --rollback-on-failure，失败自动退回上一个修订，附带 --cleanup-on-fail。</summary>
        public bool RollbackOnFailure { get; set; }

        public int TimeoutSec { get; set; }
    }

    /// <summary>回滚到某次修订，Revision 来自 helm history。</summary>
    public class RollbackHelmChartRequest : BaseNamespacedRequest
    {
        public string Name { get; set; }

        /// <summary>0 表示回到最近一次修订之前，由 helm 自己决定</summary>
        public int Revision { get; set; }

        /// <summary>等回滚后的资源就绪</summary>
        public bool Wait { get; set; }

        public int TimeoutSec { get; set; }
    }

    public class GetHelmHistoryRequest : BaseNamespacedRequest
    {
        public string Name { get; set; }
    }

    public class GetHelmReleaseRequest : BaseNamespacedRequest
    {
        public string Name { get; set; }

        /// <summary>只看某一次修订的值与清单，0 表示当前</summary>
        public int Revision { get; set; }
    }

    public class UninstallHelmChartRequest : BaseNamespacedRequest
    {
        public string Name { get; set; }

        /// <summary>对应 --keep-history：资源照样删掉，只把 release 记录留在集群里，
        /// 用于「这次先别把它从 helm 的账上抹掉」。helm 没有保留资源只摘记录的选项。</summary>
        public bool KeepHistory { get; set; }

        /// <summary>卸载会等钩子跑完，0 表示用代理端给的短默认值（这条 RPC 的窗口比它长不了多少）。</summary>
        public int TimeoutSec { get; set; }
    }

    /// <summary>拉取并解析一个 http(s) chart 仓库的 index.yaml。不经过 helm 进程，
    /// 代理端直接 HTTP 取索引，所以老镜像里没装 helm 也能逛市场。</summary>
    public class ListHelmChartsRequest : BaseRequest
    {
        public string RepoUrl { get; set; }

        public string? Username { get; set; }

        public string? Password { get; set; }

        public bool Insecure { get; set; }

        /// <summary>按 chart 名/描述/关键字做的子串过滤，空表示不过滤</summary>
        public string? Query { get; set; }

        /// <summary>返回条数上限。索引动辄上万条，靠它兜住回传载荷。</summary>
        public int MaxCharts { get; set; } = 300;

        /// <summary>每个 chart 最多带几个版本，版本下拉框用</summary>
        public int MaxVersions { get; set; } = 30;
    }

    /// <summary>渲染 chart 得到多文档 YAML，供安装前预览。</summary>
    public class RenderHelmTemplateRequest : BaseNamespacedRequest
    {
        /// <summary>渲染用的假想 release 名，会出现在资源名里，所以和真装时填的一样才看得出问题</summary>
        public string Name { get; set; }

        public string Chart { get; set; }

        public string? ChartVersion { get; set; }

        public string? RepoUrl { get; set; }

        public string? Username { get; set; }

        public string? Password { get; set; }

        public bool Insecure { get; set; }

        public string? Values { get; set; }

        /// <summary>对应 --skip-crds：预览时默认把 CRD 一起渲染出来，好让操作人看见装了哪些</summary>
        public bool SkipCrds { get; set; }
    }
}
