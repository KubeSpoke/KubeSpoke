import {
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  MinusCircleOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Dropdown,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import type { MenuProps } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { resourceApi, toItems } from '../../api/resources'
import type { K8sObject } from '../../api/resources'
import KsCreateModal from '../../components/KsCreateModal'
import { YamlPreview } from '../../components/YamlPreview'
import { useResource } from '../../hooks/useResource'
import { useClusterStore } from '../../store/useClusterStore'
import { datetime } from '../../utils/format'
import { toYaml } from '../../utils/yaml'
import type { ResourceDescriptor } from '../../config/nav'
import { InviteMemberModal } from './MembersPage'

/** inline 描述符：本页面只用通用 K8s 接口读写 RBAC 对象 */
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

const API_VERSION = 'rbac.authorization.k8s.io/v1'
const DESC_KEY = 'kubesphere.io/description'
const ALIAS_KEY = 'kubesphere.io/alias-name'

interface PolicyRule {
  apiGroups?: string[]
  resources?: string[]
  verbs?: string[]
  nonResourceURLs?: string[]
}

const nameOf = (o?: K8sObject) => o?.metadata?.name ?? ''
const descOf = (o?: K8sObject) => o?.metadata?.annotations?.[DESC_KEY] ?? ''
const aliasOf = (o?: K8sObject) => o?.metadata?.labels?.[ALIAS_KEY] ?? ''
const rulesOf = (o?: K8sObject) => (o?.rules as PolicyRule[] | undefined) ?? []

/** 服务端按 resourceVersion 决定替换还是创建，改写必须保留它；managedFields/status 无意义，去掉减少噪声 */
function forApply(obj: K8sObject): K8sObject {
  const { status: _status, ...rest } = obj
  const metadata = { ...(obj.metadata ?? {}) }
  delete metadata.managedFields
  return { apiVersion: API_VERSION, kind: 'ClusterRole', ...rest, metadata }
}

const GROUP_OPTIONS = [
  { label: 'rbac.authorization.k8s.io', value: 'rbac.authorization.k8s.io' },
  { label: 'apps', value: 'apps' },
  { label: 'batch', value: 'batch' },
  { label: 'networking.k8s.io', value: 'networking.k8s.io' },
  { label: 'storage.k8s.io', value: 'storage.k8s.io' },
  { label: 'policy', value: 'policy' },
  { label: 'apiextensions.k8s.io', value: 'apiextensions.k8s.io' },
  { label: '* （所有组）', value: '*' },
]

const RESOURCE_OPTIONS = [
  'pods',
  'deployments',
  'services',
  'configmaps',
  'secrets',
  'namespaces',
  'nodes',
  'clusterroles',
  'clusterrolebindings',
  '*',
].map((v) => ({ label: v, value: v }))

const VERB_OPTIONS = ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete', 'deletecollection', 'escalate', 'bind'].map(
  (v) => ({ label: v, value: v }),
)

/** 分页文案对齐 KubeSphere：总数：N ｜ 每页显示：10 */
function usePager(all: number) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const current = Math.min(page, Math.max(1, Math.ceil(all / pageSize)))
  return {
    setPage,
    config: {
      current,
      pageSize,
      showSizeChanger: false,
      onChange: (p: number, ps?: number) => {
        setPage(p)
        if (ps && ps !== pageSize) setPageSize(ps)
      },
      showTotal: (total: number) => (
        <Space size={16} className="text-xs text-[#5c6b80]">
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
    },
  }
}

function KvTable({ title, data }: { title: string; data: Record<string, string> }) {
  const rows = Object.entries(data).map(([k, v]) => ({ k, v }))
  return (
    <>
      <Typography.Text strong className="mb-2 block">
        {title}
      </Typography.Text>
      <Table<{ k: string; v: string }>
        rowKey="k"
        size="small"
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: '无' }}
        columns={[
          { title: '键', width: 260, render: (_, r) => <span className="kbd-mono text-xs">{r.k}</span> },
          { title: '值', render: (_, r) => <span className="kbd-mono text-xs">{r.v || '-'}</span> },
        ]}
      />
    </>
  )
}

