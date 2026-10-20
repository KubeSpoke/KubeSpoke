# KubeSpoke

> **一处部署，处处纳管 —— 部署在任何位置，管理任何位置的 K8s 集群。**

KubeSpoke 是一套轻量的 Kubernetes 多集群管理控制台。管理端（Server）可以落在云主机、内网服务器甚至家里的一台小机器上；被管理的集群只需在集群内部署一个 Agent，由 Agent **主动向外**连接 Server。全程不需要对集群开放任何入站端口，NAT、防火墙、专线隔离都不是问题——这正是 "Spoke" 的含义：Server 是轮毂，每个集群是一根向外延伸的辐条。

## 特性

- **多集群管理**：一个控制台同时纳管多个集群，随时切换
- **一键安装清单**：Server 根据集群名直接生成 Agent 的 Kubernetes 安装 YAML，`kubectl apply` 即接入
- **资源总览与浏览**：节点、命名空间、工作负载、Service/Ingress、ConfigMap/Secret、PV/PVC/StorageClass、事件
- **实时 Pod 日志**：日志流式推送
- **Pod 资源指标**：CPU / 内存实时查看
- **常用运维操作**：替换镜像、调整副本数、创建/删除各类资源
- **内置 Web 控制台**：Server 直接托管前端，开箱即用

## 快速开始

### 1. 启动 Server

```bash
docker run -d --name kubespoke-server -p 8080:80 \
  crpi-gr7j2r1czfy1t1uu.cn-hangzhou.personal.cr.aliyuncs.com/springhgui/kubespoke-server:latest
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
