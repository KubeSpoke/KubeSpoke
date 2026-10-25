using Microsoft.EntityFrameworkCore;

namespace KubeSpoke.Server.Data
{
    public class UserEntity
    {
        public int Id { get; set; }
        public string Username { get; set; } = "";
        public string Salt { get; set; } = "";
        public string Hash { get; set; } = "";
        public int Iterations { get; set; } = 100_000;
        public string Role { get; set; } = "user";

        /// <summary>
        /// 口令是别人（管理员）代设的，本人登录必须先改密，改完置回 false。
        /// </summary>
        public bool MustChangePassword { get; set; }
    }

    /// <summary>
    /// 一条控制台的写操作留痕。只记非 GET 请求和终端开关，读操作不进库。
    /// 超过 <see cref="AuditRepository.RetentionDays"/> 天的旧记录由写入路径定期删掉，表不会一直长。
    /// </summary>
    public class AuditEntity
    {
        public long Id { get; set; }

        public DateTime TimeUtc { get; set; }

        /// <summary>控制台账号名；登录失败时也记被尝试的那个账号名（此时会话还没认证，别处取不到）。其它未登录场景为空。</summary>
        public string Actor { get; set; } = "";

        /// <summary>操作名：集群类取被调用的接口名（ScaleDeployment 等），其余取 控制器/动作。</summary>
        public string Action { get; set; } = "";

        public string Cluster { get; set; } = "";
        public string Namespace { get; set; } = "";

        /// <summary>被操作的资源名。</summary>
        public string Resource { get; set; } = "";

        /// <summary>关键参数摘要，只挑白名单字段，口令一类永远不落库。</summary>
        public string Detail { get; set; } = "";

        public string Ip { get; set; } = "";
        public bool Success { get; set; } = true;

        /// <summary>失败原因：异常消息，或登录一类接口直接回的失败提示。</summary>
        public string Message { get; set; } = "";
    }

    /// <summary>
    /// 一条集群异常。采集器每轮按指纹覆写，这轮没再出现的自动置为已恢复，
    /// 所以库里既是在告的清单，也是历史。
    /// </summary>
    public class AlertEntity
    {
        public long Id { get; set; }

        /// <summary>集群+类型+对象+原因的指纹，同一异常跨轮次靠它认出来。</summary>
        public string Fingerprint { get; set; } = "";

        public string Cluster { get; set; } = "";

        /// <summary>NodeNotReady / PodContainerWaiting / PodFailed / DeploymentUnderReplicas / WarningEvent。</summary>
        public string Kind { get; set; } = "";

        public string Namespace { get; set; } = "";
        public string Resource { get; set; } = "";
        public string Reason { get; set; } = "";
        public string Message { get; set; } = "";

        /// <summary>critical / warning。</summary>
        public string Severity { get; set; } = "warning";

        public int Count { get; set; } = 1;

        public DateTime FirstSeenUtc { get; set; }
        public DateTime LastSeenUtc { get; set; }

        /// <summary>还在告为 null；这一轮不再出现就填上恢复时间。</summary>
        public DateTime? ResolvedUtc { get; set; }

        /// <summary>静默到期时间。没到点之前这条不再对外推送、也不算进未确认角标，对象本身照旧在库里更新。</summary>
        public DateTime? MuteUntilUtc { get; set; }

        public bool Acked { get; set; }
        public string AckedBy { get; set; } = "";
        public DateTime? AckedAt { get; set; }
    }

    /// <summary>
    /// 一个告警推送渠道。现在只有通用 webhook，Kind 留着，
    /// 以后接钉钉、企业微信那种带签名的机器人时不用再改表。
    /// </summary>
    public class AlertChannelEntity
    {
        public long Id { get; set; }

        /// <summary>渠道类型，目前固定 webhook。</summary>
        public string Kind { get; set; } = "webhook";

        public string Url { get; set; } = "";

        public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    }

    /// <summary>
    /// 一次告警推送的投递结果，按「渠道 × 集群 × 轮次」记一条。
    /// 只用来回答「通知到底送到没送到」，采集判断不看它。
    /// </summary>
    public class AlertNotifyLogEntity
    {
        public long Id { get; set; }

        public DateTime TimeUtc { get; set; }

        public long ChannelId { get; set; }

        /// <summary>当时那个地址抄一份进来：渠道删了以后，这条记录还得说清发去哪了。</summary>
        public string Url { get; set; } = "";

        public string Cluster { get; set; } = "";

        public int Firing { get; set; }
        public int Resolved { get; set; }

        public bool Success { get; set; }

        /// <summary>失败原因：对方返回的 HTTP 状态码，或者抛出来的异常消息。</summary>
        public string Message { get; set; } = "";
    }

    /// <summary>
    /// 一条回收站记录：删除之前先把对象抓下来存成可重新 apply 的 YAML。
    /// 抓不到（读接口失败、对象过大、Pod/Secret 这类不收的种类）就不落库，删除照旧执行。
    /// </summary>
    public class DeletedObjectEntity
    {
        public long Id { get; set; }

        public DateTime TimeUtc { get; set; }

        /// <summary>按下删除的人。</summary>
        public string Actor { get; set; } = "";

        public string Cluster { get; set; } = "";
        public string Namespace { get; set; } = "";

        /// <summary>K8s Kind，列表页用来分组和显示。</summary>
        public string Kind { get; set; } = "";