function RuleTags({ values }: { values: string[] }) {
  if (!values.length) return <Typography.Text type="secondary">-</Typography.Text>
  return (
    <Flex wrap gap={4}>
      {values.map((v, i) => (
        <Tag key={`${i}-${v}`} variant="filled" className="!m-0">
          {v}
        </Tag>
      ))}
    </Flex>
  )
}

/** 基本信息：描述 + 规则表格（API 组 / 资源 / 操作） */
function BasicInfo({ role }: { role: K8sObject }) {
  const rules = rulesOf(role)
  return (
    <div>
      <Descriptions column={1} size="small" className="mb-4" items={[
        { key: 'name', label: '名称', children: nameOf(role) },
        { key: 'alias', label: '别名', children: aliasOf(role) || '-' },
        { key: 'desc', label: '描述', children: descOf(role) || '-' },
        { key: 'created', label: '创建时间', children: datetime(role.metadata?.creationTimestamp) },
      ]} />

      <Typography.Text strong className="mb-2 block">
        规则
      </Typography.Text>
      <Table<PolicyRule>
        size="small"
        pagination={false}
        dataSource={rules}
        rowKey={(_, i) => String(i)}
        locale={{ emptyText: '该角色没有规则' }}
        columns={[
          {
            title: 'API 组',
            width: 220,
            render: (_, r) => <RuleTags values={(r.apiGroups ?? []).map((g) => (g === '' ? '核心组' : g))} />,
          },
          {
            title: '资源',
            render: (_, r) => (
              <div>
                <RuleTags values={r.resources ?? []} />
                {r.nonResourceURLs?.length ? (
                  <Typography.Text type="secondary" className="kbd-mono block text-xs">
                    非资源地址：{r.nonResourceURLs.join(', ')}
                  </Typography.Text>
                ) : null}
              </div>
            ),
          },
          {
            title: '操作',
            width: 240,
            render: (_, r) => (r.verbs ?? []).join(', ') || '-',
          },
        ]}
      />
    </div>
  )
}

