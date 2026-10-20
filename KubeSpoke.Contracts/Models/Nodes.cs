using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Models
{
    public class Node
    {
        public string NodeName { get; set; }

        public IDictionary<string, string> Annotations { get; set; }

        public IDictionary<string, string> Labels { get; set; }

        public string Status { get; set; }
    }
}
