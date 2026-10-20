using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Models
{
    public class Secret
    {
        public string Name { get; set; }

        public string Namespace { get; set; }

        public DateTime? CreationTime { get; set; }
        public string Type { get; set; }
        public IDictionary<string, byte[]> Data { get; set; }
    }
}
