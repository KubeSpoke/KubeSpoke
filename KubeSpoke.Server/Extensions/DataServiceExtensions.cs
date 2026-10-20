using KubeSpoke.Server.Data;
using Microsoft.EntityFrameworkCore;

namespace KubeSpoke.Server.Extensions
{
    public static class DataServiceExtensions
    {
        /// <summary>
        /// EF Core + SQLite，库文件落在 ContentRoot/App_Data/kubespoke.db（容器部署需挂载 App_Data 卷）。
        /// </summary>
        public static IServiceCollection AddKubeSpokeData(this IServiceCollection services, IWebHostEnvironment env)
        {
            var dir = Path.Combine(env.ContentRootPath, "App_Data");
            Directory.CreateDirectory(dir);

            services.AddDbContext<AppDbContext>(options =>
                options.UseSqlite($"Data Source={Path.Combine(dir, "kubespoke.db")}"));
            services.AddScoped<UserRepository>();
            return services;
        }

        /// <summary>
        /// 启动时应用迁移。不再自动建初始账号：库内为空时控制台会停在「初始化」页，
        /// 由第一位访问者自己设置管理员口令，避免默认口令在公网上被人先抢走。
        /// </summary>
        public static async Task MigrateDatabaseAsync(this IServiceProvider services, ILogger logger)
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.MigrateAsync();

            var users = scope.ServiceProvider.GetRequiredService<UserRepository>();
            if (!await users.HasAnyUserAsync())
                logger.LogWarning("库内还没有账号，打开控制台按提示设置管理员口令即可完成初始化");
        }
    }
}
