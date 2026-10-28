import {
  DeleteOutlined,
  MoreOutlined,
  ReloadOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Checkbox,
  Dropdown,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Typography,
} from 'antd'
import type { MenuProps } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { resourceApi, toItems } from '../../api/resources'
import type { K8sObject } from '../../api/resources'
import { useResource } from '../../hooks/useResource'
import { useClusterStore } from '../../store/useClusterStore'
import { datetime } from '../../utils/format'
import { toYaml } from '../../utils/yaml'
import { YamlPreview } from '../../components/YamlPreview'
import type { ResourceDescriptor } from '../../config/nav'
import { StatCard } from '../../components/StatCard'

/** 集群成员 = ClusterRoleBinding 的 subjects；本页面不依赖用户库，全部语义来自 RBAC 对象 */
const CLUSTER_ROLE_BINDING: ResourceDescriptor = {
  key: 'clusterrolebindings',
  label: '集群角色绑定',
  kind: 'ClusterRoleBinding',
  group: 'rbac.authorization.k8s.io',
  version: 'v1',
  plural: 'clusterrolebindings',
  scope: 'Cluster',
  statusKind: 'none',
}

const CLUSTER_ROLE: ResourceDescriptor = {
  key: 'clusterroles',
  label: '集群角色',
  kind: 'ClusterRole',
  group: 'rbac.authorization.k8s.io',
  version: 'v1',
  plural: 'clusterroles',
  scope: 'Cluster',
  statusKind: 'none',
}

const RBAC_GROUP = 'rbac.authorization.k8s.io'

interface RbacSubject {
  kind?: string
  name?: string
  namespace?: string
  apiGroup?: string
}

interface RbacRoleRef {
  apiGroup?: string
  kind?: string
  name?: string
}

/** 一条 subject 命中的某个绑定（角色 + 绑定名），用于「编辑角色 / 移除」 */
interface BindingRef {
  binding: string
  role: string
  createdAt?: string
}

interface MemberRow {
  key: string
  kind: string
  name: string
  namespace?: string
  roles: string[]
  bindings: BindingRef[]
  createdAt?: string
}

const KIND_LABEL: Record<string, string> = {
  User: '用户',
  Group: '组',
  ServiceAccount: '服务帐户',
}

const kindLabel = (m: MemberRow) =>
  m.kind === 'ServiceAccount' ? `${KIND_LABEL.ServiceAccount}(${m.namespace ?? 'default'})` : KIND_LABEL[m.kind] ?? m.kind

const minIso = (a?: string, b?: string) => {
  if (!a) return b
  if (!b) return a
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b
}

/** 展开所有绑定的 subjects，同一 subject 的多个角色合并成一行；无 subjects 的绑定（如 SA 自动绑定）跳过 */
function toMembers(bindings: K8sObject[]): MemberRow[] {
  const map = new Map<string, MemberRow>()
  for (const b of bindings) {
    const binding = b.metadata?.name ?? ''
    if (!binding) continue
    const subjects = (b.subjects as RbacSubject[] | undefined) ?? []
    if (!subjects.length) continue
    const role = (b.roleRef as RbacRoleRef | undefined)?.name ?? binding
    const createdAt = b.metadata?.creationTimestamp
    for (const s of subjects) {
      const name = s.name
      if (!name) continue
      const kind = s.kind ?? 'User'
      const key = `${kind}/${s.namespace ?? ''}/${name}`
      const row = map.get(key) ?? {
        key,
        kind,
        name,
        namespace: s.namespace,
        roles: [],
        bindings: [],
        createdAt,
      }
      row.createdAt = minIso(row.createdAt, createdAt)
      if (!row.bindings.some((x) => x.binding === binding)) {
        row.bindings.push({ binding, role, createdAt })
        if (!row.roles.includes(role)) row.roles.push(role)
      }
      map.set(key, row)
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind))
}

/** K8s 无登录态数据源，成员状态统一按「活跃」呈现（绿点沿用 StatusDot 配色） */
function ActiveDot() {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="size-[7px] shrink-0 rounded-full" style={{ background: 'var(--color-ok)' }} />
      <span style={{ fontWeight: 500, color: 'var(--ks-ink)' }}>活跃</span>
    </span>
  )
}

