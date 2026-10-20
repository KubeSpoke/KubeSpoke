using Microsoft.Extensions.Configuration;
using System.Text;
using System.Text.Json;


namespace KubeSpoke.Agent.Models
{
    public class WeixinWorkRebotAlertor : IAlertor
    {
        static readonly HttpClient httpClient = new();

        readonly string? hook;

        public WeixinWorkRebotAlertor(IConfiguration configuration)
        {
            hook = configuration.GetValue<string>("RobotWebHook");
        }

        public void Alert(IAlertor.Level level, string title, string message)
        {
            if (string.IsNullOrEmpty(hook))
                return;

            var md = $"""
            > **系统变更/发布提醒** 
            > 
            >变更类型：<font color="info">{title}</font> 
            >危险级别：<font color="warning">{(level == IAlertor.Level.Noarmal ? "低" : "高")}</font> 
            >提醒时间：<font color="comment">{DateTime.Now.ToString("MM-dd HH:mm:ss")}</font> 
            >详细内容：<font color="warning">{message}</font> 
            > 
            >客服团队注意，如在此提醒后出现大量系统问题，可能因为该操作引起，及时反馈研发中心撤销变更。
            """;

            var body = JsonSerializer.Serialize(new
            {
                msgtype = "markdown",
                markdown = new { content = md }
            });

            Task.Run(async () =>
            {
                try
                {
                    using var content = new StringContent(body, Encoding.UTF8, "application/json");
                    await httpClient.PostAsync(hook, content);
                }
                catch
                {
                    // 告警失败不能影响被通知的操作本身
                }
            });
        }
    }
}
