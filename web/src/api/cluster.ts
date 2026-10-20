import { get, http, post } from './http'
import type {
  CanaryApp,
  ClusterAgent,
  Deployment,
  Ingress,
  Namespace,
  Secret,
  Service,
} from '../types/dto'
import type {
  Metrics,
  V1ConfigMap,
  V1Deployment,
  V1Event,
  V1Ingress,
  V1IngressClass,
  V1Node,
  V1PersistentVolume,
  V1PersistentVolumeClaim,
  V1Pod,
  V1ReplicaSet,
  V1Scale,
  V1Secret,
  V1StorageClass,
} from '../types/k8s'
import type {
  CreateConfigMapPayload,
  CreateDeploymentPayload,
  CreateDockerSecretPayload,
  CreateIngressPayload,
  CreatePvcPayload,
  CreateServicePayload,
  CreateTlsSecretPayload,
} from '../types/create'

/**
 * `/api/Cluster/{method}` 由反射分发到 IAgentApis，query 会被原样序列化成 JSON 再反序列化，
 * System.Text.Json 默认大小写敏感，所以参数 key 必须保持 C# 属性名（PascalCase）。
 */
const invoke = <T>(method: string, params: Record<string, unknown>) => {
  // 没选中集群时别把空 ClustName 打到服务端，那只会换回一条全局异常
  if (!params.ClustName) return Promise.reject(new Error('未选择集群'))
  return get<T>(`/Cluster/${method}`, params)
}

/** 省略 Namespace 时服务端多数 DTO 会回落成 "default" */
const scoped = (cluster: string, namespace?: string) => ({
  ClustName: cluster,
  ...(namespace ? { Namespace: namespace } : {}),
})

/** 创建类接口参数里有嵌套对象，GET 的 query 打不出来，一律走 POST body */
const create = <T>(method: string, payload: unknown) => {
  if (!((payload as { ClustName?: string }).ClustName)) return Promise.reject(new Error('未选择集群'))
  return post<T>(`/Cluster/${method}`, payload)
}

export const agentApi = {
  online: () => get<ClusterAgent[]>('/Agent/OnlineAgent'),
  /** 生成 agent 部署清单（YAML）；uuid 留空由服务端生成 */
  installUrl: (name: string, uuid?: string, dealerId?: string) => {
    const query = new URLSearchParams({ name })
    if (uuid) query.set('uuid', uuid)
    if (dealerId) query.set('dealerId', dealerId)
    return `/api/Agent/Install?${query.toString()}`
  },
}