/** 分页文案对齐 KubeSphere：总数：N ｜ 每页显示：10 */
function usePager(all: number) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const current = Math.min(page, Math.max(1, Math.ceil(all / pageSize)))
  const config = {
    current,
    pageSize,
    showSizeChanger: false,
    onChange: (p: number, ps?: number) => {
      setPage(p)
      if (ps && ps !== pageSize) setPageSize(ps)
    },
    showTotal: (total: number) => (
      <Space size={16} className="text-xs text-[var(--ks-body)]">
        <span>总数：{total}</span>
        <span className="inline-flex items-center gap-1">
          每页显示：
          <Select
            size="small"
            variant="borderless"
            className="!w-16"
            value={pageSize}
            onChange={(v: number) => {
              setPageSize(v)
              setPage(1)
            }}
            options={[10, 20, 50, 100].map((n) => ({ label: String(n), value: n }))}
          />
        </span>
      </Space>
    ),
  }
  return { config, setPage }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)

/** 绑定名需是合法 DNS label：角色名 + 5 位随机后缀 */
const bindingName = (role: string) =>
  `invite-${slug(role) || 'role'}-${Math.random().toString(36).padEnd(9, '0').slice(2, 7)}`
    .slice(0, 63)
    .replace(/-+$/, '')

interface InviteValues {
  kind?: string
  name?: string
  namespace?: string
  roles?: string[]
}

interface InviteProps {
  open: boolean
  onClose: () => void
  cluster: string
  /** 从集群角色行「创建资源分配」进入时预填的角色 */
  presetRole?: string
  onDone?: () => void
}

/** 邀请成员：为选中的每个 ClusterRole 生成一个 ClusterRoleBinding（YAML 下发） */
export function InviteMemberModal({ open, onClose, cluster, presetRole, onDone }: InviteProps) {
  const { message } = App.useApp()
  const [form] = Form.useForm<InviteValues>()
  const [busy, setBusy] = useState(false)
  const namespace = useClusterStore((s) => s.namespace)
  const namespaces = useClusterStore((s) => s.namespaces)

  const kind = Form.useWatch('kind', form) as string | undefined
  const watched = Form.useWatch([], form) as InviteValues | undefined

  const { data: roleData, loading: roleLoading } = useResource(
    () => (open && cluster ? resourceApi.list(cluster, CLUSTER_ROLE) : Promise.resolve([] as K8sObject[])),
    [open, cluster],
  )
  const roleOptions = useMemo(
    () =>
      toItems(roleData)
        .map((o) => o.metadata?.name ?? '')
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [roleData],
  )

  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (presetRole) form.setFieldsValue({ roles: [presetRole] })
  }, [open, presetRole, form])

  const buildBindings = (values: InviteValues) => {
    const subjectKind = values.kind === 'ServiceAccount' ? 'ServiceAccount' : values.kind === 'Group' ? 'Group' : 'User'
    const name = values.name?.trim() ?? ''
    if (!name) return []
    return (values.roles ?? []).map((role) => ({
      apiVersion: `${RBAC_GROUP}/v1`,
      kind: 'ClusterRoleBinding',
      metadata: { name: bindingName(role) },
      roleRef: { apiGroup: RBAC_GROUP, kind: 'ClusterRole', name: role },
      subjects: [
        {
          kind: subjectKind,
          name,
          apiGroup: subjectKind === 'ServiceAccount' ? '' : RBAC_GROUP,
          ...(subjectKind === 'ServiceAccount' ? { namespace: values.namespace || namespace } : {}),
        },
      ],
    }))
  }

  const submit = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    const bindings = buildBindings(values)
    if (!bindings.length) {
      message.error('请至少选择一个集群角色')
      return
    }
    setBusy(true)
    try {
      for (const b of bindings) await resourceApi.applyYaml(cluster, toYaml(b))
      message.success(`已邀请${KIND_LABEL[values.kind === 'ServiceAccount' ? 'ServiceAccount' : values.kind === 'Group' ? 'Group' : 'User']}「${values.name}」，创建 ${bindings.length} 个角色分配`)
      onDone?.()
      onClose()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="邀请成员"
      width={640}
      onCancel={onClose}
      onOk={submit}
      okText="确定"
      okButtonProps={{ loading: busy }}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ kind: 'User', namespace, roles: [] }}
      >
        <Form.Item name="kind" label="成员类型" rules={[{ required: true }]}>
          <Radio.Group
            options={[
              { label: '用户', value: 'User' },
              { label: '组', value: 'Group' },
              { label: '服务帐户', value: 'ServiceAccount' },
            ]}
          />
        </Form.Item>

        {kind === 'ServiceAccount' && (
          <Form.Item name="namespace" label="项目" rules={[{ required: true, message: '必填' }]}>
            <Select
              showSearch
              placeholder="选择服务帐户所在项目"
              options={namespaces.map((n) => ({ label: n.name, value: n.name }))}
            />
          </Form.Item>
        )}

        <Form.Item name="name" label="名称" rules={[{ required: true, message: '必填' }]}>
          <Input placeholder={kind === 'ServiceAccount' ? '服务帐户名称，如 jenkins' : '用户名或组名，如 admin'} />
        </Form.Item>

        <Form.Item name="roles" label="集群角色" rules={[{ required: true, message: '至少选择一个角色' }]}>
          <Select
            mode="multiple"
            allowClear
            showSearch
            loading={roleLoading}
            placeholder="选择要授予的集群角色"
            options={roleOptions.map((r) => ({ label: r, value: r }))}
          />
        </Form.Item>
      </Form>

      <YamlPreview value={buildBindings(watched ?? {}).map((b) => ({ ...b, metadata: { ...b.metadata, name: '<自动生成>' } }))} />
    </Modal>
  )
}

