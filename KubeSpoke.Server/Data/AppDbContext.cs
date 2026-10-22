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
    /// </summary>
    public class AuditEntity
    {
        public long Id { get; set; }

        public DateTime TimeUtc { get; set; }

        /// <summary>控制台账号名，未登录时为空。</summary>
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

        /// <summary>失败时的异常消息。</summary>
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
    /// 一条控制台设置。值统一存字符串，再加新项不用动表。
    /// </summary>
    public class SettingEntity
    {
        public string Key { get; set; } = "";
        public string Value { get; set; } = "";
    }

    public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
    {
        public DbSet<UserEntity> Users => Set<UserEntity>();

        public DbSet<AuditEntity> Audits => Set<AuditEntity>();

        public DbSet<AlertEntity> Alerts => Set<AlertEntity>();

        public DbSet<AlertChannelEntity> AlertChannels => Set<AlertChannelEntity>();

        public DbSet<AlertNotifyLogEntity> AlertNotifyLogs => Set<AlertNotifyLogEntity>();

        public DbSet<SettingEntity> Settings => Set<SettingEntity>();

        protected override void OnModelCreating(ModelBuilder builder)
        {
            builder.Entity<UserEntity>().HasIndex(u => u.Username).IsUnique();
            builder.Entity<AuditEntity>().HasIndex(a => a.TimeUtc);
            builder.Entity<AlertEntity>().HasIndex(a => a.Fingerprint).IsUnique();
            builder.Entity<AlertEntity>().HasIndex(a => a.ResolvedUtc);
            builder.Entity<AlertNotifyLogEntity>().HasIndex(l => l.TimeUtc);
            builder.Entity<SettingEntity>().HasKey(s => s.Key);
        }
    }
}
