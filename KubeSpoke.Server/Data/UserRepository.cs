using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;

namespace KubeSpoke.Server.Data
{
    /// <summary>
    /// 控制台账号仓储：EF Core + SQLite（App_Data/kubespoke.db）。
    /// 口令用 PBKDF2-SHA256 派生存储，不存明文。
    /// </summary>
    public class UserRepository(AppDbContext db)
    {
        private const int HashSize = 32;

        public async Task<UserEntity?> ValidateAsync(string? username, string? password)
        {
            if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password)) return null;

            var user = await db.Users.FirstOrDefaultAsync(u => u.Username == username);
            if (user is null) return null;

            var hash = Derive(password, user.Salt, user.Iterations);
            return CryptographicOperations.FixedTimeEquals(hash, Convert.FromBase64String(user.Hash)) ? user : null;
        }

        public async Task<List<string>> ListUsernamesAsync() =>
            await db.Users.OrderBy(u => u.Id).Select(u => u.Username).ToListAsync();

        public async Task<bool> AddAsync(string username, string password, string role)
        {
            if (!IsNameValid(username) || string.IsNullOrEmpty(password)) return false;
            if (await db.Users.AnyAsync(u => u.Username == username)) return false;

            db.Users.Add(Create(username, password, role, mustChangePassword: true));
            await db.SaveChangesAsync();
            return true;
        }

        public async Task<bool> RemoveAsync(string username)
        {
            // 管理员账号不允许删除
            var removed = await db.Users.Where(u => u.Username == username && u.Role != "admin")
                .ExecuteDeleteAsync();
            return removed > 0;
        }

        public async Task<bool> ChangePasswordAsync(string username, string oldPassword, string newPassword)
        {
            var user = await ValidateAsync(username, oldPassword);
            if (user is null || string.IsNullOrEmpty(newPassword)) return false;

            var updated = Create(username, newPassword, user.Role, mustChangePassword: false);
            user.Salt = updated.Salt;
            user.Hash = updated.Hash;
            user.Iterations = updated.Iterations;
            user.MustChangePassword = false;
            await db.SaveChangesAsync();
            return true;
        }

        public async Task<bool> IsMustChangePasswordAsync(string username) =>
            await db.Users.AnyAsync(u => u.Username == username && u.MustChangePassword);

        public async Task<bool> HasAnyUserAsync() => await db.Users.AnyAsync();

        /// <summary>
        /// 初始化：库内还没有任何账号时创建管理员，口令由设置者本人给出，因此不挂强制改密标记。
        /// 已初始化（有账号）时返回 false，调用方据此拒绝重复初始化。
        /// </summary>
        public async Task<bool> CreateAdminAsync(string username, string password)
        {
            if (!IsNameValid(username) || string.IsNullOrEmpty(password)) return false;
            if (await db.Users.AnyAsync()) return false;

            db.Users.Add(Create(username, password, "admin", mustChangePassword: false));
            await db.SaveChangesAsync();
            return true;
        }

        private static bool IsNameValid(string? username) =>
            username is { Length: >= 2 and <= 32 } && username.All(c => char.IsLetterOrDigit(c) || c is '.' or '_' or '-');

        private static UserEntity Create(string username, string password, string role, bool mustChangePassword)
        {
            var salt = RandomNumberGenerator.GetBytes(16);
            return new UserEntity
            {
                Username = username,
                Salt = Convert.ToBase64String(salt),
                Hash = Convert.ToBase64String(Derive(password, Convert.ToBase64String(salt), 100_000)),
                Role = role,
                MustChangePassword = mustChangePassword,
            };
        }

        private static byte[] Derive(string password, string saltBase64, int iterations) =>
            Rfc2898DeriveBytes.Pbkdf2(password, Convert.FromBase64String(saltBase64), iterations, HashAlgorithmName.SHA256, HashSize);
    }
}