/** 编辑信息：别名（label）+ 描述（annotation），读改写后用 YAML 下发 */
function EditInfoModal({
  role,
  cluster,
  onClose,
  onDone,
}: {
  role: K8sObject
  cluster: string
  onClose: () => void
  onDone: () => void
}) {
  const { message } = App.useApp()
  const [form] = Form.useForm<{ alias?: string; description?: string }>()
  const [busy, setBusy] = useState(false)
  const name = nameOf(role)

  const submit = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setBusy(true)
    try {
      const obj = await resourceApi.read(cluster, CLUSTER_ROLE, name)
      const metadata = { ...(obj.metadata ?? {}) } as NonNullable<K8sObject['metadata']>
      const labels = { ...(metadata.labels ?? {}) }
      const annotations = { ...(metadata.annotations ?? {}) }
      const alias = values.alias?.trim()
      const description = values.description?.trim()
      if (alias) labels[ALIAS_KEY] = alias
      else delete labels[ALIAS_KEY]
      if (description) annotations[DESC_KEY] = description
      else delete annotations[DESC_KEY]
      if (Object.keys(labels).length) metadata.labels = labels
      else delete metadata.labels
      if (Object.keys(annotations).length) metadata.annotations = annotations
      else delete metadata.annotations
      await resourceApi.applyYaml(cluster, toYaml({ ...forApply(obj), metadata }))
      message.success(`已更新角色 ${name}`)
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
      title={`编辑信息 —— ${name}`}
      width={520}
      onCancel={onClose}
      onOk={submit}
      okText="确定"
      okButtonProps={{ loading: busy }}
    >
      <Form form={form} layout="vertical" initialValues={{ alias: aliasOf(role), description: descOf(role) }}>
        <Form.Item label="名称">
          <Input disabled value={name} />
        </Form.Item>
        <Form.Item name="alias" label="别名" rules={[{ max: 63, message: '不超过 63 个字符' }]}>
          <Input placeholder="展示用的友好名称（可选）" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="为该角色添加描述（可选）" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

/** 编辑 YAML：读取线上对象，改完原样提交 */
function EditYamlModal({
  role,
  cluster,
  onClose,
  onDone,
}: {
  role: K8sObject
  cluster: string
  onClose: () => void
  onDone: () => void
}) {
  const { message } = App.useApp()
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const name = nameOf(role)
  const { data, loading, error } = useResource(
    () => (cluster && name ? resourceApi.read(cluster, CLUSTER_ROLE, name) : Promise.resolve({} as K8sObject)),
    [cluster, name],
  )

  // 未编辑时直接由线上对象派生 YAML，省掉 effect 里的 setState
  const text = draft ?? (data && Object.keys(data).length ? toYaml(forApply(data)) : '')

  const submit = async () => {
    setBusy(true)
    try {
      await resourceApi.applyYaml(cluster, text)
      message.success(`已保存角色 ${name}`)
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
      title={`编辑 YAML —— ${name}`}
      width={720}
      onCancel={onClose}
      onOk={submit}
      okText="确定"
      okButtonProps={{ loading: busy, disabled: loading || !!error }}
    >
      {error && (
        <Typography.Text type="danger" className="mb-2 block">
          {error}
        </Typography.Text>
      )}
      <Input.TextArea
        className="kbd-mono"
        spellCheck={false}
        value={text}
        placeholder={loading ? '读取中…' : ''}
        onChange={(e) => setDraft(e.target.value)}
        autoSize={{ minRows: 14, maxRows: 24 }}
        style={{ fontSize: 12 }}
      />
    </Modal>
  )
}

interface RuleFormRow {
  apiGroups?: string[]
  resources?: string[]
  verbs?: string[]
}

interface RoleFormValues {
  name?: string
  Description?: string
  rules?: RuleFormRow[]
}

/** 创建角色：规则行编辑器 → 生成 ClusterRole YAML 下发 */
function CreateRoleModal({
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
  const [form] = Form.useForm<RoleFormValues>()
  const [busy, setBusy] = useState(false)
  const watched = Form.useWatch([], form) as RoleFormValues | undefined

  useEffect(() => {
    if (open) form.resetFields()
  }, [open, form])

  const build = (values: RoleFormValues): K8sObject => {
    const description = values.Description?.trim()
    const rules = (values.rules ?? [])
      .filter((r) => (r?.resources?.length ?? 0) > 0 && (r?.verbs?.length ?? 0) > 0)
      .map<PolicyRule>((r) => ({
        apiGroups: r.apiGroups?.length ? r.apiGroups : [''],
        resources: r.resources ?? [],
        verbs: r.verbs ?? [],
      }))
    return {
      apiVersion: API_VERSION,
      kind: 'ClusterRole',
      metadata: {
        name: values.name?.trim() ?? '',
        ...(description ? { annotations: { [DESC_KEY]: description } } : {}),
      },
      rules,
    }
  }

  const submit = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    const payload = build(values)
    if (((payload.rules as PolicyRule[] | undefined)?.length ?? 0) === 0) {
      message.error('请至少配置一条包含资源与操作的规则')
      return
    }
    setBusy(true)
    try {
      await resourceApi.applyYaml(cluster, toYaml(payload))
      message.success(`角色 ${values.name} 已创建`)
      onCreated()
      onClose()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <KsCreateModal
      open={open}
      title="创建角色"
      width={820}
      showYamlToggle={false}
      onCancel={onClose}
      onOk={submit}
      okText="创建"
      okButtonProps={{ loading: busy }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ name: '', Description: '', rules: [{ apiGroups: [], resources: [], verbs: [] }] }}
      >
        <Form.Item
          name="name"
          label="名称"
          rules={[
            { required: true, message: '必填' },
            { pattern: /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/, message: '仅允许小写字母、数字、点和短横线' },
          ]}
        >
          <Input placeholder="log-reader" />
        </Form.Item>

        <Form.Item name="Description" label="描述">
          <Input.TextArea rows={2} placeholder="为该角色添加描述（可选）" />
        </Form.Item>

        <Typography.Text type="secondary" className="mb-2 block">
          规则（API 组留空表示核心组，资源与操作必填）
        </Typography.Text>
        <Form.List name="rules">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name: fieldName, ...restField }) => (
                <div key={key} className="mb-2 rounded border border-[#ebeef2] px-3 pt-2">
                  <Flex gap={8} wrap align="flex-start">
                    <Form.Item {...restField} name={[fieldName, 'apiGroups']} label="API 组" className="!mb-2 min-w-[200px] flex-1">
                      <Select mode="tags" allowClear placeholder="选择或输入，留空 = 核心组" options={GROUP_OPTIONS} />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[fieldName, 'resources']}
                      label="资源名称"
                      className="!mb-2 min-w-[200px] flex-1"
                      rules={[{ required: true, message: '必填' }]}
                    >
                      <Select mode="tags" allowClear placeholder="pods、services…" options={RESOURCE_OPTIONS} />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[fieldName, 'verbs']}
                      label="操作"
                      className="!mb-2 min-w-[200px] flex-1"
                      rules={[{ required: true, message: '必填' }]}
                    >
                      <Select mode="multiple" allowClear placeholder="get、list…" options={VERB_OPTIONS} />
                    </Form.Item>
                    <Button
                      className="mt-6"
                      size="small"
                      type="text"
                      danger
                      icon={<MinusCircleOutlined />}
                      onClick={() => remove(fieldName)}
                      disabled={fields.length <= 1}
                    />
                  </Flex>
                </div>
              ))}
              <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ apiGroups: [], resources: [], verbs: [] })}>
                添加规则
              </Button>
            </>
          )}
        </Form.List>
      </Form>

      <YamlPreview value={build(watched ?? {})} />
    </KsCreateModal>
  )
}

