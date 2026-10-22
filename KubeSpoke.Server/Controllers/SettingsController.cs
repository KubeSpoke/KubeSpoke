using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Models;
using KubeSpoke.Server.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Reflection;

namespace KubeSpoke.Server.Controllers
{
    /// <summary>
    /// 控制台自己的设置，不属于某个集群，所以做成平台级的一页。
    /// </summary>
    [Authorize]
    public class SettingsController : BaseController
    {
        private readonly SystemSettingsRepository settings;

        public SettingsController(SystemSettingsRepository settings)
        {
            this.settings = settings;
        }

        /// <summary>
        /// 当前取值和可填范围，顺带列出那些自带时限、不吃这项配置的接口，
        /// 免得有人把超时调小后发现告警采集没受影响，以为设置没生效。
        /// </summary>
        [HttpGet]
        public async Task<object> Get()
        {
            var rpcTimeoutSec = await settings.GetRpcTimeoutSecAsync();
            return new
            {
                rpcTimeoutSec,
                min = SystemSettingsRepository.MinRpcTimeoutSec,
                max = SystemSettingsRepository.MaxRpcTimeoutSec,
                @default = SystemSettingsRepository.DefaultRpcTimeoutSec,
                overrides = typeof(IAgentApis).GetMethods()
                    .Select(m => (m.Name, Sec: m.GetCustomAttribute<MaxWaitSecAttribute>()?.Sec))
                    .Where(x => x.Sec is > 0)
                    .OrderBy(x => x.Name)
                    .Select(x => new { method = x.Name, sec = x.Sec!.Value }),
            };
        }

        /// <summary>写入并同步内存值：代理每次调用现读时限，所以不用重启也不用 Agent 重连。</summary>
        [HttpPost]
        public async Task<int> SetRpcTimeout([FromQuery] int rpcTimeoutSec)
        {
            var applied = await settings.SetRpcTimeoutSecAsync(rpcTimeoutSec);
            Global.RpcTimeoutSec = applied;
            return applied;
        }
    }
}