        /// <summary>被删掉的对象名。</summary>
        public string Name { get; set; } = "";

        /// <summary>通用资源接口坐标，还原前用它再读一次集群，确认没有同名对象挡路。</summary>
        public string Group { get; set; } = "";
        public string Version { get; set; } = "";
        public string Plural { get; set; } = "";

        /// <summary>还原时要发给 Agent 的对象原文，已剥掉 uid / resourceVersion / status。</summary>
        public string Yaml { get; set; } = "";

        /// <summary>过期时间，到点由回收站自己清掉。</summary>
        public DateTime ExpiresUtc { get; set; }

        /// <summary>已经还原过一次的时间；还原不删记录，留着好追溯是谁恢复的。</summary>
        public DateTime? RestoredUtc { get; set; }
    }

    /// <summary>
    /// 一条控制台设置。值统一存字符串，再加新项不用动表。
    /// </summary>
    public class SettingEntity
    {
        public string Key { get; set; } = "";
        public string Value { get; set; } = "";
    }

    /// <summary>
    /// 一条内网穿透隧道。agent 按此配置在目标集群拉起 fasttunnel-client Pod（PodName），
    /// 由该 Pod 主动连接外部 FastTunnel 服务端建立穿透。隧道的实时状态不落库，按需查 Pod。
    /// Token 属于凭据：落库是为了重建/展示，但列表接口不回传，审计白名单也不含它。
    /// </summary>
    public class TunnelEntity
    {
        public long Id { get; set; }

        /// <summary>集群标识（agent 的 ClustName）。</summary>
        public string Cluster { get; set; } = "";

        /// <summary>隧道显示名，用户自填。</summary>
        public string Name { get; set; } = "";

        /// <summary>fasttunnel-client Pod 所在命名空间。</summary>
        public string Namespace { get; set; } = "default";

        /// <summary>agent 建出来的 Pod 名，删除/查状态时点名用。</summary>
        public string PodName { get; set; } = "";

        public string Image { get; set; } = "";

        public string ServerAddr { get; set; } = "";
        public int ServerPort { get; set; }
        public string Token { get; set; } = "";

        /// <summary>HTTP 穿透条目的 JSON 数组（FastTunnelConfig.Web[]）。</summary>
        public string WebsJson { get; set; } = "[]";

        /// <summary>端口转发条目的 JSON 数组（FastTunnelConfig.Forward[]）。</summary>
        public string ForwardsJson { get; set; } = "[]";

        public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
        public string CreatedBy { get; set; } = "";
    }

    /// <summary>
    /// 一个 Helm chart 仓库（应用市场的一路来源）。
    /// Username/Password 属于凭据：落库是为了每次装应用时现取现用，但列表接口不回传口令，
    /// 审计白名单里也没有 Password，所以它既不出现在响应里也不留在留痕里。
    /// 仓库内容（chart 列表）不入库，只在内存里按 TTL 缓存，避免库里的目录和上游脱节。
    /// </summary>
    public class HelmRepoEntity
    {
        public long Id { get; set; }

        /// <summary>显示名，也是浏览器引用这一路仓库用的键，全站唯一。</summary>
        public string Name { get; set; } = "";

        /// <summary>仓库根地址（http(s)，index.yaml 由代理端按这个地址去取）。</summary>
        public string Url { get; set; } = "";

        public string Username { get; set; } = "";
        public string Password { get; set; } = "";

        /// <summary>自建镜像仓库常用自签证书，勾了它代理端才不校验服务端证书。</summary>
        public bool Insecure { get; set; }

        public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
        public string CreatedBy { get; set; } = "";
    }

    public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
    {
        public DbSet<UserEntity> Users => Set<UserEntity>();

        public DbSet<AuditEntity> Audits => Set<AuditEntity>();

        public DbSet<AlertEntity> Alerts => Set<AlertEntity>();

        public DbSet<AlertChannelEntity> AlertChannels => Set<AlertChannelEntity>();

        public DbSet<AlertNotifyLogEntity> AlertNotifyLogs => Set<AlertNotifyLogEntity>();

        public DbSet<SettingEntity> Settings => Set<SettingEntity>();

        public DbSet<DeletedObjectEntity> DeletedObjects => Set<DeletedObjectEntity>();

        public DbSet<TunnelEntity> Tunnels => Set<TunnelEntity>();

        public DbSet<HelmRepoEntity> HelmRepos => Set<HelmRepoEntity>();

        protected override void OnModelCreating(ModelBuilder builder)
        {
            builder.Entity<UserEntity>().HasIndex(u => u.Username).IsUnique();
            builder.Entity<AuditEntity>().HasIndex(a => a.TimeUtc);
            builder.Entity<AlertEntity>().HasIndex(a => a.Fingerprint).IsUnique();
            builder.Entity<AlertEntity>().HasIndex(a => a.ResolvedUtc);
            builder.Entity<AlertNotifyLogEntity>().HasIndex(l => l.TimeUtc);
            builder.Entity<DeletedObjectEntity>().HasIndex(d => d.TimeUtc);
            builder.Entity<DeletedObjectEntity>().HasIndex(d => d.ExpiresUtc);
            builder.Entity<TunnelEntity>().HasIndex(t => t.Cluster);
            builder.Entity<HelmRepoEntity>().HasIndex(r => r.Name).IsUnique();
            builder.Entity<SettingEntity>().HasKey(s => s.Key);
        }
    }
}
