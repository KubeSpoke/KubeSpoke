using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Models
{
    public class DockerConfig
    {
        public Dictionary<string, RegistryAuth> auths { get; set; }

        public class RegistryAuth
        {
            public string username { get; set; }

            public string password { get; set; }

            public string auth => Convert.ToBase64String(Encoding.UTF8.GetBytes($"{username}:{password}"));
        }
    }
}