/** tone token：ok/warn/danger/muted 与节点管理页同款 */
const TONE_COLOR: Record<string, string> = { ok: '#59c492', warn: '#f5a623', danger: '#d94f4f', muted: '#9aa7b8' }

/**
 * 内置角色启发式（仅用现有 metadata，不新增接口）：K8s 默认 RBAC 角色通常带 system: 前缀
 * 或 kubernetes.io/bootstrapping 标注；其余视为在此控制台创建的自定义角色。
 */
const isBuiltIn = (o: K8sObject) =>
  nameOf(o).startsWith('system:') || 'kubernetes.io/bootstrapping' in (o.metadata?.annotations ?? {})

const pctOf = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : '0%')

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

export default function ClusterRolesPage() {
  const cluster = useClusterStore((s) => s.cluster)
  const { message, modal } = App.useApp()
  const [filter, setFilter] = useState('')
  const [stat, setStat] = useState<'builtin' | 'custom' | 'empty'>()
  const [activeName, setActiveName] = useState<string>()
  const [detail, setDetail] = useState<K8sObject>()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<K8sObject>()
  const [yamlTarget, setYamlTarget] = useState<K8sObject>()
  const [inviteRole, setInviteRole] = useState<string>()

  const { data, error, loading, refresh } = useResource(
    () => (cluster ? resourceApi.list(cluster, CLUSTER_ROLE) : Promise.resolve([] as K8sObject[])),
    [cluster],
  )

  const all = useMemo(
    () => toItems(data).slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [data],
  )

  const counts = useMemo(() => {
    let builtin = 0, custom = 0, empty = 0
    for (const o of all) {
      if (isBuiltIn(o)) builtin += 1
      else custom += 1
      if (rulesOf(o).length === 0) empty += 1
    }
    return { builtin, custom, empty }
  }, [all])

  const rows = useMemo(() => {
    let list = all
    if (stat === 'builtin') list = list.filter(isBuiltIn)
    else if (stat === 'custom') list = list.filter((o) => !isBuiltIn(o))
    else if (stat === 'empty') list = list.filter((o) => rulesOf(o).length === 0)
    const q = filter.trim().toLowerCase()
    if (q) list = list.filter((o) => nameOf(o).toLowerCase().includes(q) || descOf(o).toLowerCase().includes(q))
    return list
  }, [all, stat, filter])

  const pager = usePager(rows.length)

  const active = useMemo(
    () => all.find((o) => nameOf(o) === activeName) ?? rows[0] ?? all[0],
    [all, rows, activeName],
  )

  const remove = (o: K8sObject) => {
    const name = nameOf(o)
    modal.confirm({
      title: `删除角色 ${name}？`,
      content: '删除后，依赖该角色的集群成员会立即失去对应权限。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await resourceApi.remove(cluster, CLUSTER_ROLE, name)
          message.success(`已删除角色 ${name}`)
          refresh()
        } catch (e) {
          message.error((e as Error).message)
        }
      },
    })
  }

  const menuOf = (o: K8sObject): MenuProps => ({
    items: [
      { key: 'info', label: '编辑信息', icon: <EditOutlined /> },
      { key: 'yaml', label: '编辑 YAML', icon: <FileTextOutlined /> },
      { key: 'assign', label: '创建资源分配', icon: <PlusOutlined /> },
      { type: 'divider' },
      { key: 'delete', label: '删除', danger: true, icon: <DeleteOutlined /> },
    ],
    onClick: ({ key }) => {
      if (key === 'info') setEditing(o)
      if (key === 'yaml') setYamlTarget(o)
      if (key === 'assign') setInviteRole(nameOf(o))
      if (key === 'delete') remove(o)
    },
  })

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
              <SafetyCertificateOutlined />
            </span>
            <div>
              <div className="text-xl font-bold" style={{ color: '#15233a' }}>集群角色</div>
              <div className="mt-1 text-[13px]" style={{ color: '#6b7a92' }}>
                当前集群：{cluster || '未选择'}。角色按 API 组 / 资源 / 操作授予权限，作用范围覆盖整个集群。
              </div>
            </div>
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            创建角色
          </Button>
        </div>

        {/* 统计卡 */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="角色总数" value={all.length} total={all.length} pct="100%" color="#2f6fed" bg="#e8f1ff" icon={<SafetyCertificateOutlined />} active={!stat} onClick={() => setStat(undefined)} />
          <StatCard label="内置角色" value={counts.builtin} total={all.length} pct={pctOf(counts.builtin, all.length)} color="#27a06a" bg="#e6f7ef" icon={<SafetyCertificateOutlined />} active={stat === 'builtin'} onClick={() => setStat(stat === 'builtin' ? undefined : 'builtin')} />
          <StatCard label="自定义角色" value={counts.custom} total={all.length} pct={pctOf(counts.custom, all.length)} color="#7c5cff" bg="#f0ebff" icon={<EditOutlined />} active={stat === 'custom'} onClick={() => setStat(stat === 'custom' ? undefined : 'custom')} />
          <StatCard label="空规则" value={counts.empty} total={all.length} pct={pctOf(counts.empty, all.length)} color="#f5a623" bg="#fff4e5" icon={<ExclamationCircleOutlined />} active={stat === 'empty'} onClick={() => setStat(stat === 'empty' ? undefined : 'empty')} />
        </div>

        {/* 表格卡片 */}
        <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="text-[13px]" style={{ color: '#8f9aa9' }}>类型</span>
            <Select allowClear placeholder="全部" style={{ width: 120 }} value={stat} onChange={setStat} suffixIcon={null} variant="filled"
              options={[{ label: '内置角色', value: 'builtin' }, { label: '自定义角色', value: 'custom' }, { label: '空规则', value: 'empty' }]} />
            <span className="ml-auto flex items-center gap-2">
              <Input.Search style={{ width: 220 }} placeholder="搜索角色名称、描述..." allowClear value={filter} onChange={(e) => { setFilter(e.target.value); pager.setPage(1) }} />
              <Button type="text" icon={<ReloadOutlined />} onClick={refresh} loading={loading} />
            </span>
          </div>
          <Table<K8sObject>
            rowKey={(o) => o.metadata?.uid ?? nameOf(o)}
            size="small"
            loading={loading}
            dataSource={rows}
            pagination={pager.config}
            scroll={{ x: 760 }}
            locale={{ emptyText: '暂无集群角色，点击「创建角色」新增自定义角色。' }}
            onRow={(o) => ({
              onClick: (e) => {
                if ((e.target as HTMLElement).closest('button,a,input')) return
                setActiveName(nameOf(o))
              },
              className: 'cursor-pointer',
            })}
            rowClassName={(o) => (nameOf(o) === active?.metadata?.name ? 'ks-row-active' : '')}
            columns={[
              {
                title: '名称',
                render: (_, o) => {
                  const builtin = isBuiltIn(o)
                  return (
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-md text-base" style={{ background: builtin ? '#e6f7ef' : '#e8f1ff', color: builtin ? '#27a06a' : '#2f6fed' }}>
                        <SafetyCertificateOutlined />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium" style={{ color: '#15233a' }} title={nameOf(o)}>{nameOf(o)}</div>
                        <div className="truncate text-xs" style={{ color: '#8f9aa9' }}>{descOf(o) || aliasOf(o) || (builtin ? 'Kubernetes 默认角色' : '在此控制台创建')}</div>
                      </div>
                      <span className="inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]" style={{ background: builtin ? '#e6f7ef' : '#eef1f5', color: builtin ? '#27a06a' : '#5b6a80' }}>
                        {builtin ? '内置' : '自定义'}
                      </span>
                    </div>
                  )
                },
              },
              {
                title: '规则',
                width: 72,
                sorter: (a, b) => rulesOf(a).length - rulesOf(b).length,
                render: (_, o) => {
                  const n = rulesOf(o).length
                  return <span style={{ color: n ? '#15233a' : '#b3bdcc' }}>{n}</span>
                },
              },
              { title: '创建时间', width: 170, render: (_, o) => datetime(o.metadata?.creationTimestamp) },
              {
                title: '操作',
                width: 104,
                render: (_, o) => (
                  <div className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <Button size="small" type="link" style={{ paddingLeft: 0 }} onClick={() => setDetail(o)}>
                      详情
                    </Button>
                    <Dropdown menu={menuOf(o)} trigger={['click']}>
                      <Button size="small" type="text" icon={<MoreOutlined />} />
                    </Dropdown>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>

      {/* 右：选中角色详情 */}
      <div className="hidden w-[300px] shrink-0 space-y-4 xl:block">
        {active ? (
          <>
            <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
              <div className="flex items-center gap-3 px-4" style={{ height: 58, borderBottom: '1px solid #eef1f5' }}>
                <span className="grid size-9 place-items-center rounded-lg text-base text-white" style={{ background: 'linear-gradient(135deg, #5ea0ff, #1668dc)' }}>
                  <SafetyCertificateOutlined />
                </span>
                <span className="min-w-0 flex-1 truncate text-base font-bold" style={{ color: '#15233a' }} title={nameOf(active)}>{nameOf(active)}</span>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs" style={isBuiltIn(active) ? { background: '#e6f7ef', color: '#27a06a' } : { background: '#e8f1ff', color: '#2f6fed' }}>
                  <span className="size-[6px] rounded-full" style={{ background: isBuiltIn(active) ? TONE_COLOR.ok : '#2f6fed' }} />
                  {isBuiltIn(active) ? '内置' : '自定义'}
                </span>
              </div>
              <div className="px-4 py-2">
                <FieldRow label="别名" value={aliasOf(active) || '-'} />
                <FieldRow label="描述" value={descOf(active) || '-'} />
                <FieldRow label="规则数量" value={`${rulesOf(active).length} 条`} />
                <FieldRow label="创建时间" value={datetime(active.metadata?.creationTimestamp)} />
              </div>
            </div>

            <Panel title="规则摘要" extra={<a style={{ fontSize: 12 }} onClick={() => setDetail(active)}>完整详情 <RightOutlined style={{ fontSize: 10 }} /></a>}>
              {rulesOf(active).length ? (
                <div className="space-y-2.5">
                  {rulesOf(active).slice(0, 4).map((r, i) => (
                    <div key={i} className="text-[12px] leading-5" style={{ color: '#5b6a80' }}>
                      <div className="truncate font-medium" style={{ color: '#15233a' }}>
                        {(r.resources ?? []).join(', ') || (r.nonResourceURLs ?? []).join(', ') || '-'}
                      </div>
                      <div className="truncate">
                        组：{(r.apiGroups ?? []).map((g) => (g === '' ? '核心组' : g)).join(', ') || '-'} · 操作：{(r.verbs ?? []).join(', ') || '-'}
                      </div>
                    </div>
                  ))}
                  {rulesOf(active).length > 4 && (
                    <div className="text-xs" style={{ color: '#8f9aa9' }}>共 {rulesOf(active).length} 条规则，点「完整详情」查看全部。</div>
                  )}
                </div>
              ) : (
                <div className="text-[13px]" style={{ color: '#8f9aa9' }}>该角色没有显式规则（可能为聚合角色）。</div>
              )}
            </Panel>
          </>
        ) : (
          <div className="rounded-lg bg-white px-4 py-6 text-center text-[13px]" style={{ border: '1px solid #e6ebf1', color: '#8f9aa9' }}>
            {all.length ? '点击左侧角色行查看详情。' : '当前集群没有可读取的集群角色。'}
          </div>
        )}

        <Panel title="使用小贴士">
          <div className="text-[13px] leading-6" style={{ color: '#5b6a80' }}>
            内置角色通常带 <span className="kbd-mono">system:</span> 前缀或 bootstrapping 标注，用于 Kubernetes 默认授权；在此页面创建的记为自定义角色。「空规则」角色不授予任何权限，请确认是否为聚合角色。
          </div>
        </Panel>
      </div>

      <Drawer open={!!detail} size="large" title="角色详情" onClose={() => setDetail(undefined)}>
        {detail && (
          <Tabs
            size="small"
            className="ks-tabs"
            items={[
              { key: 'basic', label: '基本信息', children: <BasicInfo role={detail} /> },
              {
                key: 'meta',
                label: '元数据',
                children: (
                  <Flex vertical gap={20}>
                    <KvTable title="标签" data={detail.metadata?.labels ?? {}} />
                    <KvTable title="注释" data={detail.metadata?.annotations ?? {}} />
                  </Flex>
                ),
              },
            ]}
          />
        )}
      </Drawer>

      <CreateRoleModal open={creating} cluster={cluster} onClose={() => setCreating(false)} onCreated={refresh} />

      {editing && (
        <EditInfoModal role={editing} cluster={cluster} onClose={() => setEditing(undefined)} onDone={refresh} />
      )}
      {yamlTarget && (
        <EditYamlModal
          role={yamlTarget}
          cluster={cluster}
          onClose={() => setYamlTarget(undefined)}
          onDone={refresh}
        />
      )}

      <InviteMemberModal
        open={!!inviteRole}
        cluster={cluster}
        presetRole={inviteRole}
        onClose={() => setInviteRole(undefined)}
        onDone={() => {
          setDetail(undefined)
        }}
      />
    </div>
  )
}
