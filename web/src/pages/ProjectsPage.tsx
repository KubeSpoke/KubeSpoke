import {
  ApartmentOutlined,
  CheckCircleFilled,
  ContainerOutlined,
  DeploymentUnitOutlined,
  DownOutlined,
  ExclamationCircleOutlined,
  GlobalOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Dropdown,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Spin,
  Table,
  Typography,
} from 'antd'
import type { MenuProps } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { resourceApi, toItems } from '../api/resources'
import type { K8sObject } from '../api/resources'
import type { ResourceDescriptor } from '../config/nav'
import { useResource } from '../hooks/useResource'
import { useClusterStore } from '../store/useClusterStore'
import { datetime } from '../utils/format'
import { toYaml } from '../utils/yaml'
import type { V1Event } from '../types/k8s'

/** 项目 = Namespace。这里用通用资源接口取完整对象，才能拿到 annotations */
const NAMESPACE: ResourceDescriptor = {
  key: 'namespaces', label: '项目', kind: 'Namespace', group: '', version: 'v1',
  plural: 'namespaces', scope: 'Cluster', statusKind: 'none',
}
const PODS: ResourceDescriptor = {
  key: 'pods', label: '容器组', kind: 'Pod', group: '', version: 'v1',
  plural: 'pods', scope: 'Namespaced', statusKind: 'phase',
}
const DEPLOYMENTS: ResourceDescriptor = {
  key: 'deployments', label: '部署', kind: 'Deployment', group: 'apps', version: 'v1',
  plural: 'deployments', scope: 'Namespaced', statusKind: 'readyReplicas',
}
const SERVICES: ResourceDescriptor = {
  key: 'services', label: '服务', kind: 'Service', group: '', version: 'v1',
  plural: 'services', scope: 'Namespaced', statusKind: 'none',
}

const ALIAS_KEY = 'kubesphere.io/alias-name'
const DESCRIPTION_KEY = 'kubesphere.io/description'

const nameOf = (o: K8sObject) => o.metadata?.name ?? ''
const aliasOf = (o: K8sObject) => o.metadata?.annotations?.[ALIAS_KEY] ?? ''
const descriptionOf = (o: K8sObject) => o.metadata?.annotations?.[DESCRIPTION_KEY] ?? ''
const phaseOf = (o: K8sObject) => (o.status?.phase as string | undefined) ?? 'Unknown'

/** KubeSphere 把系统命名空间单独归类，这里用同样的名称规则本地判断 */
const isSystemProject = (name: string) =>
  name.startsWith('kube-') || name === 'kubesphere-system' || name.startsWith('kubesphere-')

/** 读单个对象时后端可能回落成列表（CustomObjects 路径），两种形态都收敛到目标对象 */
function asObject(res: K8sObject | K8sObject[] | undefined, name: string): K8sObject | undefined {
  const items = toItems(res)
  if (items.length) return items.find((o) => nameOf(o) === name)
  return Array.isArray(res) ? undefined : res
}

const PHASE_TEXT: Record<string, string> = { Active: '活跃', Terminating: '终止中' }
const PHASE_COLOR: Record<string, string> = { Active: '#59c492', Terminating: '#f5a623' }

const TONE_COLOR: Record<string, string> = { ok: '#59c492', warn: '#f5a623', danger: '#d94f4f', muted: '#9aa7b8' }

/** 设计稿口径的项目状态：文案 + 语义色（与统计卡、右侧胶囊共用） */
function projectUiStatus(phase: string): { text: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } {
  if (phase === 'Active') return { text: '活跃', tone: 'ok' }
  if (phase === 'Terminating') return { text: '终止中', tone: 'warn' }
  return { text: PHASE_TEXT[phase] ?? phase, tone: 'muted' }
}

function ProjectStatus({ phase }: { phase: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="size-[7px] shrink-0 rounded-full" style={{ background: PHASE_COLOR[phase] ?? '#9aa7b8' }} />
      <span style={{ fontWeight: 500, color: '#15233a' }}>{PHASE_TEXT[phase] ?? phase}</span>
    </span>
  )
}

