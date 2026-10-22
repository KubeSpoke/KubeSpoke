using KubeSpoke.Server;
using KubeSpoke.Server.Extensions;
using KubeSpoke.Server.Filters;
using KubeSpoke.Server.Hubs;
using KubeSpoke.Server.Models;
using Microsoft.AspNetCore.SignalR;
using Serilog;
using Serilog.Events;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = true;
    options.MaximumParallelInvocationsPerClient = 100;
})
.AddHubOptions<ClusterAgentHub>(hubOptions =>
{
    hubOptions.MaximumReceiveMessageSize = null;
})
.AddHubOptions<LogHub>(hubOptions =>
{
    hubOptions.MaximumReceiveMessageSize = null;
})
//.AddStackExchangeRedis() // TODO：横向扩展
.AddJsonProtocol(options =>
{
    options.PayloadSerializerOptions.PropertyNamingPolicy = null;
});
// Add services to the container.


// Add services to the container.
builder.Services.AddSingleton<BXExceptionFilter>();
builder.Services.AddSingleton<GitlabEventHandler>();
builder.Services.AddSingleton<YunXiaoClient>();
// 告警采集：每分钟向每个在线集群要一次异常清单
builder.Services.AddHostedService<KubeSpoke.Server.Services.AlertCollector>();

builder.Services.AddControllers();
// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();

builder.Host.UseSerilog((context, services, loggerConfiguration) =>
{
    loggerConfiguration.ReadFrom.Configuration(context.Configuration)
      .MinimumLevel.Debug()
      .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
      .MinimumLevel.Override("Microsoft.Hosting.Lifetime", LogEventLevel.Information)
      .ReadFrom.Services(services)
      .Enrich.FromLogContext()
      .WriteTo.Console();
});

builder.Services.AddHttpClient();

builder.Services.AddAgentApis();

builder.Services.AddCors(options =>
{
    options.AddPolicy("cors1", builder =>
    {
        builder.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
    });
});

//认证
builder.Services.AddKubeSpokeData(builder.Environment);
builder.Services.AddUserAuthentication();
builder.Services.AddAuthentication().AddAgentAuthentication();

builder.WebHost.ConfigureKestrel(x =>
{
    x.ResponseHeaderEncodingSelector = (str) =>
    {
        return Encoding.UTF8;
    };

    x.RequestHeaderEncodingSelector = (str) =>
    {
        return Encoding.UTF8;
    };
});


builder.Services.AddControllers();
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

var app = builder.Build();

await app.Services.MigrateDatabaseAsync(app.Services.GetRequiredService<Microsoft.Extensions.Logging.ILoggerFactory>().CreateLogger("Bootstrap"));
Global.hubContext = app.Services.GetRequiredService<IHubContext<ClusterAgentHub>>();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("cors1");
app.UseHttpsRedirection();

// SPA 深链回落：MapFallbackToFile 的 catch-all 端点会抢在静态文件中间件之前命中，
// 这里改成把没有端点接住的 GET 路径直接改写成 index.html，/api 前缀继续返回 404
app.Use(async (httpContext, next) =>
{
    var path = httpContext.Request.Path;
    if (httpContext.GetEndpoint() is null && HttpMethods.IsGet(httpContext.Request.Method)
        && !path.StartsWithSegments("/api") && !Path.HasExtension(path))
        httpContext.Request.Path = "/index.html";

    await next();
});

// 配置静态文件中间件，允许访问 .yaml 文件
app.UseStaticFiles(new StaticFileOptions
{
    ServeUnknownFileTypes = true, // 允许服务未知文件类型
    OnPrepareResponse = ctx =>
    {
        if (ctx.File.Name.EndsWith(".yaml"))
        {
            ctx.Context.Response.Headers.ContentDisposition = "inline";
        }
    }
});

// 审计要回放写请求的正文，这行必须排在控制器之前
app.UseAuditBodyBuffer();
app.UseAuthentication();
app.UseAuthorization();
// 口令还是建号时那个值的账号，改密之前其他接口一律拦住
app.UseMustChangePasswordGuard();

app.MapControllers();
app.MapHub<ClusterAgentHub>("/cluster-agent", options =>
{
    // 表示服务器从客户端缓存的最大字节数。 如果客户端尝试发送比此限制更大的消息，则可能会关闭该连接。
    options.ApplicationMaxBufferSize = 0;
    // 表示服务器可以发送的最大字节数。 如果服务器尝试发送比此限制更大的消息（包括从中心方法返回的值），则将引发异常。
    options.TransportMaxBufferSize = 0;
});

app.MapHub<LogHub>("/pod-log", options =>
{
    options.ApplicationMaxBufferSize = 0;
    options.TransportMaxBufferSize = 0;
});

app.MapHub<ExecHub>("/pod-exec", options =>
{
    options.ApplicationMaxBufferSize = 0;
    options.TransportMaxBufferSize = 0;
});

app.Run();
