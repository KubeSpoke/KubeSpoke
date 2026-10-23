using System.Text.Json;
using KubeSpoke.Server.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;

namespace KubeSpoke.Server.Filters
{
    /// <summary>
    /// 控制台的写操作留痕：非 GET 请求执行完就落一条库，读接口不进。
    /// 参数只按白名单挑几个字段拼摘要，口令一类不可能被写进库里。
    /// Auth 里的失败（登录被拒之类）不抛异常而是直接回 401/403，按状态码补成失败记录。
    /// </summary>
    public class AuditFilter(AuditRepository audits, ILogger<AuditFilter> logger) : IAsyncActionFilter
    {
        /// <summary>集群、命名空间、资源名单独成列，其余这些字段拼进摘要。</summary>
        private static readonly string[] DetailKeys = ["Container", "ContainerName", "Command", "Replicas", "Image", "Weight", "Username", "Role", "Kind", "Server", "Id", "Minutes", "RpcTimeoutSec"];

        /// <summary>资源名在各接口里叫法不一（Name / PodName / AppName…），按这个顺序取第一个有的。</summary>
        private static readonly string[] ResourceKeys = ["Name", "PodName", "AppName", "IngressClassName", "TargetName", "UserName"];

        /// <summary>再大的请求体也不值得为它审计，直接放弃解析。</summary>
        private const int MaxBodyChars = 64 * 1024;

        public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
        {
            var http = context.HttpContext;
            var request = http.Request;
            // Hooks 是外部系统回调，不是人的操作，记进来只会淹掉真正的留痕
            if (IsReadOnly(request.Method) || ControllerName(context) == "Hooks")
            {
                await next();
                return;
            }

            var body = await ReadBodyAsync(request);
            var executed = await next();

            try
            {
                var args = Parse(body, request.Query);
                var controller = ControllerName(context);
                var action = controller == "Cluster"
                    // 集群类接口全走 api/Cluster/{method} 反射派发，动作名在路由里而不在方法名里
                    ? RouteValue(context, "method") ?? "Cluster"
                    : $"{controller}/{RouteValue(context, "action")}";

                var actor = http.User?.Identity?.Name ?? "";
                var (success, message) = executed.Exception is { } ex
                    ? (false, BXExceptionFilter.Unwrap(ex).Message)
                    : (true, "");

                // 登录失败是 return Unauthorized(...)，不抛异常，只按异常判会全记成成功。
                // 只认 Auth 这一个控制器的 401/403：其它接口未登录的探测量大得多，记进来只会淹掉留痕。
                if (success && controller == "Auth" && IsDenied(executed.Result, out var reason))
                {
                    success = false;
                    message = reason;
                    // 这一步 http.User 还是未认证的，操作者只能取提交上来的账号名
                    if (actor.Length == 0) actor = args.Username;
                }

                await audits.RecordAsync(actor, action,
                    args.Cluster, args.Namespace, args.Resource, args.Detail,
                    http.Connection.RemoteIpAddress?.ToString() ?? "", success, message);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "[审计落库失败]");
            }
        }

