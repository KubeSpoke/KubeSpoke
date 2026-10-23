using System.Collections.Concurrent;
using System.Security.Claims;
using KubeSpoke.Server.Data;
using KubeSpoke.Server.Extensions;
using KubeSpoke.Server.Filters;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KubeSpoke.Server.Controllers
{
    public class LoginRequest
    {
        public string? Username { get; set; }
        public string? Password { get; set; }
    }

    public class ChangePasswordRequest
    {
        public string? OldPassword { get; set; }
        public string? NewPassword { get; set; }
    }

    public class CreateUserRequest
    {
        public string? Username { get; set; }
        public string? Password { get; set; }
        public string? Role { get; set; }
    }

    public class InitRequest
    {
        public string? Password { get; set; }
    }

    [Route("api/auth")]
    [ServiceFilter(typeof(AuditFilter))]
    public class AuthController(UserRepository users) : ControllerBase
    {
        /// <summary>
        /// 是否已有账号。前端据此决定进登录页还是初始化页，未初始化时登录页本身没有意义。
        /// </summary>
        [HttpGet("status")]
        public async Task<IActionResult> Status() =>
            Ok(new { initialized = await users.HasAnyUserAsync() });

        /// <summary>
        /// 首次安装：由第一位访问者给管理员账号设口令，成功后直接带上会话 cookie。
        /// 账号名固定 admin，已初始化后再调用一律 409。
        /// </summary>
        [HttpPost("init")]
        public async Task<IActionResult> Init([FromBody] InitRequest request)
        {
            if (await users.HasAnyUserAsync())
                return Conflict(new { message = "系统已初始化，请直接登录" });

            var password = request.Password ?? "";
            if (password.Length < 6)
                return BadRequest(new { message = "密码至少 6 位" });

            if (!await users.CreateAdminAsync(UserAuthExtensions.AdminUsername, password))
                return BadRequest(new { message = "密码不符合要求" });

            await SignInAsync(UserAuthExtensions.AdminUsername, "admin");
            return Ok(new { username = UserAuthExtensions.AdminUsername, role = "admin", mustChangePassword = false });
        }

        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] LoginRequest request)
        {
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "";

            // 连着错到阈值就先进锁，不查库也不验口令：爆破每一轮的成本降到一次字典查找
            if (LoginFailureTracker.TryGetLockout(request.Username, ip, out var minutesLeft))
            {
                Response.Headers["Retry-After"] = (minutesLeft * 60).ToString();
                return Unauthorized(new { message = $"失败次数过多，请 {minutesLeft} 分钟后再试" });
            }

            var user = await users.ValidateAsync(request.Username, request.Password);
            if (user is null)
            {
                LoginFailureTracker.RegisterFailure(request.Username, ip);
                return Unauthorized(new { message = "用户名或密码错误" });
            }

            LoginFailureTracker.Reset(user.Username, ip);
            await SignInAsync(user.Username, user.Role);

            return Ok(new { username = user.Username, role = user.Role, mustChangePassword = user.MustChangePassword });
        }

        private Task SignInAsync(string username, string role) =>
            HttpContext.SignInAsync(
                UserAuthExtensions.ConsoleScheme,
                new ClaimsPrincipal(new ClaimsIdentity([
                    new Claim(ClaimTypes.Name, username),
                    new Claim(ClaimTypes.Role, role),
                ], UserAuthExtensions.ConsoleScheme, ClaimTypes.Name, ClaimTypes.Role)),
                new AuthenticationProperties { IsPersistent = false });

        [HttpPost("logout")]
        public async Task<IActionResult> Logout()
        {
            await HttpContext.SignOutAsync(UserAuthExtensions.ConsoleScheme);
            return Ok(new { });
        }

        [Authorize]
        [HttpGet("me")]
        public async Task<IActionResult> Me() =>
            // 标志要现查：会话可能是改密前种的，刷新页面也得被拦回改密页
            Ok(new
            {
                username = User.Identity?.Name,
                role = User.FindFirstValue(ClaimTypes.Role),
                mustChangePassword = await users.IsMustChangePasswordAsync(User.Identity?.Name ?? ""),
            });

        [Authorize]
        [HttpPost("password")]
        public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request)
        {
            var username = User.Identity?.Name ?? "";
            if (!await users.ChangePasswordAsync(username, request.OldPassword ?? "", request.NewPassword ?? ""))
                return BadRequest(new { message = "原密码不正确或新密码为空" });

            await HttpContext.SignOutAsync(UserAuthExtensions.ConsoleScheme);
            return Ok(new { });
        }

        [Authorize(Roles = "admin")]
        [HttpGet("users")]
        public async Task<IActionResult> ListUsers() => Ok(await users.ListUsernamesAsync());

        [Authorize(Roles = "admin")]
        [HttpPost("users")]
        public async Task<IActionResult> CreateUser([FromBody] CreateUserRequest request)
        {
            var role = request.Role == "admin" ? "admin" : "user";
            if (!await users.AddAsync(request.Username ?? "", request.Password ?? "", role))
                return BadRequest(new { message = "用户名不合法、已存在或密码为空" });
            return Ok(new { username = request.Username, role });
        }

        [Authorize(Roles = "admin")]
        [HttpDelete("users/{username}")]
        public async Task<IActionResult> RemoveUser(string username)
        {
            if (username == User.Identity?.Name)
                return BadRequest(new { message = "不能删除当前登录账号" });
            if (!await users.RemoveAsync(username))
                return BadRequest(new { message = "账号不存在或管理员不可删除" });
            return Ok(new { });
        }
    }

    /// <summary>
    /// 登录爆破的挡板：同一个「来源 IP + 账号」连续错到 <see cref="LoginFailureTracker.MaxFailures"/> 次，
    /// 就锁 <see cref="LoginFailureTracker.LockMinutes"/> 分钟，登录成功立刻清零。
    /// 键里带上 IP 是有意为之——不然任何人只要知道账号名就能把管理员整个锁在门外。
    /// 计数只活在当前进程里：重启即清零，多副本部署时各实例各算各的，本产品按单实例设计所以够用，
    /// 真要多副本再换成共享存储。
    /// </summary>
    internal static class LoginFailureTracker
    {
        /// <summary>连着错几次开始锁。</summary>
        internal const int MaxFailures = 5;

        /// <summary>锁多久（分钟）。</summary>
        internal const int LockMinutes = 15;

        /// <summary>一条计数：已错次数、锁定到期时刻、最后一次活动时刻（给清理用）。</summary>
        private record Entry(int Failures, DateTime BlockedUntilUtc, DateTime TouchedUtc);

        private static readonly ConcurrentDictionary<string, Entry> Attempts = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>字典条数上限：超了先顺手清掉过窗的键，防止拿随机账号名把内存撑爆。</summary>
        private const int AttemptsCap = 4096;

        private static string Key(string? username, string ip) => $"{ip}|{(username ?? "").Trim()}";

        /// <summary>现在是否处于锁定期，是就回剩余分钟数（向上取整，至少 1）。</summary>
        internal static bool TryGetLockout(string? username, string ip, out int minutesLeft)
        {
            minutesLeft = 0;
            var now = DateTime.UtcNow;
            if (!Attempts.TryGetValue(Key(username, ip), out var entry) || entry.Failures < MaxFailures) return false;

            // 锁定期过了就把账清掉，下一次错误重新开始计数
            if (entry.BlockedUntilUtc <= now)
            {
                Attempts.TryRemove(Key(username, ip), out _);
                return false;
            }

            minutesLeft = Math.Max(1, (int)Math.Ceiling((entry.BlockedUntilUtc - now).TotalMinutes));
            return true;
        }

        /// <summary>记一次失败；够阈值就把到期时刻定到现在 + LockMinutes。锁定期内的尝试进不到这里（控制器先挡）。</summary>
        internal static void RegisterFailure(string? username, string ip)
        {
            var now = DateTime.UtcNow;
            SweepExpired(now);

            var key = Key(username, ip);
            Attempts.AddOrUpdate(key,
                _ => new Entry(1, default, now),
                (_, old) =>
                {
                    var expired = old.Failures >= MaxFailures && old.BlockedUntilUtc <= now;
                    var failures = expired ? 1 : old.Failures + 1;
                    return new Entry(failures, failures >= MaxFailures ? now.AddMinutes(LockMinutes) : default, now);
                });
        }

        /// <summary>登录成功，这条线（同 IP 同账号）的账全清。</summary>
        internal static void Reset(string? username, string ip) => Attempts.TryRemove(Key(username, ip), out _);

        private static void SweepExpired(DateTime now)
        {
            if (Attempts.Count < AttemptsCap) return;

            var cutoff = now.AddMinutes(-LockMinutes);
            var expired = Attempts.Where(x => x.Value.TouchedUtc <= cutoff).Select(x => x.Key).ToList();
            foreach (var key in expired)
                Attempts.TryRemove(key, out _);
        }
    }
}
