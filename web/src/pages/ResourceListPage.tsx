import { App, Button, Dropdown, Empty, Input, Modal, Popover, Select, Table, Tag, Tooltip, Typography } from 'antd'
import type { MenuProps, TableColumnsType } from 'antd'
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  EllipsisOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { findDescriptor, resourceDescriptors } from '../config/nav'
import type { ResourceDescriptor } from '../config/nav'
import { PodDetailDrawer } from './PodDetailPage'
import { ResourceDetailDrawer } from './ResourceDetailPage'
import { deriveStatus, resourceApi, toItems } from '../api/resources'
import type { K8sObject } from '../api/resources'
import { useKsActions } from '../components/KsActions'
import { useResource } from '../hooks/useResource'
import { useClusterStore } from '../store/useClusterStore'
import { datetime } from '../utils/format'
import { toYaml } from '../utils/yaml'
import CreateServiceModal from './network/CreateServiceModal'
import CreateIngressModal from './network/CreateIngressModal'
import CreatePvcModal from './storage/CreatePvcModal'
import { CreateSecretModal } from './config/CreateSecretModal'
import { CreateConfigMapModal } from './config/CreateConfigMapModal'

/** 设计 token：品牌 #2f6fed，状态色 ok/warn/danger/muted（与节点管理页同源） */
const TONE_COLOR: Record<string, string> = { ok: '#59c492', warn: '#f5a623', danger: '#d94f4f', muted: '#9aa7b8' }
type Tone = 'ok' | 'warn' | 'danger' | 'muted'

const ALIAS_KEY = 'kubesphere.io/alias-name'

type Rec = Record<string, unknown>
type RowMenu = NonNullable<MenuProps['items']>
const asRec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const asArr = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Rec[] : [])
const asStr = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))
const num = (v: unknown): number => Number(v ?? 0) || 0

/** 一次性任务名后缀：与 KsActions 的 rand5 同规则（小写字母数字） */
const rand5 = () => Math.random().toString(36).replace(/[^a-z0-9]/g, 'x').padEnd(5, '0').slice(0, 5)

const meta = (o: K8sObject): Rec => asRec(o.metadata)
const spec = (o: K8sObject): Rec => asRec(o.spec)
const stat = (o: K8sObject): Rec => asRec(o.status)
const nameOf = (o: K8sObject): string => asStr(meta(o).name)
const nsOf = (o: K8sObject): string => asStr(meta(o).namespace)
const annOf = (o: K8sObject): Rec => asRec(meta(o).annotations)
const aliasOf = (o: K8sObject): string => asStr(annOf(o)[ALIAS_KEY])

/** 页头横幅描述：说明这类资源是什么（未知 descriptor 走通用兜底文案） */
function describeResource(d: ResourceDescriptor): string {
  switch (d.key) {
    case 'pods':
      return '容器组是集群中最小的运行单元，一个 Pod 封装并调度一个或多个容器'
    case 'services':
      return '服务为一组容器组提供稳定的访问入口，把流量负载均衡到后端 Pod'
    case 'ingresses':
      return '应用路由基于域名与路径，把集群外部流量路由到集群内的服务'
    case 'endpoints':
      return '端点记录服务当前实际可用与未就绪的后端地址列表'
    case 'statefulsets':
      return '有状态副本集为每个容器组维持稳定的名称与存储，适合有状态工作负载'
    case 'daemonsets':
      return '守护进程集确保每个节点运行一个容器组副本，常用于节点级组件'
    case 'jobs':
      return '任务创建容器组直至指定数量成功完成，用于一次性批处理'
    case 'cronjobs':
      return '定时任务按 cron 计划周期性创建任务，执行定期作业'
    case 'serviceaccounts':
      return '服务帐户为容器内进程提供访问 API Server 的身份凭据'
    case 'secrets':
      return '保密字典存储密码、令牌、证书等敏感数据，供工作负载或控制器引用'
    case 'configmaps':
      return '配置字典保存非机密的配置键值，可注入环境变量或挂载为文件'
    case 'persistentvolumeclaims':
      return '持久卷声明按指定容量与访问模式，向存储系统申请一块可用卷'
    case 'persistentvolumes':
      return '持久卷是集群级存储资源，由管理员预先创建或经存储类动态供应'
    case 'storageclasses':
      return '存储类定义不同等级存储的供应参数，声明可按需动态创建卷'
    case 'resourcequotas':
      return '资源配额限制项目内累计的资源用量与对象数量，超出将无法创建'
    case 'limitranges':
      return '限制范围设定项目内容器默认与上限的资源请求，约束单个容器的用量区间'
    case 'poddisruptionbudgets':
      return '中断预算保证自愿中断时仍有足够容器组可用，避免驱逐时打爆副本数'
    case 'customresourcedefinitions':
      return '定制资源定义扩展 Kubernetes API，声明集群可用的自定义资源类型'
    case 'workloadtemplates':
      return '工作负载模板用于管理工作负载的版本与灰度发布策略'
    case 'roles':
      return '角色在命名空间范围内定义一组权限规则'
    case 'clusterroles':
      return '集群角色在集群范围内定义一组权限规则'
    default:
      return `查看和管理集群中的 ${d.label}（${d.kind}）资源`
  }
}

function StatusPill({ text, tone, extra }: { text: string; tone: Tone; extra?: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="size-[7px] shrink-0 rounded-full" style={{ background: TONE_COLOR[tone] ?? '#9aa7b8' }} />
      <span style={{ fontWeight: 500, color: '#15233a' }}>{text}</span>
      {extra && <span className="text-[#8f9aa9]">{extra}</span>}
    </span>
  )
}

// ---------------------------------------------------------------- 各资源状态派生