/** 编辑角色：以勾选方式保留 / 移除该成员的绑定（取消勾选即删除对应 ClusterRoleBinding） */
function AssignmentsModal({
  member,
  cluster,
  onClose,
  onDone,
}: {
  member: MemberRow
  cluster: string
  onClose: () => void
  onDone: () => void
}) {
  const { message } = App.useApp()
  const [kept, setKept] = useState<string[]>(member.bindings.map((b) => b.binding))
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const removed = member.bindings.filter((b) => !kept.includes(b.binding))
    if (!removed.length) {
      onClose()
      return
    }
    setBusy(true)
    try {
      for (const b of removed) await resourceApi.remove(cluster, CLUSTER_ROLE_BINDING, b.binding)
      message.success(`已移除 ${removed.length} 个角色分配`)
      onDone()
      onClose()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={`编辑角色 —— ${member.name}`}
      width={560}
      onCancel={onClose}
      onOk={submit}
      okText="确定"
      okButtonProps={{ loading: busy }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        保留需要的角色分配，取消勾选即移除该成员对应的绑定（删除 ClusterRoleBinding）。
      </Typography.Text>
      <Checkbox.Group
        className="mt-3 flex flex-col gap-2"
        value={kept}
        onChange={(v) => setKept(v as string[])}
      >
        {member.bindings.map((b) => (
          <Checkbox key={b.binding} value={b.binding}>
            <Space size={6}>
              <SafetyCertificateOutlined className="text-[var(--ks-muted)]" />
              <span>{b.role}</span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                （{b.binding}）
              </Typography.Text>
            </Space>
          </Checkbox>
        ))}
      </Checkbox.Group>
    </Modal>
  )
}

/** tone token：与节点管理页同款 */
const TONE_COLOR: Record<string, string> = { ok: 'var(--color-ok)', warn: 'var(--color-warn)', danger: 'var(--color-danger)', muted: 'var(--ks-muted)' }

const pctOf = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : '0%')

/** 右侧竖排面板（与节点管理页同款） */
function Panel({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="ks-panel">
      <div className="flex items-center justify-between px-5 pb-2 pt-4" style={{ minHeight: 42 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ks-ink)' }}>{title}</span>
        {extra}
      </div>
      <div className="px-5 pb-5 pt-1">{children}</div>
    </div>
  )
}

function FieldRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[13px]">
      <span style={{ color: 'var(--ks-muted)' }}>{label}</span>
      <span className="max-w-[62%] truncate text-right" style={{ color: 'var(--ks-ink)' }}>{value}</span>
    </div>
  )
}

