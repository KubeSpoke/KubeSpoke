using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Contracts.Models
{
    public class MaxWaitSecAttribute : Attribute
    {
        public int Sec { get; set; } = 5;
    }
}