export const clusterApi = {
  nodes: (c: string) => invoke<V1Node[]>('GetNodes', { ClustName: c }),
  nodeMetrics: (c: string) => invoke<Metrics[]>('GetNodesMetrics', { ClustName: c }),
  podMetrics: (c: string) => invoke<Metrics[]>('GetPodsMetrics', { ClustName: c }),

  namespaces: (c: string) => invoke<Namespace[]>('GetNamespaces', { ClustName: c }),
  createNamespace: (c: string, name: string) => post('/Cluster/CreateNamespace', { ClustName: c, Name: name }),
  deleteNamespace: (c: string, name: string) =>
    invoke<boolean>('DeleteNamespace', { ClustName: c, Name: name }),

  pods: (c: string, namespace?: string) => invoke<V1Pod[]>('GetPods', scoped(c, namespace)),
  deletePod: (c: string, namespace: string, podName: string) =>
    invoke<V1Pod>('DeletePod', { ClustName: c, Namespace: namespace, PodName: podName }),

  deployments: (c: string, namespace?: string) =>
    get<Deployment[]>('/Cluster/GetDeployments', scoped(c, namespace)),
  createDeployment: (payload: CreateDeploymentPayload) => create<Deployment>('CreateDeployment', payload),
  deleteDeployment: (c: string, namespace: string, name: string) =>
    http
      .delete<boolean>('/Cluster/DeleteDeployment', {
        params: { ClustName: c, Namespace: namespace, Name: name },
      })
      .then((r) => r.data),
  replaceImage: (c: string, payload: { Name: string; Namespace: string; Image: string }) =>
    invoke<V1Deployment>('ReplaceImage', { ClustName: c, ...payload }),
  replicaScale: (c: string, namespace: string, name: string) =>
    invoke<V1Scale>('GetReplicaSetScale', { ClustName: c, Namespace: namespace, Name: name }),
  replicaSets: (c: string, namespace?: string) =>
    invoke<V1ReplicaSet[]>('ListReplicaSet', scoped(c, namespace)),

  services: (c: string, namespace?: string) => get<Service[]>('/Cluster/GetServices', scoped(c, namespace)),
  createService: (payload: CreateServicePayload) => create<Service>('CreateService', payload),
  deleteService: (c: string, namespace: string, name: string) =>
    invoke<boolean>('DeleteService', { ClustName: c, Namespace: namespace, Name: name }),

  ingress: (c: string, namespace?: string) => get<Ingress[]>('/Cluster/GetIngressList', scoped(c, namespace)),
  createIngress: (payload: CreateIngressPayload) => create<V1Ingress>('CreateIngress', payload),
  ingressClasses: (c: string) => invoke<V1IngressClass[]>('GetIngressClassList', { ClustName: c }),
  deleteIngress: (c: string, namespace: string, name: string) =>
    post('/Cluster/DeleteIngress', { ClustName: c, Namespace: namespace, Name: name }),

  secrets: (c: string, namespace?: string) => get<Secret[]>('/Cluster/GetSecrets', scoped(c, namespace)),
  createDockerRegistrySecret: (payload: CreateDockerSecretPayload) =>
    create<Secret>('CreateDockerRegistrySecret', payload),
  createTlsSecret: (payload: CreateTlsSecretPayload) => create<V1Secret>('CreateTlsSecret', payload),
  deleteSecret: (c: string, namespace: string, name: string) =>
    post('/Cluster/DeleteSecret', { ClustName: c, Namespace: namespace, Name: name }),

  configMaps: (c: string, namespace?: string) => invoke<V1ConfigMap[]>('GetConfigMaps', scoped(c, namespace)),
  createConfigMap: (payload: CreateConfigMapPayload) => create<V1ConfigMap>('CreateConfigMap', payload),
  configMap: (c: string, namespace: string, name: string) =>
    invoke<V1ConfigMap>('GetConfigMap', { ClustName: c, Namespace: namespace, Name: name }),
  deleteConfigMap: (c: string, namespace: string, name: string) =>
    invoke<boolean>('DeleteConfigMap', { ClustName: c, Namespace: namespace, Name: name }),

  pvcs: (c: string, namespace?: string) =>
    invoke<V1PersistentVolumeClaim[]>('GetPersistentVolumeClaimList', scoped(c, namespace)),
  createPersistentVolumeClaim: (payload: CreatePvcPayload) =>
    create<V1PersistentVolumeClaim>('CreatePersistentVolumeClaim', payload),
  pvs: (c: string) => invoke<V1PersistentVolume[]>('GetPersistentVolumeList', { ClustName: c }),
  storageClasses: (c: string) => invoke<V1StorageClass[]>('GetStorageClassList', { ClustName: c }),

  events: (c: string, namespace?: string) => invoke<V1Event[]>('GetEvents', scoped(c, namespace)),

  canary: (c: string, namespace: string, name: string) =>
    invoke<CanaryApp>('GetCanaryApp', { ClustName: c, Namespace: namespace, Name: name }),
  createCanary: (c: string, payload: { Name: string; Namespace: string; Image: string; Weight: number }) =>
    invoke<CanaryApp>('CreateCanaryApp', { ClustName: c, ...payload }),
  changeWeight: (c: string, namespace: string, name: string, weight: number) =>
    invoke<boolean>('ChangeCanaryWeight', {
      ClustName: c,
      Namespace: namespace,
      Name: name,
      Weight: weight,
    }),
  removeCanary: (c: string, namespace: string, name: string) =>
    invoke<boolean>('RemoveCanaryApp', {
      ClustName: c,
      Namespace: namespace,
      Name: name,
      NoAlert: true,
    }),

  /** Pod 实时日志走 SignalR：/pod-log?clusterId=&podName=&Namespace= 服务端推送 "LogWrite" */
  logHubUrl: (c: string, namespace: string, podName: string) => {
    const query = new URLSearchParams({ clusterId: c, podName, Namespace: namespace })
    return `/pod-log?${query}`
  },
}

/** 容器日志（一次性拉取，服务端以 text/plain 流式返回） */
export const containerLogsUrl = (c: string, id: string) =>
  `/api/Cluster/GetContainerLogs?ClustName=${encodeURIComponent(c)}&Id=${encodeURIComponent(id)}`