function statusOf(d: ResourceDescriptor, o: K8sObject): { text: string; tone: Tone; extra?: string } {
  switch (d.key) {
    case 'statefulsets':
    case 'daemonsets': {
      const desired = d.key === 'daemonsets' ? num(stat(o).desiredNumberScheduled ?? stat(o).numberAvailable) : num(spec(o).replicas)
      const ready = num(stat(o).readyReplicas ?? stat(o).numberReady ?? stat(o).numberAvailable)
      const updated = num(stat(o).updatedReplicas ?? stat(o).updatedNumberScheduled)
      const pair = `(${ready}/${desired})`
      if (desired === 0) return { text: '已停止', tone: 'muted' }
      if (ready >= desired && (d.key === 'daemonsets' || updated === 0 || updated >= desired)) {
        return { text: '运行中', tone: 'ok', extra: pair }
      }
      return { text: '更新中', tone: 'warn', extra: pair }
    }
    case 'jobs': {
      const conds = asArr(stat(o).conditions)
      if (conds.some((c) => asStr(c.type) === 'Failed' && asStr(c.status) === 'True')) return { text: '失败', tone: 'danger' }
      if (conds.some((c) => asStr(c.type) === 'Complete' && asStr(c.status) === 'True')) return { text: '已完成', tone: 'ok' }
      return { text: '运行中', tone: 'ok' }
    }
    case 'cronjobs':
      return spec(o).suspend === true ? { text: '已暂停', tone: 'muted' } : { text: '运行中', tone: 'ok' }
    case 'pods': {
      const phase = asStr(stat(o).phase) || 'Unknown'
      const map: Record<string, { text: string; tone: Tone }> = {
        Running: { text: '运行中', tone: 'ok' },
        Pending: { text: '等待中', tone: 'warn' },
        Succeeded: { text: '成功完成', tone: 'ok' },
        Failed: { text: '失败', tone: 'danger' },
      }
      return map[phase] ?? { text: '未知', tone: 'muted' }
    }
    case 'persistentvolumeclaims': {
      const phase = asStr(stat(o).phase)
      if (phase === 'Bound') return { text: '已绑定', tone: 'ok' }
      if (phase === 'Lost') return { text: '丢失', tone: 'danger' }
      if (phase === 'Pending') return { text: '等待中', tone: 'warn' }
      return { text: phase || '未知', tone: 'muted' }
    }
    default: {
      const s = deriveStatus(d, o)
      return { text: s.text, tone: s.tone }
    }
  }
}

/** Pod 异常原因（等待中 / 失败时展示在名称副行） */
function podAbnormalReason(o: K8sObject): string {
  const statuses = [...asArr(stat(o).containerStatuses), ...asArr(stat(o).initContainerStatuses)]
  for (const c of statuses) {
    const waiting = asRec(asRec(c.state).waiting).reason
    if (asStr(waiting)) return asStr(waiting)
    const terminated = asRec(asRec(c.state).terminated)
    if (asStr(terminated.reason) && num(terminated.exitCode) !== 0) return asStr(terminated.reason)
  }
  const bad = asArr(stat(o).conditions).find((c) => asStr(c.status) === 'False' && asStr(c.reason))
  return bad ? asStr(bad.reason) : ''
}

const podUpdatedIso = (o: K8sObject): string => {
  let max = ''
  for (const c of asArr(stat(o).conditions)) {
    const lu = asStr(c.lastUpdateTime) || asStr(c.lastTransitionTime)
    if (lu > max) max = lu
  }
  return max || asStr(meta(o).creationTimestamp)
}

const ACCESS_MODE_CN: Record<string, string> = {
  ReadWriteOnce: '单节点读写',
  ReadOnlyMany: '多节点只读',
  ReadWriteMany: '多节点读写',
}

const storageTypeOf = (provisioner: string): string => {
  if (!provisioner) return '未分类'
  if (/nfs|cephfs/i.test(provisioner)) return '文件存储'
  if (/s3|oss|minio/i.test(provisioner)) return '对象存储'
  return '块存储'
}

// ---------------------------------------------------------------- 创建 YAML 模板

function yamlTemplate(d: ResourceDescriptor): string {
  const apiVersion = d.group ? `${d.group}/${d.version}` : d.version
  switch (d.key) {
    case 'jobs':
      return [
        `apiVersion: ${apiVersion}`,
        'kind: Job',
        'metadata:',
        '  name: my-job',
        '  namespace: default',
        'spec:',
        '  template:',
        '    spec:',
        '      restartPolicy: Never',
        '      containers:',
        '        - name: job',
        '          image: busybox:1.36',
        '          command: ["sh", "-c", "echo hello kubespoke"]',
        '',
      ].join('\n')
    case 'cronjobs':
      return [
        `apiVersion: ${apiVersion}`,
        'kind: CronJob',
        'metadata:',
        '  name: my-cronjob',
        '  namespace: default',
        'spec:',
        '  schedule: "*/5 * * * *"',
        '  jobTemplate:',
        '    spec:',
        '      template:',
        '        spec:',
        '          restartPolicy: OnFailure',
        '          containers:',
        '            - name: job',
        '              image: busybox:1.36',
        '              command: ["sh", "-c", "date"]',
        '',
      ].join('\n')
    case 'storageclasses':
      return [
        `apiVersion: ${apiVersion}`,
        'kind: StorageClass',
        'metadata:',
        '  name: my-storage-class',
        'provisioner: kubernetes.io/no-provisioner',
        'reclaimPolicy: Delete',
        'allowVolumeExpansion: false',
        '',
      ].join('\n')
    case 'workloadtemplates':
      return [
        `apiVersion: ${apiVersion}`,
        'kind: Template',
        'metadata:',
        '  name: my-template',
        '  namespace: default',
        'spec:',
        '  template:',
        '    name: my-deployment',
        '    version: v1.0.0',
        '',
      ].join('\n')
    case 'horizontalpodautoscalers':
      return [
        `apiVersion: ${apiVersion}`,
        'kind: HorizontalPodAutoscaler',
        'metadata:',
        '  name: my-hpa',
        '  namespace: default',
        'spec:',
        '  scaleTargetRef:',
        '    apiVersion: apps/v1',
        '    kind: Deployment',
        '    name: my-deployment',
        '  minReplicas: 1',
        '  maxReplicas: 5',
        '  metrics:',
        '    - type: Resource',
        '      resource:',
        '        name: cpu',
        '        target:',
        '          type: Utilization',
        '          averageUtilization: 70',
        '',
      ].join('\n')
    case 'resourcequotas':
      return [
        `apiVersion: ${apiVersion}`,
        'kind: ResourceQuota',
        'metadata:',
        '  name: my-quota',
        '  namespace: default',
        'spec:',
        '  hard:',
        '    requests.cpu: "2"',
        '    requests.memory: 4Gi',
        '    limits.cpu: "4"',
        '    limits.memory: 8Gi',
        '    pods: "20"',
        '',
      ].join('\n')
    case 'limitranges':
      return [
        `apiVersion: ${apiVersion}`,
        'kind: LimitRange',
        'metadata:',
        '  name: my-limits',
        '  namespace: default',
        'spec:',
        '  limits:',
        '    - type: Container',
        '      defaultRequest:',
        '        cpu: 100m',
        '        memory: 128Mi',
        '      default:',
        '        cpu: 500m',
        '        memory: 512Mi',
        '      max:',
        '        cpu: "2"',
        '        memory: 2Gi',
        '',
      ].join('\n')
    case 'poddisruptionbudgets':
      return [
        `apiVersion: ${apiVersion}`,
        'kind: PodDisruptionBudget',
        'metadata:',
        '  name: my-pdb',
        '  namespace: default',
        'spec:',
        '  minAvailable: 1',
        '  selector:',
        '    matchLabels:',
        '      app: my-deployment',
        '',
      ].join('\n')
    default:
      return [
        `apiVersion: ${apiVersion}`,
        `kind: ${d.kind}`,
        'metadata:',
        '  name: my-resource',
        ...(d.scope === 'Namespaced' ? ['  namespace: default'] : []),
        'spec:',
        '  # 在此填写资源规格',
        '',
      ].join('\n')
  }
}

