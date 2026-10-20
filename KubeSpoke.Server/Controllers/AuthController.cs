using System.Security.Claims;
using KubeSpoke.Server.Data;
using KubeSpoke.Server.Extensions;
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
            var user = await users.ValidateAsync(request.Username, request.Password);
            if (user is null)
                return Unauthorized(new { message = "用户名或密码错误" });

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
}
