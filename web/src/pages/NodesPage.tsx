import { App, Button, Dropdown, Input, Modal, Progress, Select, Table, Typography } from 'antd'
import type { MenuProps } from 'antd'
import {
  CloudServerOutlined,
  DownOutlined,
  ExclamationCircleOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
} from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { clusterApi } from '../api/cluster'
import { NodeDetailDrawer } from './NodeDetailPage'
import { PodDetailDrawer } from './PodDetailPage'
import { resourceApi, toItems } from '../api/resources'
import type { K8sObject } from '../api/resources'
import { resourceDescriptors, clusterPath } from '../config/nav'
import { useResource } from '../hooks/useResource'
import { useClusterStore } from '../store/useClusterStore'
import { bytes, cpuCores, datetime, percent } from '../utils/format'
import { toYaml } from '../utils/yaml'
import type { ResourceDescriptor } from '../config/nav'
import type { Metrics, V1Event, V1Node } from '../types/k8s'

/**
 * 集群节点的通用描述符：列表/详情读取沿用 clusterApi.nodes（后端有类型化接口，字段完整），
 * 所有写操作（编辑信息、停止/启动、删除）走 resourceApi，与 KubeSphere 的资源写入方式一致。
 */
export const NODES: ResourceDescriptor = {
  key: 'nodes',
  label: '集群节点',
  kind: 'Node',
  group: '',
  version: 'v1',
  plural: 'nodes',
  scope: 'Cluster',
  icon: undefined,
  statusKind: 'conditions',
}

/** KubeSphere 的别名/描述写在注解里，「编辑信息」读写的就是这两项 */
export const ALIAS_ANNOTATION = 'kubesphere.io/alias-name'
export const DESCRIPTION_ANNOTATION = 'kubesphere.io/description'

const WORKER_LABEL = 'node-role.kubernetes.io/worker'

export const internalIp = (n: V1Node): string | undefined =>
  n.status?.addresses?.find((a) => a.type === 'InternalIP')?.address

/** KubeSphere 节点状态文案：不可调度优先级最高，其余看 Ready condition */
export const nodeStatusText = (n: V1Node): string => {
  if (n.spec?.unschedulable === true) return '已停止'
  const ready = n.status?.conditions?.find((c) => c.type === 'Ready')?.status
  return ready === 'True' ? '运行中' : '不就绪'
}

const STATUS_COLOR: Record<string, string> = {
  运行中: '#59c492',
  不就绪: '#f5a623',
  已停止: '#f5a623',
}

/** StatusDot 的中文版本（StatusDot 的配色表按英文 phase 索引，这里显式给中文态配色） */
export function NodeStatusDot({ node }: { node: V1Node }) {
  const text = nodeStatusText(node)
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="size-[7px] shrink-0 rounded-full" style={{ background: STATUS_COLOR[text] ?? '#9aa7b8' }} />
      <span style={{ fontWeight: 500, color: '#15233a' }}>{text}</span>
    </span>
  )
}

/** 角色列：control-plane（含存量集群的 master）→ 控制平面节点，worker → 工作节点，多个逗号分隔 */
export const nodeRolesText = (n: V1Node): string => {
  const labels = n.metadata?.labels ?? {}
  const roles = Object.keys(labels)
    .filter((k) => k.startsWith('node-role.kubernetes.io/'))
    .map((k) => k.split('/')[1])
  const out: string[] = []
  if (roles.some((r) => r === 'control-plane' || r === 'master')) out.push('控制平面节点')
  if (labels[WORKER_LABEL] !== undefined) out.push('工作节点')
  roles.filter((r) => r !== 'control-plane' && r !== 'master' && r !== 'worker').forEach((r) => out.push(r))
  return out.length ? out.join(', ') : '-'
}

interface NodeActionsProps {
  node: V1Node
  /** 操作成功后刷新当前视图 */
  onChanged: () => void
  /** 删除成功后的额外跳转（详情页返回列表） */
  onDeleted?: () => void
  /** 自定义触发器，列表默认「更多」，详情传「操作」按钮 */
  trigger?: ReactNode
}

