using KubeSpoke.Server.Filters;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace KubeSpoke.Server.Controllers
{
    [ApiController]
    [ServiceFilter(typeof(BXExceptionFilter))]
    [Route("api/[controller]/[action]")]
    public class BaseController : ControllerBase
    {
    }
}
