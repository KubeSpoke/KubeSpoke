import { get, post } from './http'
import type { ResourceDescriptor } from '../config/nav'
import type { V1Event } from '../types/k8s'

/** 通用 K8s 对象：字段宽松，详情页展示原始 YAML，列表页按描述符取少数字段 */
export interface K8sObject {
  apiVersion?: string
  kind?: string
  metadata?: {
    name?: string
    namespace?: string
    uid?: string
    creationTimestamp?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
    [k: string]: unknown
  }
  spec?: Record<string, unknown>
  status?: Record<string, unknown>
  items?: K8sObject[]
  [k: string]: unknown
}

/** `/api/Cluster/{method}` 反射到 IAgentApis，参数键必须 PascalCase */
export const resourceApi = {
  list: (cluster: string, d: ResourceDescriptor, namespace?: string) =>
    get<K8sObject | K8sObject[]>('/Cluster/ListResources', {
      ClustName: cluster,
      Group: d.group,
      Version: d.version,
      Plural: d.plural,
      ...(d.scope === 'Namespaced' && namespace ? { Namespace: namespace } : {}),
    }),

  read: (cluster: string, d: ResourceDescriptor, name: string, namespace?: string) =>
    get<K8sObject>('/Cluster/ReadResource', {
      ClustName: cluster,
      Group: d.group,
      Version: d.version,
      Plural: d.plural,
      Name: name,
      ...(d.scope === 'Namespaced' && namespace ? { Namespace: namespace } : {}),
    }),

  remove: (cluster: string, d: ResourceDescriptor, name: string, namespace?: string) =>
    post<boolean>('/Cluster/DeleteResource', {
      ClustName: cluster,
      Group: d.group,
      Version: d.version,
      Plural: d.plural,
      Name: name,
      ...(d.scope === 'Namespaced' && namespace ? { Namespace: namespace } : {}),
    }),

  /** 以 YAML 创建或替换任意资源（KubeSphere 的「编辑 YAML / 使用模板创建」） */
  applyYaml: (cluster: string, yaml: string) =>
    post<K8sObject | boolean>('/Cluster/ApplyResource', { ClustName: cluster, Yaml: yaml }),

  /** 某对象的关联事件（保留 involvedObject）。Node 事件传 kind=Node、namespace 留空。 */
  events: (cluster: string, kind: string, name: string, namespace?: string) =>
    get<V1Event[]>('/Cluster/GetResourceEvents', {
      ClustName: cluster,
      Kind: kind,
      Name: name,
      ...(namespace ? { Namespace: namespace } : {}),
    }),
}

/** 列表响应统一成数组：后端可能返回 {items:[...]} 或直接 [...] */
export function toItems(res: K8sObject | K8sObject[] | undefined): K8sObject[] {
  if (!res) return []
  if (Array.isArray(res)) return res
  if (Array.isArray(res.items)) return res.items
  return []
}

function truthyCondition(status: Record<string, unknown> | undefined, types: string[]): boolean {
  const conditions = (status?.conditions ?? []) as { type?: string; status?: string; reason?: string }[]
  return conditions.some((c) => types.includes(c.type ?? '') && c.status === 'True')
}

/** 依据描述符派生资源状态文案 + 语义色，复刻 KubeSphere 状态点 */
export function deriveStatus(d: ResourceDescriptor, o: K8sObject): { text: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } {
  const status = o.status as Record<string, unknown> | undefined
  switch (d.statusKind) {
    case 'phase': {
      const phase = (status?.phase as string) || 'Unknown'
      const tone = phase === 'Bound' || phase === 'Active' ? 'ok' : phase === 'Pending' ? 'warn' : phase === 'Failed' || phase === 'Released' ? 'danger' : 'muted'
      return { text: phase, tone }
    }
    case 'readyReplicas': {
      const desired = Number((o.spec as { replicas?: number } | undefined)?.replicas ?? 0)
      const ready = Number(status?.readyReplicas ?? status?.numberReady ?? 0)
      if (desired === 0) return { text: '已停止', tone: 'muted' }
      if (ready >= desired) return { text: '运行中', tone: 'ok' }
      return { text: '更新中', tone: 'warn', }
    }
    case 'conditions': {
      if (truthyCondition(status, ['Ready', 'Available', 'Established', 'NamesAccepted'])) return { text: '就绪', tone: 'ok' }
      if (truthyCondition(status, ['Complete', 'Successful'])) return { text: '已完成', tone: 'ok' }
      const failed = (status?.conditions as { type?: string; status?: string }[] | undefined)?.find((c) => c.type === 'Failed' && c.status === 'True')
      if (failed) return { text: '失败', tone: 'danger' }
      return { text: '等待中', tone: 'warn' }
    }
    case 'none':
    default:
      return { text: '正常', tone: 'ok' }
  }
}
