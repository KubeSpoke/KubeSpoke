using KubeSpoke.Contracts.Dtos;
using KubeSpoke.Contracts.Extensions;
using KubeSpoke.Contracts.Models;
using k8s.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Channels;
using System.Threading.Tasks;
using System.Xml.Linq;
using Secret = KubeSpoke.Contracts.Models.Secret;

namespace KubeSpoke.Contracts
{
    /// <summary>
    /// 代理端接口
    /// 警告：接口的订单必须满足以下约束条件
    /// 1.接口不能重载
    /// 2.接口必须要且只能有一个参数，参数需继承<see cref="BaseRequest"/>
    /// 3.接口必须有返回值
    /// </summary>
    public interface IAgentApis
    {
        /// <summary>
        /// 获取Node信息
        /// </summary>
        /// <param name="clustUUID"></param>
        /// <returns></returns>
        public IEnumerable<V1Node> GetNodes(GetNodesRequest request);

        public IEnumerable<V1Pod> GetPods(GetPodsRequest request);

        /// <summary>
        /// 获取命名空间列表
        /// </summary>
        /// <param name="request"></param>
        /// <returns></returns>
        public IEnumerable<Namespace> GetNamespaces(GetNamespaceRequest request);

        /// <summary>
        /// 删除pod
        /// </summary>
        /// <param name="request"></param>
        /// <returns></returns>
        public V1Pod DeletePod(DeletePodRequest request);

        public bool DeleteNamespace(CreateNamespaceRequest request);

        public V1Deployment GetDeployment(GetDeploymentRequest request);

        /// <summary>
        /// 获取部署
        /// </summary>
        /// <param name="request"></param>
        /// <returns></returns>
        public IEnumerable<Deployment> GetDeployments(GetDeploymentsRequest request);

        /// <summary>
        /// 创建命名空间
        /// </summary>
        /// <param name="request"></param>
        /// <returns></returns>
        public Namespace CreateNamespace(CreateNamespaceRequest request);

        /// <summary>
        /// 删除部署
        /// </summary>
        /// <param name="request"></param>
        public bool DeleteDeployment(DeleteDeploymentRequest request);

        /// <summary>
        /// 创建部署
        /// </summary>
        /// <param name="request"></param>
        /// <returns></returns>
        public Deployment CreateDeployment(CreateDeploymentRequest request);

        /// <summary>
        /// 创建服务
        /// </summary>
        /// <param name="request"></param>
        /// <returns></returns>
        public Service CreateService(CreateServiceRequest request);

        /// <summary>
        /// 删除服务
        /// </summary>
        /// <param name="request"></param>
        /// <returns></returns>
        public bool DeleteService(DeleteServiceRequest request);

        public IEnumerable<Service> GetServices(GetServicesRequest request);

        public bool DeleteSecret(DeleteSecretRequest request);

        public Secret CreateSecret(CreateDockerSecretRequest request);

        public IEnumerable<Secret> GetSecrets(GetSecretsRequest request);

        public bool DeleteIngress(DeleteIngressRequest request);

        public V1Ingress CreateIngress(CreateIngressRequest request);

        public IEnumerable<Ingress> GetIngressList(GetIngressListRequest request);

        public Secret CreateDockerRegistrySecret(CreateDockerSecretRequest request);

        public IEnumerable<V1IngressClass> GetIngressClassList(GetIngressClassListRequest request);

        public V1IngressClass CreateIngressClass(CreateIngressClassRequest request);

        public bool DeleteIngressClass(DeleteIngressClassRequest request);

        public V1Secret CreateTlsSecret(CreateTlsSecretRequest request);

        public V1ConfigMap CreateConfigMap(CreateConfigMapRequest request);

        public V1ConfigMap GetConfigMap(GetConfigMapRequest request);

        public IEnumerable<V1ConfigMap> GetConfigMaps(GetConfigMapsRequest request);

        public bool DeleteConfigMap(DeleteConfigMapRequest request);

        public IList<V1PersistentVolumeClaim> GetPersistentVolumeClaimList(GetPersistentVolumeClaimListRequest request);

        public V1PersistentVolumeClaim CreatePersistentVolumeClaim(CreatePersistentVolumeClaimRequest request);

        public V1PersistentVolumeClaim DeletePersistentVolumeClaim(DeletePersistentVolumeClaimRequest request);

        public IEnumerable<V1PersistentVolume> GetPersistentVolumeList(GetPersistentVolumeListRequest request);

        public IEnumerable<V1StorageClass> GetStorageClassList(GetStorageClassListRequest request);

        public ChannelReader<string> ReadPodLog(ReadPodLogRequest request);

        /// <summary>
        /// 打开容器交互式终端。返回的是终端输出帧（每帧 base64，因为 JSON 通道装不了裸字节），
        /// 键盘输入不走这条 RPC，而是服务端直接往 agent 连接推 ExecInput 消息。
        /// </summary>
        public ChannelReader<string> StartPodExec(StartPodExecRequest request);

