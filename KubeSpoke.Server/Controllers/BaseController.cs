using KubeSpoke.Server.Filters;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace KubeSpoke.Server.Controllers
{
    [ApiController]
    [ServiceFilter(typeof(BXExceptionFilter))]
    [ServiceFilter(typeof(AuditFilter))]
    [Route("api/[controller]/[action]")]
    public class BaseController : ControllerBase
    {
    }
}
