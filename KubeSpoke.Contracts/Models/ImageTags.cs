using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Models
{
    /// <summary>
    /// 镜像仓库里某个仓库路径的 tag 清单。走的是通用 registry v2 接口，
    /// 阿里云 ACR（个人版与企业版）、Harbor、Docker Hub 都是同一套。
    /// </summary>
    public class ImageTags
    {
        /// <summary>仓库地址。docker.io 会还原成实际收请求的 registry-1.docker.io</summary>
        public string Registry { get; set; } = "";

        /// <summary>仓库路径，不含地址与 tag，如 ns/app</summary>
        public string Repository { get; set; } = "";

        /// <summary>按版本号倒序的 tag；latest 这类浮动 tag 沉到最后</summary>
        public List<string> Tags { get; set; } = new List<string>();

        /// <summary>凭证来源：anonymous，或 secret:命名空间/名称</summary>
        public string Credential { get; set; } = "anonymous";

        /// <summary>拉不到 / 只列了前 N 个 / 用了哪个凭证的说明，正常时为空串</summary>
        public string Notice { get; set; } = "";
    }
}
