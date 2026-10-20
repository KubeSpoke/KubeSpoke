using KubeSpoke.Server.Filters;
using KubeSpoke.Server.Models;
using IdentityModel.Client;
using k8s.KubeConfigModels;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Primitives;
using NGitLab.Models;

namespace KubeSpoke.Server.Controllers
{
    [Route("api/[controller]/[action]")]
    [ServiceFilter(typeof(BXExceptionFilter))]
    [ApiController]
    public class HooksController : ControllerBase
    {
        ILogger<HooksController> logger;

        public HooksController(ILogger<HooksController> logger)
        {
            this.logger = logger;
        }
 
        /// <summary>
        /// POST /api/hooks/gitlab
        /// </summary>
        /// <returns></returns>
        [HttpPost]
        public async Task<IActionResult> Gitlab([FromServices] GitlabEventHandler gitlabEventHandler)
        {
            using StreamReader stream = new StreamReader(Request.HttpContext.Request.Body);
            string body = await stream.ReadToEndAsync();

            logger.LogInformation("[Gitlab Hook]" + body);

            // X-Gitlab-Event: Merge Request Hook
            if (!Request.Headers.TryGetValue("X-Gitlab-Event", out StringValues gitlabEvent))
            {
                throw new Exception("缺少参数 X-Gitlab-Event");
            }

            var jd = System.Text.Json.JsonDocument.Parse(body);
            var eventKey = jd.RootElement.TryGetString("object_kind");

            logger.LogInformation($"[GITLAB 事件]：{eventKey} gitlabEvent: {gitlabEvent}");

            switch (eventKey)
            {
                case "merge_request":
                    gitlabEventHandler.MergeHook(body);
                    break;
                case "push":
                case "Tag Push Hook":
                case "Issue Hook":
                case "Note Hook":
                case "Wiki Page Hook":
                case "Pipeline Hook":
                case "Job Hook":
                case "Deployment Hook":
                case "Member Hook":
                case "Subgroup Hook":
                case "Feature Flag Hook":
                case "Release Hook":
                case "Emoji Hook":
                case "Resource Access Token Hook":
                default:
                    logger.LogInformation($"暂不处理");
                    break;
            }

            return Ok();
        }
    }
}