// ---------------------------------------------------------------- 页面本地小组件（与节点管理页同款）

function Panel({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
      <div className="flex items-center justify-between px-4" style={{ height: 46, borderBottom: '1px solid #eef1f5' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#15233a' }}>{title}</span>
        {extra}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}

function FieldRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[13px]">
      <span style={{ color: '#8f9aa9' }}>{label}</span>
      <span className="max-w-[62%] truncate text-right" style={{ color: '#15233a' }}>{value}</span>
    </div>
  )
}

function StatCard({ label, value, total, pct, color, bg, icon, active, onClick }: {
  label: string; value: number; total: number; pct: string; color: string; bg: string; icon: ReactNode; active?: boolean; onClick?: () => void
}) {
  return (
    <div
      className="flex cursor-pointer items-center justify-between rounded-lg bg-white px-4 py-3 transition-shadow hover:shadow-md"
      style={{ border: `1px solid ${active ? color : '#e6ebf1'}` }}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg text-lg" style={{ background: bg, color }}>{icon}</span>
        <div>
          <div className="text-xs" style={{ color: '#8f9aa9' }}>{label}</div>
          <div className="text-xl font-bold leading-6" style={{ color: '#15233a' }}>
            {value}
            <span className="ml-1 text-xs font-normal" style={{ color: '#8f9aa9' }}>/ {total}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: '#8f9aa9' }}>{pct}</span>
        <RightOutlined style={{ color: '#c9d2de', fontSize: 12 }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 页面

/** workloadtemplates 这类 CRD 通常不存在：错误吞掉显示空表（KS 空态一致） */
const isMissingApi = (msg: string): boolean => /not found|404|the server could not find the requested resource/i.test(msg)

const NO_CREATE = new Set(['pods', 'customresourcedefinitions'])
const STRUCTURED_KEYS = new Set(['services', 'ingresses', 'persistentvolumeclaims', 'secrets', 'configmaps'])

/** 辅助描述符：通用列表接口在 Namespace 为空时返回全命名空间资源 */
const NODE_DESC: ResourceDescriptor = {
  key: 'nodes', label: '节点', kind: 'Node', group: '', version: 'v1', plural: 'nodes', scope: 'Cluster',
}
const ROLEBINDING_DESC: ResourceDescriptor = {
  key: 'rolebindings', label: '角色绑定', kind: 'RoleBinding', group: 'rbac.authorization.k8s.io', version: 'v1', plural: 'rolebindings', scope: 'Namespaced',
}
const CLUSTERROLEBINDING_DESC: ResourceDescriptor = {
  key: 'clusterrolebindings', label: '集群角色绑定', kind: 'ClusterRoleBinding', group: 'rbac.authorization.k8s.io', version: 'v1', plural: 'clusterrolebindings', scope: 'Cluster',
}

interface HelperData {
  pvcCounts?: Record<string, number>
  saRoles?: Record<string, string[]>
  nodeIps?: Record<string, string>
}

export default function ResourceListPage() {
  const { key } = useParams()
  const d = findDescriptor(key)
  const { message, modal } = App.useApp()
  const cluster = useClusterStore((s) => s.cluster)
  const namespace = useClusterStore((s) => s.namespace)

  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>()
  const [nsFilter, setNsFilter] = useState<string>()
  const [activeKey, setActiveKey] = useState<string>()
  const [page, setPage] = useState({ current: 1, size: 10 })
  const [createOpen, setCreateOpen] = useState(false)
  const [yaml, setYaml] = useState('')
  const [detailObj, setDetailObj] = useState<K8sObject | null>(null)
  const [detailPod, setDetailPod] = useState<{ ns: string; name: string } | null>(null)
  const [detailRes, setDetailRes] = useState<{ d: ResourceDescriptor; ns: string; name: string } | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const { data, error, loading, refresh } = useResource(
    () => (cluster && d ? resourceApi.list(cluster, d) : Promise.resolve(undefined)),
    [cluster, key],
  )

  /** 附加数据：存储类的 PVC 统计 / 服务帐户的角色 / 容器组的节点 IP */
  const helper = useResource<HelperData>(async () => {
    if (!cluster || !d) return {}
    if (d.key === 'storageclasses') {
      const pvcs = toItems(await resourceApi.list(cluster, resourceDescriptors.persistentvolumeclaims))
      const counts: Record<string, number> = {}
      for (const p of pvcs) {
        const sc = asStr(spec(p).storageClassName)
        if (sc) counts[sc] = (counts[sc] ?? 0) + 1
      }
      return { pvcCounts: counts }
    }
    if (d.key === 'serviceaccounts') {
      const [rbs, crbs] = await Promise.all([
        resourceApi.list(cluster, ROLEBINDING_DESC),
        resourceApi.list(cluster, CLUSTERROLEBINDING_DESC),
      ])
      const map: Record<string, string[]> = {}
      for (const rb of [...toItems(rbs), ...toItems(crbs)]) {
        const roleRef = asStr(asRec(rb.roleRef).name)
        if (!roleRef) continue
        for (const s of asArr(rb.subjects)) {
          if (asStr(s.kind) !== 'ServiceAccount') continue
          const sns = asStr(s.namespace) || asStr(meta(rb).namespace)
          const k = `${sns}/${asStr(s.name)}`
          map[k] = map[k] ?? []
          if (!map[k].includes(roleRef)) map[k].push(roleRef)
        }
      }
      return { saRoles: map }
    }
    if (d.key === 'pods') {
      const nodes = toItems(await resourceApi.list(cluster, NODE_DESC))
      const ips: Record<string, string> = {}
      for (const n of nodes) {
        const internal = asArr(stat(n).addresses).find((a) => asStr(a.type) === 'InternalIP')
        if (internal) ips[nameOf(n)] = asStr(internal.address)
      }
      return { nodeIps: ips }
    }
    return {}
  }, [cluster, key, data])

  const ks = useKsActions({ cluster, d: d ?? resourceDescriptors.services, refresh })

  const keyOf = (o: K8sObject): string => asStr(meta(o).uid) || `${nsOf(o)}/${nameOf(o)}`

  const reload = () => {
    refresh()
    helper.refresh()
  }

  /** 全量条目（请求失败时不展示上一份数据，同组件切换资源类型会保留旧 data） */
  const items = useMemo(() => (error ? [] : toItems(data)), [data, error])

  const nsOptions = useMemo(() => {
    const set = new Set<string>()
    for (const o of items) if (nsOf(o)) set.add(nsOf(o))
    return Array.from(set).sort().map((v) => ({ label: v, value: v }))
  }, [items])

  /** 统计卡口径：直接按每行已有状态渲染函数 statusOf 的 tone 归类，不新调接口 */
  const counts = useMemo(() => {
    let ok = 0
    let danger = 0
    if (d) {
      for (const o of items) {
        const t = statusOf(d, o).tone
        if (t === 'ok') ok += 1
        else if (t === 'danger') danger += 1
      }
    }
    return { ok, danger }
  }, [items, d])

  const statusOptions = useMemo(() => {
    if (!d) return [] as { label: string; value: string }[]
    const seen = new Set<string>()
    const out: { label: string; value: string }[] = []
    for (const o of items) {
      const t = statusOf(d, o).text
      if (!seen.has(t)) {
        seen.add(t)
        out.push({ label: t, value: t })
      }
    }
    return out
  }, [items, d])

  const rows = useMemo(() => {
    let list = items
    if (nsFilter) list = list.filter((o) => nsOf(o) === nsFilter)
    if (statusFilter && d) {
      if (statusFilter === 'ok') list = list.filter((o) => statusOf(d, o).tone === 'ok')
      else if (statusFilter === 'danger') list = list.filter((o) => statusOf(d, o).tone === 'danger')
      else list = list.filter((o) => statusOf(d, o).text === statusFilter)
    }
    if (!filter.trim()) return list
    const q = filter.trim().toLowerCase()
    return list.filter((o) =>
      [nameOf(o), nsOf(o), aliasOf(o), asStr(o.kind)].some((v) => v.toLowerCase().includes(q)),
    )
  }, [items, nsFilter, statusFilter, filter, d])

  /** 当前数据聚合出的「项目」筛选项 */
  const nsFilters = useMemo(() => {
    const set = new Set<string>()
    for (const o of rows) if (nsOf(o)) set.add(nsOf(o))
    return Array.from(set).sort().map((v) => ({ text: v, value: v }))
  }, [rows])

  const active = useMemo(() => items.find((o) => keyOf(o) === activeKey), [items, activeKey])

  if (!d) return <Empty description="未知的资源类型" className="py-24" />

  const hiddenError = d.key === 'workloadtemplates' && isMissingApi(error)
  const shownError = hiddenError ? '' : error

  /* 详情统一走右侧抽屉：?detail=<对象名> 可直达 */
  const openDetail = (o: K8sObject) => {
    setDetailObj(o)
    const next = new URLSearchParams(searchParams)
    next.set('detail', nameOf(o))
    setSearchParams(next, { replace: true })
  }

  const closeDetail = () => {
    setDetailObj(null)
    const next = new URLSearchParams(searchParams)
    next.delete('detail')
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    const raw = searchParams.get('detail')
    if (!raw) return
    const obj = items.find((o) => nameOf(o) === raw)
    if (obj) setDetailObj(obj)
  }, [searchParams, items])

  // ------------------------------------------------------------ 通用列

  const nameLink = (o: K8sObject, main: ReactNode, sub?: ReactNode) => (
    <div className="min-w-0">
      <a
        className="block truncate font-medium"
        style={{ color: '#2f6fed' }}
        title={nameOf(o)}
        onClick={(e) => {
          e.stopPropagation()
          openDetail(o)
        }}
      >
        {main}
      </a>
      <div className="kbd-mono truncate text-xs text-[#8f9aa9]">{sub ?? '-'}</div>
    </div>
  )

  const stdNameCol = (subFor?: (o: K8sObject) => ReactNode): TableColumnsType<K8sObject>[number] => ({
    title: '名称',
    key: 'name',
    width: 200,
    sorter: (a, b) => nameOf(a).localeCompare(nameOf(b)),
    render: (_, o) => nameLink(o, nameOf(o), subFor ? subFor(o) : aliasOf(o) || '-'),
  })

  const nsCol: TableColumnsType<K8sObject>[number] = {
    title: '项目',
    key: 'ns',
    width: 150,
    filters: nsFilters,
    onFilter: (v, o) => nsOf(o) === v,
    render: (_, o) => nsOf(o) || '-',
  }

  const createdCol: TableColumnsType<K8sObject>[number] = {
    title: '创建时间',
    key: 'created',
    width: 175,
    sorter: (a, b) => asStr(meta(a).creationTimestamp).localeCompare(asStr(meta(b).creationTimestamp)),
    render: (_, o) => datetime(asStr(meta(o).creationTimestamp)),
  }

  const statusCol = (): TableColumnsType<K8sObject>[number] => {
    const seen = new Set<string>()
    const filters: { text: string; value: string }[] = []
    for (const o of rows) {
      const t = statusOf(d, o).text
      if (!seen.has(t)) {
        seen.add(t)
        filters.push({ text: t, value: t })
      }
    }
    return {
      title: '状态',
      key: 'status',
      width: 170,
      filters,
      onFilter: (v, o) => statusOf(d, o).text === v,
      render: (_, o) => {
        const s = statusOf(d, o)
        if (d.key === 'pods') {
          const phase = asStr(stat(o).phase)
          if (phase === 'Pending' || phase === 'Failed') {
            const conds = asArr(stat(o).conditions)
            return (
              <Tooltip
                title={
                  <div className="text-xs">
                    {conds.length ? (
                      conds.map((c, i) => (
                        <div key={i} className="whitespace-normal">
                          {`${asStr(c.type)} ${asStr(c.status)}${asStr(c.reason) ? ` · ${asStr(c.reason)}` : ''}${asStr(c.message) ? ` — ${asStr(c.message)}` : ''}`}
                        </div>
                      ))
                    ) : (
                      '无状态条件'
                    )}
                  </div>
                }
              >
                <span>
                  <StatusPill text={s.text} tone={s.tone} />
                </span>
              </Tooltip>
            )
          }
        }
        return <StatusPill text={s.text} tone={s.tone} extra={s.extra} />
      },
    }
  }

  // ------------------------------------------------------------ CronJob 专属操作

  /** 立即执行：读最新对象后按 spec.jobTemplate 造一个一次性 Job 提交（无 patch RPC，统一 applyYaml） */
  const doRunNow = (o: K8sObject) => {
    const nm = nameOf(o)
    const ns = nsOf(o) || undefined
    modal.confirm({
      title: `立即执行 ${nm}？`,
      content: '将按定时计划的模板创建一个一次性任务，不影响后续的调度计划。',
      okText: '执行',
      onOk: async () => {
        try {
          const cj = await resourceApi.read(cluster, d, nm, ns)
          const jobSpec = asRec(asRec(spec(cj).jobTemplate).spec)
          if (!Object.keys(jobSpec).length) {
            message.error('该定时任务没有可用的任务模板')
            return
          }
          const jobName = `${nm}-manual-${rand5()}`
          const metadata: Rec = { name: jobName }
          const jobNs = nsOf(cj) || ns
          if (jobNs) metadata.namespace = jobNs
          const labels = asRec(meta(cj).labels)
          if (Object.keys(labels).length) metadata.labels = labels
          const job: K8sObject = {
            apiVersion: 'batch/v1',
            kind: 'Job',
            metadata: metadata as K8sObject['metadata'],
            spec: jobSpec,
          }
          await resourceApi.applyYaml(cluster, toYaml(job))
          message.success(`已创建任务 ${jobName}`)
          reload()
        } catch (e) {
          message.error((e as Error).message)
        }
      },
    })
  }

  /** 行菜单：通用动作仍由 KsActions 提供（含 CronJob 的暂停 / 继续），此处只补「立即执行」 */
  const rowMenuFor = (o: K8sObject): RowMenu => {
    const base = (ks.menuItemsFor(o) ?? []) as RowMenu
    if (d.key !== 'cronjobs') return base
    const item: RowMenu[number] = { key: 'runNow', label: '立即执行', onClick: () => doRunNow(o) }
    const delIdx = base.findIndex((it) => (it as { key?: string } | null)?.key === 'delete')
    return delIdx < 0 ? [...base, item] : [...base.slice(0, delIdx), item, ...base.slice(delIdx)]
  }

  const actionCol: TableColumnsType<K8sObject>[number] = {
    title: '操作',
    key: 'actions',
    width: 72,
    align: 'center',
    render: (_, o) => (
      <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <Dropdown trigger={['hover']} menu={{ items: rowMenuFor(o) }}>
          <Button size="small" type="text" icon={<EllipsisOutlined />} />
        </Dropdown>
      </div>
    ),
  }

  // ------------------------------------------------------------ 专属单元格

  const internalCell = (o: K8sObject) => {
    const clusterIP = asStr(spec(o).clusterIP)
    if (!clusterIP || clusterIP === 'None') return '-'
    return (
      <span className="inline-flex items-center gap-2">
        <span className="kbd-mono text-xs">{clusterIP}</span>
        <Tag bordered={false}>虚拟IP</Tag>
      </span>
    )
  }

  const externalCell = (o: K8sObject) => {
    const type = asStr(spec(o).type)
    if (type === 'LoadBalancer') {
      const ingress = asArr(asRec(stat(o).loadBalancer).ingress)
      const ips = ingress.map((i) => asStr(i.ip) || asStr(i.hostname)).filter(Boolean)
      return ips.length ? <span className="kbd-mono text-xs">{ips.join(', ')}</span> : '等待分配'
    }
    if (type === 'NodePort') {
      const tags = asArr(spec(o).ports)
        .filter((p) => p.nodePort !== undefined)
        .map((p, i) => (
          <Tag key={i} bordered={false}>
            {`${num(p.nodePort)}/${asStr(p.protocol) || 'TCP'}`}
          </Tag>
        ))
      return tags.length ? <span className="inline-flex flex-wrap gap-1">{tags}</span> : '-'
    }
    return '-'
  }

  const saRoleCell = (o: K8sObject) => {
    const roles = helper.data?.saRoles?.[`${nsOf(o)}/${nameOf(o)}`]
    return roles?.length ? roles.join(', ') : '-'
  }

  const saSecretCell = (o: K8sObject) => {
    const secrets = asArr(asRec(o).secrets)
    if (!secrets.length) return '-'
    if (secrets.length === 1) return <span className="kbd-mono text-xs">{asStr(secrets[0].name) || '-'}</span>
    return `共${secrets.length}个`
  }

  // ------------------------------------------------------------ 列配置（严格按 KubeSphere 顺序）

  const buildColumns = (): TableColumnsType<K8sObject> => {
    const cols: TableColumnsType<K8sObject> = []
    if (d.key === 'customresourcedefinitions') {
      cols.push(
        {
          title: '类别',
          key: 'kind',
          width: 220,
          render: (_, o) => {
            const names = asRec(spec(o).names)
            return nameLink(o, asStr(names.kind) || d.kind, `${asStr(spec(o).group)}/${asStr(asArr(spec(o).versions)[0]?.name)}`)
          },
        },
        {
          title: '名称',
          key: 'plural',
          width: 220,
          sorter: (a, b) => nameOf(a).localeCompare(nameOf(b)),
          render: (_, o) => {
            const names = asRec(spec(o).names)
            return <span className="kbd-mono text-xs">{`${asStr(names.plural)}.${asStr(spec(o).group)}`}</span>
          },
        },
        { title: '作用域', key: 'scope', width: 130, render: (_, o) => asStr(spec(o).scope) || '-' },
        createdCol,
      )
      return cols
    }

    switch (d.key) {
      case 'statefulsets':
      case 'daemonsets':
        cols.push(stdNameCol(), statusCol(), nsCol, createdCol, actionCol)
        break
      case 'jobs':
        cols.push(
          stdNameCol(),
          statusCol(),
          nsCol,
          {
            title: '上次运行时间',
            key: 'lastrun',
            width: 175,
            render: (_, o) => datetime(asStr(stat(o).completionTime) || asStr(stat(o).startTime) || undefined),
          },
          actionCol,
        )
        break
      case 'cronjobs':
        cols.push(
          stdNameCol(),
          statusCol(),
          nsCol,
          { title: '定时计划', key: 'schedule', width: 140, render: (_, o) => <span className="kbd-mono text-xs">{asStr(spec(o).schedule) || '-'}</span> },
          createdCol,
          actionCol,
        )
        break
      case 'pods':
        cols.push(
          stdNameCol((o) => {
            const phase = asStr(stat(o).phase)
            if (phase === 'Running' || phase === 'Succeeded') return '-'
            return podAbnormalReason(o) || '-'
          }),
          statusCol(),
          nsCol,
          {
            title: '节点',
            key: 'node',
            width: 170,
            render: (_, o) => {
              const node = asStr(spec(o).nodeName)
              if (!node) return '-'
              const ip = helper.data?.nodeIps?.[node]
              return (
                <div className="min-w-0">
                  <div className="truncate">{node}</div>
                  {ip && <div className="kbd-mono truncate text-xs text-[#8f9aa9]">{ip}</div>}
                </div>
              )
            },
          },
          { title: '容器组 IP 地址', key: 'podip', width: 140, render: (_, o) => <span className="kbd-mono text-xs">{asStr(stat(o).podIP) || '-'}</span> },
          {
            title: '更新时间',
            key: 'updated',
            width: 175,
            sorter: (a, b) => podUpdatedIso(a).localeCompare(podUpdatedIso(b)),
            render: (_, o) => datetime(podUpdatedIso(o) || undefined),
          },
          actionCol,
        )
        break
      case 'services':
        cols.push(
          stdNameCol(),
          nsCol,
          { title: '内部访问', key: 'internal', width: 170, render: (_, o) => internalCell(o) },
          { title: '外部访问', key: 'external', width: 170, render: (_, o) => externalCell(o) },
          createdCol,
          actionCol,
        )
        break
      case 'ingresses':
        cols.push(
          stdNameCol(),
          {
            title: '网关地址',
            key: 'gw',
            width: 140,
            render: (_, o) => {
              const first = asArr(asRec(stat(o).loadBalancer).ingress)[0]
              return <span className="kbd-mono text-xs">{asStr(first?.ip) || asStr(first?.hostname) || '-'}</span>
            },
          },
          { title: 'Ingress Class', key: 'class', width: 130, render: (_, o) => asStr(spec(o).ingressClassName) || '-' },
          nsCol,
          createdCol,
          actionCol,
        )
        break
      case 'persistentvolumeclaims':
        cols.push(
          stdNameCol(),
          statusCol(),
          nsCol,
          { title: '持久卷', key: 'pv', width: 150, render: (_, o) => <span className="kbd-mono text-xs">{asStr(spec(o).volumeName) || '-'}</span> },
          {
            title: '访问模式',
            key: 'modes',
            width: 140,
            render: (_, o) => asArr(stat(o).accessModes).map((m) => ACCESS_MODE_CN[asStr(m)] ?? asStr(m)).filter(Boolean).join(', ') || '-',
          },
          { title: '挂载状态', key: 'mounted', width: 90, render: (_, o) => (asStr(stat(o).phase) === 'Bound' ? '已挂载' : '未挂载') },
          createdCol,
          actionCol,
        )
        break
      case 'storageclasses':
        cols.push(
          {
            title: '名称',
            key: 'name',
            width: 200,
            sorter: (a, b) => nameOf(a).localeCompare(nameOf(b)),
            render: (_, o) => {
              const isDefault = asStr(annOf(o)['storageclass.kubernetes.io/is-default-class']) === 'true'
              return nameLink(
                o,
                <span>
                  {nameOf(o)}
                  {isDefault && (
                    <Tag className="ml-2" bordered={false} color="blue">
                      默认
                    </Tag>
                  )}
                </span>,
                aliasOf(o) || '-',
              )
            },
          },
          { title: '存储类型', key: 'stype', width: 100, render: (_, o) => storageTypeOf(asStr(o.provisioner)) },
          { title: '持久卷声明数量', key: 'pvccount', width: 120, render: (_, o) => helper.data?.pvcCounts?.[nameOf(o)] ?? 0 },
          { title: '允许卷克隆', key: 'clone', width: 100, render: () => '否' },
          { title: '允许卷扩展', key: 'expand', width: 100, render: (_, o) => (o.allowVolumeExpansion === true ? '是' : '否') },
          { title: '供应者', key: 'prov', width: 220, render: (_, o) => <span className="kbd-mono text-xs">{asStr(o.provisioner) || '-'}</span> },
          actionCol,
        )
        break
      case 'secrets':
        cols.push(
          stdNameCol(),
          nsCol,
          { title: '类型', key: 'type', width: 200, render: (_, o) => asStr(o.type) || '默认' },
          { title: '字段数量', key: 'fields', width: 90, render: (_, o) => Object.keys(asRec(o.data)).length },
          createdCol,
          actionCol,
        )
        break
      case 'configmaps':
        cols.push(
          stdNameCol(),
          nsCol,
          {
            title: '字段',
            key: 'fields',
            width: 220,
            render: (_, o) => [...Object.keys(asRec(o.data)), ...Object.keys(asRec(o.binaryData))].join(', ') || '-',
          },
          createdCol,
          actionCol,
        )
        break
      case 'serviceaccounts':
        cols.push(
          stdNameCol(),
          nsCol,
          { title: '角色', key: 'roles', width: 200, render: (_, o) => saRoleCell(o) },
          { title: '保密字典', key: 'secrets', width: 140, render: (_, o) => saSecretCell(o) },
          createdCol,
          actionCol,
        )
        break
      case 'workloadtemplates':
        cols.push(
          stdNameCol(),
          { title: '类型', key: 'type', width: 120, render: (_, o) => asStr(spec(o).type) || '-' },
          nsCol,
          createdCol,
          actionCol,
        )
        break
      default:
        cols.push(
          stdNameCol(),
          statusCol(),
          ...(d.scope === 'Namespaced' ? [nsCol] : []),
          createdCol,
          actionCol,
        )
    }
    return cols
  }

  const columns = buildColumns()
  const hasStatusCol = columns.some((c) => (c as { key?: string }).key === 'status')

  // ------------------------------------------------------------ 创建

  const useStructuredCreate = STRUCTURED_KEYS.has(d.key)
  const createTitle = d.key === 'workloadtemplates' ? '创建工作负载模板' : '创建'

  const openCreate = () => {
    if (!useStructuredCreate) setYaml(yamlTemplate(d))
    setCreateOpen(true)
  }
  const closeCreate = () => setCreateOpen(false)
  const created = () => {
    setCreateOpen(false)
    refresh()
    helper.refresh()
  }

  const doApplyTemplate = async () => {
    try {
      await resourceApi.applyYaml(cluster, yaml)
      message.success('已提交')
      created()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const commonCreate = { open: true, onClose: closeCreate, cluster, namespace, onCreated: created }

  // ------------------------------------------------------------ 右侧栏（选中行轻量摘要）

  const aStatus = active ? statusOf(d, active) : null
  const aLabels = active ? (Object.entries(asRec(meta(active).labels)) as [string, string][]) : []
  const aYamlHead = active ? toYaml(active).split('\n').slice(0, 20).join('\n') : ''
  const pct = (n: number): string => (items.length ? `${Math.round((n / items.length) * 100)}%` : '0%')

  return (
    <>
      <div className="flex items-start gap-4">
        {/* 左：主区 */}
        <div className="min-w-0 flex-1 space-y-4">
          {shownError && (
            <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {shownError} <Button size="small" onClick={reload}>重试</Button>
            </div>
          )}

          {/* 页头横幅 */}
          <div
            className="relative flex items-center justify-between gap-4 overflow-hidden rounded-lg px-6 py-5"
            style={{ background: 'linear-gradient(90deg, #f2f7ff 0%, #e9f1fd 60%, #eef4fe 100%)' }}
          >
            <div className="flex min-w-0 items-center gap-4">
              <span
                className="grid size-14 shrink-0 place-items-center rounded-xl text-2xl text-white"
                style={{ background: 'linear-gradient(135deg, #5ea0ff, #1668dc)' }}
              >
                {d.icon ?? <AppstoreOutlined />}
              </span>
              <div className="min-w-0">
                <div className="text-xl font-bold" style={{ color: '#15233a' }}>{d.label}</div>
                <div className="mt-1 truncate text-[13px]" style={{ color: '#6b7a92' }} title={describeResource(d)}>
                  {describeResource(d)} · 当前集群：{cluster || '未选择'} · 跨全部项目展示
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="text" icon={<ReloadOutlined />} loading={loading} onClick={reload}>刷新</Button>
              {!NO_CREATE.has(d.key) && (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={openCreate}
                >
                  {createTitle}
                </Button>
              )}
            </div>
          </div>

          {/* 统计卡：按每行状态 tone 归类，点击过滤表格行，再次点击取消 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label={`${d.label}总数`} value={items.length} total={items.length} pct={items.length ? '100%' : '0%'}
              color="#2f6fed" bg="#e8f1ff" icon={d.icon ?? <AppstoreOutlined />}
              active={!statusFilter} onClick={() => setStatusFilter(undefined)}
            />
            <StatCard
              label="正常" value={counts.ok} total={items.length} pct={pct(counts.ok)}
              color="#27a06a" bg="#e6f7ef" icon={<CheckCircleOutlined />}
              active={statusFilter === 'ok'} onClick={() => setStatusFilter(statusFilter === 'ok' ? undefined : 'ok')}
            />
            <StatCard
              label="异常" value={counts.danger} total={items.length} pct={pct(counts.danger)}
              color="#d94f4f" bg="#fdecec" icon={<ExclamationCircleOutlined />}
              active={statusFilter === 'danger'} onClick={() => setStatusFilter(statusFilter === 'danger' ? undefined : 'danger')}
            />
          </div>

          {/* 工具栏 + 表格卡片 */}
          <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              {d.scope === 'Namespaced' && (
                <>
                  <span className="text-[13px]" style={{ color: '#8f9aa9' }}>项目</span>
                  <Select
                    allowClear
                    placeholder="全部"
                    style={{ width: 140 }}
                    value={nsFilter}
                    onChange={setNsFilter}
                    suffixIcon={null}
                    variant="filled"
                    options={nsOptions}
                  />
                </>
              )}
              {hasStatusCol && (
                <>
                  <span className="text-[13px]" style={{ color: '#8f9aa9' }}>状态</span>
                  <Select
                    allowClear
                    placeholder="全部"
                    style={{ width: 110 }}
                    value={statusFilter && statusFilter !== 'ok' && statusFilter !== 'danger' ? statusFilter : undefined}
                    onChange={setStatusFilter}
                    suffixIcon={null}
                    variant="filled"
                    options={statusOptions}
                  />
                </>
              )}
              <span className="ml-auto flex items-center gap-2">
                <Input.Search
                  className="ks-search"
                  placeholder="输入条件进行过滤"
                  allowClear
                  style={{ width: 220 }}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <Button type="text" icon={<ReloadOutlined />} onClick={reload} loading={loading} />
                <Popover
                  trigger="click"
                  placement="bottomRight"
                  content={<Typography.Text type="secondary" style={{ fontSize: 12 }}>列设置</Typography.Text>}
                >
                  <Tooltip title="列设置">
                    <Button type="text" icon={<SettingOutlined />} />
                  </Tooltip>
                </Popover>
              </span>
            </div>
            <Table<K8sObject>
              rowKey={keyOf}
              size="small"
              loading={loading}
              dataSource={rows}
              columns={columns}
              scroll={{ x: 960 }}
              onRow={(o) => ({
                className: 'cursor-pointer',
                onClick: (e) => {
                  if ((e.target as HTMLElement).closest('button,a,input')) return
                  setActiveKey(keyOf(o))
                },
              })}
              rowClassName={(o) => (keyOf(o) === activeKey ? 'ks-row-active' : '')}
              pagination={{
                current: page.current,
                pageSize: page.size,
                showSizeChanger: true,
                pageSizeOptions: [10, 20, 50, 100],
                showTotal: (t) => `总数：${t}`,
                onChange: (current, size) => setPage({ current, size: size || page.size }),
              }}
            />
          </div>
        </div>

        {/* 右：选中资源轻量摘要 */}
        <div className="hidden w-[300px] shrink-0 space-y-4 xl:block">
          {active && aStatus ? (
            <>
              <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
                <div className="flex items-center gap-3 px-4" style={{ height: 58, borderBottom: '1px solid #eef1f5' }}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg text-base text-white" style={{ background: 'linear-gradient(135deg, #5ea0ff, #1668dc)' }}>
                    {d.icon ?? <AppstoreOutlined />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-base font-bold" title={nameOf(active)} style={{ color: '#15233a' }}>
                    {nameOf(active)}
                  </span>
                  <span
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
                    style={{ background: `${TONE_COLOR[aStatus.tone]}1a`, color: aStatus.tone === 'ok' ? '#27a06a' : TONE_COLOR[aStatus.tone] === '#9aa7b8' ? '#5b6a80' : TONE_COLOR[aStatus.tone] }}
                  >
                    <span className="size-[6px] rounded-full" style={{ background: TONE_COLOR[aStatus.tone] }} />
                    {aStatus.text}
                  </span>
                  <Dropdown trigger={['click']} placement="bottomRight" menu={{ items: rowMenuFor(active) }}>
                    <Button type="text" size="small">⋯</Button>
                  </Dropdown>
                </div>
                <div className="px-4 py-2">
                  <FieldRow label="类别" value={asStr(active.kind) || d.kind} />
                  <FieldRow label="项目" value={nsOf(active) || (d.scope === 'Cluster' ? '集群级' : '-')} />
                  <FieldRow label="API 版本" value={<span className="kbd-mono">{asStr(active.apiVersion) || '-'}</span>} />
                  <FieldRow label="别名" value={aliasOf(active) || '-'} />
                  <FieldRow label="创建时间" value={datetime(asStr(meta(active).creationTimestamp))} />
                </div>
              </div>

              <Panel
                title="YAML 摘要"
                extra={<a style={{ fontSize: 12 }} onClick={() => openDetail(active)}>查看详情 <RightOutlined style={{ fontSize: 10 }} /></a>}
              >
                <pre className="kbd-mono m-0 max-h-[240px] overflow-auto rounded-md bg-slate-50 p-3 text-xs">
                  {aYamlHead}
                </pre>
              </Panel>

              <Panel title="关键标签">
                {aLabels.length ? (
                  <div className="space-y-1.5">
                    {aLabels.slice(0, 8).map(([k, v]) => (
                      <div key={k} className="text-[13px]">
                        <div className="truncate font-medium" title={k} style={{ color: '#15233a' }}>{k}</div>
                        <div className="kbd-mono truncate text-xs" title={v} style={{ color: '#8f9aa9' }}>{v}</div>
                      </div>
                    ))}
                    {aLabels.length > 8 && (
                      <div className="text-xs" style={{ color: '#8f9aa9' }}>其余 {aLabels.length - 8} 个标签请查看详情</div>
                    )}
                  </div>
                ) : (
                  <div className="text-[13px]" style={{ color: '#8f9aa9' }}>无标签</div>
                )}
              </Panel>
            </>
          ) : (
            <Panel title="使用小贴士">
              <div className="text-[13px] leading-6" style={{ color: '#5b6a80' }}>
                点击表格行即可在右侧查看该{d.label}的状态、YAML 摘要与关键标签；点击名称在右侧抽屉中查看完整详情，可直接编辑 YAML 或删除。
              </div>
            </Panel>
          )}
        </div>
      </div>

      {ks.modalNode}

      {createOpen && useStructuredCreate && d.key === 'services' && <CreateServiceModal {...commonCreate} />}
      {createOpen && useStructuredCreate && d.key === 'ingresses' && <CreateIngressModal {...commonCreate} />}
      {createOpen && useStructuredCreate && d.key === 'persistentvolumeclaims' && <CreatePvcModal {...commonCreate} />}
      {createOpen && useStructuredCreate && d.key === 'secrets' && <CreateSecretModal {...commonCreate} />}
      {createOpen && useStructuredCreate && d.key === 'configmaps' && <CreateConfigMapModal {...commonCreate} />}

      {createOpen && !useStructuredCreate && (
        <Modal
          open
          title={`${createTitle} · ${d.kind}`}
          width={640}
          onCancel={closeCreate}
          onOk={doApplyTemplate}
          okText="提交"
        >
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            编辑后提交，服务端按 YAML 逐个创建 / 替换资源。
          </Typography.Text>
          <Input.TextArea
            className="kbd-mono mt-2"
            spellCheck={false}
            value={yaml}
            onChange={(e) => setYaml(e.target.value)}
            autoSize={{ minRows: 12, maxRows: 20 }}
            style={{ fontSize: 12 }}
          />
        </Modal>
      )}

      {d.key === 'pods' ? (
        <PodDetailDrawer
          cluster={cluster}
          namespace={detailObj ? nsOf(detailObj) : undefined}
          name={detailObj ? nameOf(detailObj) : undefined}
          onClose={closeDetail}
          onDeleted={closeDetail}
        />
      ) : (
        <ResourceDetailDrawer
          cluster={cluster}
          descriptor={d}
          namespace={detailObj ? nsOf(detailObj) : undefined}
          name={detailObj ? nameOf(detailObj) : undefined}
          onClose={closeDetail}
          onOpenPod={(ns, name) => setDetailPod({ ns, name })}
          onOpenResource={(key, ns, name) => setDetailRes({ d: resourceDescriptors[key], ns, name })}
          onDeleted={closeDetail}
          onChanged={refresh}
        />
      )}

      <PodDetailDrawer
        cluster={cluster}
        namespace={detailPod?.ns}
        name={detailPod?.name}
        onClose={() => setDetailPod(null)}
        onDeleted={() => setDetailPod(null)}
      />

      {detailRes && (
        <ResourceDetailDrawer
          cluster={cluster}
          descriptor={detailRes.d}
          namespace={detailRes.ns}
          name={detailRes.name}
          onClose={() => setDetailRes(null)}
          onOpenPod={(ns, name) => setDetailPod({ ns, name })}
          onOpenResource={(key, ns, name) => setDetailRes({ d: resourceDescriptors[key], ns, name })}
          onDeleted={() => setDetailRes(null)}
          onChanged={refresh}
        />
      )}
    </>
  )
}
