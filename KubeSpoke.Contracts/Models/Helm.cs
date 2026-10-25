using System;
using System.Collections.Generic;

namespace KubeSpoke.Contracts.Models
{
    /// <summary>
    /// 代理端 helm 可执行文件的自检结果。老镜像里没有 helm，界面要靠这个提示去重新下发 agent，
    /// 而不是让每次装应用都退化成一条看不懂的「No such file or directory」。
    /// </summary>
    public class HelmCapability
    {
        public bool Ready { get; set; }

        /// <summary>helm version --short 的原文，形如 v4.3.0+gbec5b06。</summary>
        public string HelmVersion { get; set; } = "";

        /// <summary>不可用的原因（找不到可执行文件、没权限、kubeconfig 合成失败都算在这里）。</summary>
        public string Error { get; set; } = "";
    }

    /// <summary>一条 helm release（helm list 的一行）。</summary>
    public class HelmRelease
    {
        public string Name { get; set; } = "";
        public string Namespace { get; set; } = "";

        /// <summary>当前修订号，回滚就是回到这里面的某个历史值。</summary>
        public int Revision { get; set; }

        /// <summary>helm 原样给出的时间串，不在代理端猜时区。</summary>
        public string Updated { get; set; } = "";

        /// <summary>deployed / pending-install / failed / uninstalled …，界面按它出状态点。</summary>
        public string Status { get; set; } = "";

        public string Chart { get; set; } = "";
        public string Version { get; set; } = "";
        public string AppVersion { get; set; } = "";
        public string Description { get; set; } = "";
    }

    /// <summary>一次修订（helm history 的一行），回滚候选就来自这里。</summary>
    public class HelmRevision
    {
        public int Revision { get; set; }
        public string Updated { get; set; } = "";
        public string Status { get; set; } = "";
        public string Chart { get; set; } = "";
        public string Version { get; set; } = "";
        public string AppVersion { get; set; } = "";

        /// <summary>helm 给这次修订写的说明，Install/Upgrade/Rollback 字样靠它区分。</summary>
        public string Description { get; set; } = "";
    }

    /// <summary>
    /// 单个 release 的展开信息。三份文本原样带回：values 用于「升级时预填」，
    /// manifest 用于对照线上实际被改过什么，notes 是 chart 作者写的安装后说明。
    /// </summary>
    public class HelmReleaseDetail
    {
        public string Name { get; set; } = "";
        public string Namespace { get; set; } = "";
        public string Chart { get; set; } = "";
        public string Version { get; set; } = "";
        public string AppVersion { get; set; } = "";
        public string Status { get; set; } = "";
        public int Revision { get; set; }

        /// <summary>helm get values -a 的 YAML（生效值，含 chart 默认值）。</summary>
        public string Values { get; set; } = "";

        /// <summary>helm get manifest 的多文档 YAML。</summary>
        public string Manifest { get; set; } = "";

        public string Notes { get; set; } = "";
    }

    /// <summary>仓库索引里的一个 chart，界面市场页的一条卡片。</summary>
    public class HelmChart
    {
        /// <summary>所属仓库地址，安装时要原样带回给 helm --repo。</summary>
        public string Repo { get; set; } = "";
        public string Name { get; set; } = "";
        public string Version { get; set; } = "";
        public string AppVersion { get; set; } = "";
        public string Description { get; set; } = "";
        public string Icon { get; set; } = "";
        public string Home { get; set; } = "";

        /// <summary>chart 自己声明的 kubeVersion 约束，装之前给用户一个「可能装不上」的信号。</summary>
        public string KubeVersion { get; set; } = "";

        public bool Deprecated { get; set; }

        /// <summary>library 类型的 chart 不能直接装，界面要禁掉安装按钮。</summary>
        public string Type { get; set; } = "";

        public List<string> Keywords { get; set; } = new List<string>();

        /// <summary>可选版本，新在前，条数在代理端已经截过。</summary>
        public List<HelmChartVersion> Versions { get; set; } = new List<HelmChartVersion>();
    }

    public class HelmChartVersion
    {
        public string Version { get; set; } = "";
        public string AppVersion { get; set; } = "";
        public bool Deprecated { get; set; }

        /// <summary>index.yaml 里的 created 时间，格式按 chart 作者写的为准，所以只给字符串。</summary>
        public string Created { get; set; } = "";
    }

    /// <summary>
    /// 一次写操作（安装/升级/回滚/卸载）的结果。Message 非空即失败：helm 失败时退出码非 0，
    /// 代理端把它 stderr 的最后几行带回来，界面直接摊开给操作人看。
    /// </summary>
    public class HelmOperation
    {
        public string Name { get; set; } = "";
        public string Namespace { get; set; } = "";
        public int Revision { get; set; }
        public string Status { get; set; } = "";
        public string Chart { get; set; } = "";
        public string Version { get; set; } = "";
        public string Message { get; set; } = "";

        /// <summary>helm 自己的输出（安装 notes 一类），失败时是 stderr，截断后带回。</summary>
        public string Output { get; set; } = "";
    }
}
