using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace KubeSpoke.Agent.Models
{
    /// <summary>
    /// 提醒助手
    /// </summary>
    public interface IAlertor
    {
        public enum Level
        {
            /// <summary>
            /// 普通
            /// </summary>
            Noarmal = 1,

            /// <summary>
            /// 警告
            /// </summary>
            Warning = 2,

            /// <summary>
            /// 危险
            /// </summary>
            Danger = 3,
        }

        public void Alert(Level level, string title, string message);
    }
}
