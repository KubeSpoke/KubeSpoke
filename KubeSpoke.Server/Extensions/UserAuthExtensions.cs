using KubeSpoke.Server.Data;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace KubeSpoke.Server.Extensions
{
    public static class UserAuthExtensions
    {
        public const string ConsoleScheme = "Console";

        /// <summary>前端据此把用户钉在改密页上的错误码。</summary>
        public const string MustChangePasswordCode = "must_change_password";

        /// <summary>控制台账号名固定为 admin，初始化时只设口令。</summary>
        public const string AdminUsername = "admin";

        /// <summary>
        /// 口令还是管理员代设的账号改密之前，除登录/登出/me/改密/初始化外
        /// 一律 403 + must_change_password，控制台别的功能进不去。
        /// </summary>
        public static IApplicationBuilder UseMustChangePasswordGuard(this IApplicationBuilder app) =>
            app.Use(async (context, next) =>
            {
                var path = context.Request.Path;
                if (context.User.Identity is { IsAuthenticated: true, AuthenticationType: ConsoleScheme } identity
                    && path.StartsWithSegments("/api") && !IsPasswordFlowPath(path)
                    && await context.RequestServices.GetRequiredService<UserRepository>().IsMustChangePasswordAsync(identity.Name ?? ""))
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    await context.Response.WriteAsJsonAsync(new { code = MustChangePasswordCode, message = "首次登录必须先修改密码" });
                    return;
                }

                await next();
            });

        private static bool IsPasswordFlowPath(PathString path) =>
            path.StartsWithSegments("/api/auth/login")
            || path.StartsWithSegments("/api/auth/logout")
            || path.StartsWithSegments("/api/auth/me")
            || path.StartsWithSegments("/api/auth/password");

        /// <summary>
        /// 控制台用户体系：Cookie 会话认证，作为默认方案；
        /// agent 侧的 Agent 方案（集群 Secret）由各 Hub 显式指定，互不影响。
        /// </summary>
        public static IServiceCollection AddUserAuthentication(this IServiceCollection services)
        {
            services.AddAuthentication(options =>
            {
                options.DefaultAuthenticateScheme = ConsoleScheme;
                options.DefaultChallengeScheme = ConsoleScheme;
            })
            .AddCookie(ConsoleScheme, options =>
            {
                options.Cookie.Name = "kubespoke_auth";
                options.Cookie.HttpOnly = true;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.ExpireTimeSpan = TimeSpan.FromHours(12);
                options.SlidingExpiration = true;
                // 前后端分离，未登录一律回 401 让前端跳登录页，不做 302
                options.Events.OnRedirectToLogin = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return Task.CompletedTask;
                };
                options.Events.OnRedirectToAccessDenied = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    return Task.CompletedTask;
                };
            });

            return services;
        }
    }
}