/** 列表「更多」菜单：静态项，删除走单元格内的 Popconfirm 二次确认 */
const ROW_MENU: MenuProps['items'] = [
  { key: 'edit', label: '编辑信息' },
  { key: 'yaml', label: '查看 YAML' },
]

type Scope = 'user' | 'system' | 'all'

interface FormValues {
  name: string
  alias?: string
  description?: string
}

// ---------------------------------------------------------------- 页面局部小组件（与节点管理页同款）

/** 右侧竖排面板（与节点/工作负载页同款） */
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

export default function ProjectsPage() {
  const { message, modal } = App.useApp()
  const cluster = useClusterStore((s) => s.cluster)
  const loadNamespaces = useClusterStore((s) => s.loadNamespaces)

  const [filterScope, setFilterScope] = useState<Scope>('user')
  const [filterPhase, setFilterPhase] = useState<string>()
  const [search, setSearch] = useState('')
  const [current, setCurrent] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<K8sObject>()
  const [yamlTarget, setYamlTarget] = useState<K8sObject>()
  const [detail, setDetail] = useState<K8sObject>()
  const [activeName, setActiveName] = useState<string>()

  const { data, error, loading, refresh } = useResource<K8sObject[]>(
    () => (cluster ? resourceApi.list(cluster, NAMESPACE).then(toItems) : Promise.resolve([])),
    [cluster],
  )

  const all = useMemo(() => data ?? [], [data])
  const userProjects = useMemo(() => all.filter((o) => !isSystemProject(nameOf(o))), [all])
  const systemProjects = useMemo(() => all.filter((o) => isSystemProject(nameOf(o))), [all])

  const counts = useMemo(() => {
    let active = 0
    let terminating = 0
    for (const o of all) {
      const p = phaseOf(o)
      if (p === 'Active') active += 1
      else if (p === 'Terminating') terminating += 1
    }
    return { active, terminating }
  }, [all])

  const rows = useMemo(() => {
    let list = filterScope === 'all' ? all : filterScope === 'system' ? systemProjects : userProjects
    if (filterPhase) list = list.filter((o) => phaseOf(o) === filterPhase)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((o) => nameOf(o).toLowerCase().includes(q) || aliasOf(o).toLowerCase().includes(q))
    }
    return list
  }, [all, userProjects, systemProjects, filterScope, filterPhase, search])

  useEffect(() => setCurrent(1), [filterScope, filterPhase, search, pageSize])

  const active = useMemo(
    () => all.find((o) => nameOf(o) === activeName) ?? rows[0] ?? all[0],
    [all, rows, activeName],
  )
  const shownName = active ? nameOf(active) : undefined
  const aStatus = active ? projectUiStatus(phaseOf(active)) : null

  /** 选中项目下的资源概览：复用与详情抽屉相同的三个通用列表接口 */
  const usage = useResource<{ pods: number; deployments: number; services: number } | null>(
    async () => {
      if (!cluster || !shownName) return null
      const [pods, deployments, services] = await Promise.all(
        [PODS, DEPLOYMENTS, SERVICES].map(
          (d) => resourceApi.list(cluster, d, shownName).then(toItems).catch(() => [] as K8sObject[]),
        ),
      )
      const inProject = (items: K8sObject[]) => items.filter((o) => (o.metadata?.namespace ?? shownName) === shownName).length
      return { pods: inProject(pods), deployments: inProject(deployments), services: inProject(services) }
    },
    [cluster, shownName],
  )

  const overview = usage.data
    ? [
        { label: '容器组', value: usage.data.pods, color: '#2f6fed' },
        { label: '部署', value: usage.data.deployments, color: '#59c492' },
        { label: '服务', value: usage.data.services, color: '#7c5cff' },
      ]
    : null
  const overviewMax = overview ? Math.max(...overview.map((i) => i.value), 1) : 1

  const [projEvents, setProjEvents] = useState<V1Event[]>([])
  useEffect(() => {
    if (!cluster || !shownName) {
      setProjEvents([])
      return
    }
    let live = true
    void resourceApi
      .events(cluster, 'Namespace', shownName)
      .then((evs) => live && setProjEvents(evs ?? []))
      .catch(() => live && setProjEvents([]))
    return () => {
      live = false
    }
  }, [cluster, shownName])

  const done = () => {
    void refresh()
    void loadNamespaces()
  }

  const remove = async (o: K8sObject) => {
    try {
      await resourceApi.remove(cluster, NAMESPACE, nameOf(o))
      message.success(`已删除项目 ${nameOf(o)}`)
      done()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const onMenu = (o: K8sObject) => ({ key }: { key: string }) => {
    if (key === 'edit') setEditing(o)
    if (key === 'yaml') setYamlTarget(o)
  }

  const confirmRemove = (o: K8sObject) => {
    modal.confirm({
      title: `删除项目 ${nameOf(o)}？`,
      content: '删除项目将级联删除其下所有资源，正在运行的业务可能中断。此操作不可恢复。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => remove(o),
    })
  }

  const pctOf = (n: number) => (all.length ? `${Math.round((n / all.length) * 100)}%` : '0%')

  if (!all.length && !loading) {
    return (
      <div className="rounded-lg bg-white p-10 text-center" style={{ border: '1px solid #e6ebf1', color: '#8f9aa9' }}>
        当前集群没有可读取的项目。
        <Button size="small" className="ml-3" onClick={refresh} loading={loading}>刷新</Button>
      </div>
    )
  }

  const sideMenu: MenuProps = {
    items: [
      { key: 'edit', label: '编辑信息' },
      { key: 'yaml', label: '查看 YAML' },
      { key: 'remove', label: '删除', danger: true },
    ],
    onClick: ({ key }) => {
      if (!active) return
      if (key === 'edit') setEditing(active)
      if (key === 'yaml') setYamlTarget(active)
      if (key === 'remove') confirmRemove(active)
    },
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
          className="relative flex items-center justify-between gap-4 overflow-hidden rounded-lg px-6 py-5"
          style={{ background: 'linear-gradient(90deg, #f2f7ff 0%, #e9f1fd 60%, #eef4fe 100%)' }}
        >
          <div className="flex items-center gap-4">
            <span
              className="grid size-14 shrink-0 place-items-center rounded-xl text-2xl text-white"
              style={{ background: 'linear-gradient(135deg, #5ea0ff, #1668dc)' }}
            >
              <ApartmentOutlined />
            </span>
            <div>
              <div className="text-xl font-bold" style={{ color: '#15233a' }}>项目</div>
              <div className="mt-1 text-[13px]" style={{ color: '#6b7a92' }}>
                当前集群：{cluster || '未选择'}。项目（命名空间）是集群内资源的隔离边界，一个项目下的资源互不可见。
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>刷新</Button>
            <Button
              type="primary"
              disabled={!cluster}
              icon={<PlusOutlined />}
              onClick={() => setCreateOpen(true)}
            >
              新建项目
            </Button>
          </div>
        </div>

        {/* 统计卡 */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard
            label="项目总数" value={all.length} total={all.length} pct="100%"
            color="#2f6fed" bg="#e8f1ff" icon={<ApartmentOutlined />}
            active={filterScope === 'all' && !filterPhase}
            onClick={() => { setFilterScope('all'); setFilterPhase(undefined) }}
          />
          <StatCard
            label="活跃" value={counts.active} total={all.length} pct={pctOf(counts.active)}
            color="#27a06a" bg="#e6f7ef" icon={<CheckCircleFilled />}
            active={filterPhase === 'Active'}
            onClick={() => setFilterPhase(filterPhase === 'Active' ? undefined : 'Active')}
          />
          <StatCard
            label="终止中" value={counts.terminating} total={all.length} pct={pctOf(counts.terminating)}
            color="#f5a623" bg="#fdf4e7" icon={<ExclamationCircleOutlined />}
            active={filterPhase === 'Terminating'}
            onClick={() => setFilterPhase(filterPhase === 'Terminating' ? undefined : 'Terminating')}
          />
          <StatCard
            label="系统项目" value={systemProjects.length} total={all.length} pct={pctOf(systemProjects.length)}
            color="#5b6a80" bg="#eef1f5" icon={<SettingOutlined />}
            active={filterScope === 'system'}
            onClick={() => setFilterScope(filterScope === 'system' ? 'all' : 'system')}
          />
        </div>

        {/* 表格卡片 */}
        <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="text-[13px]" style={{ color: '#8f9aa9' }}>状态</span>
            <Select
              allowClear placeholder="全部" style={{ width: 100 }} value={filterPhase} onChange={setFilterPhase}
              suffixIcon={null} variant="filled"
              options={[{ label: '活跃', value: 'Active' }, { label: '终止中', value: 'Terminating' }]}
            />
            <span className="text-[13px]" style={{ color: '#8f9aa9' }}>类型</span>
            <Select
              style={{ width: 110 }} value={filterScope} onChange={(v) => setFilterScope(v as Scope)}
              suffixIcon={null} variant="filled"
              options={[
                { label: '用户项目', value: 'user' },
                { label: '系统项目', value: 'system' },
                { label: '全部项目', value: 'all' },
              ]}
            />
            <span className="ml-auto flex items-center gap-2">
              <Input.Search
                style={{ width: 220 }} placeholder="搜索项目名称、别名..." allowClear
                value={search} onChange={(e) => setSearch(e.target.value)}
              />
              <Button type="text" icon={<ReloadOutlined />} onClick={refresh} loading={loading} />
            </span>
          </div>
          <Table<K8sObject>
            rowKey={(o) => nameOf(o)}
            size="small"
            loading={loading}
            dataSource={rows}
            scroll={{ x: 800 }}
            locale={{ emptyText: '没有匹配的项目' }}
            onRow={(r) => ({
              onClick: (e) => {
                if ((e.target as HTMLElement).closest('button,a,input')) return
                setActiveName(nameOf(r))
              },
            })}
            rowClassName={(r) => (active && nameOf(r) === nameOf(active) ? 'ks-row-active' : '')}
            pagination={{
              current,
              pageSize,
              total: rows.length,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (t) => `共 ${t} 条`,
              onChange: (p, ps) => {
                setCurrent(p)
                setPageSize(ps)
              },
            }}
            columns={[
              {
                key: 'name',
                title: '名称',
                width: 200,
                sorter: (a, b) => nameOf(a).localeCompare(nameOf(b)),
                render: (_, o) => (
                  <div className="flex items-center gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full text-sm" style={{ background: '#e8f1ff', color: '#2f6fed' }}>
                      <ApartmentOutlined />
                    </span>
                    <div className="min-w-0 flex-1">
                      <a className="block truncate font-medium" style={{ color: '#15233a' }} onClick={() => setDetail(o)}>
                        {nameOf(o)}
                      </a>
                      <div className="truncate text-xs" style={{ color: '#8f9aa9' }}>{aliasOf(o) || '-'}</div>
                    </div>
                  </div>
                ),
              },
              {
                key: 'scope',
                title: '类型',
                width: 90,
                render: (_, o) => {
                  const sys = isSystemProject(nameOf(o))
                  const s = sys ? { color: '#5b6a80', bg: '#eef1f5' } : { color: '#2f6fed', bg: '#e8f1ff' }
                  return (
                    <span className="inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs" style={{ background: s.bg, color: s.color }}>
                      {sys ? '系统项目' : '用户项目'}
                    </span>
                  )
                },
              },
              { key: 'status', title: '状态', width: 100, render: (_, o) => <ProjectStatus phase={phaseOf(o)} /> },
              {
                key: 'created',
                title: '创建时间',
                width: 160,
                sorter: (a, b) => (a.metadata?.creationTimestamp ?? '').localeCompare(b.metadata?.creationTimestamp ?? ''),
                render: (_, o) => <span className="text-xs" style={{ color: '#5b6a80' }}>{datetime(o.metadata?.creationTimestamp)}</span>,
              },
              {
                key: 'actions',
                title: '操作',
                width: 210,
                render: (_, o) => (
                  <span className="whitespace-nowrap">
                    <Button size="small" type="link" style={{ paddingLeft: 0 }} onClick={() => setDetail(o)}>
                      详情
                    </Button>
                    <Dropdown menu={{ items: ROW_MENU, onClick: onMenu(o) }} trigger={['click']} placement="bottomRight">
                      <Button size="small" type="text" className="!px-2 !text-[#5c6b80]">
                        更多 <DownOutlined style={{ fontSize: 10 }} />
                      </Button>
                    </Dropdown>
                    <Popconfirm
                      title={`删除项目 ${nameOf(o)}？`}
                      description={<span style={{ color: '#d94f4f' }}>删除项目将级联删除其下所有资源</span>}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => remove(o)}
                    >
                      <Button size="small" type="text" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </span>
                ),
              },
            ]}
          />
        </div>
      </div>

      {/* 右：选中项目详情 */}
      <div className="hidden w-[300px] shrink-0 space-y-4 xl:block">
        {active && aStatus && (
          <>
            <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
              <div className="flex items-center gap-3 px-4" style={{ height: 58, borderBottom: '1px solid #eef1f5' }}>
                <span className="grid size-9 place-items-center rounded-lg text-base text-white" style={{ background: 'linear-gradient(135deg, #5ea0ff, #1668dc)' }}>
                  <ApartmentOutlined />
                </span>
                <span className="min-w-0 flex-1 truncate text-base font-bold" style={{ color: '#15233a' }}>{nameOf(active)}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs" style={{ background: `${TONE_COLOR[aStatus.tone]}1a`, color: aStatus.tone === 'ok' ? '#27a06a' : '#5b6a80' }}>
                  <span className="size-[6px] rounded-full" style={{ background: TONE_COLOR[aStatus.tone] }} />
                  {aStatus.text}
                </span>
                <Dropdown menu={sideMenu} trigger={['click']} placement="bottomRight">
                  <Button type="text" size="small">⋯</Button>
                </Dropdown>
              </div>
              <div className="px-4 py-2">
                <FieldRow label="别名" value={aliasOf(active) || '-'} />
                <FieldRow label="描述" value={descriptionOf(active) || '-'} />
                <FieldRow label="状态" value={aStatus.text} />
                <FieldRow label="分类" value={isSystemProject(nameOf(active)) ? '系统项目' : '用户项目'} />
                <FieldRow label="创建时间" value={datetime(active.metadata?.creationTimestamp)} />
              </div>
            </div>

            <Panel title="资源概览" extra={<a style={{ fontSize: 12 }} onClick={() => setDetail(active)}>查看详情 <RightOutlined style={{ fontSize: 10 }} /></a>}>
              {overview ? (
                <div className="space-y-2">
                  {overview.map((it) => (
                    <div key={it.label} className="flex items-center gap-3 text-[13px]">
                      <span className="size-[7px] rounded-full" style={{ background: it.color }} />
                      <span className="w-12" style={{ color: '#5b6a80' }}>{it.label}</span>
                      <span className="w-8 text-right font-medium" style={{ color: '#15233a' }}>{it.value}</span>
                      <div className="h-1.5 flex-1 rounded-full bg-[#eef1f5]">
                        <div className="h-1.5 rounded-full" style={{ width: `${Math.round((it.value / overviewMax) * 100)}%`, background: it.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[13px]" style={{ color: '#8f9aa9' }}>{usage.loading ? '加载中…' : '暂无数据'}</div>
              )}
            </Panel>

            <Panel title="最近事件">
              {projEvents.length ? (
                <div className="space-y-2">
                  {projEvents.slice(0, 4).map((ev, i) => (
                    <div key={`${ev.metadata?.name}-${i}`} className="flex items-center gap-2 text-[13px]">
                      <span className="size-[7px] shrink-0 rounded-full" style={{ background: ev.type === 'Warning' ? '#d94f4f' : '#27a06a' }} />
                      <span className="w-[92px] shrink-0 truncate font-medium" style={{ color: '#15233a' }}>{ev.reason}</span>
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
            项目即命名空间（Namespace），是集群内资源的隔离边界；删除项目会级联删除其下所有资源，长期停留在「终止中」通常表示有资源卡在删除保护（finalizer）上。
          </div>
        </Panel>
      </div>

      <CreateProjectModal
        open={createOpen}
        cluster={cluster}
        onClose={() => setCreateOpen(false)}
        onCreated={done}
      />
      <EditProjectModal
        project={editing}
        cluster={cluster}
        onClose={() => setEditing(undefined)}
        onSaved={done}
      />
      {yamlTarget && (
        <YamlModal project={yamlTarget} cluster={cluster} onClose={() => setYamlTarget(undefined)} />
      )}
      {detail && <ProjectDrawer project={detail} cluster={cluster} onClose={() => setDetail(undefined)} />}
    </div>
  )
}

/** 创建项目：名称 + 别名 + 描述，别名/描述写进 Namespace 注解 */
function CreateProjectModal({
  open,
  cluster,
  onClose,
  onCreated,
}: {
  open: boolean
  cluster: string
  onClose: () => void
  onCreated: () => void
}) {
  const { message } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const name = values.name.trim()
    const alias = values.alias?.trim() ?? ''
    const description = values.description?.trim() ?? ''
    const annotations: Record<string, string> = {}
    if (alias) annotations[ALIAS_KEY] = alias
    if (description) annotations[DESCRIPTION_KEY] = description

    setSaving(true)
    try {
      await resourceApi.applyYaml(
        cluster,
        toYaml({
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: { name, ...(Object.keys(annotations).length ? { annotations } : {}) },
        }),
      )
      message.success(`已创建项目 ${name}`)
      form.resetFields()
      onClose()
      onCreated()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title="创建项目" width={520} onCancel={onClose} onOk={submit} okText="确定" confirmLoading={saving}>
      <Form form={form} layout="vertical" requiredMark preserve={false} className="pt-1">
        <Form.Item
          name="name"
          label="名称"
          extra="只能包含小写字母、数字和 -，且以字母或数字开头与结尾，最长 63 个字符。"
          rules={[
            { required: true, message: '请输入项目名' },
            { max: 63, message: '名称最长 63 个字符' },
            {
              pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/,
              message: '名称只能包含小写字母、数字和 -，且需以字母或数字开头、结尾',
            },
          ]}
        >
          <Input placeholder="my-project" autoComplete="off" />
        </Form.Item>
        <Form.Item name="alias" label="别名">
          <Input placeholder="可选，用于展示的友好名称" autoComplete="off" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="可选，说明这个项目的用途" maxLength={500} showCount />
        </Form.Item>
      </Form>
    </Modal>
  )
}

/** 编辑信息：改别名 / 描述注解，读原对象合并后再 apply，避免覆盖其他字段 */
function EditProjectModal({
  project,
  cluster,
  onClose,
  onSaved,
}: {
  project?: K8sObject
  cluster: string
  onClose: () => void
  onSaved: () => void
}) {
  const { message } = App.useApp()
  const [form] = Form.useForm<{ alias?: string; description?: string }>()
  const [saving, setSaving] = useState(false)
  const name = project ? nameOf(project) : ''

  useEffect(() => {
    if (project) form.setFieldsValue({ alias: aliasOf(project), description: descriptionOf(project) })
  }, [project, form])

  const submit = async () => {
    if (!name) return
    let values: { alias?: string; description?: string }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSaving(true)
    try {
      const latest = asObject(await resourceApi.read(cluster, NAMESPACE, name), name)
      const annotations = { ...(latest?.metadata?.annotations ?? {}) }
      const alias = values.alias?.trim() ?? ''
      const description = values.description?.trim() ?? ''
      if (alias) annotations[ALIAS_KEY] = alias
      else delete annotations[ALIAS_KEY]
      if (description) annotations[DESCRIPTION_KEY] = description
      else delete annotations[DESCRIPTION_KEY]

      await resourceApi.applyYaml(
        cluster,
        toYaml({
          apiVersion: latest?.apiVersion ?? 'v1',
          kind: latest?.kind ?? 'Namespace',
          metadata: {
            name,
            labels: latest?.metadata?.labels,
            annotations,
            resourceVersion: latest?.metadata?.resourceVersion,
          },
        }),
      )
      message.success('已保存')
      onClose()
      onSaved()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={!!project}
      title={`编辑信息 · ${name}`}
      width={520}
      onCancel={onClose}
      onOk={submit}
      okText="确定"
      confirmLoading={saving}
    >
      <Form form={form} layout="vertical" requiredMark className="pt-1">
        <Form.Item label="名称">
          <Input value={name} disabled />
        </Form.Item>
        <Form.Item name="alias" label="别名">
          <Input placeholder="可选，用于展示的友好名称" autoComplete="off" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="可选，说明这个项目的用途" maxLength={500} showCount />
        </Form.Item>
      </Form>
    </Modal>
  )
}

/** 只读 YAML：拉最新对象原样打成 YAML 供排查 */
function YamlModal({ project, cluster, onClose }: { project: K8sObject; cluster: string; onClose: () => void }) {
  const name = nameOf(project)
  const { data, loading } = useResource<K8sObject | undefined>(
    () => (cluster ? resourceApi.read(cluster, NAMESPACE, name).then((res) => asObject(res, name)) : Promise.resolve(undefined)),
    [cluster, name],
  )
  return (
    <Modal open title={`查看 YAML · ${name}`} width={720} onCancel={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
      <Spin spinning={loading}>
        <Input.TextArea
          readOnly
          spellCheck={false}
          className="kbd-mono"
          value={toYaml(data ?? project)}
          autoSize={{ minRows: 14, maxRows: 24 }}
          style={{ fontSize: 12 }}
        />
      </Spin>
    </Modal>
  )
}

/** 项目详情抽屉：基本信息 + 该项目下的资源数量（本系统没有项目控制台，名称点击走这里） */
function ProjectDrawer({ project, cluster, onClose }: { project: K8sObject; cluster: string; onClose: () => void }) {
  const name = nameOf(project)
  const { data, loading } = useResource<{ pods: number; deployments: number; services: number }>(
    async () => {
      if (!cluster) return { pods: 0, deployments: 0, services: 0 }
      const [pods, deployments, services] = await Promise.all(
        [PODS, DEPLOYMENTS, SERVICES].map(
          (d) => resourceApi.list(cluster, d, name).then(toItems).catch(() => [] as K8sObject[]),
        ),
      )
      const inProject = (items: K8sObject[]) => items.filter((o) => (o.metadata?.namespace ?? name) === name).length
      return { pods: inProject(pods), deployments: inProject(deployments), services: inProject(services) }
    },
    [cluster, name],
  )

  return (
    <Drawer open size={520} title={`项目 · ${name}`} onClose={onClose} destroyOnHidden>
      <div className="space-y-6">
        <div>
          <div className="mb-2 text-[13px] font-medium text-[#79879c]">基本信息</div>
          <Descriptions
            size="small"
            column={1}
            styles={{ label: { width: 104, color: '#79879c' } }}
            items={[
              { key: 'name', label: '名称', children: name },
              { key: 'alias', label: '别名', children: aliasOf(project) || '-' },
              { key: 'desc', label: '描述', children: descriptionOf(project) || '-' },
              { key: 'status', label: '状态', children: <ProjectStatus phase={phaseOf(project)} /> },
              { key: 'created', label: '创建时间', children: datetime(project.metadata?.creationTimestamp) },
            ]}
          />
        </div>

        <div>
          <div className="mb-2 text-[13px] font-medium text-[#79879c]">资源统计</div>
          <div className="grid grid-cols-3 gap-3">
            <StatTile icon={<ContainerOutlined />} label="容器组" value={data?.pods} loading={loading} />
            <StatTile icon={<DeploymentUnitOutlined />} label="部署" value={data?.deployments} loading={loading} />
            <StatTile icon={<GlobalOutlined />} label="服务" value={data?.services} loading={loading} />
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            统计来自当前集群的通用 K8s 接口，仅计入本项目下的对象。
          </Typography.Text>
        </div>
      </div>
    </Drawer>
  )
}

function StatTile({
  icon,
  label,
  value,
  loading,
}: {
  icon: React.ReactNode
  label: string
  value?: number
  loading?: boolean
}) {
  return (
    <div className="rounded border border-[#ebeef2] px-3 py-3">
      <div className="flex items-center gap-2 text-xs text-[#79879c]">
        <span className="text-[15px]">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 min-h-6">
        {loading ? (
          <Skeleton active={false} title={{ width: 40 }} paragraph={false} />
        ) : (
          <span className="text-xl font-semibold leading-none" style={{ color: '#15233a' }}>
            {value ?? 0}
          </span>
        )}
      </div>
    </div>
  )
}
