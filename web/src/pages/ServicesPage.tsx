import {
  ClockCircleOutlined,
  CopyOutlined,
  DownOutlined,
  ExclamationCircleOutlined,
  GlobalOutlined,
  PartitionOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { App, Button, Dropdown, Empty, Form, Input, Modal, Select, Table, Tabs, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { resourceApi, toItems } from '../api/resources'
import type { K8sObject } from '../api/resources'
import { resourceDescriptors, clusterPath } from '../config/nav'
import type { ResourceDescriptor } from '../config/nav'
import { PodDetailDrawer } from './PodDetailPage'
import { ResourceDetailDrawer } from './ResourceDetailPage'
import { useResource } from '../hooks/useResource'
import { useClusterStore } from '../store/useClusterStore'
import { datetime } from '../utils/format'
import { toYaml } from '../utils/yaml'
import CreateIngressModal from './network/CreateIngressModal'
import CreateServiceModal from './network/CreateServiceModal'

/** Endpoint 没有独立菜单位，但详情路由复用通用资源详情页 */
const ENDPOINTS: ResourceDescriptor = {
  key: 'endpoints', label: 'Endpoint', kind: 'Endpoints', group: '', version: 'v1',
  plural: 'endpoints', scope: 'Namespaced', statusKind: 'none',
}

const SERVICES = resourceDescriptors.services
const INGRESSES = resourceDescriptors.ingresses

const ALIAS_KEY = 'kubesphere.io/alias-name'
const DESC_KEY = 'kubesphere.io/description'

const TABS = [
  { key: 'services', label: 'Service' },
  { key: 'ingresses', label: 'Ingress' },
  { key: 'dns', label: 'DNS' },
  { key: 'endpoints', label: 'Endpoint' },
]

const TONE_COLOR: Record<string, string> = { ok: '#59c492', warn: '#f5a623', danger: '#d94f4f', muted: '#9aa7b8' }

const TYPE_STYLE: Record<string, { color: string; bg: string }> = {
  ClusterIP: { color: '#2f6fed', bg: '#e8f1ff' },
  NodePort: { color: '#7c5cff', bg: '#f0ebff' },
  LoadBalancer: { color: '#d98a12', bg: '#fff4e0' },
  ExternalName: { color: '#1fa79a', bg: '#e2f7f5' },
}

const rec = (o: K8sObject, k: 'spec' | 'status') => ((o[k] ?? {}) as Record<string, unknown>)

interface PortItem {
  name?: string
  port: number
  targetPort?: number | string
  nodePort?: number
  protocol?: string
}

function svcPorts(o: K8sObject): PortItem[] {
  return (rec(o, 'spec').ports as PortItem[] | undefined) ?? []
}

function selectorText(o: K8sObject): string {
  const sel = (rec(o, 'spec').selector ?? {}) as Record<string, string>
  return Object.entries(sel).map(([k, v]) => `${k}=${v}`).join(',')
}

/** Service 状态：待删除 > 异常（LB 未分配端点 / ExternalName 缺域名）> 运行中 */
function svcStatus(o: K8sObject): { text: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } {
  if (o.metadata?.deletionTimestamp) return { text: '待删除', tone: 'muted' }
  const spec = rec(o, 'spec')
  const type = (spec.type as string) || 'ClusterIP'
  if (type === 'LoadBalancer') {
    const lb = (rec(o, 'status').loadBalancer as { ingress?: unknown[] } | undefined)
    if (!lb?.ingress?.length) return { text: '异常', tone: 'danger' }
  }
  if (type === 'ExternalName' && !spec.externalName) return { text: '异常', tone: 'danger' }
  return { text: '运行中', tone: 'ok' }
}

function extAccess(o: K8sObject): string {
  const spec = rec(o, 'spec')
  const type = (spec.type as string) || 'ClusterIP'
  if (type === 'ExternalName') return (spec.externalName as string) || '–'
  if (type === 'NodePort') {
    const np = svcPorts(o).map((p) => p.nodePort).filter(Boolean)
    return np.length ? np.join('/') : '–'
  }
  if (type === 'LoadBalancer') {
    const ing = (rec(o, 'status').loadBalancer as { ingress?: { ip?: string; hostname?: string }[] } | undefined)?.ingress
    return ing?.length ? (ing[0].ip ?? ing[0].hostname ?? '–') : '待分配'
  }
  return '–'
}

function ingressStatus(o: K8sObject): { text: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } {
  if (o.metadata?.deletionTimestamp) return { text: '待删除', tone: 'muted' }
  const ing = (rec(o, 'status').loadBalancer as { ingress?: unknown[] } | undefined)?.ingress
  return ing?.length ? { text: '运行中', tone: 'ok' } : { text: '等待端点', tone: 'warn' }
}

function ingressHosts(o: K8sObject): string {
  const rules = (rec(o, 'spec').rules as { host?: string }[] | undefined) ?? []
  return rules.map((r) => r.host ?? '*').join(', ') || '–'
}

function ingressTls(o: K8sObject): boolean {
  return ((rec(o, 'spec').tls as unknown[] | undefined) ?? []).length > 0
}

interface EpSubset {
  addresses?: { ip: string }[]
  notReadyAddresses?: { ip: string }[]
  ports?: { port: number }[]
}

function epSubsets(o: K8sObject): EpSubset[] {
  // Endpoints 的 subsets 是顶层字段，不在 spec 下
  return (o.subsets as EpSubset[] | undefined) ?? []
}

function epAddresses(o: K8sObject): string[] {
  const out: string[] = []
  for (const s of epSubsets(o)) {
    for (const a of s.addresses ?? []) for (const p of s.ports ?? [{ port: 0 }]) out.push(p.port ? `${a.ip}:${p.port}` : a.ip)
  }
  return out
}

function epNotReady(o: K8sObject): string[] {
  const out: string[] = []
  for (const s of epSubsets(o)) {
    for (const a of s.notReadyAddresses ?? []) for (const p of s.ports ?? [{ port: 0 }]) out.push(p.port ? `${a.ip}:${p.port}` : a.ip)
  }
  return out
}

function annotation(o: K8sObject, key: string): string {
  return (o.metadata?.annotations ?? {})[key] ?? ''
}

function writeAnnotation(o: K8sObject, key: string, value: string) {
  const meta = (o.metadata ?? {}) as NonNullable<K8sObject['metadata']>
  const ann = { ...meta.annotations } as Record<string, string>
  if (value) ann[key] = value
  else delete ann[key]
  meta.annotations = ann
  o.metadata = meta
}

interface Row {
  key: string
  d: ResourceDescriptor
  o: K8sObject
  ns: string
  name: string
}

interface Overview {
  services: K8sObject[]
  ingresses: K8sObject[]
  endpoints: K8sObject[]
  pods: K8sObject[]
}

const emptyCounts = { total: 0, running: 0, abnormal: 0, deleting: 0 }

/** 右侧竖排面板（与工作负载页同款） */
function Panel({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
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

function StatCard({ label, value, total, color, bg, icon, active, onClick }: {
  label: string; value: number; total: number; color: string; bg: string; icon: React.ReactNode; active?: boolean; onClick?: () => void
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
      <RightOutlined style={{ color: '#c9d2de', fontSize: 12 }} />
    </div>
  )
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[13px]">
      <span style={{ color: '#8f9aa9' }}>{label}</span>
      <span className="max-w-[60%] truncate text-right" style={{ color: '#15233a' }}>{value}</span>
    </div>
  )
}

export default function ServicesPage() {
  const navigate = useNavigate()
  const { message, modal } = App.useApp()
  const cluster = useClusterStore((s) => s.cluster)
  const namespace = useClusterStore((s) => s.namespace)
  const params = useParams<{ tab?: string }>()
  const tab = TABS.some((t) => t.key === params.tab) ? params.tab! : 'services'
  const setTab = (k: string) => {
    setFilterStatus(undefined)
    setSelected([])
    navigate(clusterPath(cluster, k === 'services' ? 'services' : `services/${k}`))
  }

  const { data, error, loading, refresh } = useResource<Overview | null>(
    async () => {
      if (!cluster) return null
      const [svcs, ings, eps, pods] = await Promise.all([
        resourceApi.list(cluster, SERVICES).catch(() => [] as K8sObject[]),
        resourceApi.list(cluster, INGRESSES).catch(() => [] as K8sObject[]),
        resourceApi.list(cluster, ENDPOINTS).catch(() => [] as K8sObject[]),
        resourceApi.list(cluster, resourceDescriptors.pods).catch(() => [] as K8sObject[]),
      ])
      return { services: toItems(svcs), ingresses: toItems(ings), endpoints: toItems(eps), pods: toItems(pods) }
    },
    [cluster],
  )

  const [filterNs, setFilterNs] = useState<string>()
  const [filterType, setFilterType] = useState<string>()
  const [filterSelector, setFilterSelector] = useState<string>()
  const [filterStatus, setFilterStatus] = useState<string>()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<React.Key[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [activeKey, setActiveKey] = useState<string>()
  const [yamlText, setYamlText] = useState<{ title: string; text: string } | null>(null)
  const [infoRow, setInfoRow] = useState<Row | null>(null)
  const [detailRow, setDetailRow] = useState<Row | null>(null)
  const [detailPod, setDetailPod] = useState<{ ns: string; name: string } | null>(null)
  const [detailRes, setDetailRes] = useState<{ d: ResourceDescriptor; ns: string; name: string } | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm<{ alias: string; description: string }>()

  const rowsByTab = useMemo(() => {
    const mk = (d: ResourceDescriptor, items: K8sObject[]): Row[] =>
      items.map((o) => ({
        key: `${d.key}/${o.metadata?.namespace ?? ''}/${o.metadata?.name ?? ''}`,
        d,
        o,
        ns: o.metadata?.namespace ?? '-',
        name: o.metadata?.name ?? '-',
      }))
    return {
      services: mk(SERVICES, data?.services ?? []),
      ingresses: mk(INGRESSES, data?.ingresses ?? []),
      endpoints: mk(ENDPOINTS, data?.endpoints ?? []),
      dns: [] as Row[],
    } as Record<string, Row[]>
  }, [data])

  const counts = useMemo(() => {
    const svc = { ...emptyCounts }
    for (const o of data?.services ?? []) {
      svc.total += 1
      if (o.metadata?.deletionTimestamp) svc.deleting += 1
      else if (svcStatus(o).tone === 'danger') svc.abnormal += 1
      else svc.running += 1
    }
    const ing = { ...emptyCounts }
    for (const o of data?.ingresses ?? []) {
      ing.total += 1
      if (o.metadata?.deletionTimestamp) ing.deleting += 1
      else if (ingressStatus(o).tone === 'ok') ing.running += 1
      else ing.abnormal += 1
    }
    const ep = { ...emptyCounts }
    for (const o of data?.endpoints ?? []) {
      ep.total += 1
      if (o.metadata?.deletionTimestamp) ep.deleting += 1
      else if (epAddresses(o).length) ep.running += 1
      else ep.abnormal += 1
    }
    return { services: svc, ingresses: ing, endpoints: ep }
  }, [data])

  const nsOptions = useMemo(() => {
    const set = new Set((rowsByTab[tab] ?? []).map((r) => r.ns))
    return [...set].sort().map((n) => ({ label: n, value: n }))
  }, [rowsByTab, tab])

  const selectorOptions = useMemo(
    () => [...new Set((data?.services ?? []).map(selectorText).filter(Boolean))].sort().map((s) => ({ label: s, value: s })),
    [data],
  )

  const rows = useMemo(() => {
    let rs = rowsByTab[tab] ?? []
    if (filterNs) rs = rs.filter((r) => r.ns === filterNs)
    if (tab === 'services' && filterType) rs = rs.filter((r) => ((rec(r.o, 'spec').type as string) || 'ClusterIP') === filterType)
    if (tab === 'services' && filterSelector) rs = rs.filter((r) => selectorText(r.o) === filterSelector)
    const q = search.trim().toLowerCase()
    if (q) {
      rs = rs.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        Object.entries(r.o.metadata?.labels ?? {}).some(([k, v]) => `${k}=${v}`.toLowerCase().includes(q)) ||
        selectorText(r.o).toLowerCase().includes(q),
      )
    }
    return rs
  }, [rowsByTab, tab, filterNs, filterType, filterSelector, search])

  /** 右侧详情跟随：默认选中当前页签第一条，点击行切换 */
  useEffect(() => {
    if (!rows.some((r) => r.key === activeKey)) setActiveKey(rows[0]?.key)
  }, [rows, activeKey])
  const active = rows.find((r) => r.key === activeKey) ?? rows[0]

  /* 详情统一走右侧抽屉：?detail=<key>/<ns>/<name> 可直达 */
  const openDetail = (r: Row) => {
    setDetailRow(r)
    const next = new URLSearchParams(searchParams)
    next.set('detail', `${r.d.key}/${r.ns}/${r.name}`)
    setSearchParams(next, { replace: true })
  }

  const closeDetail = () => {
    setDetailRow(null)
    const next = new URLSearchParams(searchParams)
    next.delete('detail')
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    const raw = searchParams.get('detail')
    if (!raw) return
    const [key, ns, ...rest] = raw.split('/')
    const name = rest.join('/')
    const d = resourceDescriptors[key]
    if (!d || !name) {
      const next = new URLSearchParams(searchParams)
      next.delete('detail')
      setSearchParams(next, { replace: true })
      return
    }
    const obj = (rowsByTab[tab] ?? []).find((r) => r.d.key === key && r.name === name)
    setDetailRow(
      obj ?? { key: `${key}/${ns}/${name}`, d, ns: ns === '-' ? '' : ns, name, o: {} as K8sObject },
    )
  }, [searchParams, setSearchParams, rowsByTab, tab])

  const confirmDelete = (r: Row) => {
    modal.confirm({
      title: `删除 ${r.name}？`,
      content: `删除${r.d.label}会同时回收其关联资源，此操作不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await resourceApi.remove(cluster, r.d, r.name, r.ns)
          message.success('已删除')
          refresh()
        } catch (e) {
          message.error((e as Error).message)
        }
      },
    })
  }

  const batchDelete = () => {
    const targets = rows.filter((r) => selected.includes(r.key))
    if (!targets.length) return
    modal.confirm({
      title: `批量删除 ${targets.length} 项？`,
      content: '此操作不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        const failed: string[] = []
        for (const r of targets) {
          try {
            await resourceApi.remove(cluster, r.d, r.name, r.ns)
          } catch {
            failed.push(r.name)
          }
        }
        setSelected([])
        if (failed.length) message.warning(`已删除 ${targets.length - failed.length} 项，失败：${failed.join('、')}`)
        else message.success(`已删除 ${targets.length} 项`)
        refresh()
      },
    })
  }

  const openInfo = (r: Row) => {
    form.setFieldsValue({ alias: annotation(r.o, ALIAS_KEY), description: annotation(r.o, DESC_KEY) })
    setInfoRow(r)
  }

  const submitInfo = async () => {
    if (!infoRow) return
    const values = await form.validateFields()
    setBusy(true)
    try {
      const obj = await resourceApi.read(cluster, infoRow.d, infoRow.name, infoRow.ns)
      writeAnnotation(obj, ALIAS_KEY, values.alias?.trim() ?? '')
      writeAnnotation(obj, DESC_KEY, values.description?.trim() ?? '')
      await resourceApi.applyYaml(cluster, toYaml(obj))
      message.success('已保存')
      setInfoRow(null)
      refresh()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const openYaml = async (r: Row) => {
    try {
      const obj = await resourceApi.read(cluster, r.d, r.name, r.ns)
      setYamlText({ title: `编辑 YAML · ${r.name}`, text: toYaml(obj) })
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const submitYaml = async () => {
    if (!yamlText) return
    setBusy(true)
    try {
      await resourceApi.applyYaml(cluster, yamlText.text)
      message.success('已保存')
      setYamlText(null)
      refresh()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const rowMenu = (r: Row) => ({
    items: [
      { key: 'info', label: '编辑信息', onClick: () => openInfo(r) },
      { key: 'yaml', label: '编辑 YAML', onClick: () => void openYaml(r) },
      { key: 'delete', label: '删除', danger: true, onClick: () => confirmDelete(r) },
    ],
  })

  const nameCell = (r: Row, icon: React.ReactNode, color: string, bg: string) => (
    <div className="flex items-center gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-full text-sm" style={{ background: bg, color }}>{icon}</span>
      <div className="min-w-0 flex-1">
        <a className="block truncate font-medium" style={{ color: '#15233a' }} onClick={() => openDetail(r)}>{r.name}</a>
        <div className="truncate text-xs" style={{ color: '#8f9aa9' }}>{annotation(r.o, ALIAS_KEY) || '-'}</div>
      </div>
    </div>
  )

  const timeCol = {
    title: '创建时间',
    width: 132,
    sorter: (a: Row, b: Row) => (a.o.metadata?.creationTimestamp ?? '').localeCompare(b.o.metadata?.creationTimestamp ?? ''),
    render: (_: unknown, r: Row) => <span className="text-xs" style={{ color: '#5b6a80' }}>{datetime(r.o.metadata?.creationTimestamp)}</span>,
  }

  const nsCol = { title: '命名空间', dataIndex: 'ns', width: 120, sorter: (a: Row, b: Row) => a.ns.localeCompare(b.ns) }

  const columns = useMemo(() => {
    const ops = () => ({
      title: '操作',
      width: 120,
      render: (_: unknown, x: Row) => (
        <span className="whitespace-nowrap">
          <Button size="small" type="link" style={{ paddingLeft: 0 }} onClick={() => openDetail(x)}>详情</Button>
          {x.d.key === 'services' && (
            <Button size="small" type="link" onClick={() => navigate(clusterPath(cluster, 'res/pods'))}>进入</Button>
          )}
          <Dropdown menu={rowMenu(x)} trigger={['click']}>
            <Button size="small" type="link">更多 <DownOutlined style={{ fontSize: 9 }} /></Button>
          </Dropdown>
        </span>
      ),
    })
    switch (tab) {
      case 'services':
        return [
          { title: '名称', dataIndex: 'name', width: 150, sorter: (a: Row, b: Row) => a.name.localeCompare(b.name), render: (_: unknown, r: Row) => nameCell(r, <GlobalOutlined />, '#2f6fed', '#e8f1ff') },
          nsCol,
          {
            title: '类型',
            width: 95,
            sorter: (a: Row, b: Row) => String(rec(a.o, 'spec').type ?? 'ClusterIP').localeCompare(String(rec(b.o, 'spec').type ?? 'ClusterIP')),
            render: (_: unknown, r: Row) => {
              const t = (rec(r.o, 'spec').type as string) || 'ClusterIP'
              const s = TYPE_STYLE[t] ?? { color: '#5b6a80', bg: '#eef1f5' }
              return <span className="inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs" style={{ background: s.bg, color: s.color }}>{t}</span>
            },
          },
          { title: '集群 IP', width: 95, render: (_: unknown, r: Row) => <span className="kbd-mono text-xs">{(rec(r.o, 'spec').clusterIP as string) || '-'}</span> },
          { title: '外部访问', width: 80, render: (_: unknown, r: Row) => extAccess(r.o) },
          { title: '选择器', ellipsis: true, render: (_: unknown, r: Row) => <span className="kbd-mono text-xs">{selectorText(r.o) || '-'}</span> },
          timeCol,
          ops(),
        ]
      case 'ingresses':
        return [
          { title: '名称', dataIndex: 'name', sorter: (a: Row, b: Row) => a.name.localeCompare(b.name), render: (_: unknown, r: Row) => nameCell(r, <PartitionOutlined />, '#7c5cff', '#f0ebff') },
          nsCol,
          { title: '入口地址', ellipsis: true, render: (_: unknown, r: Row) => <span className="kbd-mono text-xs">{ingressHosts(r.o)}</span> },
          {
            title: '端点',
            width: 140,
            render: (_: unknown, r: Row) => {
              const ing = (rec(r.o, 'status').loadBalancer as { ingress?: { ip?: string; hostname?: string }[] } | undefined)?.ingress
              return <span className="kbd-mono text-xs">{ing?.length ? (ing[0].ip ?? ing[0].hostname ?? '-') : '-'}</span>
            },
          },
          { title: 'TLS', width: 70, render: (_: unknown, r: Row) => (ingressTls(r.o) ? '是' : '否') },
          timeCol,
          ops(),
        ]
      case 'endpoints':
        return [
          { title: '名称', dataIndex: 'name', sorter: (a: Row, b: Row) => a.name.localeCompare(b.name), render: (_: unknown, r: Row) => nameCell(r, <ThunderboltOutlined />, '#1fa79a', '#e2f7f5') },
          nsCol,
          { title: '可用地址', width: 100, sorter: (a: Row, b: Row) => epAddresses(a.o).length - epAddresses(b.o).length, render: (_: unknown, r: Row) => epAddresses(r.o).length },
          { title: '未就绪地址', width: 110, render: (_: unknown, r: Row) => epNotReady(r.o).length },
          { title: '地址', ellipsis: true, render: (_: unknown, r: Row) => <span className="kbd-mono text-xs">{epAddresses(r.o).join(', ') || '-'}</span> },
          timeCol,
          ops(),
        ]
      default:
        return []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, cluster])

  /** 相关 Pod：命名空间一致且 Service selector ⊆ Pod labels */
  const relatedPods = useMemo(() => {
    if (tab !== 'services' || !active) return []
    const sel = (rec(active.o, 'spec').selector ?? {}) as Record<string, string>
    if (!Object.keys(sel).length) return []
    return (data?.pods ?? []).filter((p) => {
      if (p.metadata?.namespace !== active.ns) return false
      const labels = p.metadata?.labels ?? {}
      return Object.entries(sel).every(([k, v]) => labels[k] === v)
    })
  }, [tab, active, data])

  const activeEp = useMemo(() => {
    if (tab !== 'services' || !active) return undefined
    return (data?.endpoints ?? []).find((e) => e.metadata?.name === active.name && e.metadata?.namespace === active.ns)
  }, [tab, active, data])

  const c = counts[tab as keyof typeof counts] ?? emptyCounts
  const statDefs = [
    { label: `${TABS.find((t) => t.key === tab)?.label} 总数`, value: c.total, color: '#2f6fed', bg: '#e8f1ff', icon: tab === 'ingresses' ? <PartitionOutlined /> : tab === 'endpoints' ? <ThunderboltOutlined /> : <GlobalOutlined />, filter: undefined },
    { label: '运行中', value: c.running, color: '#27a06a', bg: '#e6f7ef', icon: <GlobalOutlined />, filter: 'running' },
    { label: '异常', value: c.abnormal, color: '#d98a12', bg: '#fff4e0', icon: <ExclamationCircleOutlined />, filter: 'abnormal' },
    { label: '待删除', value: c.deleting, color: '#7c5cff', bg: '#f0ebff', icon: <ClockCircleOutlined />, filter: 'deleting' },
  ]
  const rowTone = (r: Row): 'ok' | 'warn' | 'danger' | 'muted' => {
    if (r.o.metadata?.deletionTimestamp) return 'muted'
    if (r.d.key === 'services') return svcStatus(r.o).tone
    if (r.d.key === 'ingresses') return ingressStatus(r.o).tone
    return epAddresses(r.o).length ? 'ok' : 'warn'
  }
  const tableRows = useMemo(() => {
    if (!filterStatus) return rows
    if (filterStatus === 'running') return rows.filter((r) => rowTone(r) === 'ok')
    if (filterStatus === 'abnormal') return rows.filter((r) => rowTone(r) === 'warn' || rowTone(r) === 'danger')
    return rows.filter((r) => rowTone(r) === 'muted')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filterStatus, tab])

  return (
    <div className="flex items-start gap-4">
      {/* 左：主区 */}
      <div className="min-w-0 flex-1 space-y-4">
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error} <Button size="small" onClick={refresh}>重试</Button>
          </div>
        )}

        {/* 页头横幅 */}
        <div
          className="relative flex items-center justify-between overflow-hidden rounded-lg px-6 py-5"
          style={{ background: 'linear-gradient(90deg, #f2f7ff 0%, #e9f1fd 60%, #eef4fe 100%)' }}
        >
          <div className="flex items-center gap-4">
            <span
              className="grid size-14 shrink-0 place-items-center rounded-xl text-2xl text-white"
              style={{ background: 'linear-gradient(135deg, #5ea0ff, #1668dc)' }}
            >
              <GlobalOutlined />
            </span>
            <div>
              <div className="text-xl font-bold" style={{ color: '#15233a' }}>服务与发现</div>
              <div className="mt-1 text-[13px]" style={{ color: '#6b7a92' }}>
                管理集群中的 Service、Ingress、DNS 和 Endpoint 等资源。
              </div>
            </div>
          </div>
          <img
            src="/login-hero.svg"
            alt=""
            className="pointer-events-none hidden h-24 w-auto lg:block"
            style={{ objectFit: 'contain', objectPosition: 'right', maskImage: 'linear-gradient(90deg, transparent, #000 30%)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 30%)' }}
          />
        </div>

        <Tabs activeKey={tab} onChange={setTab} items={TABS} />

        {/* 统计卡 */}
        {tab !== 'dns' && (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {statDefs.map((s) => (
              <StatCard
                key={s.label}
                label={s.label}
                value={s.value}
                total={c.total}
                color={s.color}
                bg={s.bg}
                icon={s.icon}
                active={!!s.filter && filterStatus === s.filter}
                onClick={() => s.filter && setFilterStatus(filterStatus === s.filter ? undefined : s.filter)}
              />
            ))}
          </div>
        )}

        {/* 表格卡片 */}
        <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            {tab === 'services' && (
              <Button type="primary" icon={<PlusOutlined />} style={{ background: 'linear-gradient(90deg, #3f8cff, #1f5fe0)', borderColor: '#1f5fe0' }} onClick={() => setCreateOpen(true)}>
                创建 Service
              </Button>
            )}
            {tab === 'ingresses' && (
              <Button type="primary" icon={<PlusOutlined />} style={{ background: 'linear-gradient(90deg, #3f8cff, #1f5fe0)', borderColor: '#1f5fe0' }} onClick={() => setCreateOpen(true)}>
                创建 Ingress
              </Button>
            )}
            {selected.length > 0 && (
              <Button danger onClick={batchDelete}>批量删除（{selected.length}）</Button>
            )}
            <span className="ml-1 text-[13px]" style={{ color: '#8f9aa9' }}>命名空间</span>
            <Select allowClear placeholder="全部" style={{ width: 95 }} value={filterNs} onChange={setFilterNs} options={nsOptions} suffixIcon={null} variant="filled" />
            {tab === 'services' && (
              <>
                <span className="text-[13px]" style={{ color: '#8f9aa9' }}>类型</span>
                <Select allowClear placeholder="全部" style={{ width: 95 }} value={filterType} onChange={setFilterType} options={Object.keys(TYPE_STYLE).map((t) => ({ label: t, value: t }))} suffixIcon={null} variant="filled" />
                <span className="text-[13px]" style={{ color: '#8f9aa9' }}>选择器</span>
                <Select allowClear placeholder="全部" style={{ width: 120 }} value={filterSelector} onChange={setFilterSelector} options={selectorOptions} suffixIcon={null} variant="filled" />
              </>
            )}
            <span className="ml-auto flex items-center gap-2">
              <Input.Search
                style={{ width: 170 }}
                placeholder={`搜索 ${TABS.find((t) => t.key === tab)?.label} 名称、标签...`}
                allowClear
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button type="text" icon={<ReloadOutlined />} onClick={refresh} loading={loading} />
            </span>
          </div>
          {tab === 'dns' ? (
            <Empty
              className="!py-20"
              description={
                <span style={{ color: '#8f9aa9' }}>
                  当前集群未安装 DNS 服务发现组件（KubeSphere 网络策略 CRD 不存在）。<br />
                  可使用 Service 的集群域名 <span className="kbd-mono">svc.ns.svc.cluster.local</span> 完成服务解析。
                </span>
              }
            />
          ) : (
            <Table<Row>
              rowKey="key"
              size="middle"
              loading={loading || busy}
              dataSource={tableRows}
              scroll={{ x: 960 }}
              rowSelection={{
                selectedRowKeys: selected,
                onChange: setSelected,
              }}
              onRow={(r) => ({
                onClick: (e) => {
                  if ((e.target as HTMLElement).closest('button,a,input')) return
                  setActiveKey(r.key)
                },
              })}
              rowClassName={(r) => (r.key === active?.key ? 'ks-row-active' : '')}
              pagination={{
                defaultPageSize: 10,
                showSizeChanger: true,
                pageSizeOptions: [10, 20, 50, 100],
                showTotal: (t) => `共 ${t} 条`,
              }}
              columns={columns}
            />
          )}
        </div>
      </div>

      {/* 右：选中资源详情 */}
      <div className="hidden w-[320px] shrink-0 space-y-4 xl:block">
        {tab === 'dns' || !active ? (
          <Panel title="使用小贴士">
            <div className="text-[13px] leading-6" style={{ color: '#5b6a80' }}>
              Service 为一组 Pod 提供稳定的访问入口；Ingress 基于域名与路径把集群外流量路由到 Service。
            </div>
          </Panel>
        ) : tab === 'services' ? (
          <>
            <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
              <div className="flex items-center gap-3 px-4" style={{ height: 58, borderBottom: '1px solid #eef1f5' }}>
                <span className="grid size-9 place-items-center rounded-lg text-base text-white" style={{ background: 'linear-gradient(135deg, #5ea0ff, #1668dc)' }}>
                  <GlobalOutlined />
                </span>
                <span className="min-w-0 truncate text-base font-bold" style={{ color: '#15233a' }}>{active.name}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs" style={{ background: `${TONE_COLOR[svcStatus(active.o).tone]}1a`, color: TONE_COLOR[svcStatus(active.o).tone] === '#59c492' ? '#27a06a' : '#5b6a80' }}>
                  <span className="size-[6px] rounded-full" style={{ background: TONE_COLOR[svcStatus(active.o).tone] }} />
                  {svcStatus(active.o).text}
                </span>
                <Dropdown menu={rowMenu(active)} trigger={['click']} className="ml-auto">
                  <Button type="text" size="small" style={{ marginLeft: 'auto' }}>⋯</Button>
                </Dropdown>
              </div>
              <div className="px-4 py-2">
                <FieldRow label="命名空间" value={active.ns} />
                <FieldRow label="类型" value={(rec(active.o, 'spec').type as string) || 'ClusterIP'} />
                <FieldRow label="集群 IP" value={<span className="kbd-mono">{(rec(active.o, 'spec').clusterIP as string) || '-'}</span>} />
                <FieldRow label="创建时间" value={datetime(active.o.metadata?.creationTimestamp)} />
              </div>
            </div>

            <Panel title="端口">
              <Table
                size="small"
                rowKey={(_, i) => String(i)}
                pagination={false}
                dataSource={svcPorts(active.o)}
                locale={{ emptyText: '无端口' }}
                columns={[
                  { title: '端口', dataIndex: 'port', render: (v: number) => <span className="kbd-mono">{v}</span> },
                  { title: '目标端口', dataIndex: 'targetPort', render: (v?: number | string) => <span className="kbd-mono">{v ?? '-'}</span> },
                  { title: '协议', dataIndex: 'protocol', render: (v?: string) => v || 'TCP' },
                ]}
              />
            </Panel>

            <Panel
              title="选择器"
              extra={
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    void navigator.clipboard?.writeText(selectorText(active.o))
                    message.success('已复制')
                  }}
                />
              }
            >
              <div className="kbd-mono text-[13px]" style={{ color: '#15233a' }}>{selectorText(active.o) || '无选择器'}</div>
            </Panel>

            <Panel title="相关 Pod" extra={<a style={{ fontSize: 12 }} onClick={() => navigate(clusterPath(cluster, 'res/pods'))}>查看全部 <RightOutlined style={{ fontSize: 10 }} /></a>}>
              {relatedPods.length ? (
                <div className="space-y-1">
                  {relatedPods.slice(0, 5).map((p) => {
                    const phase = (p.status as { phase?: string } | undefined)?.phase ?? 'Unknown'
                    const tone = phase === 'Running' ? 'ok' : phase === 'Pending' ? 'warn' : phase === 'Failed' ? 'danger' : 'muted'
                    return (
                      <div
                        key={p.metadata?.uid ?? p.metadata?.name}
                        className="flex cursor-pointer items-center gap-2 text-[13px]"
                        onClick={() => setDetailPod({ ns: p.metadata?.namespace ?? 'default', name: p.metadata?.name ?? '' })}
                      >
                        <span className="size-[7px] shrink-0 rounded-full" style={{ background: TONE_COLOR[tone] }} />
                        <span className="min-w-0 flex-1 truncate" style={{ color: '#15233a' }}>{p.metadata?.name}</span>
                        <span className="rounded px-1.5 py-0.5 text-xs" style={{ background: `${TONE_COLOR[tone]}1a`, color: tone === 'ok' ? '#27a06a' : '#5b6a80' }}>{phase}</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-[13px]" style={{ color: '#8f9aa9' }}>无匹配的选择器 Pod</div>
              )}
            </Panel>

            <Panel title="Endpoints" extra={<a style={{ fontSize: 12 }} onClick={() => setTab('endpoints')}>查看全部 <RightOutlined style={{ fontSize: 10 }} /></a>}>
              {activeEp && epAddresses(activeEp).length ? (
                <div className="space-y-1">
                  {epAddresses(activeEp).slice(0, 6).map((a) => (
                    <div key={a} className="kbd-mono text-[13px]" style={{ color: '#15233a' }}>{a}</div>
                  ))}
                </div>
              ) : (
                <div className="text-[13px]" style={{ color: '#8f9aa9' }}>暂无可用端点</div>
              )}
            </Panel>
          </>
        ) : tab === 'ingresses' ? (
          <>
            <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
              <div className="flex items-center gap-3 px-4" style={{ height: 58, borderBottom: '1px solid #eef1f5' }}>
                <span className="grid size-9 place-items-center rounded-lg text-base text-white" style={{ background: 'linear-gradient(135deg, #9d86ff, #6a48e0)' }}>
                  <PartitionOutlined />
                </span>
                <span className="min-w-0 truncate text-base font-bold" style={{ color: '#15233a' }}>{active.name}</span>
                <Dropdown menu={rowMenu(active)} trigger={['click']}>
                  <Button type="text" size="small" style={{ marginLeft: 'auto' }}>⋯</Button>
                </Dropdown>
              </div>
              <div className="px-4 py-2">
                <FieldRow label="命名空间" value={active.ns} />
                <FieldRow
                  label="端点"
                  value={(() => {
                    const ing = (rec(active.o, 'status').loadBalancer as { ingress?: { ip?: string; hostname?: string }[] } | undefined)?.ingress
                    return ing?.length ? (ing[0].ip ?? ing[0].hostname ?? '已就绪') : '等待中'
                  })()}
                />
                <FieldRow label="TLS" value={ingressTls(active.o) ? '已配置' : '未配置'} />
                <FieldRow label="创建时间" value={datetime(active.o.metadata?.creationTimestamp)} />
              </div>
            </div>
            <Panel title="转发规则">
              <div className="space-y-2">
                {((rec(active.o, 'spec').rules as { host?: string; http?: { paths?: { path?: string; pathType?: string; backend?: { service?: { name?: string; port?: { number?: number; name?: string } } } }[] } }[] | undefined) ?? []).map((r, i) => (
                  <div key={i} className="text-[13px]" style={{ color: '#15233a' }}>
                    <div className="kbd-mono font-medium">{r.host || '*'}</div>
                    {(r.http?.paths ?? []).map((p, j) => (
                      <div key={j} className="mt-0.5 text-xs" style={{ color: '#5b6a80' }}>
                        <span className="kbd-mono">{p.path ?? '/'}</span> → {p.backend?.service?.name}
                        {p.backend?.service?.port?.number ? `:${p.backend.service.port.number}` : ''}
                      </div>
                    ))}
                  </div>
                ))}
                {!((rec(active.o, 'spec').rules as unknown[] | undefined)?.length) && <div className="text-[13px]" style={{ color: '#8f9aa9' }}>无转发规则</div>}
              </div>
            </Panel>
          </>
        ) : (
          <>
            <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
              <div className="flex items-center gap-3 px-4" style={{ height: 58, borderBottom: '1px solid #eef1f5' }}>
                <span className="grid size-9 place-items-center rounded-lg text-base text-white" style={{ background: 'linear-gradient(135deg, #4fd0c0, #14958a)' }}>
                  <ThunderboltOutlined />
                </span>
                <span className="min-w-0 truncate text-base font-bold" style={{ color: '#15233a' }}>{active.name}</span>
                <Dropdown menu={rowMenu(active)} trigger={['click']}>
                  <Button type="text" size="small" style={{ marginLeft: 'auto' }}>⋯</Button>
                </Dropdown>
              </div>
              <div className="px-4 py-2">
                <FieldRow label="命名空间" value={active.ns} />
                <FieldRow label="可用地址" value={epAddresses(active.o).length} />
                <FieldRow label="未就绪地址" value={epNotReady(active.o).length} />
                <FieldRow label="创建时间" value={datetime(active.o.metadata?.creationTimestamp)} />
              </div>
            </div>
            <Panel title="地址">
              {epAddresses(active.o).length || epNotReady(active.o).length ? (
                <div className="space-y-1">
                  {epAddresses(active.o).map((a) => (
                    <div key={a} className="kbd-mono text-[13px]" style={{ color: '#15233a' }}>{a}</div>
                  ))}
                  {epNotReady(active.o).map((a) => (
                    <div key={`nr-${a}`} className="kbd-mono text-[13px]" style={{ color: '#8f9aa9' }}>{a}（未就绪）</div>
                  ))}
                </div>
              ) : (
                <div className="text-[13px]" style={{ color: '#8f9aa9' }}>无地址</div>
              )}
            </Panel>
          </>
        )}

        {tab !== 'dns' && (
          <Panel title="使用小贴士">
            <div className="text-[13px] leading-6" style={{ color: '#5b6a80' }}>
              {tab === 'services' && 'Service 为一组 Pod 提供稳定的集群内访问入口；NodePort 与 LoadBalancer 类型可对外暴露服务。'}
              {tab === 'ingresses' && 'Ingress 基于域名与路径将集群外流量路由到 Service，需配合 Ingress Controller 使用。'}
              {tab === 'endpoints' && 'Endpoints 由 Kubernetes 自动维护，记录 Service 选择器命中的 Pod 实际地址。'}
            </div>
          </Panel>
        )}
      </div>

      {createOpen && tab === 'services' && (
        <CreateServiceModal open onClose={() => setCreateOpen(false)} cluster={cluster} namespace={namespace} onCreated={refresh} />
      )}
      {createOpen && tab === 'ingresses' && (
        <CreateIngressModal open onClose={() => setCreateOpen(false)} cluster={cluster} namespace={namespace} onCreated={refresh} />
      )}

      <Modal
        open={!!infoRow}
        title={`编辑信息 · ${infoRow?.name ?? ''}`}
        onCancel={() => setInfoRow(null)}
        onOk={() => void submitInfo()}
        okButtonProps={{ loading: busy }}
        confirmLoading={busy}
      >
        <Form form={form} layout="vertical" autoComplete="off">
          <Form.Item label="别名" name="alias" tooltip={ALIAS_KEY}>
            <Input placeholder="为资源设置别名（可选）" maxLength={63} />
          </Form.Item>
          <Form.Item label="描述" name="description" tooltip={DESC_KEY}>
            <Input.TextArea rows={3} placeholder="添加描述（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={!!yamlText}
        title={yamlText?.title}
        width={720}
        onCancel={() => setYamlText(null)}
        onOk={() => void submitYaml()}
        okButtonProps={{ loading: busy }}
        confirmLoading={busy}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>保存将按 YAML 替换集群中的该资源。</Typography.Text>
        <Input.TextArea
          className="kbd-mono mt-2"
          value={yamlText?.text ?? ''}
          onChange={(e) => setYamlText((v) => (v ? { ...v, text: e.target.value } : v))}
          autoSize={{ minRows: 16, maxRows: 26 }}
          style={{ fontSize: 12 }}
        />
      </Modal>

      {detailRow && (
        <ResourceDetailDrawer
          cluster={cluster}
          descriptor={detailRow.d}
          namespace={detailRow.ns}
          name={detailRow.name}
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
    </div>
  )
}
