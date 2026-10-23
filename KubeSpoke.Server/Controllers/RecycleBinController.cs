using KubeSpoke.Contracts;
using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Server.Data;
using KubeSpoke.Server.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KubeSpoke.Server.Controllers
{
    /// <summary>
    /// 回收站：删除动作先在控制台留一份原文快照，误删了就按快照重新 apply 回去。
    /// Kubernetes 自己没有撤销，级联删除之后 apiserver 里什么都不剩，
    /// 所以快照只能在下发删除之前抓，抓不到就照常删、只是不可恢复。
    /// </summary>
    [Authorize]
    public class RecycleBinController(IAgentApis agentApis, RecycleBinRepository bin) : BaseController
    {
        /// <summary>通用资源坐标 + Kind（Kind 只用于判断收不收和列表显示）。</summary>
        public class ResourceTarget : DeleteResourceRequest
        {
            public string Kind { get; set; } = "";
        }

        /// <summary>删除并尽量留下快照。返回 saved=false 表示这次删掉的东西恢复不了。</summary>
        [HttpPost]
        public async Task<object> Delete([FromBody] ResourceTarget target)
        {
            var restorable = ObjectSnapshot.IsRestorable(target.Kind);
            string? yaml = null;

            if (restorable)
            {
                try
                {
                    yaml = ObjectSnapshot.Build(agentApis.ReadResource(target));
                }
                catch (Exception)
                {
                    // 读不到就当作没这回事：快照失败不该让人删不掉东西
                    yaml = null;
                }
            }

            DeleteInCluster(target);

            if (yaml is null) return new { saved = false };

            var item = new DeletedObjectEntity
            {
                TimeUtc = DateTime.UtcNow,
                ExpiresUtc = DateTime.UtcNow.AddDays(RecycleBinRepository.KeepDays),
                Actor = User?.Identity?.Name ?? "",
                Cluster = target.ClustName ?? "",
                Namespace = target.Namespace ?? "",
                Kind = target.Kind,
                Name = target.Name ?? "",
                Group = target.Group ?? "",
                Version = target.Version ?? "",
                Plural = target.Plural ?? "",
                Yaml = yaml,
            };
            await bin.RecordAsync(item);
            return new { saved = true, id = item.Id };
        }

        [HttpGet]
        public async Task<object> List([FromQuery] string? cluster, [FromQuery] string? kind,
            [FromQuery] string? keyword, [FromQuery] int take = 50, [FromQuery] int skip = 0)
        {
            var (items, total) = await bin.ListAsync(new RecycleBinRepository.Query
            {
                Cluster = cluster ?? "",
                Kind = kind ?? "",
                Keyword = keyword ?? "",
            }, Math.Clamp(take, 1, 200), Math.Max(skip, 0));

            return new
            {
                total,
                keepDays = RecycleBinRepository.KeepDays,
                items = items.Select(d => new
                {
                    d.Id,
                    time = d.TimeUtc.ToLocalTime(),
                    d.Actor,
                    d.Cluster,
                    d.Namespace,
                    d.Kind,
                    d.Name,
                    expires = d.ExpiresUtc.ToLocalTime(),
                    restored = d.RestoredUtc?.ToLocalTime(),
                }),
            };
        }

        /// <summary>原文只在点开某一条时给，列表不带着走。</summary>
        [HttpGet]
        public async Task<object?> Get([FromQuery] long id)
        {
            var item = await bin.FindAsync(id);
            return item is null ? null : new { id = item.Id, yaml = item.Yaml };
        }

        /// <summary>按快照重新建回去。同名对象还在就拒绝，免得把两份配置叠在一起。</summary>
        [HttpPost]
        public async Task<string> Restore([FromQuery] long id)
        {
            var item = await bin.FindAsync(id) ?? throw new Exception("回收站里没有这条记录");
            if (item.RestoredUtc is not null) throw new Exception("这条已经还原过一次了");

            var exists = agentApis.ReadResource(new DeleteResourceRequest
            {
                ClustName = item.Cluster,
                Namespace = item.Namespace,
                Name = item.Name,
                Group = item.Group,
                Version = item.Version,
                Plural = item.Plural,
            });
            if (exists is not null) throw new Exception($"集群里已经有 {item.Kind}/{item.Name}，先把现在这个删掉再还原");

            if (!agentApis.ApplyResource(new ApplyResourceRequest { ClustName = item.Cluster, Yaml = item.Yaml }))
                throw new Exception("还原失败：集群拒绝了这个对象");

            await bin.MarkRestoredAsync(id);
            return "ok";
        }

        /// <summary>丢弃一条快照，不等它自己过期。</summary>
        [HttpPost]
        public async Task<bool> Drop([FromQuery] long id) => await bin.DropAsync(id);

        private void DeleteInCluster(ResourceTarget target)
        {
            if (agentApis.DeleteResource(target)) return;
            throw new Exception("集群没有确认这次删除");
        }
    }
}
