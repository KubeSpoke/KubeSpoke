using KubeSpoke.Server.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KubeSpoke.Server.Controllers
{
    /// <summary>
    /// 审计留痕的查询口。只有写操作会进库，这里自然全是 GET。
    /// </summary>
    [Authorize]
    public class AuditController : BaseController
    {
        private readonly AuditRepository audits;

        public AuditController(AuditRepository audits)
        {
            this.audits = audits;
        }

        [HttpGet]
        public async Task<object> List([FromQuery] string? cluster, [FromQuery] string? keyword,
            [FromQuery] bool? success, [FromQuery] int take = 50, [FromQuery] int skip = 0)
        {
            var (items, total) = await audits.ListAsync(new AuditRepository.Query
            {
                Cluster = cluster ?? "",
                Keyword = keyword ?? "",
                Success = success,
            }, Math.Clamp(take, 1, 200), Math.Max(skip, 0));

            return new
            {
                total,
                items = items.Select(a => new
                {
                    a.Id,
                    time = a.TimeUtc.ToLocalTime(),
                    a.Actor,
                    a.Action,
                    a.Cluster,
                    a.Namespace,
                    a.Resource,
                    a.Detail,
                    a.Ip,
                    a.Success,
                    a.Message,
                }),
            };
        }
    }
}