export default function MembersPage() {
  const cluster = useClusterStore((s) => s.cluster)
  const { message, modal } = App.useApp()
  const [filter, setFilter] = useState('')
  const [kindFilter, setKindFilter] = useState<'User' | 'Group' | 'ServiceAccount'>()
  const [activeKey, setActiveKey] = useState<string>()
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<MemberRow>()

  const { data, error, loading, refresh } = useResource(
    () => (cluster ? resourceApi.list(cluster, CLUSTER_ROLE_BINDING) : Promise.resolve([] as K8sObject[])),
    [cluster],
  )

  const all = useMemo(() => toMembers(toItems(data)), [data])

  const counts = useMemo(() => {
    let user = 0, group = 0, sa = 0
    for (const m of all) {
      if (m.kind === 'User') user += 1
      else if (m.kind === 'Group') group += 1
      else if (m.kind === 'ServiceAccount') sa += 1
    }
    return { user, group, sa }
  }, [all])

  const rows = useMemo(() => {
    let list = all
    if (kindFilter) list = list.filter((m) => m.kind === kindFilter)
    const q = filter.trim().toLowerCase()
    if (q)
      list = list.filter(
        (m) => m.name.toLowerCase().includes(q) || m.roles.some((r) => r.toLowerCase().includes(q)),
      )
    return list
  }, [all, kindFilter, filter])

  const pager = usePager(rows.length)

  const active = useMemo(
    () => all.find((m) => m.key === activeKey) ?? rows[0] ?? all[0],
    [all, rows, activeKey],
  )

  const removeBindings = async (list: BindingRef[], title: string, content: string) => {
    if (!list.length) {
      message.info('该成员没有可删除的角色分配')
      return
    }
    modal.confirm({
      title,
      content,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          for (const b of list) await resourceApi.remove(cluster, CLUSTER_ROLE_BINDING, b.binding)
          message.success(`已移除 ${list.length} 个角色分配`)
          refresh()
        } catch (e) {
          message.error((e as Error).message)
        }
      },
    })
  }

  const memberMenu: MenuProps['items'] = [
    { key: 'roles', label: '编辑角色', icon: <SafetyCertificateOutlined /> },
    { key: 'remove', label: '移除', danger: true, icon: <DeleteOutlined /> },
  ]

  const onMenu = (m: MemberRow): MenuProps['onClick'] => ({ key }) => {
    if (key === 'roles') setEditing(m)
    if (key === 'remove')
      removeBindings(
        m.bindings,
        `移除 ${m.name}？`,
        `将删除该${kindLabel(m).split('(')[0]}相关的 ${m.bindings.length} 个集群角色绑定，其集群权限会立即失效。`,
      )
  }

  return (
    <div className="flex items-start gap-4">
      {/* 左：主区 */}
      <div className="min-w-0 flex-1 space-y-4">
        {error && (
          <div className="rounded-xl bg-red-50 px-5 py-3.5 text-sm text-red-700">
            {error} <Button size="small" onClick={refresh}>重试</Button>
          </div>
        )}

        {/* 页头横幅 */}
        <div
          className="ks-panel relative flex items-center justify-between overflow-hidden px-6 py-5"

        >
          <div className="flex items-center gap-4">
            <span
              className="grid size-14 shrink-0 place-items-center rounded-xl text-2xl text-white"
              style={{ background: "var(--ks-brand-bg)", color: "var(--color-brand)" }}
            >
              <TeamOutlined />
            </span>
            <div>
              <div className="text-xl font-bold" style={{ color: 'var(--ks-ink)' }}>集群成员</div>
              <div className="mt-1 text-[13px]" style={{ color: 'var(--ks-muted)' }}>
                当前集群：{cluster || '未选择'}。成员来自集群角色绑定的 subjects（用户 / 组 / 服务帐户），角色即其被授予的 ClusterRole。
              </div>
            </div>
          </div>
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => setInviting(true)}>
            邀请成员
          </Button>
        </div>

        {/* 统计卡 */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="成员总数" value={all.length} total={all.length} pct="100%" color="var(--color-brand)" bg="var(--ks-brand-bg)" icon={<TeamOutlined />} active={!kindFilter} onClick={() => setKindFilter(undefined)} />
          <StatCard label="用户" value={counts.user} total={all.length} pct={pctOf(counts.user, all.length)} color="var(--ks-ok-text)" bg="var(--ks-ok-bg)" icon={<UserAddOutlined />} active={kindFilter === 'User'} onClick={() => setKindFilter(kindFilter === 'User' ? undefined : 'User')} />
          <StatCard label="组" value={counts.group} total={all.length} pct={pctOf(counts.group, all.length)} color="var(--ks-violet)" bg="var(--ks-violet-bg)" icon={<TeamOutlined />} active={kindFilter === 'Group'} onClick={() => setKindFilter(kindFilter === 'Group' ? undefined : 'Group')} />
          <StatCard label="服务帐户" value={counts.sa} total={all.length} pct={pctOf(counts.sa, all.length)} color="var(--color-warn)" bg="var(--ks-warn-bg)" icon={<SafetyCertificateOutlined />} active={kindFilter === 'ServiceAccount'} onClick={() => setKindFilter(kindFilter === 'ServiceAccount' ? undefined : 'ServiceAccount')} />
        </div>

        {/* 表格卡片 */}
        <div className="ks-panel">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="text-[13px]" style={{ color: 'var(--ks-muted)' }}>类型</span>
            <Select allowClear placeholder="全部" style={{ width: 120 }} value={kindFilter} onChange={setKindFilter} suffixIcon={null} variant="filled"
              options={[{ label: '用户', value: 'User' }, { label: '组', value: 'Group' }, { label: '服务帐户', value: 'ServiceAccount' }]} />
            <span className="ml-auto flex items-center gap-2">
              <Input.Search style={{ width: 220 }} placeholder="搜索名称、角色..." allowClear value={filter} onChange={(e) => { setFilter(e.target.value); pager.setPage(1) }} />
              <Button type="text" icon={<ReloadOutlined />} onClick={refresh} loading={loading} />
            </span>
          </div>
          <Table<MemberRow>
            rowKey="key"
            size="small"
            loading={loading}
            dataSource={rows}
            pagination={pager.config}
            scroll={{ x: 900 }}
            locale={{ emptyText: '暂无集群成员，点击「邀请成员」为用户、组或服务帐户分配集群角色。' }}
            onRow={(m) => ({
              onClick: (e) => {
                if ((e.target as HTMLElement).closest('button,a,input')) return
                setActiveKey(m.key)
              },
              className: 'cursor-pointer',
            })}
            rowClassName={(m) => (m.key === active?.key ? 'ks-row-active' : '')}
            columns={[
              {
                title: '名称',
                width: 200,
                render: (_, m) => (
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md text-base" style={{ background: 'var(--ks-brand-bg)', color: 'var(--color-brand)' }}>
                      <TeamOutlined />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium" style={{ color: 'var(--ks-ink)' }} title={m.name}>{m.name}</div>
                      <div className="truncate text-xs" style={{ color: 'var(--ks-muted)' }}>{kindLabel(m)}</div>
                    </div>
                  </div>
                ),
              },
              {
                title: '类型',
                width: 110,
                render: (_, m) => {
                  const map: Record<string, { color: string; bg: string }> = {
                    User: { color: 'var(--ks-ok-text)', bg: 'var(--ks-ok-bg)' },
                    Group: { color: 'var(--ks-violet)', bg: 'var(--ks-violet-bg)' },
                    ServiceAccount: { color: 'var(--color-warn)', bg: 'var(--ks-warn-bg)' },
                  }
                  const s = map[m.kind] ?? { color: 'var(--ks-body)', bg: 'var(--ks-fill)' }
                  return (
                    <span className="inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs" style={{ background: s.bg, color: s.color }}>
                      {KIND_LABEL[m.kind] ?? m.kind}
                    </span>
                  )
                },
              },
              { title: '状态', width: 90, render: () => <ActiveDot /> },
              {
                title: '角色',
                render: (_, m) =>
                  m.roles.length ? (
                    <Typography.Text className="kbd-mono !text-xs" title={m.roles.join(', ')}>{m.roles.join(', ')}</Typography.Text>
                  ) : (
                    <Typography.Text type="secondary">-</Typography.Text>
                  ),
              },
              { title: '加入时间', width: 170, render: (_, m) => datetime(m.createdAt) },
              {
                title: '操作',
                width: 132,
                render: (_, m) => (
                  <div className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <Button size="small" type="link" style={{ paddingLeft: 0 }} onClick={() => setEditing(m)}>
                      编辑角色
                    </Button>
                    <Dropdown menu={{ items: memberMenu, onClick: onMenu(m) }} trigger={['click']}>
                      <Button size="small" type="text" icon={<MoreOutlined />} />
                    </Dropdown>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>

      {/* 右：选中成员详情 */}
      <div className="hidden w-[300px] shrink-0 space-y-4 xl:block">
        {active ? (
          <>
            <div className="ks-panel">
              <div className="flex items-center gap-3 px-5 pb-2 pt-4" style={{ minHeight: 46 }}>
                <span className="grid size-9 place-items-center rounded-lg text-base text-white" style={{ background: "var(--ks-brand-bg)", color: "var(--color-brand)" }}>
                  <TeamOutlined />
                </span>
                <span className="min-w-0 flex-1 truncate text-base font-bold" style={{ color: 'var(--ks-ink)' }} title={active.name}>{active.name}</span>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs" style={{ background: 'var(--ks-ok-bg)', color: 'var(--ks-ok-text)' }}>
                  <span className="size-[6px] rounded-full" style={{ background: TONE_COLOR.ok }} />
                  活跃
                </span>
              </div>
              <div className="px-4 py-2">
                <FieldRow label="类型" value={kindLabel(active)} />
                <FieldRow label="角色分配" value={`${active.bindings.length} 个绑定`} />
                <FieldRow label="加入时间" value={datetime(active.createdAt)} />
              </div>
            </div>

            <Panel title="角色分配" extra={<a style={{ fontSize: 12 }} onClick={() => setEditing(active)}>编辑角色 <RightOutlined style={{ fontSize: 10 }} /></a>}>
              {active.roles.length ? (
                <div className="space-y-2">
                  {active.roles.map((r) => {
                    const b = active.bindings.find((x) => x.role === r)
                    return (
                      <div key={r} className="flex items-center gap-2 text-[13px]">
                        <SafetyCertificateOutlined className="shrink-0" style={{ color: 'var(--ks-muted)' }} />
                        <span className="kbd-mono min-w-0 flex-1 truncate" style={{ color: 'var(--ks-ink)' }}>{r}</span>
                        {b && <span className="shrink-0 text-xs" style={{ color: 'var(--ks-muted)' }}>{datetime(b.createdAt)}</span>}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-[13px]" style={{ color: 'var(--ks-muted)' }}>该成员暂无角色。</div>
              )}
            </Panel>
          </>
        ) : (
          <div className="ks-panel px-4 py-6 text-center text-[13px]" style={{ color: 'var(--ks-muted)' }}>
            {all.length ? '点击左侧成员行查看详情。' : '当前集群还没有成员。'}
          </div>
        )}

        <Panel title="使用小贴士">
          <div className="text-[13px] leading-6" style={{ color: 'var(--ks-body)' }}>
            集群成员来自 ClusterRoleBinding 的 subjects，一个成员可持有多个角色。「编辑角色」通过勾选保留 / 移除绑定；移除后其集群权限立即失效。K8s 无登录态数据，状态统一显示为「活跃」。
          </div>
        </Panel>
      </div>

      <InviteMemberModal open={inviting} onClose={() => setInviting(false)} cluster={cluster} onDone={refresh} />

      {editing && (
        <AssignmentsModal member={editing} cluster={cluster} onClose={() => setEditing(undefined)} onDone={refresh} />
      )}
    </div>
  )
}
