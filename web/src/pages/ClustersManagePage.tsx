import { App, Button, Drawer, Dropdown, Input, Progress, Select, Space, Table, Tag, Typography } from 'antd'
import type { ReactNode } from 'react'
import {
  CheckCircleOutlined,
  CloudServerOutlined,
  ClusterOutlined,
  DownOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { agentApi, clusterApi } from '../api/cluster'
import { AddClusterDrawer } from '../components/AddClusterDrawer'
import { ClusterBaseInfo } from '../pages/settings/BaseInfoPage'
import { resourceApi } from '../api/resources'
import type { K8sObject } from '../api/resources'
import { useClusterStore } from '../store/useClusterStore'
import { bytes, cpuCores, datetime, percent } from '../utils/format'
import { internalIp } from './NodesPage'
import type { V1Node } from '../types/k8s'
import type { ResourceDescriptor } from '../config/nav'
import { clusterPath } from '../config/nav'

/** 集群展示名/别名/类型挂在 kube-system 注解上（与概览页同一套约定） */
const ANNOTATION_ALIAS = 'kubespoke.io/alias-name'
const ANNOTATION_TYPE = 'kubespoke.io/type'

const NS_DESC: ResourceDescriptor = {
  key: 'namespaces',
  label: '项目',
  kind: 'Namespace',
  group: '',
  version: 'v1',
  plural: 'namespaces',
  scope: 'Namespaced',
}

interface ClusterRow {
  name: string
  alias?: string
  type: string
  address: string
  version: string
  nodes: number
  readyNodes: number
  cpuPct: number | null
  memPct: number | null
  status: '运行中' | '异常'
  created?: string
}

const readyCount = (nodes: V1Node[]) =>
  nodes.filter((n) => n.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True')).length

const AVATAR_COLORS = ['#2f6fed', '#29b6a9', '#7c5cff', '#f5a623', '#36b37e', '#ff7a59']

const TONE_COLOR: Record<string, string> = { ok: '#59c492', warn: '#f5a623', danger: '#d94f4f', muted: '#9aa7b8' }

const STATUS_TONE: Record<string, { dot: string; text: string; bg: string }> = {
  运行中: { dot: TONE_COLOR.ok, text: '#1e9c60', bg: '#e9f8f0' },
  异常: { dot: TONE_COLOR.danger, text: '#d94f4f', bg: '#fdecec' },
}

// ---------------------------------------------------------------- 页面小组件（对齐节点管理页，文件内本地实现）

/** 右侧竖排面板（与节点管理页同款） */
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
      format={() =>
        pct === null ? (
          <span style={{ fontSize: 11, color: '#b3bdcc' }}>无数据</span>
        ) : (
          <span style={{ fontSize: 14, fontWeight: 600 }}>{pct}%</span>
        )
      }
    />
  )
}

function FieldRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[13px]">
      <span style={{ color: '#8f9aa9' }}>{label}</span>
      <span className="max-w-[62%] truncate text-right" style={{ color: '#15233a' }}>
        {value}
      </span>
    </div>
  )
}

function StatCard({
  label,
  value,
  total,
  pct,
  color,
  bg,
  icon,
  active,
  onClick,
}: {
  label: string
  value: number
  total: number
  pct: string
  color: string
  bg: string
  icon: ReactNode
  active?: boolean
  onClick?: () => void
}) {
  return (
    <div
      className="flex cursor-pointer items-center justify-between rounded-lg bg-white px-4 py-3 transition-shadow hover:shadow-md"
      style={{ border: `1px solid ${active ? color : '#e6ebf1'}` }}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg text-lg" style={{ background: bg, color }}>
          {icon}
        </span>
        <div>
          <div className="text-xs" style={{ color: '#8f9aa9' }}>
            {label}
          </div>
          <div className="text-xl font-bold leading-6" style={{ color: '#15233a' }}>
            {value}
            <span className="ml-1 text-xs font-normal" style={{ color: '#8f9aa9' }}>
              / {total}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: '#8f9aa9' }}>
          {pct}
        </span>
        <RightOutlined style={{ color: '#c9d2de', fontSize: 12 }} />
      </div>
    </div>
  )
}

