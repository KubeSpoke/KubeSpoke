# KubeSpoke

> **一处部署，处处纳管 —— 部署在任何位置，管理任何位置的 K8s 集群。**

KubeSpoke 是一套轻量的 Kubernetes 多集群管理控制台。管理端（Server）可以落在云主机、内网服务器甚至家里的一台小机器上；被管理的集群只需在集群内部署一个 Agent，由 Agent **主动向外**连接 Server。全程不需要对集群开放任何入站端口，NAT、防火墙、专线隔离都不是问题——这正是 "Spoke" 的含义：Server 是轮毂，每个集群是一根向外延伸的辐条。

## 特性

- **多集群管理**：一个控制台同时纳管多个集群，随时切换
- **一键安装清单**：Server 根据集群名直接生成 Agent 的 Kubernetes 安装 YAML，`kubectl apply` 即接入
- **资源总览与浏览**：节点、命名空间、工作负载、Service/Ingress、ConfigMap/Secret、PV/PVC/StorageClass、事件
- **实时 Pod 日志**：日志流式推送
- **容器终端**：网页里直接开 `kubectl exec` 的交互式 shell，随面板改变终端尺寸
- **Pod 资源指标**：CPU / 内存实时查看
- **常用运维操作**：替换镜像（可直接从镜像仓库的 tag 列表里挑版本）、调整副本数、创建/删除各类资源
- **Helm 应用**：注册 chart 仓库、浏览市场、安装前预览渲染结果，release 的升级/回滚/卸载与修订历史一目了然（helm 已内置在 Agent 镜像里）
- **告警中心**：每分钟采集各集群的节点未就绪、容器起不来、副本不足与 Warning 事件，自动去重、恢复、可确认；新告警与恢复可按集群 POST 到自定义 webhook，支持按时长静默，每次推送留投递回执
- **审计日志**：控制台里的写操作（含容器终端的开关）全部留痕，按集群与关键字检索
- **系统设置**：控制台自身的运行参数集中一页，目前可调等 Agent 回执的超时秒数，改完即生效不用重启
- **内置 Web 控制台**：Server 直接托管前端，开箱即用

## 快速开始

### 1. 启动 Server

```bash
docker run -d --name kubespoke-server -p 8080:80 \
  crpi-gr7j2r1czfy1t1uu.cn-hangzhou.personal.cr.aliyuncs.com/springhgui/kubespoke-server:0.5.3
```

也可以一行脚本部署到任意 Kubernetes 集群。脚本会先问暴露方式：NodePort（默认 30080），还是 nginx Ingress——选它就再问域名、要不要挂 TLS、证书走 cert-manager 自动签发还是已有 Secret，Service 自动变为 ClusterIP：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/KubeSpoke/KubeSpoke/master/deploy-server.sh)
```

不想被问（比如 `curl | bash` 管道里没有终端），直接给环境变量：`NAMESPACE`、`IMAGE`、`SERVICE_TYPE`、`NODE_PORT`、`INGRESS_HOST`、`INGRESS_CLASS`、`INGRESS_TLS`、`INGRESS_TLS_SECRET`、`CERT_MANAGER_ISSUER`、`HOST_PATH`。

控制台账号存在 SQLite（容器内 `/app/App_Data`），脚本默认挂 hostPath 到节点的 `/data/kubespoke`（`HOST_PATH` 可改），所以 pod 重建后口令还在；代价是这份数据跟着节点走，换节点即丢。

```bash
INGRESS_HOST=kubespoke.example.com INGRESS_TLS=true CERT_MANAGER_ISSUER=letsencrypt-prod \
  bash <(curl -fsSL https://raw.githubusercontent.com/KubeSpoke/KubeSpoke/master/deploy-server.sh)
```

### 2. 接入一个集群

向 Server 请求该集群的安装清单（自动生成本集群专属的 UUID 与回连地址）：

```bash
curl "http://<server-host>:8080/api/Agent/Install?name=demo-cluster" | kubectl apply -f -
```

清单内容为一个 Namespace + ServiceAccount + ClusterRole（集群管理权限）+ Agent Deployment，可先输出到文件检查后再 apply。

### 3. 打开控制台

浏览器访问 `http://<server-host>:8080/`，在集群选择器里即可看到刚接入的 `demo-cluster`。
