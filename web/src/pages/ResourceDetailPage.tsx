import { App, Alert, Button, Descriptions, Dropdown, Empty, Form, Input, Modal, Popconfirm, Space, Table, Tabs, Tag, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { DownOutlined, EditOutlined, EyeInvisibleOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { findDescriptor, clusterPath } from '../config/nav'
import type { ResourceDescriptor } from '../config/nav'
import { deriveStatus, resourceApi, toItems } from '../api/resources'
import type { K8sObject } from '../api/resources'
import { DetailDrawer } from '../components/DetailDrawer'
import { EventsPanel } from '../components/EventsPanel'
import { LabelRowsField } from '../components/LabelRowsField'
import { confirmApply } from '../components/ApplyGuard'
import { labelsFromRows } from '../api/payloads'
import type { LabelRowIn } from '../api/payloads'
import { EditConfigMapModal } from './config/EditConfigMapModal'
import type { ConfigMapEditValues } from './config/EditConfigMapModal'
import { useResource } from '../hooks/useResource'
import { useClusterStore } from '../store/useClusterStore'
import { toYaml } from '../utils/yaml'
import { datetime, memory } from '../utils/format'

/* ------------------------------------------------------------------ 常量与工具 */

const labelStyle = { fontSize: 12, color: '#79879c' }
const valueStyle = { fontSize: 13, fontWeight: 500, color: '#15233a' }

const ANNO_ALIAS = 'kubesphere.io/alias-name'
const ANNO_DESC = 'kubesphere.io/description'
const ANNO_CREATOR = 'kubesphere.io/creator'
const ANNO_RESTARTED = 'kubespoke.io/restartedAt'

/** K8s 原始状态词 -> KubeSphere 中文文案 */
const STATUS_CN: Record<string, string> = {
  Running: '运行中',
  Pending: '等待中',
  Succeeded: '成功完成',
  Completed: '成功完成',
  Complete: '成功完成',
  Failed: '失败',
  Unknown: '未知',
  Bound: '已绑定',
  Active: '活跃',
  Released: '已释放',
  Terminating: '终止中',
  Ready: '就绪',
  NotReady: '未就绪',
  Available: '可用',
  True: '是',
  False: '否',
}

const STATUS_COLOR: Record<string, string> = {
  Running: '#3ca96a',
  Succeeded: '#3ca96a',
  Completed: '#3ca96a',
  Complete: '#3ca96a',
  Bound: '#3ca96a',
  Active: '#3ca96a',
  Ready: '#3ca96a',
  Available: '#3ca96a',
  Pending: '#f5a623',
  NotReady: '#f5a623',
  Terminating: '#f5a623',
  Updating: '#f5a623',
  Failed: '#ca2621',
  Released: '#ca2621',
  Unbound: '#ca2621',
  CrashLoopBackOff: '#ca2621',
  Error: '#ca2621',
  Unknown: '#9aa7b8',
}

const TONE_COLOR: Record<string, string> = { ok: '#3ca96a', warn: '#f5a623', danger: '#ca2621', muted: '#9aa7b8' }

const cnStatus = (v?: string) => (v ? STATUS_CN[v] ?? v : '-')

type Dict = Record<string, unknown>

const dict = (v: unknown): Dict => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : {})
const objArr = (v: unknown): Dict[] => (Array.isArray(v) ? (v as Dict[]) : [])
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const numv = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
const boolv = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
const specOf = (o?: K8sObject): Dict => dict(o?.spec)
const statusOf = (o?: K8sObject): Dict => dict(o?.status)

/** Secret 的 data 值是 base64；解不出来就原样展示 */
function b64decode(v: string): string {
  try {
    const bin = atob(v)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return v
  }
}

/** 容器状态：state 下的第一个键（running / waiting / terminated）里的 reason */
function containerStateReason(s: Dict): string | undefined {
  const state = dict(s.state)
  const key = Object.keys(state)[0]
  if (!key) return undefined
  return text(dict(state[key]).reason) ?? key
}

function duration(startIso?: string, endIso?: string): string {
  if (!startIso) return '-'
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '-'
  const sec = Math.floor((end - start) / 1000)
  if (sec < 60) return `${sec} 秒`
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟 ${sec % 60} 秒`
  return `${Math.floor(sec / 3600)} 小时 ${Math.floor((sec % 3600) / 60)} 分钟`
}


function withAnnotations(o: K8sObject, patch: Record<string, string>): K8sObject {
  const md = { ...dict(o.metadata) }
  const ann = { ...dict(md.annotations) }
  for (const [k, v] of Object.entries(patch)) {
    if (v) ann[k] = v
    else delete ann[k]
  }
  md.annotations = ann
  const next = { ...o, metadata: md }
  delete next.status
  return next
}

/** 配置字典编辑：data 与 labels 整体替换，别名/描述写注解，其余字段（binaryData 等）原样保留 */
function withConfigData(o: K8sObject, patch: ConfigMapEditValues): K8sObject {
  const next: K8sObject = structuredClone(o)
  next.data = patch.data
  const md = { ...dict(next.metadata) }
  if (Object.keys(patch.labels).length) md.labels = patch.labels
  else delete md.labels
  next.metadata = md
  return withAnnotations(next, { [ANNO_ALIAS]: patch.alias, [ANNO_DESC]: patch.description })
}

/** 标签整体替换：行全删时要连 labels 键一起删掉，别留空对象 */
function withLabels(o: K8sObject, labels: Record<string, string>): K8sObject {
  const md = { ...dict(o.metadata) }
  if (Object.keys(labels).length) md.labels = labels
  else delete md.labels
  const next = { ...o, metadata: md }
  delete next.status
  return next
}

/** 编辑信息表单：别名/描述写注解，标签行整体替换 metadata.labels */
type InfoFormValues = { alias?: string; description?: string; LabelRows?: LabelRowIn[] }

function withRestartAnnotation(o: K8sObject): K8sObject {
  const spec = { ...specOf(o) }
  const tpl = { ...dict(spec.template) }
  const tplMeta = { ...dict(tpl.metadata) }
  tplMeta.annotations = { ...dict(tplMeta.annotations), [ANNO_RESTARTED]: new Date().toISOString() }
  tpl.metadata = tplMeta
  spec.template = tpl
  const next: K8sObject = { ...o, spec }
  delete next.status
  return next
}

function withSuspend(o: K8sObject, suspend: boolean): K8sObject {
  const spec = { ...specOf(o) }
  spec.suspend = suspend
  const next: K8sObject = { ...o, spec }
  delete next.status
  return next
}

/** 定制资源定义 -> 其实例资源的描述符（spec.names.plural + group + versions[0].name） */
function crDescriptor(data?: K8sObject): ResourceDescriptor | undefined {
  const sp = specOf(data)
  const names = dict(sp.names)
  const kind = text(names.kind)
  const plural = text(names.plural)
  const version = text(objArr(dict(sp.versions))[0]?.name) ?? text(data?.metadata?.name)
  if (!kind || !plural || !version) return undefined
  const scope: ResourceDescriptor['scope'] = text(sp.scope) === 'Namespaced' ? 'Namespaced' : 'Cluster'
  return { key: plural, label: `${kind} 实例`, kind, group: text(sp.group) ?? '', version, plural, scope, statusKind: 'none' }
}

/* ------------------------------------------------------------------ 小组件 */

function StatusText({ phase }: { phase?: string }) {
  if (!phase) return <span style={valueStyle}>-</span>
  return <span style={{ ...valueStyle, color: STATUS_COLOR[phase] ?? '#36435c' }}>{cnStatus(phase)}</span>
}

function DerivedText({ d, o }: { d: ResourceDescriptor; o: K8sObject }) {
  const s = deriveStatus(d, o)
  return <span style={{ ...valueStyle, color: TONE_COLOR[s.tone] }}>{s.text}</span>
}

function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between">
        <Typography.Text strong className="!text-[13px]">
          {title}
        </Typography.Text>
        {extra}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function LabelTable({ data, empty }: { data?: Record<string, string>; empty: string }) {
  const rows = Object.entries(data ?? {})
  if (!rows.length) return <Empty description={empty} image={Empty.PRESENTED_IMAGE_SIMPLE} />
  return (
    <Table
      rowKey="k"
      size="small"
      pagination={false}
      dataSource={rows.map(([k, v]) => ({ k, v }))}
      columns={[
        { title: '名称', dataIndex: 'k', render: (v: string) => <Tag>{v}</Tag> },
        { title: '值', dataIndex: 'v', render: (v: string) => <span className="kbd-mono text-xs">{v}</span> },
      ]}
    />
  )
}

/** 详情头下方的「属性」strip：小灰 label + 值 */
function AttrStrip({ typeLabel, items }: { typeLabel: string; items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap items-start gap-x-10 gap-y-3">
      <span className="mt-0.5 inline-flex items-center rounded bg-[#eef1f5] px-2 py-1 text-xs font-medium text-[#5b6b80]">
        {typeLabel}
      </span>
      {items.map((it) => (
        <div key={it.label} className="min-w-[92px]">
          <div style={labelStyle}>{it.label}</div>
          <div className="mt-0.5" style={valueStyle}>
            {it.value}
          </div>
        </div>
      ))}
    </div>
  )
}

/** 容器组表（ownerReferences / selector 匹配出来的那批 Pod） */
function PodTable({ items, onOpenPod }: { items: K8sObject[]; onOpenPod?: (namespace: string, podName: string) => void }) {
  return (
    <Table<K8sObject>
      rowKey={(o) => o.metadata?.uid ?? `${o.metadata?.namespace}/${o.metadata?.name}`}
      size="small"
      pagination={false}
      dataSource={items}
      locale={{ emptyText: '暂无关联的容器组' }}
      scroll={{ x: 860 }}
      columns={[
        {
          title: '名称',
          render: (_, o) => (
            <a onClick={() => onOpenPod?.(o.metadata?.namespace ?? 'default', o.metadata?.name ?? '')}>
              {o.metadata?.name}
            </a>
          ),
        },
        { title: '状态', width: 110, render: (_, o) => <StatusText phase={text(statusOf(o).phase)} /> },
        { title: '节点', width: 200, render: (_, o) => text(specOf(o).nodeName) ?? '-' },
        { title: '容器组 IP 地址', width: 150, render: (_, o) => <span className="kbd-mono text-xs">{text(statusOf(o).podIP) ?? '-'}</span> },
        { title: '创建时间', width: 180, render: (_, o) => datetime(o.metadata?.creationTimestamp) },
      ]}
    />
  )
}

function BoolCell({ v }: { v?: boolean }) {
  if (v === undefined) return <>-</>
  return v ? <Tag color="green" variant="filled">是</Tag> : <Tag variant="filled">否</Tag>
}

/* ------------------------------------------------------------------ 页面 */

/** 通用资源详情整页正文：列表页右侧抽屉与直达链接共用（写操作就地完成） */
export function ResourceDetailBody({
  cluster,
  descriptor,
  namespace,
  name,
  onOpenPod,
  onOpenResource,
  onDeleted,
  onChanged,
}: {
  cluster: string
  descriptor: ResourceDescriptor
  namespace?: string
  name?: string
  onOpenPod?: (namespace: string, podName: string) => void
  onOpenResource?: (key: string, namespace: string, name: string) => void
  onDeleted?: () => void
  onChanged?: () => void
}) {
  const d = descriptor
  const decoded = name ? decodeURIComponent(name) : ''
  const { message, modal } = App.useApp()
  const targetNs = d.scope === 'Namespaced' ? namespace : undefined

  const [infoOpen, setInfoOpen] = useState(false)
  const [infoForm] = Form.useForm<InfoFormValues>()
  const [yamlOpen, setYamlOpen] = useState(false)
  const [yamlText, setYamlText] = useState('')
  const [cmEditOpen, setCmEditOpen] = useState(false)
  const [viewOpen, setViewOpen] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)

  const { data, error, loading, refresh } = useResource<K8sObject>(
    () => (cluster ? resourceApi.read(cluster, d, decoded, targetNs) : Promise.resolve({} as K8sObject)),
    [cluster, d.key, decoded, targetNs],
  )

  const uid = data?.metadata?.uid

  // 关联容器组：sts / ds / jobs 按 ownerReferences，services 按 spec.selector
  const wantsPods = !!d && ['statefulsets', 'daemonsets', 'jobs', 'services'].includes(d.key)
  const podsRes = useResource<K8sObject | K8sObject[] | undefined>(
    () =>
      cluster && wantsPods
        ? resourceApi.list(cluster, {
            key: 'pods', label: '容器组', kind: 'Pod', group: '', version: 'v1', plural: 'pods', scope: 'Namespaced', statusKind: 'phase',
          } as ResourceDescriptor, targetNs)
        : Promise.resolve(undefined),
    [cluster, wantsPods, targetNs, uid],
  )

  // 定时任务 -> 其下的任务
  const wantsJobs = d?.key === 'cronjobs'
  const jobsRes = useResource<K8sObject | K8sObject[] | undefined>(
    () =>
      cluster && wantsJobs
        ? resourceApi.list(cluster, {
            key: 'jobs', label: '任务', kind: 'Job', group: 'batch', version: 'v1', plural: 'jobs', scope: 'Namespaced', statusKind: 'conditions',
          } as ResourceDescriptor, targetNs)
        : Promise.resolve(undefined),
    [cluster, wantsJobs, targetNs, uid],
  )

  // 服务帐户 -> 角色绑定
  const wantsRbac = d?.key === 'serviceaccounts'
  const rbacRes = useResource<{ rb: K8sObject[]; crb: K8sObject[]; secrets: K8sObject[] }>(
    async () => {
      if (!cluster || !wantsRbac) return { rb: [], crb: [], secrets: [] }
      const list = async (dd: ResourceDescriptor, ns?: string) => {
        try {
          return toItems(await resourceApi.list(cluster, dd, ns))
        } catch {
          return [] as K8sObject[]
        }
      }
      const [rb, crb, secrets] = await Promise.all([
        list({ key: 'rolebindings', label: '角色绑定', kind: 'RoleBinding', group: 'rbac.authorization.k8s.io', version: 'v1', plural: 'rolebindings', scope: 'Namespaced', statusKind: 'none' }, targetNs),
        list({ key: 'clusterrolebindings', label: '集群角色绑定', kind: 'ClusterRoleBinding', group: 'rbac.authorization.k8s.io', version: 'v1', plural: 'clusterrolebindings', scope: 'Cluster', statusKind: 'none' }),
        list({ key: 'secrets', label: '保密字典', kind: 'Secret', group: '', version: 'v1', plural: 'secrets', scope: 'Namespaced', statusKind: 'none' }, targetNs),
      ])
      return { rb, crb, secrets }
    },
    [cluster, wantsRbac, targetNs, decoded],
  )

  const crDesc = useMemo(() => (d?.key === 'customresourcedefinitions' ? crDescriptor(data) : undefined), [d?.key, data])
  const crRes = useResource<K8sObject | K8sObject[] | undefined>(
    () => (cluster && crDesc ? resourceApi.list(cluster, crDesc) : Promise.resolve(undefined)),
    [cluster, crDesc?.plural, crDesc?.version, crDesc?.group],
  )

  const sp = specOf(data)
  const st = statusOf(data)
  const creator = data?.metadata?.annotations?.[ANNO_CREATOR]
  const isSuspend = boolv(sp.suspend) === true
  const podItems = toItems(podsRes.data)
  const jobItems = toItems(jobsRes.data)

  /* ------------------------------------------------------------ 更多操作 */

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
    return undefined
  }

  const latest = () => resourceApi.read(cluster, d, decoded, targetNs)

  const openInfo = async () => {
    try {
      const obj = await latest()
      infoForm.setFieldsValue({
        alias: obj.metadata?.annotations?.[ANNO_ALIAS] ?? '',
        description: obj.metadata?.annotations?.[ANNO_DESC] ?? '',
        LabelRows: Object.entries(obj.metadata?.labels ?? {}).map(([key, value]) => ({ key, value })),
      })
      setInfoOpen(true)
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const persistInfo = (values: InfoFormValues) =>
    run(async () => {
      // 编辑场景不按保留键过滤（如 Service 的 app），否则原标签会被一起抹掉
      const yaml = await confirmApply({
        modal: modal,
        cluster,
        descriptor: d,
        name: decoded,
        namespace: targetNs,
        seeded: data,
        title: `保存 ${decoded} 的信息？`,
        okText: '保存',
        build: (live) =>
          withLabels(
            withAnnotations(live, { [ANNO_ALIAS]: values.alias?.trim() ?? '', [ANNO_DESC]: values.description?.trim() ?? '' }),
            labelsFromRows(values.LabelRows) ?? {},
          ),
      })
      if (yaml === null) {
        message.info('没有变化')
        return
      }
      await resourceApi.applyYaml(cluster, yaml)
      message.success('已保存')
      setInfoOpen(false)
      refresh()
    })

  const saveInfo = async () => {
    const values = await infoForm.validateFields().catch(() => null)
    if (!values) return
    await persistInfo(values)()
  }

  const saveYaml = run(async () => {
    await resourceApi.applyYaml(cluster, yamlText)
    message.success('已保存')
    setYamlOpen(false)
    refresh()
  })

  const saveConfigData = (values: ConfigMapEditValues) =>
    run(async () => {
      const yaml = await confirmApply({
        modal: modal,
        cluster,
        descriptor: d,
        name: decoded,
        namespace: targetNs,
        seeded: data,
        okText: '保存',
        build: (live) => withConfigData(live, values),
      })
      if (yaml === null) {
        message.info('没有变化')
        return
      }
      await resourceApi.applyYaml(cluster, yaml)
      message.success('已保存')
      setCmEditOpen(false)
      refresh()
    })()

  const doRecreate = () => {
    void run(async () => {
      const yaml = await confirmApply({
        modal: modal,
        cluster,
        descriptor: d,
        name: decoded,
        namespace: targetNs,
        seeded: data,
        title: `重建 ${decoded}？`,
        intro: '会给 Pod 模板打一个重启注解，触发滚动更新。',
        okText: '重建',
        build: (live) => withRestartAnnotation(live),
      })
      if (yaml === null) {
        message.info('没有变化')
        return
      }
      await resourceApi.applyYaml(cluster, yaml)
      message.success('已触发重建')
      refresh()
    })()
  }

  const doToggleSuspend = run(async () => {
    const yaml = await confirmApply({
      modal: modal,
      cluster,
      descriptor: d,
      name: decoded,
      namespace: targetNs,
      seeded: data,
      title: isSuspend ? `恢复 ${decoded}？` : `暂停 ${decoded}？`,
      intro: isSuspend ? '把 spec.suspend 置为 false，下一个周期起继续调度。' : '把 spec.suspend 置为 true，不再产生新的执行。',
      okText: isSuspend ? '恢复' : '暂停',
      build: (live) => withSuspend(live, !isSuspend),
    })
    if (yaml === null) {
      message.info('没有变化')
      return
    }
    await resourceApi.applyYaml(cluster, yaml)
    message.success(isSuspend ? '已恢复' : '已暂停')
    refresh()
  })

  const doDelete = run(async () => {
    await resourceApi.remove(cluster, d, decoded, targetNs)
    message.success('已删除')
    onChanged?.()
    onDeleted?.()
  })

  const canInfo = ['statefulsets', 'daemonsets', 'jobs', 'cronjobs', 'services', 'ingresses', 'persistentvolumeclaims', 'secrets', 'configmaps', 'serviceaccounts'].includes(d.key)
  const isWorkload = d.key === 'statefulsets' || d.key === 'daemonsets'
  /** 每类资源都给到编辑 YAML：已列出的分支之外（部署、角色、持久卷、存储类等）走兜底 */
  const hasYamlEntry = canInfo || d.key === 'pods' || d.key === 'customresourcedefinitions'

  const menuItems: MenuProps['items'] = [
    ...(canInfo
      ? [
          { key: 'editInfo', label: '编辑信息' },
          ...(d.key === 'configmaps' ? [{ key: 'editData', label: '编辑数据项' }] : []),
          { key: 'editYaml', label: '编辑 YAML' },
        ]
      : []),
    ...(d.key === 'pods' ? [{ key: 'viewYaml', label: '查看 YAML' }, { key: 'editYaml', label: '编辑 YAML' }] : []),
    ...(d.key === 'customresourcedefinitions' ? [{ key: 'editYaml', label: '编辑 YAML' }] : []),
    ...(isWorkload ? [{ key: 'recreate', label: '重建' }] : []),
    ...(d.key === 'cronjobs' ? [{ key: 'suspend', label: isSuspend ? '恢复' : '暂停' }] : []),
    ...(!hasYamlEntry ? [{ key: 'editYaml', label: '编辑 YAML' }] : []),
    {
      key: 'delete',
      danger: true,
      label: (
        <Popconfirm title={`删除 ${decoded}？`} description="删除后不可恢复。" okText="删除" okButtonProps={{ danger: true }} onConfirm={doDelete}>
          <span className="block w-full text-left" onClick={(e) => e.stopPropagation()}>
            删除
          </span>
        </Popconfirm>
      ),
    },
  ]

  const onMenuClick: MenuProps['onClick'] = ({ key: k }) => {
    if (k === 'editInfo') void openInfo()
    if (k === 'editData') setCmEditOpen(true)
    if (k === 'editYaml') {
      setYamlText(toYaml(data ?? {}))
      setYamlOpen(true)
    }
    if (k === 'viewYaml') setViewOpen(true)
    if (k === 'recreate') doRecreate()
    if (k === 'suspend') void doToggleSuspend()
  }

  /* ------------------------------------------------------------ 属性 strip */

  const attrs: { label: string; value: ReactNode }[] = []
  const push = (label: string, value: ReactNode) => attrs.push({ label, value })

  if (d.key === 'pods') {
    push('状态', <StatusText phase={text(st.phase)} />)
    push('项目', text(data?.metadata?.namespace) ?? targetNs ?? '-')
    push('节点', text(sp.nodeName) ?? '-')
    push('容器组 IP 地址', text(st.podIP) ?? '-')
  } else if (isWorkload) {
    push('状态', <DerivedText d={d} o={data ?? {}} />)
    push('项目', text(data?.metadata?.namespace) ?? targetNs ?? '-')
    push('副本', `${numv(st.readyReplicas) ?? numv(st.numberReady) ?? 0} / ${numv(sp.replicas) ?? numv(st.desiredNumberScheduled) ?? 0}`)
  } else if (d.key === 'jobs') {
    push('状态', <DerivedText d={d} o={data ?? {}} />)
    push('项目', text(data?.metadata?.namespace) ?? targetNs ?? '-')
    push('成功数', numv(st.succeeded) ?? 0)
    push('失败数', numv(st.failed) ?? 0)
  } else if (d.key === 'cronjobs') {
    push('状态', isSuspend ? '已暂停' : <DerivedText d={d} o={data ?? {}} />)
    push('项目', text(data?.metadata?.namespace) ?? targetNs ?? '-')
    push('定时计划', text(sp.schedule) ?? '-')
    push('最后调度', datetime(text(st.lastScheduleTime)))
  } else if (d.key === 'services') {
    push('类型', text(sp.type) ?? 'ClusterIP')
    push('项目', text(data?.metadata?.namespace) ?? targetNs ?? '-')
    push('内部访问', text(sp.clusterIP) ?? '-')
  } else if (d.key === 'ingresses') {
    push('项目', text(data?.metadata?.namespace) ?? targetNs ?? '-')
    push('网关地址', ingressAddress(data ?? {}) || '-')
    push('IngressClass', text(sp.ingressClassName) ?? '-')
  } else if (d.key === 'persistentvolumeclaims') {
    push('状态', <StatusText phase={text(st.phase)} />)
    push('项目', text(data?.metadata?.namespace) ?? targetNs ?? '-')
    push('容量', text(dict(st.capacity).storage) ?? '-')
    push('存储类', text(sp.storageClassName) ?? '-')
  } else if (d.key === 'secrets') {
    push('类型', text(dict(data).type) ?? 'Opaque')
    push('项目', text(data?.metadata?.namespace) ?? targetNs ?? '-')
    push('数据条目', Object.keys(dict(data).data ?? {}).length + Object.keys(dict(data).stringData ?? {}).length)
  } else if (d.key === 'configmaps') {
    push('项目', text(data?.metadata?.namespace) ?? targetNs ?? '-')
    push('数据条目', Object.keys(dict(data).data ?? {}).length)
    push('二进制数据条目', Object.keys(dict(data).binaryData ?? {}).length)
  } else if (d.key === 'serviceaccounts') {
    push('项目', text(data?.metadata?.namespace) ?? targetNs ?? '-')
    push('自动挂载 API 凭据', boolv(sp.automountServiceAccountToken) === undefined ? '未设置' : boolv(sp.automountServiceAccountToken) ? '是' : '否')
  } else if (d.key === 'customresourcedefinitions') {
    push('组', text(sp.group) ?? '-')
    push('作用域', text(sp.scope) ?? '-')
    push('类别', text(dict(sp.names).kind) ?? '-')
  } else {
    push('状态', <DerivedText d={d} o={data ?? {}} />)
    if (d.scope === 'Namespaced') push('项目', text(data?.metadata?.namespace) ?? targetNs ?? '-')
  }
  push('创建时间', datetime(data?.metadata?.creationTimestamp))

  /* ------------------------------------------------------------ 资源状态标签页 */

  const ownedPods = podItems.filter((p) => objArr(dict(p.metadata).ownerReferences).some((r) => text(r.uid) === uid))
  const selector = dict(sp.selector)
  const selectorRows = Object.entries(selector).filter(([, v]) => typeof v === 'string') as [string, string][]
  const selectorPods = podItems.filter((p) => {
    if (!selectorRows.length) return false
    const labels = dict(dict(p.metadata).labels)
    return selectorRows.every(([k, v]) => labels[k] === v)
  })
  const cronJobs = jobItems.filter(
    (j) => objArr(dict(j.metadata).ownerReferences).some((r) => text(r.uid) === uid) || text(dict(dict(j.metadata).labels)['cronjob-name']) === decoded,
  )

  const statusTab = (): ReactNode => {
    if (isWorkload) {
      const expected = d.key === 'daemonsets' ? numv(st.desiredNumberScheduled) : numv(sp.replicas)
      const current = d.key === 'daemonsets' ? numv(st.currentNumberScheduled) : numv(st.replicas)
      const ready = d.key === 'daemonsets' ? numv(st.numberReady) : numv(st.readyReplicas)
      return (
        <>
          <Section title="副本">
            <Descriptions
              size="small"
              column={4}
              styles={{ label: labelStyle }}
              items={[
                { key: 'r', label: '副本', children: `${ready ?? 0} / ${expected ?? 0}` },
                { key: 'e', label: '期望副本数', children: expected ?? '-' },
                { key: 'c', label: '当前副本数', children: current ?? '-' },
                { key: 'u', label: '就绪副本数', children: ready ?? '-' },
              ]}
            />
          </Section>
          <Section title="容器组">
            <PodTable items={ownedPods} onOpenPod={onOpenPod} />
          </Section>
        </>
      )
    }

    if (d.key === 'jobs') {
      return (
        <>
          <Section title="状态">
            <Descriptions
              size="small"
              column={3}
              styles={{ label: labelStyle }}
              items={[
                { key: 's', label: '状态', children: <DerivedText d={d} o={data ?? {}} /> },
                { key: 'ok', label: '成功数', children: numv(st.succeeded) ?? 0 },
                { key: 'bad', label: '失败数', children: numv(st.failed) ?? 0 },
                { key: 'start', label: '开始时间', children: datetime(text(st.startTime)) },
                { key: 'end', label: '完成时间', children: datetime(text(st.completionTime)) },
                { key: 'dur', label: '持续时长', children: duration(text(st.startTime), text(st.completionTime)) },
              ]}
            />
          </Section>
          <Section title="容器组">
            <PodTable items={ownedPods} onOpenPod={onOpenPod} />
          </Section>
        </>
      )
    }

    if (d.key === 'cronjobs') {
      const jobDesc: ResourceDescriptor = { key: 'jobs', label: '任务', kind: 'Job', group: 'batch', version: 'v1', plural: 'jobs', scope: 'Namespaced', statusKind: 'conditions' }
      return (
        <>
          <Section title="定时计划">
            <Descriptions
              size="small"
              column={3}
              styles={{ label: labelStyle }}
              items={[
                { key: 'sch', label: '定时计划', children: <span className="kbd-mono text-xs">{text(sp.schedule) ?? '-'}</span> },
                { key: 'last', label: '最后调度', children: datetime(text(st.lastScheduleTime)) },
                { key: 'pause', label: '暂停', children: isSuspend ? '已暂停' : '未暂停' },
                { key: 'hist', label: '并发策略', children: text(sp.concurrencyPolicy) ?? '-' },
                { key: 'suspend', label: '挂起中的任务', children: objArr(st.active).length },
              ]}
            />
          </Section>
          <Section title="任务">
            <Table<K8sObject>
              rowKey={(o) => o.metadata?.uid ?? o.metadata?.name ?? ''}
              size="small"
              pagination={false}
              dataSource={cronJobs}
              locale={{ emptyText: '暂无任务' }}
              columns={[
                {
                  title: '名称',
                  render: (_, o) => (
                    <a onClick={() => onOpenResource?.('jobs', o.metadata?.namespace ?? targetNs ?? 'default', o.metadata?.name ?? '')}>
                      {o.metadata?.name}
                    </a>
                  ),
                },
                { title: '状态', width: 120, render: (_, o) => <DerivedText d={jobDesc} o={o} /> },
                { title: '上次运行时间', width: 190, render: (_, o) => datetime(text(statusOf(o).startTime)) },
                { title: '创建时间', width: 190, render: (_, o) => datetime(o.metadata?.creationTimestamp) },
              ]}
            />
          </Section>
        </>
      )
    }

    if (d.key === 'services') {
      const ports = objArr(sp.ports)
      return (
        <>
          <Section title="访问">
            <Descriptions
              size="small"
              column={2}
              styles={{ label: labelStyle }}
              items={[
                { key: 'in', label: '内部访问', children: <span className="kbd-mono text-xs">{`${text(sp.clusterIP) ?? '-'}（${text(sp.type) ?? 'ClusterIP'}）`}</span> },
                { key: 'out', label: '外部访问', children: <span className="kbd-mono text-xs">{serviceExternal(data ?? {})}</span> },
                { key: 'sess', label: '会话亲和性', children: text(sp.sessionAffinity) === 'ClientIP' ? '客户端 IP' : '无' },
              ]}
            />
          </Section>
          <Section title="端口">
            <Table<Dict>
              rowKey={(r, i) => `${text(r.name) ?? ''}-${numv(r.port) ?? ''}-${i ?? 0}`}
              size="small"
              pagination={false}
              dataSource={ports}
              locale={{ emptyText: '没有端口' }}
              columns={[
                { title: '名称', render: (_, r) => text(r.name) ?? '-' },
                { title: '协议', width: 100, render: (_, r) => text(r.protocol) ?? 'TCP' },
                { title: '端口', width: 110, render: (_, r) => numv(r.port) ?? '-' },
                { title: '目标端口', width: 120, render: (_, r) => String(r.targetPort ?? '-') },
                { title: '节点端口', width: 120, render: (_, r) => numv(r.nodePort) ?? '-' },
              ]}
            />
          </Section>
          <Section title="容器组">
            <PodTable items={selectorPods} onOpenPod={onOpenPod} />
          </Section>
        </>
      )
    }

    if (d.key === 'ingresses') {
      const rules = objArr(sp.rules).flatMap((rule) => {
        const host = text(rule.host) ?? '*'
        const paths = objArr(dict(rule.http).paths)
        return paths.length
          ? paths.map((p) => ({
              host,
              path: text(p.path) ?? '/',
              pathType: text(p.pathType) ?? 'Prefix',
              backend: servicePortOf(p.backend),
            }))
          : [{ host, path: '-', pathType: '-', backend: '-' }]
      })
      const tls = objArr(sp.tls).map((t) => ({ hosts: objArr(t.hosts).map((h) => text(h) ?? '').filter(Boolean).join(', ') || '*', secret: text(t.secretName) ?? '-' }))
      return (
        <>
          <Section title="访问">
            <Descriptions
              size="small"
              column={2}
              styles={{ label: labelStyle }}
              items={[
                { key: 'gw', label: '网关地址', children: <span className="kbd-mono text-xs">{ingressAddress(data ?? {}) || '-'}</span> },
                { key: 'cls', label: 'IngressClass', children: text(sp.ingressClassName) ?? '-' },
                { key: 'def', label: '默认后端', children: dict(sp.defaultBackend) ? backendNameOf(dict(sp.defaultBackend)) : '-' },
              ]}
            />
          </Section>
          <Section title="转发规则">
            <Table
              rowKey={(r) => `${r.host}${r.path}`}
              size="small"
              pagination={false}
              dataSource={rules}
              locale={{ emptyText: '没有转发规则' }}
              columns={[
                { title: '域名', render: (_, r) => <span className="kbd-mono text-xs">{r.host}</span> },
                { title: '路径', width: 200, render: (_, r) => <span className="kbd-mono text-xs">{r.path}</span> },
                { title: '匹配类型', width: 120, render: (_, r) => r.pathType },
                { title: '后端服务', width: 220, render: (_, r) => <span className="kbd-mono text-xs">{r.backend}</span> },
              ]}
            />
          </Section>
          <Section title="TLS 证书">
            <Table
              rowKey={(r) => `${r.hosts}-${r.secret}`}
              size="small"
              pagination={false}
              dataSource={tls}
              locale={{ emptyText: '没有 TLS 证书' }}
              columns={[
                { title: '域名', render: (_, r) => <span className="kbd-mono text-xs">{r.hosts}</span> },
                { title: '保密字典', width: 240, render: (_, r) => <span className="kbd-mono text-xs">{r.secret}</span> },
              ]}
            />
          </Section>
        </>
      )
    }

    if (d.key === 'persistentvolumeclaims') {
      return (
        <Descriptions
          size="small"
          column={2}
          styles={{ label: labelStyle }}
          items={[
            { key: 's', label: '状态', children: <StatusText phase={text(st.phase)} /> },
            { key: 'c', label: '容量', children: text(dict(st.capacity).storage) ?? text(dict(dict(sp.resources).requests).storage) ?? '-' },
            { key: 'am', label: '访问模式', children: Array.isArray(sp.accessModes) ? (sp.accessModes as unknown[]).map(String).join(', ') || '-' : '-' },
            { key: 'pv', label: '持久卷', children: text(sp.volumeName) ?? '-' },
            { key: 'sc', label: '存储类', children: text(sp.storageClassName) ?? '-' },
            { key: 'vm', label: '卷模式', children: text(sp.volumeMode) ?? '-' },
          ]}
        />
      )
    }

    if (d.key === 'secrets') {
      const rows = [
        ...Object.entries(dict(dict(data).data)).map(([k, v]) => ({ name: k, value: text(v) ?? '', encoded: true })),
        ...Object.entries(dict(dict(data).stringData)).map(([k, v]) => ({ name: k, value: text(v) ?? '', encoded: false })),
      ]
      return (
        <>
          <Section title="类型">
            <Descriptions size="small" column={2} styles={{ label: labelStyle }} items={[{ key: 't', label: '类型', children: text(dict(data).type) ?? 'Opaque' }]} />
          </Section>
          <Section title="数据">
            <Table
              rowKey="name"
              size="small"
              pagination={false}
              dataSource={rows}
              locale={{ emptyText: '没有数据' }}
              columns={[
                { title: '名称', dataIndex: 'name', width: 260, render: (v: string) => <Tag>{v}</Tag> },
                {
                  title: '值',
                  dataIndex: 'value',
                  render: (v: string, r) => {
                    const plain = r.encoded ? b64decode(v) : v
                    const open = !!revealed[r.name]
                    return (
                      <Space size={6}>
                        <span className="kbd-mono text-xs">{open ? (plain || <Typography.Text type="secondary">（空）</Typography.Text>) : '••••••'}</span>
                        <Button
                          size="small"
                          type="text"
                          icon={open ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                          onClick={() => setRevealed((prev) => ({ ...prev, [r.name]: !prev[r.name] }))}
                        />
                      </Space>
                    )
                  },
                },
              ]}
            />
          </Section>
        </>
      )
    }

    if (d.key === 'configmaps') {
      const dataRows = Object.entries(dict(dict(data).data)).map(([k, v]) => ({ name: k, value: String(v ?? '') }))
      const binRows = Object.entries(dict(dict(data).binaryData)).map(([k, v]) => ({ name: k, size: b64decode(String(v ?? '')).length }))
      return (
        <>
          <Section
            title="数据"
            extra={
              <Button size="small" icon={<EditOutlined />} onClick={() => setCmEditOpen(true)}>
                编辑数据项
              </Button>
            }
          >
            <Table
              rowKey="name"
              size="small"
              pagination={false}
              dataSource={dataRows}
              locale={{ emptyText: '没有数据' }}
              expandable={{
                rowExpandable: (r) => r.value.includes('\n'),
                expandedRowRender: (r) => <pre className="kbd-mono m-0 max-h-72 overflow-auto rounded bg-slate-50 p-3 text-xs">{r.value}</pre>,
              }}
              columns={[
                { title: '名称', dataIndex: 'name', width: 260, render: (v: string) => <Tag>{v}</Tag> },
                {
                  title: '值',
                  dataIndex: 'value',
                  render: (v: string) => (v.includes('\n') ? <span className="text-xs text-[#8f9aa9]">{v.split('\n').length} 行（点击左侧展开）</span> : <span className="kbd-mono text-xs">{v}</span>),
                },
              ]}
            />
          </Section>
          <Section title="二进制数据">
            <Table
              rowKey="name"
              size="small"
              pagination={false}
              dataSource={binRows}
              locale={{ emptyText: '没有二进制数据' }}
              columns={[
                { title: '名称', dataIndex: 'name', render: (v: string) => <Tag>{v}</Tag> },
                { title: '大小', width: 200, render: (_, r) => memory(r.size) },
              ]}
            />
          </Section>
        </>
      )
    }

    if (d.key === 'serviceaccounts') {
      const subjectsOf = (o: K8sObject) => objArr(dict(o.spec).subjects)
      const matched = (list: K8sObject[]) =>
        list.filter((o) => subjectsOf(o).some((s) => (text(s.kind) === 'ServiceAccount' || text(s.kind) === 'Group') && text(s.name) === decoded && (text(s.namespace) ?? targetNs) === targetNs))
      const bindings = [
        ...matched(rbacRes.data?.rb ?? []).map((o) => ({ ...o, __scope: '角色绑定' })),
        ...matched(rbacRes.data?.crb ?? []).map((o) => ({ ...o, __scope: '集群角色绑定' })),
      ]
      const declared = objArr(sp.secrets).map((s) => text(s.name) ?? '')
      // K8s 1.24+ 不再把令牌写进 spec.secrets，按注解回填自动挂载的保密字典
      const annotated = (rbacRes.data?.secrets ?? [])
        .filter((s) => text(dict(dict(s.metadata).annotations)['kubernetes.io/service-account.name']) === decoded)
        .map((s) => s.metadata?.name ?? '')
      const saSecrets = [...new Set([...declared, ...annotated])].filter(Boolean)
      const pullSecrets = objArr(sp.imagePullSecrets).map((s) => text(s.name) ?? '')
      return (
        <>
          <Section title="自动挂载 API 凭据">
            <Descriptions
              size="small"
              column={2}
              styles={{ label: labelStyle }}
              items={[{ key: 'am', label: '自动挂载 API 凭据', children: boolv(sp.automountServiceAccountToken) === undefined ? '未设置（默认挂载）' : boolv(sp.automountServiceAccountToken) ? '是' : '否' }]}
            />
          </Section>
          <Section title="挂载的保密字典">
            <Table
              rowKey="name"
              size="small"
              pagination={false}
              dataSource={saSecrets.length ? saSecrets.map((n) => ({ name: n })) : []}
              locale={{ emptyText: '没有挂载的保密字典' }}
              columns={[{ title: '名称', dataIndex: 'name', render: (v: string) => <span className="kbd-mono text-xs">{v}</span> }]}
            />
          </Section>
          <Section title="镜像拉取凭据">
            <Table
              rowKey="name"
              size="small"
              pagination={false}
              dataSource={pullSecrets.length ? pullSecrets.map((n) => ({ name: n })) : []}
              locale={{ emptyText: '没有镜像拉取凭据' }}
              columns={[{ title: '名称', dataIndex: 'name', render: (v: string) => <span className="kbd-mono text-xs">{v}</span> }]}
            />
          </Section>
          <Section title="角色绑定">
            <Table<K8sObject>
              rowKey={(o) => `${(o as { __scope?: string }).__scope}-${o.metadata?.namespace ?? ''}-${o.metadata?.name ?? ''}`}
              size="small"
              pagination={false}
              dataSource={bindings}
              loading={rbacRes.loading}
              locale={{ emptyText: '没有关联的角色绑定' }}
              columns={[
                { title: '名称', render: (_, o) => o.metadata?.name ?? '-' },
                { title: '类型', width: 160, render: (_, o) => (o as { __scope?: string }).__scope ?? '-' },
                { title: '角色', width: 200, render: (_, o) => <span className="kbd-mono text-xs">{text(dict(dict(o.spec).roleRef).name) ?? '-'}</span> },
              ]}
            />
          </Section>
        </>
      )
    }

    if (d.key === 'pods') {
      const cs = objArr(st.containerStatuses)
      return (
        <>
          <Descriptions
            size="small"
            column={3}
            styles={{ label: labelStyle }}
            items={[
              { key: 'p', label: '状态', children: <StatusText phase={text(st.phase)} /> },
              { key: 'ip', label: '容器组 IP 地址', children: text(st.podIP) ?? '-' },
              { key: 'node', label: '节点', children: text(sp.nodeName) ?? '-' },
              { key: 'qos', label: 'QoS 类别', children: text(st.qosClass) ?? '-' },
              { key: 'rs', label: '重启次数', children: cs.reduce((acc, c) => acc + (numv(c.restartCount) ?? 0), 0) },
              { key: 'start', label: '启动时间', children: datetime(text(st.startTime)) },
            ]}
          />
          <Section title="容器">
            <Table<Dict>
              rowKey={(c, i) => `${text(c.name) ?? ''}-${i ?? 0}`}
              size="small"
              pagination={false}
              dataSource={objArr(sp.containers)}
              locale={{ emptyText: '没有容器' }}
              columns={[
                { title: '名称', width: 180, render: (_, c) => text(c.name) ?? '-' },
                { title: '镜像', render: (_, c) => <span className="kbd-mono text-xs">{text(c.image) ?? '-'}</span> },
                {
                  title: '状态',
                  width: 120,
                  render: (_, c) => <StatusText phase={containerStateReason(cs.find((s) => text(s.name) === text(c.name)) ?? {})} />,
                },
                {
                  title: '重启次数',
                  width: 100,
                  render: (_, c) => numv(cs.find((s) => text(s.name) === text(c.name))?.restartCount) ?? 0,
                },
              ]}
            />
          </Section>
        </>
      )
    }

    // 通用兜底（存储类、工作负载模板等）：spec / status 的扁平字段
    const flatRows = (source: Dict, omit?: string[]) =>
      Object.entries(source).filter(([k, v]) => !(omit?.includes(k) ?? false) && ['string', 'number', 'boolean'].includes(typeof v))
    const specEntries = flatRows(sp)
    const statusEntries = flatRows(st)
    const extraEntries = flatRows(dict(data), ['apiVersion', 'kind', 'metadata', 'spec', 'status'])
    const flat = (title: string, rows: [string, unknown][]) =>
      rows.length ? (
        <Section title={title}>
          <Descriptions size="small" column={2} styles={{ label: labelStyle }} items={rows.map(([k, v]) => ({ key: k, label: k, children: <span className="kbd-mono text-xs">{String(v)}</span> }))} />
        </Section>
      ) : null
    return (
      <>
        {flat('字段', extraEntries)}
        {flat('规格', specEntries)}
        {flat('状态', statusEntries)}
        {d.key === 'workloadtemplates' && (
          <Section title="模板">
            <pre className="kbd-mono m-0 max-h-96 overflow-auto rounded bg-slate-50 p-3 text-xs">{toYaml(sp)}</pre>
          </Section>
        )}
      </>
    )
  }

  /* ------------------------------------------------------------ CRD 两标签 */

  const crdDefTab = (): ReactNode => {
    const names = dict(sp.names)
    const versions = objArr(sp.versions)
    return (
      <>
        <Descriptions
          size="small"
          column={2}
          styles={{ label: labelStyle }}
          items={[
            { key: 'n', label: '名称', children: <span className="kbd-mono text-xs">{data?.metadata?.name ?? decoded}</span> },
            { key: 'g', label: '组', children: <span className="kbd-mono text-xs">{text(sp.group) ?? '-'}</span> },
            { key: 'sc', label: '作用域', children: text(sp.scope) ?? '-' },
            { key: 'cat', label: '类别', children: `${text(names.kind) ?? '-'} · ${text(names.plural) ?? '-'} · ${text(names.singular) ?? '-'} · ${text(names.listKind) ?? '-'}` },
          ]}
        />
        <Section title="版本">
          <Table<Dict>
            rowKey={(r, i) => `${text(r.name) ?? ''}-${i ?? 0}`}
            size="small"
            pagination={false}
            dataSource={versions}
            locale={{ emptyText: '没有版本' }}
            columns={[
              { title: '版本', width: 140, render: (_, r) => <Tag>{text(r.name) ?? '-'}</Tag> },
              { title: '存储版本', width: 110, render: (_, r) => <BoolCell v={boolv(r.storage)} /> },
              { title: '服务版本', width: 110, render: (_, r) => <BoolCell v={boolv(r.served)} /> },
              { title: '描述', render: (_, r) => text(r.description) ?? '-' },
            ]}
          />
        </Section>
      </>
    )
  }

  const crListTab = (): ReactNode => {
    if (!crDesc) return <Empty description="无法从定义推断其实例资源" image={Empty.PRESENTED_IMAGE_SIMPLE} />
    const items = toItems(crRes.data)
    return (
      <Table<K8sObject>
        rowKey={(o) => o.metadata?.uid ?? `${o.metadata?.namespace}/${o.metadata?.name}`}
        size="small"
        loading={crRes.loading}
        dataSource={items}
        locale={{ emptyText: crRes.error ? '无法读取自定义资源' : '没有自定义资源' }}
        pagination={{ pageSize: 10, hideOnSinglePage: true, showTotal: (t) => `共 ${t} 条` }}
        columns={[
          { title: '名称', render: (_, o) => <span className="kbd-mono text-xs">{o.metadata?.name}</span> },
          ...(crDesc.scope === 'Namespaced' ? [{ title: '项目', width: 200, render: (_: unknown, o: K8sObject) => o.metadata?.namespace ?? '-' }] : []),
          { title: '创建时间', width: 200, render: (_, o) => datetime(o.metadata?.creationTimestamp) },
        ]}
      />
    )
  }

  /* ------------------------------------------------------------ 组装标签页 */

  const tabItems: { key: string; label: string; children: ReactNode }[] = []
  if (d.key === 'customresourcedefinitions') {
    tabItems.push({ key: 'crdDef', label: '定制资源定义', children: <div className="p-5">{crdDefTab()}</div> })
    tabItems.push({ key: 'crList', label: '自定义资源', children: <div className="p-5">{crListTab()}</div> })
  } else {
    tabItems.push({ key: 'status', label: '资源状态', children: <div className="p-5">{statusTab()}</div> })
  }
  tabItems.push({
    key: 'meta',
    label: '元数据',
    children: (
      <div className="p-5">
        <Section title="标签">
          <LabelTable data={data?.metadata?.labels} empty="没有标签" />
        </Section>
        <Section title="注解">
          <LabelTable data={data?.metadata?.annotations} empty="没有注解" />
        </Section>
        <Section title="所有者引用">
          <Table<Dict>
            rowKey={(r, i) => `${text(r.kind) ?? ''}-${text(r.name) ?? ''}-${i ?? 0}`}
            size="small"
            pagination={false}
            dataSource={objArr(dict(data?.metadata).ownerReferences)}
            locale={{ emptyText: '没有所有者引用' }}
            columns={[
              { title: '类型', width: 200, render: (_, r) => text(r.kind) ?? '-' },
              { title: '名称', render: (_, r) => text(r.name) ?? '-' },
            ]}
          />
        </Section>
        <Section title="创建者">
          <Typography.Text style={{ fontSize: 13 }}>{creator || '-'}</Typography.Text>
        </Section>
      </div>
    ),
  })
  tabItems.push({
    key: 'events',
    label: '事件',
    children: <div className="p-5">{cluster ? <EventsPanel cluster={cluster} kind={d.kind} name={decoded} namespace={targetNs} /> : <Empty description="请先选择在线集群" image={Empty.PRESENTED_IMAGE_SIMPLE} />}</div>,
  })
  tabItems.push({
    key: 'yaml',
    label: 'YAML',
    children: (
      <div className="p-5">
        <pre className="kbd-mono m-0 overflow-auto rounded bg-slate-50 p-3 text-xs" style={{ maxHeight: 520 }}>
          {toYaml(data ?? {})}
        </pre>
      </div>
    ),
  })

  return (
    <>
      {error && (
        <Alert
          className="mx-5 mt-4"
          type="error"
          showIcon
          message={
            <Space>
              <Tag color="red" variant="filled">接口错误</Tag>
              {error}
            </Space>
          }
        />
      )}

      <div className="px-5 pb-4 pt-4">
        <div className="mb-3 flex items-center gap-2">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {namespace ?? '-'} / {decoded}
          </Typography.Text>
          <span className="ml-auto flex items-center gap-2">
            <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={refresh} />
            <Dropdown trigger={['click']} menu={{ items: menuItems, onClick: onMenuClick }}>
              <Button size="small">
                更多操作 <DownOutlined />
              </Button>
            </Dropdown>
          </span>
        </div>
        <AttrStrip typeLabel={d.label} items={attrs} />
      </div>

      <Tabs className="ks-tabs px-1" items={tabItems} />

      <Modal open={infoOpen} title={`编辑信息 · ${decoded}`} confirmLoading={busy} onCancel={() => setInfoOpen(false)} onOk={saveInfo} okText="确定" cancelText="取消">
        <Form form={infoForm} layout="vertical" autoComplete="off" className="py-2">
          <Form.Item label="别名" name="alias">
            <Input maxLength={63} placeholder="请输入别名" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="请输入描述" />
          </Form.Item>
          <LabelRowsField />
        </Form>
      </Modal>

      {cmEditOpen && (
        <EditConfigMapModal
          open
          onClose={() => setCmEditOpen(false)}
          name={decoded}
          namespace={data?.metadata?.namespace ?? targetNs ?? 'default'}
          busy={busy}
          initial={{
            items: Object.entries(dict(data?.data)).map(([key, value]) => ({ key, value: text(value) ?? '' })),
            LabelRows: Object.entries(dict(data?.metadata?.labels)).map(([key, value]) => ({ key, value: text(value) ?? '' })),
            Alias: data?.metadata?.annotations?.[ANNO_ALIAS] ?? '',
            Description: data?.metadata?.annotations?.[ANNO_DESC] ?? '',
          }}
          binaryKeys={Object.keys(dict(data?.binaryData))}
          onSubmit={saveConfigData}
        />
      )}

      <Modal open={yamlOpen} title={`编辑 YAML · ${decoded}`} width={720} confirmLoading={busy} onCancel={() => setYamlOpen(false)} onOk={saveYaml} okText="提交">
        <Input.TextArea className="kbd-mono" spellCheck={false} value={yamlText} onChange={(e) => setYamlText(e.target.value)} autoSize={{ minRows: 16, maxRows: 26 }} style={{ fontSize: 12 }} />
      </Modal>

      <Modal open={viewOpen} title={`查看 YAML · ${decoded}`} width={720} onCancel={() => setViewOpen(false)} footer={<Button onClick={() => setViewOpen(false)}>关闭</Button>}>
        <pre className="kbd-mono m-0 max-h-[60vh] overflow-auto rounded bg-slate-50 p-3 text-xs">{toYaml(data ?? {})}</pre>
      </Modal>
    </>
  )
}

/** 通用资源详情抽屉：正文自带操作区，抽屉只负责标题与关闭 */
export function ResourceDetailDrawer({
  cluster,
  descriptor,
  namespace,
  name,
  onClose,
  onOpenPod,
  onOpenResource,
  onDeleted,
  onChanged,
}: {
  cluster: string
  descriptor: ResourceDescriptor
  namespace?: string
  name?: string
  onClose: () => void
  onOpenPod?: (namespace: string, podName: string) => void
  onOpenResource?: (key: string, namespace: string, name: string) => void
  onDeleted?: () => void
  onChanged?: () => void
}) {
  return (
    <DetailDrawer open={!!name} title={`资源详情 · ${name ?? ''}`} onClose={onClose}>
      {name && (
        <ResourceDetailBody
          cluster={cluster}
          descriptor={descriptor}
          namespace={namespace}
          name={name}
          onOpenPod={onOpenPod}
          onOpenResource={onOpenResource}
          onDeleted={onDeleted}
          onChanged={onChanged}
        />
      )}
    </DetailDrawer>
  )
}

/** 旧整页详情路由的兼容壳：同一路径直接以抽屉呈现 */
export default function ResourceDetailPage() {
  const { clusterId, key, namespace, name } = useParams<{ clusterId?: string; key?: string; namespace?: string; name?: string }>()
  const storeCluster = useClusterStore((s) => s.cluster)
  const navigate = useNavigate()
  const cluster = clusterId ?? storeCluster
  const descriptor = findDescriptor(key)
  if (!descriptor) return <Empty description="未知的资源类型" className="py-24" />
  return (
    <ResourceDetailDrawer
      cluster={cluster}
      descriptor={descriptor}
      namespace={namespace}
      name={name}
      onClose={() => navigate(-1)}
      onOpenPod={(ns, podName) => navigate(clusterPath(cluster, `pods/${ns}/${encodeURIComponent(podName)}`))}
      onOpenResource={(resKey, ns, resName) => navigate(clusterPath(cluster, `res/${resKey}/${ns}/${encodeURIComponent(resName)}`))}
      onDeleted={() => navigate(clusterPath(cluster, `res/${key}`))}
    />
  )
}

/* ------------------------------------------------------------ 服务/路由辅助 */

/** 集群内域名之外，KubeSphere 还会给出一个可访问的外部地址 */
function serviceExternal(o: K8sObject): string {
  const sp = specOf(o)
  const st = statusOf(o)
  const type = text(sp.type) ?? 'ClusterIP'
  const lb = objArr(dict(st.loadBalancer).ingress)
    .map((i) => text(i.hostname) ?? text(i.ip) ?? '')
    .filter(Boolean)
  const extIps = objArr(sp.externalIPs).map((v) => text(v) ?? '').filter(Boolean)
  const nodePorts = objArr(sp.ports).map((p) => numv(p.nodePort)).filter((n): n is number => typeof n === 'number')
  if (type === 'LoadBalancer') return lb.length ? lb.join(', ') : extIps.length ? extIps.join(', ') : '等待分配外部地址'
  if (type === 'ExternalName') return text(sp.externalName) ?? '-'
  if (type === 'NodePort') return nodePorts.length ? `<节点 IP>:${nodePorts.join('、')}` : '-'
  return extIps.length ? extIps.join(', ') : '-'
}

function ingressAddress(o: K8sObject): string {
  const ingress = objArr(dict(statusOf(o).loadBalancer).ingress)
    .map((i) => text(i.hostname) ?? text(i.ip) ?? '')
    .filter(Boolean)
  return ingress.join(', ')
}

function servicePortOf(backend: unknown): string {
  const b = dict(backend)
  const svc = dict(b.service)
  if (text(svc.name)) return `${svc.name}:${dict(svc.port).number ?? text(dict(svc.port).name) ?? '-'}`
  if (dict(b.resource)) return text(dict(dict(b.resource).name)) ?? '-'
  return '-'
}

function backendNameOf(b: Dict): string {
  const svc = dict(b.service)
  if (text(svc.name)) return `${svc.name}:${dict(svc.port).number ?? '-'}`
  return text(dict(b.resource).name) ?? '-'
}