        // ---- 容器内文件浏览与传输 ----
        // 全部建在 exec 之上（和 kubectl cp 同一件事），所以容器里只要有 sh/ls/cat 就够了，
        // 不需要 sshfs、不需要挂载、不需要往集群里塞任何常驻组件。

        /// <summary>列一个目录。要在容器里跑一次 ls 并等它退出，所以窗口比默认 3s 放宽</summary>
        [MaxWaitSec(Sec = 15)]
        public PodFileListResult ListPodFiles(ListPodFilesRequest request);

        /// <summary>下载单个文件，返回文件字节帧（每帧 base64），服务端边解边写 HTTP 响应</summary>
        public ChannelReader<string> DownloadPodFile(DownloadPodFileRequest request);

        /// <summary>
        /// 开一路上传会话，返回的是这路的收尾通道：容器里的 cat 收到 EOF 退出（或失败）才会有帧流尽，
        /// 服务端据此判断字节是否全部写进了临时文件。字节本身由服务端推 ExecInput 灌进 stdin。
        /// </summary>
        public ChannelReader<string> StartPodUpload(StartPodUploadRequest request);

        /// <summary>把写完成的临时文件挪到目标路径。只有确认全部字节到位后服务端才会调它。</summary>
        [MaxWaitSec(Sec = 15)]
        public bool MovePodFile(MovePodFileRequest request);

        [MaxWaitSec(Sec = 15)]
        public bool MakePodDirectory(MakePodDirectoryRequest request);

        [MaxWaitSec(Sec = 15)]
        public bool RemovePodFiles(RemovePodFilesRequest request);

        public V1Deployment ReplaceImage(ReplaceImageRequest request);

        public V1Pod GetPodStatus(ReadPodLogRequest request);

        public IEnumerable<Corev1Event> GetEvents(GetEventsRequest request);

        public IEnumerable<NodeMetrics> GetNodesMetrics(GetPodsMetricsRequest request);

        public V1Scale GetReplicaSetScale(GetReplicaSetScaleRequest request);

        public V1ReplicaSet GetReplicaSet(GetReplicaSetScaleRequest request);

        public bool RemoveCanaryApp(RemoveCanaryAppRequest request);

        public IList<V1ReplicaSet> ListReplicaSet(ListReplicaSetRequest request);

        public CreateCanaryAppResponse CreateCanaryApp(CreateCanaryAppRequest request);

        public CreateCanaryAppResponse GetCanaryApp(RemoveCanaryAppRequest request);

        bool ChangeCanaryWeight(ChangeCanaryWeightRequest request);

        public IEnumerable<PodMetrics> GetPodsMetrics(GetPodsMetricsRequest request);

        // ---- 通用 K8s 资源（覆盖 KubeSphere 集群管理下 StatefulSet/DaemonSet/Job/CronJob/
        //      ServiceAccount/Role/ClusterRole/PV/StorageClass/CRD 及自定义资源）----

        /// <summary>列出某类资源；内置类型走类型化 API，未知类型走 CustomObjects</summary>
        public object ListResources(ListResourcesRequest request);

        /// <summary>读取单个资源（详情/资源摘要）</summary>
        public object ReadResource(DeleteResourceRequest request);

        /// <summary>删除单个资源</summary>
        public bool DeleteResource(DeleteResourceRequest request);

        /// <summary>以 YAML 创建或替换任意资源</summary>
        public bool ApplyResource(ApplyResourceRequest request);

        /// <summary>集群版本等基本信息（概览页）</summary>
        public object GetClusterInfo(ClusterInfoRequest request);

        /// <summary>查询某对象关联事件（保留 involvedObject），供详情页「事件」标签</summary>
        public IEnumerable<Corev1Event> GetResourceEvents(GetResourceEventsRequest request);

        /// <summary>
        /// 探测集群里值得告警的异常（节点 NotReady、容器一直起不来、副本不足、Warning 事件等）。
        /// 代理端只回归一化后的小对象，不回原始 k8s 资源，去重和落库由服务端自己做；
        /// 一次要扫节点/Pod/部署/事件四类列表，所以放宽到 15s
        /// </summary>
        /// <param name="request"></param>
        /// <returns></returns>
        [MaxWaitSec(Sec = 15)]
        public List<AlertSignal> GetAlertSignals(GetAlertSignalsRequest request);

        /// <summary>
        /// 在集群里拉起一个 fasttunnel-client Pod 建立内网穿透（连接外部 FastTunnel 服务端）。
        /// 配置以 FastTunnel__* 环境变量注入容器；返回建出来的 Pod，隧道落库由服务端负责。
        /// </summary>
        public V1Pod CreateFastTunnelClient(CreateFastTunnelClientRequest request);
    }
}