/** 集群管理页：渐变横幅 + 可点击统计卡 + 工具栏表格 + 右侧选中集群详情（换皮，数据/路由/动作保持不变） */
export default function ClustersManagePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { message } = App.useApp()
  const setCluster = useClusterStore((s) => s.setCluster)
  const current = useClusterStore((s) => s.cluster)

  const [rows, setRows] = useState<ClusterRow[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [activeName, setActiveName] = useState<string>()
  const [detailCluster, setDetailCluster] = useState<string>()

  // 支持外部（如 DashboardPage 的 kubeconfig 弹窗）用 /clusters?add=1 直接拉起抽屉
  useEffect(() => {
    if (searchParams.get('add')) {
      setAddOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete('add')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const agents = (await agentApi.online()) ?? []
      const list = await Promise.all(
        agents.map(async (a): Promise<ClusterRow> => {
          const [nodesR, metricsR, nsR] = await Promise.allSettled([
            clusterApi.nodes(a.name),
            clusterApi.nodeMetrics(a.name),
            resourceApi.read(a.name, NS_DESC, 'kube-system'),
          ])
          const nodes = nodesR.status === 'fulfilled' ? nodesR.value ?? [] : []
          const metrics = metricsR.status === 'fulfilled' ? metricsR.value ?? [] : []
          const ns = nsR.status === 'fulfilled' ? (nsR.value as unknown as K8sObject) : undefined
          const allocCpu = nodes.reduce((s, n) => s + cpuCores(n.status?.allocatable?.cpu), 0)
          const allocMem = nodes.reduce((s, n) => s + bytes(n.status?.allocatable?.memory), 0)
          const usedCpu = metrics.reduce((s, m) => s + cpuCores(m.usage?.cpu), 0)
          const usedMem = metrics.reduce((s, m) => s + bytes(m.usage?.memory), 0)
          const ready = readyCount(nodes)
          const annotations = ns?.metadata?.annotations ?? {}
          return {
            name: a.name,
            alias: annotations[ANNOTATION_ALIAS],
            type: annotations[ANNOTATION_TYPE] || '自建集群',
            address: nodes.length ? (internalIp(nodes[0]) ?? '') : '',
            version: nodes[0]?.status?.nodeInfo?.kubeletVersion ?? '-',
            nodes: nodes.length,
            readyNodes: ready,
            cpuPct: metrics.length && allocCpu ? percent(usedCpu, allocCpu) : null,
            memPct: metrics.length && allocMem ? percent(usedMem, allocMem) : null,
            status: nodes.length && ready > 0 ? '运行中' : '异常',
            created: ns?.metadata?.creationTimestamp,
          }
        }),
      )
      setRows(list)
    } catch (e) {
      message.error((e as Error).message || '加载集群列表失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (typeFilter !== 'all' && r.type !== typeFilter) return false
      if (kw && !`${r.name} ${r.alias ?? ''} ${r.address}`.toLowerCase().includes(kw)) return false
      return true
    })
  }, [rows, statusFilter, typeFilter, keyword])

  const counts = useMemo(() => {
    const running = rows.filter((r) => r.status === '运行中').length
    const abnormal = rows.filter((r) => r.status === '异常').length
    return { running, abnormal }
  }, [rows])

  const enter = (r: ClusterRow) => {
    setCluster(r.name)
    navigate(clusterPath(r.name, 'overview'))
  }

  // 侧栏跟随选中集群：优先点击选中，否则回落当前过滤首行
  const active = useMemo(
    () => filtered.find((r) => r.name === activeName) ?? filtered[0],
    [filtered, activeName],
  )

  const columns = [
    {
      title: '集群名称',
      dataIndex: 'name',
      width: 220,
      sorter: (a: ClusterRow, b: ClusterRow) => a.name.localeCompare(b.name),
      render: (_: string, r: ClusterRow, i: number) => (
        <div className="flex items-center gap-3">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-full"
            style={{ background: `${AVATAR_COLORS[i % AVATAR_COLORS.length]}14`, color: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
          >
            <CloudServerOutlined />
          </span>
          <div className="min-w-0">
            {/* 点名称＝把该集群设为当前集群（与顶栏选择器同一个状态），进入控制台走「进入」 */}
            <span className="flex items-center gap-2">
              <Typography.Link className="truncate !font-medium" style={{ color: r.name === current ? '#2f6fed' : '#15233a' }} onClick={() => setCluster(r.name)}>
                {r.alias || r.name}
              </Typography.Link>
              {r.name === current && (
                <Tag color="blue" variant="filled" style={{ borderRadius: 999, margin: 0, fontSize: 11, lineHeight: '18px' }}>
                  当前
                </Tag>
              )}
            </span>
            <div className="truncate text-xs" style={{ color: '#8f9aa9' }}>{r.address || '-'}</div>
          </div>
        </div>
      ),
    },
    {
      title: '集群类型',
      dataIndex: 'type',
      width: 120,
      render: (t: string) => (
        <Tag color={t === '托管集群' ? 'blue' : 'green'} variant="filled" style={{ borderRadius: 999 }}>
          {t}
        </Tag>
      ),
    },
    { title: '版本', dataIndex: 'version', width: 100 },
    {
      title: '节点数',
      dataIndex: 'nodes',
      width: 90,
      sorter: (a: ClusterRow, b: ClusterRow) => a.nodes - b.nodes,
      render: (n: number, r: ClusterRow) => (
        <span title={`就绪 ${r.readyNodes}/${n}`}>
          {r.readyNodes} / {n}
        </span>
      ),
    },
    {
      title: 'CPU / 内存（已用）',
      key: 'usage',
      width: 200,
      render: (_: unknown, r: ClusterRow) => (
        <div className="flex items-center gap-3">
          <div className="w-20">
            <div className="text-xs" style={{ color: '#5b6a80' }}>{r.cpuPct === null ? '-' : `${r.cpuPct}%`}</div>
            <Progress percent={r.cpuPct ?? 0} showInfo={false} size="small" strokeColor="#2f6fed" />
          </div>
          <div className="w-20">
            <div className="text-xs" style={{ color: '#5b6a80' }}>{r.memPct === null ? '-' : `${r.memPct}%`}</div>
            <Progress percent={r.memPct ?? 0} showInfo={false} size="small" strokeColor="#59c492" />
          </div>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (s: string) => {
        const tone = STATUS_TONE[s] ?? STATUS_TONE['异常']
        return (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <span className="size-[7px] rounded-full" style={{ background: tone.dot }} />
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ color: tone.text, background: tone.bg }}
            >
              {s}
            </span>
          </span>
        )
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created',
      width: 170,
      sorter: (a: ClusterRow, b: ClusterRow) => (a.created ?? '').localeCompare(b.created ?? ''),
      render: (c?: string) => <span style={{ color: '#5b6a80' }}>{datetime(c)}</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 170,
      render: (_: unknown, r: ClusterRow) => (
        <Space size={12}>
          <Typography.Link onClick={() => setDetailCluster(r.name)}>详情</Typography.Link>
          <Typography.Link onClick={() => enter(r)}>进入</Typography.Link>
          <Dropdown
            menu={{
              items: [
                { key: 'access', label: '集群接入设置' },
                { key: 'reload', label: '重新加载' },
              ],
              onClick: ({ key }) => {
                if (key === 'access') setAddOpen(true)
                if (key === 'reload') void load()
              },
            }}
          >
            <Typography.Link>
              更多 <DownOutlined style={{ fontSize: 10 }} />
            </Typography.Link>
          </Dropdown>
        </Space>
      ),
    },
  ]

  const aTone = active ? STATUS_TONE[active.status] ?? STATUS_TONE['异常'] : null

  return (
    <div className="flex items-start gap-4">
      {/* 左：主区 */}
      <div className="min-w-0 flex-1 space-y-4">
        {/* 渐变横幅 */}
        <div
          className="flex items-center justify-between gap-4 rounded-lg px-6 py-5"
          style={{ background: 'linear-gradient(90deg, #f2f7ff 0%, #e9f1fd 60%, #eef4fe 100%)' }}
        >
          <div className="flex items-center gap-4">
            <span
              className="grid size-14 shrink-0 place-items-center rounded-xl text-2xl"
              style={{ background: 'linear-gradient(135deg, #dbeafe, #eff6ff)', color: '#2f6fed', border: '1px solid #cfe0fb' }}
            >
              <ClusterOutlined />
            </span>
            <div>
              <div className="text-xl font-bold" style={{ color: '#15233a' }}>集群管理</div>
              <div className="mt-1 text-[13px]" style={{ color: '#6b7a92' }}>
                统一管理接入的多集群 Kubernetes 资源，查看集群状态、节点规模与资源使用情况。
              </div>
            </div>
          </div>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void load()}
            style={{ background: 'linear-gradient(90deg, #3f8cff, #1f5fe0)', borderColor: '#1f5fe0' }}
          >
            刷新
          </Button>
        </div>

        {/* 可点击统计卡 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="集群总数" value={rows.length} total={rows.length} pct="100%"
            color="#2f6fed" bg="#e8f1ff" icon={<ClusterOutlined />}
            active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}
          />
          <StatCard
            label="运行中" value={counts.running} total={rows.length}
            pct={rows.length ? `${Math.round((counts.running / rows.length) * 100)}%` : '0%'}
            color="#27a06a" bg="#e6f7ef" icon={<CheckCircleOutlined />}
            active={statusFilter === '运行中'} onClick={() => setStatusFilter(statusFilter === '运行中' ? 'all' : '运行中')}
          />
          <StatCard
            label="异常" value={counts.abnormal} total={rows.length}
            pct={rows.length ? `${Math.round((counts.abnormal / rows.length) * 100)}%` : '0%'}
            color="#d94f4f" bg="#fdecec" icon={<WarningOutlined />}
            active={statusFilter === '异常'} onClick={() => setStatusFilter(statusFilter === '异常' ? 'all' : '异常')}
          />
        </div>

        {/* 工具栏 + 表格卡 */}
        <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              style={{ background: 'linear-gradient(90deg, #3f8cff, #1f5fe0)', borderColor: '#1f5fe0' }}
              onClick={() => setAddOpen(true)}
            >
              添加集群
            </Button>
            <span className="text-[13px]" style={{ color: '#8f9aa9' }}>集群状态</span>
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              style={{ width: 110 }}
              suffixIcon={null}
              variant="filled"
              options={[
                { value: 'all', label: '全部' },
                { value: '运行中', label: '运行中' },
                { value: '异常', label: '异常' },
              ]}
            />
            <span className="text-[13px]" style={{ color: '#8f9aa9' }}>集群类型</span>
            <Select
              value={typeFilter}
              onChange={setTypeFilter}
              style={{ width: 120 }}
              suffixIcon={null}
              variant="filled"
              options={[
                { value: 'all', label: '全部' },
                { value: '托管集群', label: '托管集群' },
                { value: '自建集群', label: '自建集群' },
              ]}
            />
            <span className="ml-auto flex items-center gap-2">
              <Input
                allowClear
                prefix={<SearchOutlined style={{ color: '#a0aab8' }} />}
                placeholder="搜索集群名称、别名或地址"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                style={{ width: 220 }}
              />
              <Button type="text" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()} />
            </span>
          </div>

          <Table<ClusterRow>
            rowKey="name"
            size="small"
            loading={loading}
            dataSource={filtered}
            columns={columns}
            scroll={{ x: 1180 }}
            onRow={(r) => ({
              onClick: (e) => {
                if ((e.target as HTMLElement).closest('button,a,input')) return
                setActiveName(r.name)
              },
            })}
            rowClassName={(r) => (r.name === active?.name ? 'ks-row-active' : '')}
            pagination={{
              pageSize: 10,
              showTotal: (t) => `共 ${t} 条`,
              hideOnSinglePage: false,
            }}
            locale={{
              emptyText: (
                <div className="py-10 text-center">
                  <div className="text-sm" style={{ color: '#8f9aa9' }}>暂无在线集群</div>
                  <Button type="link" onClick={() => setAddOpen(true)}>去接入集群</Button>
                </div>
              ),
            }}
          />
        </div>
      </div>

      {/* 右：选中集群详情 */}
      <div className="hidden w-[300px] shrink-0 space-y-4 xl:block">
        {active && aTone && (
          <>
            <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
              <div className="flex items-center gap-3 px-4" style={{ height: 58, borderBottom: '1px solid #eef1f5' }}>
                <span className="grid size-9 place-items-center rounded-lg text-base text-white" style={{ background: 'linear-gradient(135deg, #5ea0ff, #1668dc)' }}>
                  <CloudServerOutlined />
                </span>
                <span className="min-w-0 flex-1 truncate text-base font-bold" style={{ color: '#15233a' }}>
                  {active.alias || active.name}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs" style={{ background: aTone.bg, color: aTone.text }}>
                  <span className="size-[6px] rounded-full" style={{ background: aTone.dot }} />
                  {active.status}
                </span>
              </div>
              <div className="px-4 py-2">
                <FieldRow label="集群标识" value={active.name} />
                <FieldRow label="集群类型" value={active.type} />
                <FieldRow label="Kubernetes 版本" value={active.version} />
                <FieldRow label="API 地址" value={<span className="kbd-mono">{active.address || '-'}</span>} />
                <FieldRow label="节点数（就绪/总）" value={`${active.readyNodes} / ${active.nodes}`} />
                <FieldRow label="创建时间" value={datetime(active.created)} />
              </div>
            </div>

            <Panel title="资源使用率" extra={<a style={{ fontSize: 12 }} onClick={() => enter(active)}>进入集群 <RightOutlined style={{ fontSize: 10 }} /></a>}>
              <div className="flex justify-around py-1">
                {[
                  { label: 'CPU', pct: active.cpuPct, color: '#2f6fed' },
                  { label: '内存', pct: active.memPct, color: '#27a06a' },
                ].map((it) => (
                  <div key={it.label} className="flex flex-col items-center gap-1">
                    <Ring pct={it.pct} color={it.color} />
                    <div className="text-sm font-medium" style={{ color: '#15233a' }}>{it.label}</div>
                    <div className="text-xs" style={{ color: '#8f9aa9' }}>{it.pct === null ? '无数据' : `已用 ${it.pct}%`}</div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="最近事件">
              <div className="text-[13px]" style={{ color: '#8f9aa9' }}>暂无事件</div>
            </Panel>
          </>
        )}

        <Panel title="使用小贴士">
          <div className="text-[13px] leading-6" style={{ color: '#5b6a80' }}>
            点击集群名称可将其设为当前集群，「进入」打开集群概览，「详情」在右侧抽屉查看和编辑集群信息；「异常」表示该集群当前没有就绪的在线节点。
          </div>
        </Panel>
      </div>

      <AddClusterDrawer open={addOpen} onClose={() => setAddOpen(false)} />

      {/* 集群详情抽屉：复用「基本信息」整页正文，编辑就地完成 */}
      <Drawer
        open={!!detailCluster}
        onClose={() => setDetailCluster(undefined)}
        placement="right"
        size={720}
        title="集群详情"
        destroyOnHidden
      >
        {detailCluster && <ClusterBaseInfo cluster={detailCluster} onChanged={load} />}
      </Drawer>
    </div>
  )
}
