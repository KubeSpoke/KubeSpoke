using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using System.Reflection;

namespace KubeSpoke.Server.Filters
{
    public class BXExceptionFilter : IExceptionFilter
    {
        ILogger<BXExceptionFilter> logger;
        public BXExceptionFilter(ILogger<BXExceptionFilter> logger)
        {
            this.logger = logger;
        }

        public void OnException(ExceptionContext context)
        {
            logger.LogError(context.Exception, "[全局异常]");

            var ex = Unwrap(context.Exception);

            context.ExceptionHandled = true;
            context.HttpContext.Response.StatusCode = 200;

            context.Result = new JsonResult(new
            {
                success = false,
                message = ex.Message
            });

        }

        /// <summary>
        /// 反射调用套 TargetInvocationException，同步等异步套 AggregateException，
        /// 只剥一层会把 "One or more errors occurred." 原样抛给前端，真正的错因留在第二层里。
        /// </summary>
        internal static Exception Unwrap(Exception ex)
        {
            while (true)
            {
                switch (ex)
                {
                    case AggregateException agg:
                        var inner = agg.Flatten().InnerExceptions;
                        if (inner.Count == 1)
                        {
                            ex = inner[0];
                            continue;
                        }
                        return new Exception(string.Join("；", inner.Select(x => x.Message)));
                    case TargetInvocationException tie when tie.InnerException != null:
                        ex = tie.InnerException;
                        continue;
                    default:
                        return ex;
                }
            }
        }
    }
}
