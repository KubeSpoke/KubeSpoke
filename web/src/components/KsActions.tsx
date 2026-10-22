import { App, Button, Input, Modal, Select, Space, Table, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { resourceApi } from '../api/resources'
import type { K8sObject } from '../api/resources'
import type { ResourceDescriptor } from '../config/nav'
import { toYaml } from '../utils/yaml'

/** 行操作弹窗逻辑：ResourceListPage 与后续专属列表页共用 */
export interface KsActionCtx {
  cluster: string
  d: ResourceDescriptor
  refresh: () => void
}

type Items = MenuProps['items']
type Rec = Record<string, unknown>

const ALIAS_KEY = 'kubesphere.io/alias-name'
const DESC_KEY = 'kubesphere.io/description'

const asRec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const asArr = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Rec[] : [])
const asStr = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))
const strMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(asRec(v))) out[k] = asStr(val)
  return out
}

const specOf = (o: K8sObject): Rec => asRec(o.spec)
const metaOf = (o: K8sObject): Rec => asRec(o.metadata)
const nameOf = (o: K8sObject): string => asStr(metaOf(o).name)
const nsOf = (o: K8sObject): string | undefined => {
  const ns = metaOf(o).namespace
  return ns ? asStr(ns) : undefined
}

/** 读回来的对象删掉 status 后即可 apply（resourceVersion 保留 => 走替换） */
const stripStatus = (o: K8sObject): K8sObject => {
  const clone: K8sObject = JSON.parse(JSON.stringify(o)) as K8sObject
  delete clone.status
  return clone
}

// ---------------------------------------------------------------- 动作清单

const LABELS: Record<string, string> = {
  editInfo: '编辑信息',
  viewYaml: '查看 YAML',
  editYaml: '编辑 YAML',
  recreate: '重新创建',
  template: '生成模板',
  rerun: '重新运行',
  pause: '暂停',
  resume: '继续',
  editService: '编辑服务',
  editExternal: '编辑外部访问',
  editRules: '编辑路由规则',
  editAnnotations: '编辑注解',
  editSettings: '编辑设置',
  delete: '删除',
}

const ACTIONS_BY_KEY: Record<string, string[]> = {
  statefulsets: ['editInfo', 'editYaml', 'recreate', 'template', 'delete'],
  daemonsets: ['editInfo', 'editYaml', 'recreate', 'template', 'delete'],
  jobs: ['editInfo', 'rerun', 'delete'],
  cronjobs: ['editInfo', 'editYaml', 'pause', 'delete'],
  pods: ['viewYaml', 'editYaml', 'delete'],
  services: ['editInfo', 'editYaml', 'editService', 'editExternal', 'delete'],
  ingresses: ['editInfo', 'editYaml', 'editRules', 'editAnnotations', 'delete'],
  persistentvolumeclaims: ['editInfo', 'editYaml', 'delete'],
  storageclasses: ['editInfo', 'delete'],
  secrets: ['editInfo', 'editYaml', 'editSettings', 'delete'],
  configmaps: ['editInfo', 'editYaml', 'editSettings', 'delete'],
  serviceaccounts: ['editInfo', 'editYaml', 'delete'],
  workloadtemplates: ['editInfo', 'delete'],
}

/** 需要弹窗编辑的动作；其余（recreate/rerun/pause/resume/template/delete）点击即执行或确认 */
const MODAL_ACTIONS = new Set([
  'editInfo',
  'viewYaml',
  'editYaml',
  'editService',
  'editExternal',
  'editRules',
  'editAnnotations',
  'editSettings',
])

const rand5 = () => Math.random().toString(36).replace(/[^a-z0-9]/g, 'x').padEnd(5, '0').slice(0, 5)

const b64dec = (v: string): string => {
  try {
    return atob(v)
  } catch {
    return v
  }
}

// ---------------------------------------------------------------- 弹窗体（各自持有一次性状态）

interface BodyProps {
  obj: K8sObject
  onCancel: () => void
  /** 传入基于 obj 修改后的完整对象，由外层负责 applyYaml */
  onSave: (patched: K8sObject) => Promise<void>
}

