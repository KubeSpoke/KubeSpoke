using KubeSpoke.Server.Filters;

namespace KubeSpoke.Server.Extensions
{
    public static class AuditExtensions
    {
        /// <summary>
        /// 让审计能回放一遍 /api 写请求的正文（控制器后面还要再读一次），必须在 MVC 之前。
        /// </summary>
        public static IApplicationBuilder UseAuditBodyBuffer(this IApplicationBuilder app) =>
            app.UseMiddleware<AuditBodyBufferMiddleware>();
    }
}
