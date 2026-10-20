using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Models
{
    public class Response
    {
        public string kind { get; set; }

        public string apiVersion { get; set; }
     
        public string status { get; set; }

        public string message { get; set; }

        public string reason { get; set; }

        public int code { get; set; }
    }
}