function EditInfoBody({ obj, onCancel, onSave }: BodyProps) {
  const ann = strMap(metaOf(obj).annotations)
  const [alias, setAlias] = useState(ann[ALIAS_KEY] ?? '')
  const [desc, setDesc] = useState(ann[DESC_KEY] ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const next = stripStatus(obj)
    const metadata: Rec = { ...asRec(next.metadata) }
    const annotations: Record<string, string> = { ...strMap(metadata.annotations) }
    if (alias.trim()) annotations[ALIAS_KEY] = alias.trim()
    else delete annotations[ALIAS_KEY]
    if (desc.trim()) annotations[DESC_KEY] = desc.trim()
    else delete annotations[DESC_KEY]
    if (Object.keys(annotations).length) metadata.annotations = annotations
    else delete metadata.annotations
    next.metadata = metadata as K8sObject['metadata']
    setBusy(true)
    try {
      await onSave(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Typography.Text className="mb-1 block">别名</Typography.Text>
      <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="为资源设置别名（可选）" className="mb-3" />
      <Typography.Text className="mb-1 block">描述</Typography.Text>
      <Input.TextArea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="为资源添加描述（可选）" />
      <div className="mt-4 text-right">
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={busy} onClick={save}>
            确定
          </Button>
        </Space>
      </div>
    </>
  )
}

/** 查看 YAML：只读展示（编辑 YAML 走 YamlEditWrapper） */
function YamlBody({ obj, onCancel }: BodyProps) {
  const text = toYaml(obj)
  return (
    <>
      <pre className="kbd-mono m-0 max-h-[52vh] overflow-auto rounded bg-slate-50 p-3 text-xs">{text}</pre>
      <div className="mt-4 text-right">
        <Button onClick={onCancel}>关闭</Button>
      </div>
    </>
  )
}

// ---- Service：spec.ports 行编辑 -------------------------------------

interface PortRow {
  name: string
  protocol: string
  port: number | null
  targetPort: string
}

function portsToRows(ports: Rec[]): PortRow[] {
  return ports.map((p) => ({
    name: asStr(p.name),
    protocol: asStr(p.protocol) || 'TCP',
    port: p.port === undefined ? null : Number(p.port),
    targetPort: asStr(p.targetPort),
  }))
}

function EditServiceBody({ obj, onCancel, onSave }: BodyProps) {
  const [rows, setRows] = useState<PortRow[]>(() => portsToRows(asArr(specOf(obj).ports)))
  const [busy, setBusy] = useState(false)

  const patch = (i: number, key: keyof PortRow, v: unknown) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: v as never } : r)))

  const save = async () => {
    const next = stripStatus(obj)
    const ports = rows
      .filter((r) => r.port != null)
      .map((r) => {
        const item: Rec = { protocol: r.protocol || 'TCP', port: r.port }
        if (r.name.trim()) item.name = r.name.trim()
        const tp = r.targetPort.trim()
        if (tp) item.targetPort = /^\d+$/.test(tp) ? Number(tp) : tp
        const origin = asArr(specOf(obj).ports)[rows.indexOf(r)]
        if (origin?.nodePort !== undefined) item.nodePort = origin.nodePort
        return item
      })
    next.spec = { ...specOf(next), ports }
    setBusy(true)
    try {
      await onSave(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Table<PortRow>
        rowKey={(_, i) => String(i)}
        size="small"
        pagination={false}
        dataSource={rows}
        columns={[
          { title: '名称', render: (_, r, i) => <Input size="small" value={r.name} onChange={(e) => patch(i, 'name', e.target.value)} placeholder="http" /> },
          {
            title: '协议',
            width: 100,
            render: (_, r, i) => (
              <Select
                size="small"
                className="w-full"
                value={r.protocol}
                onChange={(v) => patch(i, 'protocol', v)}
                options={['TCP', 'UDP'].map((p) => ({ value: p, label: p }))}
              />
            ),
          },
          { title: '端口', width: 110, render: (_, r, i) => <Input size="small" type="number" value={r.port ?? ''} onChange={(e) => patch(i, 'port', e.target.value === '' ? null : Number(e.target.value))} /> },
          { title: '容器端口', width: 120, render: (_, r, i) => <Input size="small" value={r.targetPort} onChange={(e) => patch(i, 'targetPort', e.target.value)} placeholder="80 或 http" /> },
          {
            title: '',
            width: 40,
            render: (_, __, i) => (
              <Button size="small" type="text" danger onClick={() => setRows((rs) => rs.filter((_x, idx) => idx !== i))}>
                删除
              </Button>
            ),
          },
        ]}
      />
      <Button size="small" className="mt-2" onClick={() => setRows((rs) => [...rs, { name: '', protocol: 'TCP', port: null, targetPort: '' }])}>
        + 添加端口
      </Button>
      <div className="mt-4 text-right">
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={busy} onClick={save}>
            确定
          </Button>
        </Space>
      </div>
    </>
  )
}

// ---- Service：外部访问（spec.type） ----------------------------------

function EditExternalBody({ obj, onCancel, onSave }: BodyProps) {
  const [type, setType] = useState<string>(() => asStr(specOf(obj).type) || 'ClusterIP')
  const [busy, setBusy] = useState(false)
  const ports = asArr(specOf(obj).ports)

  const save = async () => {
    const next = stripStatus(obj)
    next.spec = { ...specOf(next), type }
    setBusy(true)
    try {
      await onSave(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Typography.Text className="mb-1 block">类型</Typography.Text>
      <Select
        className="mb-3 w-full"
        value={type}
        onChange={setType}
        options={['ClusterIP', 'NodePort', 'LoadBalancer'].map((t) => ({ value: t, label: t }))}
      />
      <Table<Rec>
        rowKey={(_, i) => String(i)}
        size="small"
        pagination={false}
        dataSource={ports}
        columns={[
          { title: '名称', render: (_, p) => asStr(p.name) || '-' },
          { title: '协议', width: 90, render: (_, p) => asStr(p.protocol) || 'TCP' },
          { title: '端口', width: 90, render: (_, p) => asStr(p.port) || '-' },
          { title: '容器端口', width: 100, render: (_, p) => asStr(p.targetPort) || '-' },
          { title: '节点端口', width: 100, render: (_, p) => (p.nodePort === undefined ? '-' : asStr(p.nodePort)) },
        ]}
      />
      <div className="mt-4 text-right">
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={busy} onClick={save}>
            确定
          </Button>
        </Space>
      </div>
    </>
  )
}

// ---- Ingress：路由规则行编辑 -----------------------------------------

interface RuleRow {
  host: string
  path: string
  pathType: string
  service: string
  port: string
}

function rulesToRows(rules: Rec[]): RuleRow[] {
  const rows: RuleRow[] = []
  for (const rule of rules) {
    const host = asStr(rule.host)
    const paths = asArr(asRec(rule.http).paths)
    if (!paths.length) {
      rows.push({ host, path: '/', pathType: 'Prefix', service: '', port: '' })
      continue
    }
    for (const p of paths) {
      const port = asRec(asRec(p.backend).service).port
      rows.push({
        host,
        path: asStr(p.path) || '/',
        pathType: asStr(p.pathType) || 'Prefix',
        service: asStr(asRec(asRec(p.backend).service).name),
        port: port === undefined ? '' : asStr(port) || asStr(asRec(port).number) || asStr(asRec(port).name),
      })
    }
  }
  return rows
}

function rowsToRules(rows: RuleRow[]): Rec[] {
  const byHost = new Map<string, Rec[]>()
  for (const r of rows) {
    if (!r.service.trim()) continue
    const paths = byHost.get(r.host) ?? []
    const portRec: Rec = /^\d+$/.test(r.port.trim()) ? { number: Number(r.port.trim()) } : { name: r.port.trim() }
    paths.push({ path: r.path || '/', pathType: r.pathType || 'Prefix', backend: { service: { name: r.service.trim(), port: portRec } } })
    byHost.set(r.host, paths)
  }
  return Array.from(byHost.entries()).map(([host, paths]) => {
    const rule: Rec = { http: { paths } }
    if (host.trim()) rule.host = host.trim()
    return rule
  })
}

const PATH_TYPES = ['Prefix', 'Exact', 'ImplementationSpecific']

function EditRulesBody({ obj, onCancel, onSave }: BodyProps) {
  const [rows, setRows] = useState<RuleRow[]>(() => {
    const r = rulesToRows(asArr(specOf(obj).rules))
    return r.length ? r : [{ host: '', path: '/', pathType: 'Prefix', service: '', port: '' }]
  })
  const [busy, setBusy] = useState(false)

  const patch = (i: number, key: keyof RuleRow, v: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)))

  const save = async () => {
    const next = stripStatus(obj)
    const spec: Rec = { ...specOf(next) }
    const rules = rowsToRules(rows)
    if (rules.length) spec.rules = rules
    else delete spec.rules
    next.spec = spec
    setBusy(true)
    try {
      await onSave(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Table<RuleRow>
        rowKey={(_, i) => String(i)}
        size="small"
        pagination={false}
        scroll={{ x: 640 }}
        dataSource={rows}
        columns={[
          { title: '域名', render: (_, r, i) => <Input size="small" value={r.host} onChange={(e) => patch(i, 'host', e.target.value)} placeholder="app.example.com" /> },
          { title: '路径', width: 120, render: (_, r, i) => <Input size="small" value={r.path} onChange={(e) => patch(i, 'path', e.target.value)} /> },
          {
            title: '匹配方式',
            width: 130,
            render: (_, r, i) => <Select size="small" className="w-full" value={r.pathType} onChange={(v) => patch(i, 'pathType', v)} options={PATH_TYPES.map((t) => ({ value: t, label: t }))} />,
          },
          { title: '后端服务', width: 140, render: (_, r, i) => <Input size="small" value={r.service} onChange={(e) => patch(i, 'service', e.target.value)} placeholder="service 名" /> },
          { title: '端口', width: 90, render: (_, r, i) => <Input size="small" value={r.port} onChange={(e) => patch(i, 'port', e.target.value)} placeholder="80" /> },
          { title: '', width: 40, render: (_, __, i) => <Button size="small" type="text" danger onClick={() => setRows((rs) => rs.filter((_x, idx) => idx !== i))}>删除</Button> },
        ]}
      />
      <Button size="small" className="mt-2" onClick={() => setRows((rs) => [...rs, { host: '', path: '/', pathType: 'Prefix', service: '', port: '' }])}>
        + 添加规则
      </Button>
      <div className="mt-4 text-right">
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={busy} onClick={save}>
            确定
          </Button>
        </Space>
      </div>
    </>
  )
}

// ---- 键值行编辑（注解 / 数据项） --------------------------------------

interface KvRow {
  key: string
  value: string
}

function KvBody({
  obj,
  onCancel,
  onSave,
  mode,
  empty,
}: BodyProps & { mode: 'annotations' | 'data'; empty: KvRow[] }) {
  const initial = (): KvRow[] => {
    if (mode === 'annotations') {
      const ann = strMap(metaOf(obj).annotations)
      const rows = Object.entries(ann).map(([key, value]) => ({ key, value }))
      return rows.length ? rows : empty
    }
    if (asRec(obj).kind === 'Secret') {
      const rows = Object.entries(strMap(asRec(obj).data)).map(([key, value]) => ({ key, value: b64dec(value) }))
      return rows.length ? rows : empty
    }
    const rows = [
      ...Object.entries(strMap(asRec(obj).data)).map(([key, value]) => ({ key, value })),
      ...Object.keys(strMap(asRec(obj).binaryData)).map((key) => ({ key, value: '' })),
    ]
    return rows.length ? rows : empty
  }
  const [rows, setRows] = useState<KvRow[]>(initial)
  const [busy, setBusy] = useState(false)

  const patch = (i: number, field: keyof KvRow, v: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)))

  const save = async () => {
    const next = stripStatus(obj)
    const map: Record<string, string> = {}
    for (const r of rows) {
      if (r.key.trim()) map[r.key.trim()] = r.value
    }
    if (mode === 'annotations') {
      const metadata: Rec = { ...asRec(next.metadata) }
      if (Object.keys(map).length) metadata.annotations = map
      else delete metadata.annotations
      next.metadata = metadata as K8sObject['metadata']
    } else {
      const payload: Rec = next as unknown as Rec
      delete payload.data
      delete payload.binaryData
      if (asRec(obj).kind === 'Secret') {
        // secret 走 stringData（applyYaml 后端可建），保留原 type
        if (asStr(obj.type)) payload.type = asStr(obj.type)
        payload.stringData = map
      } else {
        payload.data = map
      }
      // secret/configmap 顶层字段可能被 stripStatus 的浅拷贝丢掉？JSON 深拷贝保留全字段，无需处理
    }
    setBusy(true)
    try {
      await onSave(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {rows.map((r, i) => (
        <Space key={i} className="mb-2 w-full" align="start">
          <Input size="small" style={{ width: 200 }} value={r.key} onChange={(e) => patch(i, 'key', e.target.value)} placeholder="键" />
          <Input.TextArea
            size="small"
            style={{ flex: 1, minWidth: 240 }}
            autoSize={{ minRows: 1, maxRows: 6 }}
            value={r.value}
            onChange={(e) => patch(i, 'value', e.target.value)}
            placeholder="值"
          />
          <Button size="small" type="text" danger onClick={() => setRows((rs) => rs.filter((_x, idx) => idx !== i))}>
            删除
          </Button>
        </Space>
      ))}
      <Button size="small" onClick={() => setRows((rs) => [...rs, { key: '', value: '' }])}>
        + 添加条目
      </Button>
      <div className="mt-4 text-right">
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={busy} onClick={save}>
            确定
          </Button>
        </Space>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Hook

export function useKsActions(ctx: KsActionCtx): {
  menuItemsFor: (o: K8sObject) => Items
  modalNode: ReactNode
  open: (action: string, o: K8sObject) => void
} {
  const { cluster, d, refresh } = ctx
  const { message, modal } = App.useApp()

  const [pending, setPending] = useState<{ action: string; o: K8sObject; seq: number } | null>(null)
  const [loaded, setLoaded] = useState<K8sObject | null>(null)

  const actionsFor = (o: K8sObject): string[] => {
    let acts = ACTIONS_BY_KEY[d.key] ?? ['editYaml', 'delete']
    if (d.key === 'cronjobs') {
      const suspend = specOf(o).suspend === true
      acts = acts.map((a) => (a === 'pause' && suspend ? 'resume' : a))
    }
    return acts
  }

  /** 统一读-改-写保存：patched 已由弹窗体完成字段修改 */
  const savePatched = async (patched: K8sObject) => {
    try {
      await resourceApi.applyYaml(cluster, toYaml(patched))
      message.success('已保存')
      setPending(null)
      setLoaded(null)
      refresh()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const direct = async (action: string, o: K8sObject) => {
    const nm = nameOf(o)
    const ns = nsOf(o)
    try {
      if (action === 'template') {
        message.warning('生成模板需要集群安装 templating.kubesphere.io Template CRD，当前集群未安装')
        return
      }
      if (action === 'delete') {
        modal.confirm({
          title: `确定删除 ${nm} 吗？`,
          content: '删除后不可恢复。',
          okText: '删除',
          okButtonProps: { danger: true },
          onOk: async () => {
            await resourceApi.remove(cluster, d, nm, ns)
            message.success('已删除')
            refresh()
          },
        })
        return
      }
      const obj = await resourceApi.read(cluster, d, nm, ns)
      if (action === 'recreate') {
        const next = stripStatus(obj)
        const spec: Rec = { ...specOf(next) }
        const template: Rec = { ...asRec(spec.template) }
        template.metadata = { ...asRec(template.metadata), annotations: { ...strMap(asRec(template.metadata).annotations), 'kubespoke.io/restartedAt': new Date().toISOString() } }
        spec.template = template
        next.spec = spec
        await resourceApi.applyYaml(cluster, toYaml(next))
        message.success('已重新创建')
      } else if (action === 'pause' || action === 'resume') {
        const next = stripStatus(obj)
        next.spec = { ...specOf(next), suspend: action === 'pause' }
        await resourceApi.applyYaml(cluster, toYaml(next))
        message.success(action === 'pause' ? '已暂停' : '已继续')
      } else if (action === 'rerun') {
        const next: K8sObject = JSON.parse(JSON.stringify(obj)) as K8sObject
        delete next.status
        const metadata: Rec = { ...asRec(next.metadata) }
        delete metadata.uid
        delete metadata.resourceVersion
        delete metadata.creationTimestamp
        delete metadata.ownerReferences
        delete metadata.managedFields
        metadata.name = `${nm}-rerun-${rand5()}`
        const labels = strMap(metadata.labels)
        delete labels['controller-uid']
        delete labels['job-name']
        if (Object.keys(labels).length) metadata.labels = labels
        else delete metadata.labels
        next.metadata = metadata as K8sObject['metadata']
        const spec: Rec = { ...specOf(next) }
        delete spec.selector
        const tmpl: Rec = { ...asRec(spec.template) }
        const tmplMeta: Rec = { ...asRec(tmpl.metadata) }
        const tmplLabels = strMap(tmplMeta.labels)
        delete tmplLabels['controller-uid']
        delete tmplLabels['job-name']
        if (Object.keys(tmplLabels).length) tmplMeta.labels = tmplLabels
        else delete tmplMeta.labels
        tmpl.metadata = tmplMeta
        spec.template = tmpl
        next.spec = spec
        await resourceApi.applyYaml(cluster, toYaml(next))
        message.success(`已重新运行：${asStr(metadata.name)}`)
      }
      refresh()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const open = (action: string, o: K8sObject) => {
    if (!MODAL_ACTIONS.has(action)) {
      void direct(action, o)
      return
    }
    const seq = Date.now() + Math.random()
    setPending({ action, o, seq })
    setLoaded(null)
    // 统一读一次最新对象（列表对象可能缺全量字段）
    void resourceApi
      .read(cluster, d, nameOf(o), nsOf(o))
      .then(setLoaded)
      .catch((e: Error) => message.error(e.message))
  }

  const menuItemsFor = (o: K8sObject): Items =>
    actionsFor(o).map((a) => ({
      key: a,
      label: LABELS[a] ?? a,
      danger: a === 'delete',
      onClick: () => open(a, o),
    }))

  const TITLES: Record<string, string> = {
    editInfo: `编辑信息 - ${nameOf(pending?.o ?? {})}`,
    viewYaml: `查看 YAML - ${nameOf(pending?.o ?? {})}`,
    editYaml: `编辑 YAML - ${nameOf(pending?.o ?? {})}`,
    editService: `编辑服务 - ${nameOf(pending?.o ?? {})}`,
    editExternal: `编辑外部访问 - ${nameOf(pending?.o ?? {})}`,
    editRules: `编辑路由规则 - ${nameOf(pending?.o ?? {})}`,
    editAnnotations: `编辑注解 - ${nameOf(pending?.o ?? {})}`,
    editSettings: `编辑设置 - ${nameOf(pending?.o ?? {})}`,
  }

  let body: ReactNode = null
  if (pending && loaded && d) {
    const common: BodyProps = { obj: loaded, onCancel: () => setPending(null), onSave: savePatched }
    switch (pending.action) {
      case 'editInfo':
        body = <EditInfoBody key={pending.seq} {...common} />
        break
      case 'viewYaml':
        body = <YamlBody key={pending.seq} obj={loaded} onCancel={() => setPending(null)} onSave={savePatched} />
        break
      case 'editYaml':
        body = (
          <YamlEditWrapper key={pending.seq} cluster={cluster} onCancel={() => setPending(null)} afterSave={() => { setPending(null); setLoaded(null); refresh() }} loaded={loaded} />
        )
        break
      case 'editService':
        body = <EditServiceBody key={pending.seq} {...common} />
        break
      case 'editExternal':
        body = <EditExternalBody key={pending.seq} {...common} />
        break
      case 'editRules':
        body = <EditRulesBody key={pending.seq} {...common} />
        break
      case 'editAnnotations':
        body = <KvBody key={pending.seq} mode="annotations" empty={[{ key: '', value: '' }]} {...common} />
        break
      case 'editSettings':
        body = <KvBody key={pending.seq} mode="data" empty={[{ key: '', value: '' }]} {...common} />
        break
      default:
        body = null
    }
  }

  const modalNode =
    pending && body ? (
      <Modal
        open
        width={pending.action === 'viewYaml' || pending.action === 'editYaml' ? 720 : 680}
        title={TITLES[pending.action] ?? LABELS[pending.action]}
        footer={null}
        destroyOnHidden
        onCancel={() => setPending(null)}
      >
        {body}
      </Modal>
    ) : null

  return { menuItemsFor, modalNode, open }
}

/** 编辑 YAML：直接对文本负责，提交走 applyYaml（不经对象回传，避免格式损失） */
function YamlEditWrapper({
  cluster,
  loaded,
  onCancel,
  afterSave,
}: {
  cluster: string
  loaded: K8sObject
  onCancel: () => void
  afterSave: () => void
}) {
  const { message } = App.useApp()
  const [text, setText] = useState(() => {
    const clean: K8sObject = JSON.parse(JSON.stringify(loaded)) as K8sObject
    delete clean.status
    return toYaml(clean)
  })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await resourceApi.applyYaml(cluster, text)
      message.success('已保存')
      afterSave()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Input.TextArea className="kbd-mono" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} autoSize={{ minRows: 16, maxRows: 26 }} style={{ fontSize: 12 }} />
      <div className="mt-4 text-right">
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={busy} onClick={save}>
            确定
          </Button>
        </Space>
      </div>
    </>
  )
}