/**
 * KubeSphere 节点行的四项操作：编辑信息 / 查看 YAML / 停止（启动）节点 / 删除。
 * 每次都先读回最新对象，只提交 apiVersion+kind+metadata+spec，避免把 status 回写。
 */
export function NodeActions({ node, onChanged, onDeleted, trigger }: NodeActionsProps) {
  const { modal, message } = App.useApp()
  const cluster = useClusterStore((s) => s.cluster)
  const name = node.metadata?.name ?? ''
  const stopped = node.spec?.unschedulable === true

  const [draft, setDraft] = useState<K8sObject | null>(null)
  const [alias, setAlias] = useState('')
  const [description, setDescription] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [yamlText, setYamlText] = useState<string | null>(null)

  /** 最新对象；通用读取不可用时回落到页面已加载的节点对象 */
  const readFresh = async (): Promise<K8sObject> => {
    const fresh = await resourceApi.read(cluster, NODES, name).catch(() => node as unknown as K8sObject)
    return {
      apiVersion: fresh.apiVersion ?? 'v1',
      kind: fresh.kind ?? 'Node',
      metadata: {
        name,
        uid: fresh.metadata?.uid,
        resourceVersion: fresh.metadata?.resourceVersion,
        labels: fresh.metadata?.labels,
        annotations: fresh.metadata?.annotations,
      },
      spec: { ...(fresh.spec ?? {}) },
    }
  }

  const submit = async (body: K8sObject, okText: string) => {
    setBusy(true)
    try {
      await resourceApi.applyYaml(cluster, toYaml(body))
      message.success(okText)
      onChanged()
      return true
    } catch (e) {
      message.error((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const openEdit = async () => {
    setBusy(true)
    try {
      const fresh = await readFresh()
      const ann = fresh.metadata?.annotations ?? {}
      setDraft(fresh)
      setAlias(ann[ALIAS_ANNOTATION] ?? '')
      setDescription(ann[DESCRIPTION_ANNOTATION] ?? '')
      setEditOpen(true)
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async () => {
    if (!draft) return
    const body: K8sObject = { ...draft }
    const ann = { ...(body.metadata?.annotations ?? {}) }
    if (alias.trim()) ann[ALIAS_ANNOTATION] = alias.trim()
    else delete ann[ALIAS_ANNOTATION]
    if (description.trim()) ann[DESCRIPTION_ANNOTATION] = description.trim()
    else delete ann[DESCRIPTION_ANNOTATION]
    body.metadata = { ...body.metadata, annotations: ann }
    setSaving(true)
    const ok = await submit(body, '已保存')
    setSaving(false)
    if (ok) setEditOpen(false)
  }

  const showYaml = async () => {
    setBusy(true)
    try {
      const fresh = await resourceApi.read(cluster, NODES, name).catch(() => node as unknown as K8sObject)
      setYamlText(toYaml(fresh))
    } finally {
      setBusy(false)
    }
  }

  const setCordon = async (next: boolean) => {
    const body = await readFresh()
    body.spec = { ...(body.spec ?? {}), unschedulable: next }
    await submit(body, next ? '节点已停止' : '节点已启动')
  }

  const confirmDelete = () => {
    modal.confirm({
      title: `删除节点 ${name}？`,
      content:
        '删除节点只会把它从集群中移除，底层主机会随之脱离集群管理；该节点上的容器组会被终止或重新调度，正在运行的业务可能中断。此操作不可恢复。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await resourceApi.remove(cluster, NODES, name)
          message.success('已删除')
          if (onDeleted) onDeleted()
          else onChanged()
        } catch (e) {
          message.error((e as Error).message)
        }
      },
    })
  }

  const items: MenuProps['items'] = [
    { key: 'edit', label: '编辑信息' },
    { key: 'yaml', label: '查看 YAML' },
    { key: 'cordon', label: stopped ? '启动节点' : '停止节点' },
    { key: 'delete', label: '删除', danger: true },
  ]

  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'edit') void openEdit()
    if (key === 'yaml') void showYaml()
    if (key === 'cordon') void setCordon(!stopped)
    if (key === 'delete') confirmDelete()
  }

  return (
    <>
      <Dropdown menu={{ items, onClick: onMenuClick }} trigger={['click']} placement="bottomRight" disabled={busy}>
        {trigger ?? (
          <Button size="small" type="text" className="!px-2 !text-[#5c6b80]">
            更多 <DownOutlined style={{ fontSize: 10 }} />
          </Button>
        )}
      </Dropdown>

      <Modal
        open={editOpen}
        title={`编辑信息 · ${name}`}
        width={520}
        okText="确定"
        cancelText="取消"
        confirmLoading={saving}
        onCancel={() => setEditOpen(false)}
        onOk={saveEdit}
      >
        <div className="space-y-4 py-2">
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>名称</Typography.Text>
            <div className="mt-1 font-medium" style={{ color: '#15233a' }}>{name}</div>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>别名</Typography.Text>
            <Input
              className="mt-1"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="为节点设置别名（可选）"
            />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>描述</Typography.Text>
            <Input.TextArea
              className="mt-1"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="为节点添加描述（可选）"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={yamlText !== null}
        title={`查看 YAML · ${name}`}
        width={720}
        onCancel={() => setYamlText(null)}
        footer={
          <Button size="small" onClick={() => setYamlText(null)}>
            关闭
          </Button>
        }
      >
        <pre className="kbd-mono m-0 max-h-[56vh] overflow-auto rounded-md bg-slate-50 p-3 text-xs">
          {yamlText ?? ''}
        </pre>
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------- 节点管理（合并版页面）

const TONE_COLOR: Record<string, string> = { ok: '#59c492', warn: '#f5a623', danger: '#d94f4f', muted: '#9aa7b8' }

/** 设计稿口径的状态文案：不可调度=维护中，不就绪=异常 */
function nodeUiStatus(n: V1Node): { text: string; tone: 'ok' | 'warn' | 'danger' } {
  if (n.spec?.unschedulable === true) return { text: '维护中', tone: 'warn' }
  const ready = n.status?.conditions?.find((c) => c.type === 'Ready')?.status
  return ready === 'True' ? { text: '运行中', tone: 'ok' } : { text: '异常', tone: 'danger' }
}

/** 角色短名（tag 用）：control-plane / worker / 其余原样 */
function nodeRoleShort(n: V1Node): string {
  const labels = n.metadata?.labels ?? {}
  const roles = Object.keys(labels)
    .filter((k) => k.startsWith('node-role.kubernetes.io/'))
    .map((k) => k.split('/')[1])
  if (roles.some((r) => r === 'control-plane' || r === 'master')) return 'control-plane'
  if (roles.includes('worker')) return 'worker'
  return roles[0] ?? 'worker'
}

const alloc = (n: V1Node, key: 'cpu' | 'memory' | 'pods') => n.status?.allocatable?.[key]

function usageOf(m: Metrics | undefined, key: 'cpu' | 'memory'): number | null {
  const v = m?.usage?.[key]
  if (v == null) return null
  return key === 'cpu' ? cpuCores(String(v)) : bytes(String(v))
}

/** 右侧竖排面板（与工作负载/服务页同款） */
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

function Ring({ pct, color }: { pct: number | null; color: string }) {
  return (
    <Progress
      type="dashboard"
      size={64}
      percent={pct ?? 0}
      strokeColor={color}
      strokeWidth={10}
      format={() => (pct === null ? <span style={{ fontSize: 11, color: '#b3bdcc' }}>无数据</span> : <span style={{ fontSize: 14, fontWeight: 600 }}>{pct}%</span>)}
    />
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

interface NodeOverview {
  nodes: V1Node[]
  metrics: Record<string, Metrics>
  pods: K8sObject[]
}

export default function NodesPage() {
  const cluster = useClusterStore((s) => s.cluster)
  const navigate = useNavigate()
  const { message, modal } = App.useApp()

  const { data, error, loading, refresh } = useResource<NodeOverview | null>(
    async () => {
      if (!cluster) return null
      const [nodes, metrics, pods] = await Promise.all([
        clusterApi.nodes(cluster).then((l) => l ?? []),
        clusterApi.nodeMetrics(cluster).catch(() => [] as Metrics[]),
        resourceApi.list(cluster, resourceDescriptors.pods).then(toItems).catch(() => [] as K8sObject[]),
      ])
      const byName: Record<string, Metrics> = {}
      for (const m of metrics ?? []) if (m.metadata?.name) byName[m.metadata.name] = m
      return { nodes, metrics: byName, pods }
    },
    [cluster],
  )

  const nodes = useMemo(() => data?.nodes ?? [], [data])

  const [filterStatus, setFilterStatus] = useState<string>()
  const [filterRole, setFilterRole] = useState<string>()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<React.Key[]>([])
  const [activeName, setActiveName] = useState<string>()
  const [addOpen, setAddOpen] = useState(false)
  const [detailNode, setDetailNode] = useState<string>()
  const [detailPod, setDetailPod] = useState<{ ns: string; name: string }>()
  const [searchParams, setSearchParams] = useSearchParams()

  // 直达链接 ?detail=<节点名> 进来时直接拉起详情抽屉
  useEffect(() => {
    const d = searchParams.get('detail')
    if (!d) return
    setDetailNode(d)
    const next = new URLSearchParams(searchParams)
    next.delete('detail')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const rows = useMemo(() => {
    let list = [...nodes]
    if (filterStatus === 'ok') list = list.filter((n) => nodeUiStatus(n).text === '运行中')
    if (filterStatus === 'danger') list = list.filter((n) => nodeUiStatus(n).text === '异常')
    if (filterStatus === 'warn') list = list.filter((n) => nodeUiStatus(n).text === '维护中')
    if (filterRole) list = list.filter((n) => nodeRoleShort(n) === filterRole)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (n) => (n.metadata?.name ?? '').toLowerCase().includes(q) || (internalIp(n) ?? '').toLowerCase().includes(q),
      )
    }
    return list
  }, [nodes, filterStatus, filterRole, search])

  const counts = useMemo(() => {
    let ok = 0, danger = 0, warn = 0
    for (const n of nodes) {
      const t = nodeUiStatus(n).text
      if (t === '运行中') ok += 1
      else if (t === '异常') danger += 1
      else warn += 1
    }
    return { ok, danger, warn }
  }, [nodes])

  const podsByNode = useMemo(() => {
    const map: Record<string, { total: number; running: number; failed: number; succeeded: number }> = {}
    for (const p of data?.pods ?? []) {
      const node = (p.spec as { nodeName?: string } | undefined)?.nodeName
      if (!node) continue
      const m = (map[node] ??= { total: 0, running: 0, failed: 0, succeeded: 0 })
      m.total += 1
      const phase = (p.status as { phase?: string } | undefined)?.phase
      if (phase === 'Running') m.running += 1
      else if (phase === 'Failed') m.failed += 1
      else if (phase === 'Succeeded') m.succeeded += 1
    }
    return map
  }, [data])

  const active = useMemo(() => nodes.find((n) => n.metadata?.name === activeName) ?? rows[0] ?? nodes[0], [nodes, rows, activeName])
  const activeNodeName = active?.metadata?.name

  const [nodeEvents, setNodeEvents] = useState<V1Event[]>([])
  useEffect(() => {
    if (!cluster || !activeNodeName) {
      setNodeEvents([])
      return
    }
    let live = true
    void resourceApi
      .events(cluster, 'Node', activeNodeName)
      .then((evs) => live && setNodeEvents(evs ?? []))
      .catch(() => live && setNodeEvents([]))
    return () => {
      live = false
    }
  }, [cluster, activeNodeName])

  const batchDelete = () => {
    const targets = nodes.filter((n) => selected.includes(n.metadata?.name ?? ''))
    if (!targets.length) return
    modal.confirm({
      title: `批量删除 ${targets.length} 个节点？`,
      content: '删除节点会让其从集群中移除，节点上的容器组将被终止或重新调度，正在运行的业务可能中断。此操作不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        const failed: string[] = []
        for (const n of targets) {
          try {
            await resourceApi.remove(cluster, NODES, n.metadata?.name ?? '')
          } catch {
            failed.push(n.metadata?.name ?? '?')
          }
        }
        setSelected([])
        if (failed.length) message.warning(`已删除 ${targets.length - failed.length} 个，失败：${failed.join('、')}`)
        else message.success(`已删除 ${targets.length} 个节点`)
        refresh()
      },
    })
  }

  if (!nodes.length && !loading) {
    return (
      <div className="rounded-lg bg-white p-10 text-center" style={{ border: '1px solid #e6ebf1', color: '#8f9aa9' }}>
        当前集群没有可读取的节点。
        <Button size="small" className="ml-3" onClick={refresh} loading={loading}>刷新</Button>
      </div>
    )
  }

  const aMetrics = active ? data?.metrics?.[active.metadata?.name ?? ''] : undefined
  const aCpuUsed = usageOf(aMetrics, 'cpu')
  const aMemUsed = usageOf(aMetrics, 'memory')
  const aCpuTotal = active ? cpuCores(String(alloc(active, 'cpu') ?? '')) : 0
  const aMemTotal = active ? bytes(String(alloc(active, 'memory') ?? '')) : 0
  const aPods = active ? podsByNode[active.metadata?.name ?? ''] : undefined
  const aStatus = active ? nodeUiStatus(active) : null

  const usageBar = (used: number | null, total: number, color: string) => {
    if (used === null || !total) return <span className="text-xs" style={{ color: '#b3bdcc' }}>-</span>
    const pct = percent(used, total)
    return (
      <div className="min-w-[90px]">
        <div className="text-xs" style={{ color: '#15233a' }}>{pct}%</div>
        <div className="mt-1 h-1 rounded-full bg-[#eef1f5]">
          <div className="h-1 rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
        </div>
      </div>
    )
  }

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
              <CloudServerOutlined />
            </span>
            <div>
              <div className="text-xl font-bold" style={{ color: '#15233a' }}>节点管理</div>
              <div className="mt-1 text-[13px]" style={{ color: '#6b7a92' }}>
                查看和管理集群中的节点，监控节点状态、资源使用情况及运行的 Pod。
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

        {/* 统计卡 */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard
            label="节点总数" value={nodes.length} total={nodes.length} pct="100%"
            color="#2f6fed" bg="#e8f1ff" icon={<CloudServerOutlined />}
            active={!filterStatus} onClick={() => setFilterStatus(undefined)}
          />
          <StatCard
            label="运行中" value={counts.ok} total={nodes.length} pct={nodes.length ? `${Math.round((counts.ok / nodes.length) * 100)}%` : '0%'}
            color="#27a06a" bg="#e6f7ef" icon={<CloudServerOutlined />}
            active={filterStatus === 'ok'} onClick={() => setFilterStatus(filterStatus === 'ok' ? undefined : 'ok')}
          />
          <StatCard
            label="异常" value={counts.danger} total={nodes.length} pct={nodes.length ? `${Math.round((counts.danger / nodes.length) * 100)}%` : '0%'}
            color="#d94f4f" bg="#fdecec" icon={<ExclamationCircleOutlined />}
            active={filterStatus === 'danger'} onClick={() => setFilterStatus(filterStatus === 'danger' ? undefined : 'danger')}
          />
          <StatCard
            label="维护中" value={counts.warn} total={nodes.length} pct={nodes.length ? `${Math.round((counts.warn / nodes.length) * 100)}%` : '0%'}
            color="#7c5cff" bg="#f0ebff" icon={<PauseCircleOutlined />}
            active={filterStatus === 'warn'} onClick={() => setFilterStatus(filterStatus === 'warn' ? undefined : 'warn')}
          />
        </div>

        {/* 表格卡片 */}
        <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Button type="primary" icon={<PlusOutlined />} style={{ background: 'linear-gradient(90deg, #3f8cff, #1f5fe0)', borderColor: '#1f5fe0' }} onClick={() => setAddOpen(true)}>
              添加节点
            </Button>
            {selected.length > 0 && <Button danger onClick={batchDelete}>批量删除（{selected.length}）</Button>}
            <span className="text-[13px]" style={{ color: '#8f9aa9' }}>节点状态</span>
            <Select allowClear placeholder="全部" style={{ width: 100 }} value={filterStatus} onChange={setFilterStatus} suffixIcon={null} variant="filled"
              options={[{ label: '运行中', value: 'ok' }, { label: '异常', value: 'danger' }, { label: '维护中', value: 'warn' }]} />
            <span className="text-[13px]" style={{ color: '#8f9aa9' }}>角色</span>
            <Select allowClear placeholder="全部" style={{ width: 130 }} value={filterRole} onChange={setFilterRole} suffixIcon={null} variant="filled"
              options={[{ label: 'control-plane', value: 'control-plane' }, { label: 'worker', value: 'worker' }]} />
            <span className="ml-auto flex items-center gap-2">
              <Input.Search style={{ width: 200 }} placeholder="搜索节点名称、IP..." allowClear value={search} onChange={(e) => setSearch(e.target.value)} />
              <Button type="text" icon={<ReloadOutlined />} onClick={refresh} loading={loading} />
            </span>
          </div>
          <Table<V1Node>
            rowKey={(r) => r.metadata?.name ?? ''}
            size="middle"
            loading={loading}
            dataSource={rows}
            scroll={{ x: 900 }}
            rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
            onRow={(r) => ({
              onClick: (e) => {
                if ((e.target as HTMLElement).closest('button,a,input')) return
                setActiveName(r.metadata?.name)
              },
            })}
            rowClassName={(r) => (r.metadata?.name === active?.metadata?.name ? 'ks-row-active' : '')}
            pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (t) => `共 ${t} 条` }}
            columns={[
              {
                key: 'name',
                title: '节点名称',
                width: 150,
                sorter: (a, b) => (a.metadata?.name ?? '').localeCompare(b.metadata?.name ?? ''),
                render: (_, n) => {
                  const alias = (n.metadata?.annotations ?? {})[ALIAS_ANNOTATION] ?? ''
                  return (
                    <div className="flex items-center gap-3">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full text-sm" style={{ background: '#e8f1ff', color: '#2f6fed' }}>
                        <CloudServerOutlined />
                      </span>
                      <div className="min-w-0 flex-1">
                        <a className="block truncate font-medium" style={{ color: '#15233a' }} onClick={() => setDetailNode(n.metadata?.name)}>
                          {n.metadata?.name}
                        </a>
                        <div className="truncate text-xs" style={{ color: '#8f9aa9' }}>{alias || n.status?.nodeInfo?.architecture || '-'}</div>
                      </div>
                    </div>
                  )
                },
              },
              { key: 'ip', title: 'IP 地址', width: 110, render: (_, n) => <span className="kbd-mono text-xs">{internalIp(n) ?? '-'}</span> },
              {
                key: 'role',
                title: '角色',
                width: 100,
                render: (_, n) => {
                  const r = nodeRoleShort(n)
                  const s = r === 'control-plane' ? { color: '#2f6fed', bg: '#e8f1ff' } : { color: '#5b6a80', bg: '#eef1f5' }
                  return <span className="inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs" style={{ background: s.bg, color: s.color }}>{r}</span>
                },
              },
              {
                key: 'status',
                title: '状态',
                width: 100,
                render: (_, n) => {
                  const s = nodeUiStatus(n)
                  return (
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <span className="size-[7px] shrink-0 rounded-full" style={{ background: TONE_COLOR[s.tone] }} />
                      <span style={{ color: '#15233a' }}>{s.text}</span>
                    </span>
                  )
                },
              },
              { key: 'cpu', title: 'CPU 使用率', width: 95, render: (_, n) => usageBar(usageOf(data?.metrics?.[n.metadata?.name ?? ''], 'cpu'), cpuCores(String(alloc(n, 'cpu') ?? '')), '#2f6fed') },
              { key: 'mem', title: '内存使用率', width: 95, render: (_, n) => usageBar(usageOf(data?.metrics?.[n.metadata?.name ?? ''], 'memory'), bytes(String(alloc(n, 'memory') ?? '')), '#27a06a') },
              {
                key: 'pods',
                title: 'Pod 数量',
                width: 100,
                sorter: (a, b) => (podsByNode[a.metadata?.name ?? '']?.total ?? 0) - (podsByNode[b.metadata?.name ?? '']?.total ?? 0),
                render: (_, n) => `${podsByNode[n.metadata?.name ?? '']?.total ?? 0} / ${alloc(n, 'pods') ?? '-'}`,
              },
              {
                key: 'actions',
                title: '操作',
                width: 110,
                render: (_, n) => (
                  <span className="whitespace-nowrap">
                    <Button size="small" type="link" style={{ paddingLeft: 0 }} onClick={() => setDetailNode(n.metadata?.name)}>
                      详情
                    </Button>
                    <NodeActions node={n} onChanged={refresh} />
                  </span>
                ),
              },
            ]}
          />
        </div>
      </div>

      {/* 右：选中节点详情 */}
      <div className="hidden w-[320px] shrink-0 space-y-4 xl:block">
        {active && aStatus && (
          <>
            <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
              <div className="flex items-center gap-3 px-4" style={{ height: 58, borderBottom: '1px solid #eef1f5' }}>
                <span className="grid size-9 place-items-center rounded-lg text-base text-white" style={{ background: 'linear-gradient(135deg, #5ea0ff, #1668dc)' }}>
                  <CloudServerOutlined />
                </span>
                <span className="min-w-0 flex-1 truncate text-base font-bold" style={{ color: '#15233a' }}>{active.metadata?.name}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs" style={{ background: `${TONE_COLOR[aStatus.tone]}1a`, color: aStatus.tone === 'ok' ? '#27a06a' : '#5b6a80' }}>
                  <span className="size-[6px] rounded-full" style={{ background: TONE_COLOR[aStatus.tone] }} />
                  {aStatus.text}
                </span>
                <NodeActions node={active} onChanged={refresh} trigger={<Button type="text" size="small">⋯</Button>} />
              </div>
              <div className="px-4 py-2">
                <FieldRow label="IP 地址" value={<span className="kbd-mono">{internalIp(active) ?? '-'}</span>} />
                <FieldRow label="角色" value={nodeRoleShort(active)} />
                <FieldRow label="操作系统" value={active.status?.nodeInfo?.osImage ?? '-'} />
                <FieldRow label="Kubernetes 版本" value={active.status?.nodeInfo?.kubeletVersion ?? '-'} />
                <FieldRow label="创建时间" value={datetime(active.metadata?.creationTimestamp)} />
                <FieldRow label="运行时" value={active.status?.nodeInfo?.containerRuntimeVersion ?? '-'} />
              </div>
            </div>

            <Panel title="资源使用率" extra={<a style={{ fontSize: 12 }} onClick={() => setDetailNode(active.metadata?.name)}>查看详情 <RightOutlined style={{ fontSize: 10 }} /></a>}>
              <div className="flex justify-around py-1">
                {[
                  { label: 'CPU', pct: aCpuUsed !== null && aCpuTotal ? percent(aCpuUsed, aCpuTotal) : null, color: '#2f6fed', sub: aCpuTotal ? `${aCpuUsed !== null ? aCpuUsed.toFixed(1) : '-'} / ${aCpuTotal.toFixed(0)} vCPU` : '-' },
                  { label: '内存', pct: aMemUsed !== null && aMemTotal ? percent(aMemUsed, aMemTotal) : null, color: '#27a06a', sub: aMemTotal ? `${aMemUsed !== null ? (aMemUsed / 1024 ** 3).toFixed(1) : '-'} / ${(aMemTotal / 1024 ** 3).toFixed(0)} GiB` : '-' },
                ].map((it) => (
                  <div key={it.label} className="flex flex-col items-center gap-1">
                    <Ring pct={it.pct} color={it.color} />
                    <div className="text-sm font-medium" style={{ color: '#15233a' }}>{it.label}</div>
                    <div className="text-xs" style={{ color: '#8f9aa9' }}>{it.sub}</div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Pod 运行情况" extra={<a style={{ fontSize: 12 }} onClick={() => navigate(clusterPath(cluster, 'res/pods'))}>查看全部 <RightOutlined style={{ fontSize: 10 }} /></a>}>
              <div className="space-y-2">
                {[
                  { label: '运行中', value: aPods?.running ?? 0, color: '#27a06a' },
                  { label: '异常', value: aPods?.failed ?? 0, color: '#d94f4f' },
                  { label: '已完成', value: aPods?.succeeded ?? 0, color: '#9aa7b8' },
                ].map((it) => (
                  <div key={it.label} className="flex items-center gap-3 text-[13px]">
                    <span className="size-[7px] rounded-full" style={{ background: it.color }} />
                    <span className="w-12" style={{ color: '#5b6a80' }}>{it.label}</span>
                    <span className="w-8 text-right font-medium" style={{ color: '#15233a' }}>{it.value}</span>
                    <div className="h-1.5 flex-1 rounded-full bg-[#eef1f5]">
                      <div className="h-1.5 rounded-full" style={{ width: `${aPods?.total ? Math.round((it.value / aPods.total) * 100) : 0}%`, background: it.color }} />
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-3 pt-1 text-[13px]">
                  <span className="w-[19px]" />
                  <span className="w-12" style={{ color: '#5b6a80' }}>总计</span>
                  <span className="font-medium" style={{ color: '#15233a' }}>{aPods?.total ?? 0}</span>
                </div>
              </div>
            </Panel>

            <Panel title="最近事件" extra={<a style={{ fontSize: 12 }} onClick={() => setDetailNode(active.metadata?.name)}>查看全部 <RightOutlined style={{ fontSize: 10 }} /></a>}>
              {nodeEvents.length ? (
                <div className="space-y-2">
                  {nodeEvents.slice(0, 4).map((ev, i) => (
                    <div key={`${ev.metadata?.name}-${i}`} className="flex items-center gap-2 text-[13px]">
                      <span className="size-[7px] shrink-0 rounded-full" style={{ background: ev.type === 'Warning' ? '#d94f4f' : '#27a06a' }} />
                      <span className="w-[104px] shrink-0 truncate font-medium" style={{ color: '#15233a' }}>{ev.reason}</span>
                      <span className="min-w-0 flex-1 truncate" style={{ color: '#8f9aa9' }}>{ev.message}</span>
                      <span className="shrink-0 text-xs" style={{ color: '#8f9aa9' }}>{datetime(ev.lastTimestamp ?? ev.firstTimestamp)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[13px]" style={{ color: '#8f9aa9' }}>暂无事件</div>
              )}
            </Panel>
          </>
        )}

        <Panel title="使用小贴士">
          <div className="text-[13px] leading-6" style={{ color: '#5b6a80' }}>
            节点是运行 kubelet 的主机，容器组被调度到节点上执行；「维护中」表示节点已停止调度，可将业务迁出后做维护。
          </div>
        </Panel>
      </div>

      <NodeDetailDrawer
        cluster={cluster}
        name={detailNode}
        onClose={() => setDetailNode(undefined)}
        onOpenPod={(ns, name) => setDetailPod({ ns, name })}
        onDeleted={() => {
          setDetailNode(undefined)
          void refresh()
        }}
      />

      <PodDetailDrawer
        cluster={cluster}
        namespace={detailPod?.ns}
        name={detailPod?.name}
        onClose={() => setDetailPod(undefined)}
        onDeleted={() => {
          setDetailPod(undefined)
          void refresh()
        }}
      />

      <Modal open={addOpen} title="添加节点" onCancel={() => setAddOpen(false)} footer={<Button onClick={() => setAddOpen(false)}>知道了</Button>}>
        <Typography.Paragraph style={{ fontSize: 13 }}>
          节点通过 <Typography.Text code>kubeadm join</Typography.Text> 在目标主机上执行加入命令，或由云厂商 / 集群自动扩缩器自动注册；
          节点完成 kubelet 证书签发并 Ready 后，会自动出现在此列表中。KubeSpoke 控制台不提供直接添加主机的通道。
        </Typography.Paragraph>
      </Modal>
    </div>
  )
}
