using System.Text.Json;
using KubeSpoke.Server.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace KubeSpoke.Server.Filters
{
    /// <summary>
    /// 控制台的写操作留痕：非 GET 请求执行完就落一条库，读接口不进。
    /// 参数只按白名单挑几个字段拼摘要，口令一类不可能被写进库里。
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
                var (success, message) = executed.Exception is { } ex
                    ? (false, BXExceptionFilter.Unwrap(ex).Message)
                    : (true, "");
                var args = Parse(body, request.Query);
                var controller = ControllerName(context);
                var action = controller == "Cluster"
                    // 集群类接口全走 api/Cluster/{method} 反射派发，动作名在路由里而不在方法名里
                    ? RouteValue(context, "method") ?? "Cluster"
                    : $"{controller}/{RouteValue(context, "action")}";

                await audits.RecordAsync(http.User?.Identity?.Name ?? "", action,
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

        record Args(string Cluster, string Namespace, string Resource, string Detail);

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
            return new Args(fields.GetValueOrDefault("ClustName") ?? "", fields.GetValueOrDefault("Namespace") ?? "", resource, detail);
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
