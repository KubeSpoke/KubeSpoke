# BX DevOps 控制台（前端）

Vite 8 + React 19 + TypeScript + Ant Design 6 + Tailwind CSS 4，对接 `KubeSpoke.Server` 的集群管理接口。

## 开发

```bash
cd web
npm install
npm run dev          # http://localhost:5173
```

接口默认代理到 `http://localhost:5150`（即 `dotnet run --project KubeSpoke.Server --launch-profile http`）。
后端换地址时用环境变量覆盖：

```bash
VITE_API_TARGET=http://10.0.0.21:8080 npm run dev
```

`/api`、`/cluster-agent`、`/pod-log` 都会走代理，SignalR 的 WebSocket 也已打通。

## 构建

```bash
npm run build        # tsc -b && vite build，产物在 web/dist
npm run lint         # oxlint
```

## 与后端的约定

- 资源查询统一走 `GET /api/Cluster/{method}`，`{method}` 是 `KubeSpoke.Contracts.IAgentApis` 的方法名；
  query 会被服务端原样反序列化成 DTO，**参数名必须保持 C# 的 PascalCase**（`ClustName`、`Namespace`、`Name`）。
- `ClustName` 必填，取值来自 `GET /api/Agent/OnlineAgent` 返回的集群名。
- 业务异常不返回 4xx：`BXExceptionFilter` 固定 200 + `{ success: false, message }`，`src/api/http.ts` 里统一转成 `Error`。
- Pod 实时日志用 SignalR Hub `/pod-log?clusterId=&podName=&Namespace=`，服务端推送 `LogWrite` 事件。

## 目录

```
src/
  api/        # http.ts（axios + 错误约定）、cluster.ts（IAgentApis 映射）
  components/ # PageShell（页头 + 命名空间选择 + 错误提示）、StatusTag
  hooks/      # useResource：deps 变化即请求
  layouts/    # MainLayout：侧边导航 + 集群选择器
  pages/      # 总览 / 节点 / 工作负载 / 网络 / 配置与密钥 / 存储 / 灰度 / 事件 / 日志 / 集群接入
  store/      # useClusterStore：zustand，持久化当前集群与命名空间
  types/      # k8s.ts（V1Pod/V1Node…）、dto.ts（服务端自定义 DTO）
  utils/      # format.ts：Quantity、相对时间等换算
```
