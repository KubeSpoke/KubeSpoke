using AlibabaCloud.SDK.Devops20210625.Models;
using Tea;
using static AlibabaCloud.SDK.Devops20210625.Models.ListWorkitemsResponseBody;

namespace KubeSpoke.Server.Models
{
    public class YunXiaoClient
    {
        AlibabaCloud.SDK.Devops20210625.Client client;

        ILogger<YunXiaoClient> logger;

        public YunXiaoClient(ILogger<YunXiaoClient> logger)
        {
            this.logger = logger;
            client = CreateClient();
        }

        const string ORG_ID = "65960ba90cab697efe133669";

        AlibabaCloud.SDK.Devops20210625.Client CreateClient()
        {
            // AccessKey 只能通过环境变量注入，禁止把密钥写进源码。
            // 建议使用更安全的 STS 方式，更多鉴权访问方式请参见：https://help.aliyun.com/document_detail/378671.html。
            var accessKeyId = Environment.GetEnvironmentVariable("ALIBABA_CLOUD_ACCESS_KEY_ID");
            var accessKeySecret = Environment.GetEnvironmentVariable("ALIBABA_CLOUD_ACCESS_KEY_SECRET");

            if (string.IsNullOrWhiteSpace(accessKeyId) || string.IsNullOrWhiteSpace(accessKeySecret))
            {
                throw new InvalidOperationException(
                    "缺少阿里云 AccessKey 环境变量：请设置 ALIBABA_CLOUD_ACCESS_KEY_ID 和 ALIBABA_CLOUD_ACCESS_KEY_SECRET。");
            }

            AlibabaCloud.OpenApiClient.Models.Config config = new AlibabaCloud.OpenApiClient.Models.Config
            {
                AccessKeyId = accessKeyId,
                AccessKeySecret = accessKeySecret,
            };

            // Endpoint 请参考 https://api.aliyun.com/product/devops
            config.Endpoint = "devops.cn-hangzhou.aliyuncs.com";
            return new AlibabaCloud.SDK.Devops20210625.Client(config);
        }

        string[] Categorys = new string[] { "Req", "Bug" };

        /// <summary>
        /// 通过编号获取需求 或 缺陷
        /// </summary>
        /// <param name="customCode">项目的编码</param>
        /// <param name="serialNumber">需求或缺陷的编码</param>
        public ListWorkitemsResponseBodyWorkitems FineReqFromAllProject(string customCode, string serialNumber)
        {
            var res1 = client.ListProjects(ORG_ID, new ListProjectsRequest
            {
                Category = "Project",
            });

            foreach (var project in res1.Body.Projects)
            {
                if (project.CustomCode != customCode)
                {
                    continue;
                }

                logger.LogInformation($"[找到对应的项目]: {customCode}-> {project.Name}");

                foreach (var category in Categorys)
                {
                    // 复制代码运行请自行打印 API 的返回值
                    var res = client.ListWorkitems(ORG_ID, new ListWorkitemsRequest
                    {
                        SpaceType = "Project",
                        SpaceIdentifier = project.Identifier, // "e552fdc5515a3448b631b2a59a",
                        Category = category,
                        Conditions = """
                            {"conditionGroups":[[{"fieldIdentifier":"serialNumber","operator":"CONTAINS","value":["
                            """
                        + serialNumber +
                        """
                            "],"toValue":null,"className":"string","format":"input"}]]}
                            """
                    });

                    if (res.Body.Workitems.Any())
                    {
                        return res.Body.Workitems.First();
                    }
                }

                return null;
            }

            return null;
        }

        public bool CreateWorkitemComment(ListWorkitemsResponseBodyWorkitems req, string md)
        {
            var res = client.CreateWorkitemComment(ORG_ID, new CreateWorkitemCommentRequest
            {
                WorkitemIdentifier = req.Identifier,
                Content = md,
                FormatType = "MARKDOWN"
            });

            return res.Body.Success == "true";
        }
    }
}
