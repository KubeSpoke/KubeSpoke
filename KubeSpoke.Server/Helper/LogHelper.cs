using Serilog;
using SerilogLogger = Serilog.ILogger;

namespace KubeSpoke.Server.Helper
{
    /// <summary>
    /// 统一走 Serilog（Program.cs 的 UseSerilog 已配 Console sink 且 MinimumLevel.Debug），
    /// 不再直接写标准输出，否则这些行没有时间戳/级别前缀，和日志混在一起没法过滤。
    /// </summary>
    public class LogHelper
    {
        static SerilogLogger logger => Log.Logger.ForContext<LogHelper>();

        internal static void LogDebug(string v) => logger.Debug(Literal(v));

        internal static void LogError(string v) => logger.Error(Literal(v));

        internal static void LogWarn(string v) => logger.Warning(Literal(v));

        // 实测本机 JSON 载荷里的花括号不会被当占位符，但异常文本可能含 {method} 这类真占位符，一律转义成字面量
        static string Literal(string v) => v.Replace("{", "{{").Replace("}", "}}");
    }
}
