using System.Text.Json;
using System.Text.RegularExpressions;

namespace KubeSpoke.Server.Models
{
    public class GitlabEventHandler
    {
        ILogger<GitlabEventHandler> logger;
        YunXiaoClient yunXiaoClient;

        public GitlabEventHandler(ILogger<GitlabEventHandler> logger, YunXiaoClient yunXiaoClient)
        {
            this.logger = logger;
            this.yunXiaoClient = yunXiaoClient;
        }

        public void MergeHook(string body)
        {
            var request = JsonSerializer.Deserialize<MergeHookModel>(body);
            if (request == null)
            {
                throw new Exception("");
            }

            if (request.object_attributes.action == "open" || request.object_attributes.action == "update")
            {
                WhenOpen(request);
            }
            else if (request.object_attributes.action == "merge")
            {
                WhenMerged(request);
            }
            else
            {
                logger.LogInformation("当前事件不是合并事件，暂不处理");
                return;
            }
        }

        /// <summary>
        /// 申请合并分支
        /// </summary>
        /// <param name="request"></param>
        private void WhenOpen(MergeHookModel request)
        {
            // 获取分支名称，
            var branch = request.object_attributes.source_branch;
            logger.LogInformation($"[分支名] {branch}");
            if (!checkbranch(branch, out string customCode))
            {
                logger.LogInformation("非云效分支，暂不处理");
                return;
            }

            var req = yunXiaoClient.FineReqFromAllProject(customCode, branch);
            if (req == null)
            {
                logger.LogInformation("未找到对应的需求");
                return;
            }

            var md = $"""
                > [申请合并代码] {request.user.name} 申请合并分支：[{request.object_attributes.title}]({request.object_attributes.url})
                > [最后一次提交信息] [{request.object_attributes.last_commit.title}@{request.object_attributes.last_commit.id}]({request.object_attributes.last_commit.url})
                """;

            yunXiaoClient.CreateWorkitemComment(req, md);
            // 
        }

        /// <summary>
        /// 分支被合并
        /// </summary>
        /// <param name="request"></param>
        /// <exception cref="NotImplementedException"></exception>
        private void WhenMerged(MergeHookModel request)
        {
            // 获取分支名称，
            var branch = request.object_attributes.source_branch;
            logger.LogInformation($"[分支名] {branch}");
            if (!checkbranch(branch, out string customCode))
            {
                logger.LogInformation("非云效分支，暂不处理");
                return;
            }

            var req = yunXiaoClient.FineReqFromAllProject(customCode, branch);
            if (req == null)
            {
                logger.LogInformation("未找到对应的需求");
                return;
            }

            var md = $"""
                > [分支已合并] [{request.object_attributes.title}]({request.object_attributes.url})
                > [最后一次提交信息] [{request.object_attributes.last_commit.title}@{request.object_attributes.last_commit.id}]({request.object_attributes.url})
                """;

            yunXiaoClient.CreateWorkitemComment(req, md);
        }

        bool checkbranch(string branch, out string customCode)
        {
            // HYXX-20
            var match = Regex.IsMatch(branch, @"\w+-\d+");
            if (!match)
            {
                customCode = null;
            }
            else
            {
                customCode = branch.Split("-")[0];
            }

            return match;
        }
    }
}
