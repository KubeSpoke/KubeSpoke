using Microsoft.EntityFrameworkCore;

namespace KubeSpoke.Server.Data
{
    public class UserEntity
    {
        public int Id { get; set; }
        public string Username { get; set; } = "";
        public string Salt { get; set; } = "";
        public string Hash { get; set; } = "";
        public int Iterations { get; set; } = 100_000;
        public string Role { get; set; } = "user";

        /// <summary>
        /// 口令是别人（管理员）代设的，本人登录必须先改密，改完置回 false。
        /// </summary>
        public bool MustChangePassword { get; set; }
    }

    public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
    {
        public DbSet<UserEntity> Users => Set<UserEntity>();

        protected override void OnModelCreating(ModelBuilder builder)
        {
            builder.Entity<UserEntity>().HasIndex(u => u.Username).IsUnique();
        }
    }
}