        private static bool IsReadOnly(string method) =>
            HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);

        private static string ControllerName(ActionContext context)
        {
            context.ActionDescriptor.RouteValues.TryGetValue("controller", out var controller);
            return controller ?? "";
        }

        private static string? RouteValue(ActionContext context, string key) =>
            context.RouteData.Values.TryGetValue(key, out var value) ? value?.ToString() : null;

        /// <summary>
        /// 动作自己回了 401/403 就算这次操作没成。失败原因优先用响应体里的 message（比如「用户名或密码错误」），
        /// 没有就用一句通用的。
        /// </summary>
        private bool IsDenied(object? result, out string message)
        {
            message = "";
            if (result is not IStatusCodeActionResult { StatusCode: 401 or 403 }) return false;

            if (result is ObjectResult { Value: { } value }) message = ReadMessage(value);
            if (message.Length == 0) message = "认证未通过";
            return true;
        }

        /// <summary>失败提示就放在响应体的 message 字段里，匿名对象没有公共契约，只能序列化一遍再取。</summary>
        private string ReadMessage(object value)
        {
            try
            {
                var element = JsonSerializer.SerializeToElement(value);
                if (element.ValueKind != JsonValueKind.Object) return "";

                foreach (var prop in element.EnumerateObject())
                    if (prop.Name.Equals("message", StringComparison.OrdinalIgnoreCase)
                        && prop.Value.ValueKind == JsonValueKind.String)
                        return prop.Value.GetString() ?? "";
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, "[审计解析失败原因失败]");
            }

            return "";
        }

        /// <summary>
        /// 请求体由 AuditBodyBufferMiddleware 缓冲过，读完复位，控制器照旧能读到原文；
        /// 没缓冲过的（比如不是 /api 前缀）直接跳过，审计少个摘要总比把接口弄坏强。
        /// </summary>
        private async Task<string> ReadBodyAsync(HttpRequest request)
        {
            if (!request.Body.CanSeek) return "";

            try
            {
                request.Body.Position = 0;
                using var reader = new StreamReader(request.Body, leaveOpen: true);
                var text = await reader.ReadToEndAsync();
                request.Body.Position = 0;
                return text.Length > MaxBodyChars ? "" : text;
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, "[审计读取请求体失败]");
                return "";
            }
        }

        /// <summary>Username 单拎一列：登录失败时它是唯一能填进操作者列的东西。</summary>
        record Args(string Cluster, string Namespace, string Resource, string Detail, string Username);

        private static Args Parse(string body, IQueryCollection query)
        {
            var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            void Put(string key, string? value)
            {
                if (!string.IsNullOrWhiteSpace(value) && !fields.ContainsKey(key)) fields[key] = value;
            }

            if (!string.IsNullOrWhiteSpace(body))
            {
                try
                {
                    using var doc = JsonDocument.Parse(body);
                    if (doc.RootElement.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var prop in doc.RootElement.EnumerateObject())
                        {
                            // 只收标量，嵌套的资源对象不进摘要
                            var text = prop.Value.ValueKind switch
                            {
                                JsonValueKind.String => prop.Value.GetString(),
                                JsonValueKind.Number => prop.Value.GetRawText(),
                                JsonValueKind.True => "true",
                                JsonValueKind.False => "false",
                                _ => null,
                            };
                            Put(prop.Name, text);
                        }
                    }
                }
                catch (JsonException)
                {
                    // 不是 JSON 的提交内容（YAML 之类）就没法拆字段，剩下的列照记
                }
            }

            // 有些接口把参数挂在 query 上，正文里没有就退回 query
            foreach (var (key, value) in query) Put(key, value.ToString());

            var detail = string.Join(" ", DetailKeys
                .Where(fields.ContainsKey)
                .Select(key => $"{key}={fields[key]}"));
            var resource = ResourceKeys
                .Select(key => fields.GetValueOrDefault(key) ?? "")
                .FirstOrDefault(value => value.Length > 0) ?? "";
            return new Args(fields.GetValueOrDefault("ClustName") ?? "", fields.GetValueOrDefault("Namespace") ?? "",
                resource, detail, fields.GetValueOrDefault("Username") ?? "");
        }
    }

    /// <summary>
    /// 给 /api 下的写请求打开可回放的请求体流：审计要先看一遍正文，控制器后面还得再读一遍。
    /// 只给非 GET 开，读接口不碰正文，没必要多一份缓冲。
    /// </summary>
    public class AuditBodyBufferMiddleware(RequestDelegate next)
    {
        public async Task Invoke(HttpContext http)
        {
            var request = http.Request;
            if (request.Path.StartsWithSegments("/api") && !HttpMethods.IsGet(request.Method)
                && !HttpMethods.IsHead(request.Method) && !HttpMethods.IsOptions(request.Method))
            {
                request.EnableBuffering();
            }

            await next(http);
        }
    }
}
