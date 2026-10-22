using Microsoft.EntityFrameworkCore;

namespace KubeSpoke.Server.Data
{
    /// <summary>
    /// 控制台设置项。目前只有一项（RPC 超时），读取时顺手兜住越界和脏值，
    /// 免得库里一个 0 把每个接口都变成秒退。
    /// </summary>
    public class SystemSettingsRepository(AppDbContext db)
    {
        public const string RpcTimeoutKey = "rpc.timeout.sec";

        /// <summary>没设过时的取值，也是 AgentApiProxy 里的老默认。</summary>
        public const int DefaultRpcTimeoutSec = 3;

        public const int MinRpcTimeoutSec = 1;
        public const int MaxRpcTimeoutSec = 120;

        public async Task<int> GetRpcTimeoutSecAsync()
        {
            var value = (await db.Settings.FirstOrDefaultAsync(s => s.Key == RpcTimeoutKey))?.Value;
            return Parse(value);
        }

        /// <summary>写入并回读，返回真正生效的值（越界的会被夹到边界上）。</summary>
        public async Task<int> SetRpcTimeoutSecAsync(int sec)
        {
            var applied = Math.Clamp(sec, MinRpcTimeoutSec, MaxRpcTimeoutSec);
            var row = await db.Settings.FirstOrDefaultAsync(s => s.Key == RpcTimeoutKey);
            if (row == null)
                db.Settings.Add(new SettingEntity { Key = RpcTimeoutKey, Value = applied.ToString() });
            else
                row.Value = applied.ToString();
            await db.SaveChangesAsync();
            return applied;
        }

        /// <summary>供启动时加载用：库里没记或记坏了就回默认。</summary>
        public static int Parse(string? value) =>
            int.TryParse(value, out var sec) && sec >= MinRpcTimeoutSec && sec <= MaxRpcTimeoutSec
                ? sec
                : DefaultRpcTimeoutSec;
    }
}
