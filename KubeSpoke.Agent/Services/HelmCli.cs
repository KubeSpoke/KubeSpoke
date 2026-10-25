using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace KubeSpoke.Agent.Services
{
    /// <summary>
    /// 以子进程方式调用 helm CLI。chart 的模板渲染、钩子与三方合并全归 helm 自己，
    /// 代理端只负责把 kubeconfig 凑齐、把参数拼对、把结果读回来。
    /// </summary>
    public class HelmCli
    {
        /// <summary>单路 helm 命令的兜底墙钟时限（秒）。--timeout 只管 helm 自己的等待阶段，
        /// 网络卡住或进程挂死时靠这条收口，绝不能让一路 RPC 把 agent 的连接占死。</summary>
        public const int HardLimitSec = 290;

        /// <summary>超出这个长度的输出只截断带回，helm 的失败原因都在最后几行。</summary>
        public const int MaxTextChars = 256 * 1024;

        private const string DefaultSaDir = "/var/run/secrets/kubernetes.io/serviceaccount";

        /// <summary>ServiceAccount 挂载目录。单测把它指到一个临时目录上，才能在没有集群的机器上验令牌这条路径。</summary>
        public string SaDirPath { get; set; } = DefaultSaDir;

        /// <summary>helm 可执行文件名。镜像里装在 PATH 上，单测用它顶替真实二进制。</summary>
        public string Binary { get; set; } = "helm";

        private readonly ILogger<HelmCli> logger;

        public HelmCli(ILogger<HelmCli> logger)
        {
            this.logger = logger;
        }

        /// <summary>
        /// 合成一份只活到本次命令结束的 kubeconfig，返回它的路径。
        /// <para>
        /// helm 只认 kubeconfig，不认 KubernetesClient SDK 那套进程内配置，所以集群身份要落成文件：
        /// 服务端取 in-cluster 的 env，证书与令牌直接读 ServiceAccount 挂载的目录。
        /// 令牌是绑定了过期时间的投影令牌，apiserver 会定期原地换掉这几个文件，
        /// 所以每次都重读、绝不缓存——缓存下来的那份过一会儿就是一条 401。
        /// </para>
        /// <para>
        /// 本机跑 agent 时没有这个挂载目录，此时返回 null：不写 KUBECONFIG，
        /// 让 helm 按自己的默认规则去找 ~/.kube/config，和 agent 本体用 ~/.kube/config 连集群是同一份身份。
        /// </para>
        /// </summary>
        public string? BuildKubeconfig()
        {
            var tokenPath = Path.Combine(SaDirPath, "token");
            var token = File.Exists(tokenPath) ? File.ReadAllText(tokenPath).Trim() : "";
            if (token.Length == 0)
            {
                logger?.LogDebug($"[helm] 没有 {tokenPath}，改用 helm 自己的默认 kubeconfig");
                return null;
            }

            var host = Environment.GetEnvironmentVariable("KUBERNETES_SERVICE_HOST");
            var port = Environment.GetEnvironmentVariable("KUBERNETES_SERVICE_PORT");
            if (string.IsNullOrEmpty(host)) host = "kubernetes.default.svc";
            if (string.IsNullOrEmpty(port)) port = "443";

            var sb = new StringBuilder();
            sb.Append("apiVersion: v1\nkind: Config\ncurrent-context: kubespoke\nclusters:\n- name: k\n  cluster:\n")
              .Append($"    server: https://{host}:{port}\n");

            var caPath = Path.Combine(SaDirPath, "ca.crt");
            if (File.Exists(caPath))
                sb.Append("    certificate-authority-data: ").Append(Convert.ToBase64String(File.ReadAllBytes(caPath))).Append('\n');
            else
                sb.Append("    insecure-skip-tls-verify: true\n");

            sb.Append("contexts:\n- name: kubespoke\n  context:\n    cluster: k\n    user: kubespoke\nusers:\n- name: kubespoke\n  user:\n")
              .Append("    token: ").Append(token).Append('\n');

            var path = Path.Combine(Path.GetTempPath(), $"kubespoke-helm-{Guid.NewGuid():N}.kubeconfig");
            File.WriteAllText(path, sb.ToString());
            return path;
        }

        /// <summary>用完即删：这份文件里是服务账户令牌。</summary>
        public void RemoveKubeconfig(string? path)
        {
            if (string.IsNullOrEmpty(path)) return;
            try
            {
                File.Delete(path);
            }
            catch (Exception ex)
            {
                // 临时文件删不掉不该让这次操作失败，但也不能静默——它带着令牌
                logger?.LogWarning($"[helm] 临时 kubeconfig {path} 没删掉：{ex.Message}");
            }
        }

        public record HelmOutput(int ExitCode, string StdOut, string StdErr);

        /// <summary>
        /// 跑一条 helm 命令。参数逐条进 argv，不过 shell，路径与 values 里的引号都不需要转义；
        /// 口令只作为这条子进程自己的 argv 传进去，不落盘、不进日志（日志只记命令名）。
        /// values 走 stdin 而不是 argv 或临时文件：helm 认 -f -，一个字节的中间文件都不用留。
        /// </summary>
        public async Task<HelmOutput> RunAsync(string? kubeconfig, IEnumerable<string> args, string? stdin = null, CancellationToken cancel = default)
        {
            var argList = args.ToList();
            var psi = new ProcessStartInfo(Binary)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = stdin != null,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            if (stdin != null)
            {
                // 显式无 BOM：values 里带中文注释时，BOM 会让 helm 报第一行 YAML 解析失败
                psi.StandardInputEncoding = new UTF8Encoding(false);
            }
            foreach (var a in argList) psi.ArgumentList.Add(a);

            // 不写 KUBECONFIG 的话，容器里 helm 会退回 $HOME/.kube/config——那是不存在的文件
            if (!string.IsNullOrEmpty(kubeconfig)) psi.Environment["KUBECONFIG"] = kubeconfig;
            // helm 把 stdout 当数据、stderr 当进度，不让它上色才能保证带回来的 YAML 能直接解析
            psi.Environment["HELM_NO_COLOR"] = "true";

            using var process = new Process { StartInfo = psi };
            var stdout = new StringBuilder();
            var stderr = new StringBuilder();
            process.OutputDataReceived += (_, e) => { if (e.Data != null) AppendCapped(stdout, e.Data); };
            process.ErrorDataReceived += (_, e) => { if (e.Data != null) AppendCapped(stderr, e.Data); };

            try
            {
                process.Start();
            }
            catch (Exception ex)
            {
                // 老镜像里没有 helm 时这里是 Win32Exception，归成一句人话，
                // 别让界面显示 "An error occurred during the previous operation"
                throw new HelmMissingException($"集群里跑不起来 {Binary}：{ex.Message}", ex);
            }

            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            if (stdin != null)
            {
                try
                {
                    // 必须在等待退出之前写完并关掉：helm 读不到 EOF 就不会结束，
                    // 而输出读空了却没人写，两边都等对方，进程就在这儿僵住
                    await process.StandardInput.WriteAsync(stdin).ConfigureAwait(false);
                    process.StandardInput.Close();
                }
                catch (IOException ex)
                {
                    // helm 已经因为参数不对提前退了，管道断了不算失败，真正的成因在 stderr 里，照常带回
                    logger?.LogDebug($"[helm] stdin 写入中断：{ex.Message}");
                }
            }

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancel);
            cts.CancelAfter(TimeSpan.FromSeconds(HardLimitSec));
            var verb = argList.FirstOrDefault(a => !a.StartsWith("-")) ?? "";
            try
            {
                await process.WaitForExitAsync(cts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                TryKill(process);
                throw new TimeoutException($"helm {verb} 超过 {HardLimitSec}s 没有退出，已终止进程");
            }

            logger?.LogDebug($"[helm] {verb} → exit {process.ExitCode}");
            return new HelmOutput(process.ExitCode, stdout.ToString(), stderr.ToString());
        }

        /// <summary>跑一条期望成功的 helm 命令，失败就把 stderr 尾部的原因原样抛给调用方。</summary>
        public async Task<string> RunEnsureSuccess(string? kubeconfig, IEnumerable<string> args)
        {
            var res = await RunAsync(kubeconfig, args).ConfigureAwait(false);
            if (res.ExitCode != 0)
                throw new InvalidOperationException(Tail(res.StdErr.Length > 0 ? res.StdErr : res.StdOut));
            return res.StdOut;
        }

        /// <summary>失败信息就在最后几行，前面全是 helm 的用法回显。</summary>
        public static string Tail(string text, int lines = 12)
        {
            if (string.IsNullOrEmpty(text)) return "";
            var arr = text.Replace("\r\n", "\n").TrimEnd().Split('\n');
            return string.Join("\n", arr.Length <= lines ? arr : arr[(arr.Length - lines)..]);
        }

        private static void AppendCapped(StringBuilder sb, string line)
        {
            if (sb.Length > MaxTextChars) return;
            sb.Append(line).Append('\n');
        }

        private static void TryKill(Process process)
        {
            try
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
            }
            catch
            {
                // 进程刚好自己退了，杀掉失败没什么可处理的
            }
        }
    }

    /// <summary>helm 可执行文件缺失（老镜像）——界面要能把它和「装应用失败」区分开。</summary>
    public class HelmMissingException : Exception
    {
        public HelmMissingException(string message, Exception inner) : base(message, inner)
        {
        }
    }
}
