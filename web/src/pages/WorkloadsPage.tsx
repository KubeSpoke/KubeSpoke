import {
  BlockOutlined,
  ClockCircleOutlined,
  DeploymentUnitOutlined,
  DownOutlined,
  ReloadOutlined,
  RetweetOutlined,
  RightOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { App, Button, Dropdown, Form, Input, Modal, Select, Table, Tabs, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DeploymentDetailDrawer } from './DeploymentDetailPage'
import { PodDetailDrawer } from './PodDetailPage'
import { ResourceDetailDrawer } from './ResourceDetailPage'
import { deriveStatus, resourceApi, toItems } from '../api/resources'
import type { K8sObject } from '../api/resources'
import ImageVersionSelect from '../components/ImageVersionSelect'
import { resourceDescriptors } from '../config/nav'
import type { ResourceDescriptor } from '../config/nav'
import { useResource } from '../hooks/useResource'
import { useClusterStore } from '../store/useClusterStore'
import { datetime } from '../utils/format'
import { toYaml } from '../utils/yaml'
import CreateDeploymentModal from './workloads/CreateDeploymentModal'

/** 部署走通用 K8s 接口拿全量对象（DTO 缺 spec.replicas / status.conditions） */
const DEPLOYMENTS: ResourceDescriptor = {
  key: 'deployments',
  label: 'Deployment',
  kind: 'Deployment',
  group: 'apps',
  version: 'v1',
  plural: 'deployments',
  scope: 'Namespaced',
  statusKind: 'readyReplicas',
}

const ALIAS_KEY = 'kubesphere.io/alias-name'
const DESC_KEY = 'kubesphere.io/description'
const RESTART_KEY = 'kubespoke.io/restartedAt'

interface KindMeta {
  d: ResourceDescriptor
  /** 设计稿口径：页签/卡片/创建菜单一律用 Kind 英文名 */
  short: string
  icon: React.ReactNode
  color: string
  bg: string
}

const KINDS: KindMeta[] = [
  { d: DEPLOYMENTS, short: 'Deployment', icon: <DeploymentUnitOutlined />, color: '#2f6fed', bg: '#e8f1ff' },
  { d: resourceDescriptors.statefulsets, short: 'StatefulSet', icon: <BlockOutlined />, color: '#27a06a', bg: '#e6f7ef' },
  { d: resourceDescriptors.daemonsets, short: 'DaemonSet', icon: <RetweetOutlined />, color: '#7c5cff', bg: '#f0ebff' },
  { d: resourceDescriptors.jobs, short: 'Job', icon: <ThunderboltOutlined />, color: '#d98a12', bg: '#fff4e0' },
  { d: resourceDescriptors.cronjobs, short: 'CronJob', icon: <ClockCircleOutlined />, color: '#1fa79a', bg: '#e2f7f5' },
]
const KIND_BY_KEY = Object.fromEntries(KINDS.map((k) => [k.d.key, k])) as Record<string, KindMeta>

const TONE_COLOR: Record<string, string> = { ok: '#59c492', warn: '#f5a623', danger: '#d94f4f', muted: '#9aa7b8' }

const num = (v: unknown) => Number(v ?? 0)
const rec = (o: K8sObject, k: 'spec' | 'status') => ((o[k] ?? {}) as Record<string, unknown>)

/** CronJob 无 statusKind：挂起即已停止，其余按正常 */
function rowStatus(d: ResourceDescriptor, o: K8sObject): { text: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } {
  if (d.key === 'cronjobs') {
    return rec(o, 'spec').suspend === true ? { text: '已停止', tone: 'muted' } : { text: '正常', tone: 'ok' }
  }
  return deriveStatus(d, o)
}

function replicaText(d: ResourceDescriptor, o: K8sObject): string {
  const spec = rec(o, 'spec')
  const st = rec(o, 'status')
  switch (d.key) {
    case 'deployments':
    case 'statefulsets':
      return `${num(st.readyReplicas)}/${num(spec.replicas)}`
    case 'daemonsets':
      return `${num(st.numberReady)}/${num(st.desiredNumberScheduled)}`
    case 'jobs':
      return `${num(st.succeeded)}/${num(spec.completions ?? spec.parallelism ?? 1)}`
    default:
      return '-'
  }
}

/** 就绪副本数 / 期望副本数，供统计卡「就绪 x / 共 n」 */
function replicaCount(d: ResourceDescriptor, o: K8sObject): { ready: number; total: number } | null {
  const spec = rec(o, 'spec')
  const st = rec(o, 'status')
  switch (d.key) {
    case 'deployments':
    case 'statefulsets':
      return { ready: num(st.readyReplicas), total: num(spec.replicas) }
    case 'daemonsets':
      return { ready: num(st.numberReady), total: num(st.desiredNumberScheduled) }
    case 'jobs':
      return { ready: num(st.succeeded), total: num(spec.completions ?? spec.parallelism ?? 1) }
    default:
      return null
  }
}

function mainImage(d: ResourceDescriptor, o: K8sObject): string {
  const spec = rec(o, 'spec')
  const tpl =
    d.key === 'cronjobs'
      ? ((spec.jobTemplate as { spec?: { template?: { spec?: { containers?: { image?: string }[] } } } } | undefined)?.spec?.template)
      : (spec.template as { spec?: { containers?: { image?: string }[] } } | undefined)
  return tpl?.spec?.containers?.[0]?.image ?? '-'
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

const YAML_TEMPLATES: Record<string, string> = {
  statefulsets: [
    'apiVersion: apps/v1',
    'kind: StatefulSet',
    'metadata:',
    '  name: my-statefulset',
    '  namespace: default',
    'spec:',
    '  serviceName: my-service',
    '  replicas: 1',
    '  selector:',
    '    matchLabels:',
    '      app: my-statefulset',
    '  template:',
    '    metadata:',
    '      labels:',
    '        app: my-statefulset',
    '    spec:',
    '      containers:',
    '        - name: app',
    '          image: nginx:1.25',
    '',
  ].join('\n'),
  daemonsets: [
    'apiVersion: apps/v1',
    'kind: DaemonSet',
    'metadata:',
    '  name: my-daemonset',
    '  namespace: default',
    'spec:',
    '  selector:',
    '    matchLabels:',
    '      app: my-daemonset',
    '  template:',
    '    metadata:',
    '      labels:',
    '        app: my-daemonset',
    '    spec:',
    '      containers:',
    '        - name: app',
    '          image: nginx:1.25',
    '',
  ].join('\n'),
  jobs: [
    'apiVersion: batch/v1',
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
  ].join('\n'),
  cronjobs: [
    'apiVersion: batch/v1',
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
  ].join('\n'),
}

interface Row {
  key: string
  d: ResourceDescriptor
  o: K8sObject
  ns: string
  name: string
}

interface Overview {
  rows: Row[]
  counts: Record<string, { total: number; ready: number }>
}

export default function WorkloadsPage() {
  const { message, modal } = App.useApp()
  const cluster = useClusterStore((s) => s.cluster)
  const namespace = useClusterStore((s) => s.namespace)

  const { data, error, loading, refresh } = useResource<Overview | null>(
    async () => {
      if (!cluster) return null
      const [deps, sts, ds, jobs, cj] = await Promise.all([
        resourceApi.list(cluster, DEPLOYMENTS).catch(() => [] as K8sObject[]),
        resourceApi.list(cluster, resourceDescriptors.statefulsets).catch(() => [] as K8sObject[]),
        resourceApi.list(cluster, resourceDescriptors.daemonsets).catch(() => [] as K8sObject[]),
        resourceApi.list(cluster, resourceDescriptors.jobs).catch(() => [] as K8sObject[]),
        resourceApi.list(cluster, resourceDescriptors.cronjobs).catch(() => [] as K8sObject[]),
      ])
      const byKind: Record<string, K8sObject[]> = {
        deployments: toItems(deps),
        statefulsets: toItems(sts),
        daemonsets: toItems(ds),
        jobs: toItems(jobs),
        cronjobs: toItems(cj),
      }
      const rows: Row[] = []
      const counts: Overview['counts'] = {}
      for (const k of KINDS) {
        const items = byKind[k.d.key] ?? []
        let ready = 0
        for (const o of items) {
          rows.push({
            key: `${k.d.key}/${o.metadata?.namespace ?? ''}/${o.metadata?.name ?? ''}`,
            d: k.d,
            o,
            ns: o.metadata?.namespace ?? '-',
            name: o.metadata?.name ?? '-',
          })
          const rc = replicaCount(k.d, o)
          if (rc && rc.total > 0 && rc.ready >= rc.total) ready += 1
        }
        counts[k.d.key] = { total: items.length, ready }
      }
      return { rows, counts }
    },
    [cluster],
  )

  const [tab, setTab] = useState('all')
  const [filterNs, setFilterNs] = useState<string>()
  const [filterStatus, setFilterStatus] = useState<string>()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<React.Key[]>([])
  const [createKind, setCreateKind] = useState<string | null>(null)
  const [yamlText, setYamlText] = useState<{ title: string; text: string; obj?: K8sObject; d?: ResourceDescriptor } | null>(null)
  const [infoRow, setInfoRow] = useState<Row | null>(null)
  const [detailRow, setDetailRow] = useState<Row | null>(null)
  const [detailPod, setDetailPod] = useState<{ ns: string; name: string } | null>(null)
  const [detailRes, setDetailRes] = useState<{ d: ResourceDescriptor; ns: string; name: string } | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm<{ alias: string; description: string }>()

  const nsOptions = useMemo(() => {
    const set = new Set((data?.rows ?? []).map((r) => r.ns))
    return [...set].sort().map((n) => ({ label: n, value: n }))
  }, [data])

  const rows = useMemo(() => {
    let rs = data?.rows ?? []
    if (tab !== 'all') rs = rs.filter((r) => r.d.key === tab)
    if (filterNs) rs = rs.filter((r) => r.ns === filterNs)
    if (filterStatus) rs = rs.filter((r) => rowStatus(r.d, r.o).text === filterStatus)
    const q = search.trim().toLowerCase()
    if (q) rs = rs.filter((r) => r.name.toLowerCase().includes(q))
    return rs
  }, [data, tab, filterNs, filterStatus, search])

  /* 详情统一走右侧抽屉：?detail=<key>/<ns>/<name> 可直达 */
  const openDetail = (r: Row) => {
    setDetailRow(r)
    const next = new URLSearchParams(searchParams)
    next.set('detail', `${r.d.key}/${r.d.scope === 'Cluster' ? '-' : r.ns}/${r.name}`)
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
    const obj = (data?.rows ?? []).find((r) => r.d.key === key && r.name === name)
    setDetailRow(
      obj ?? {
        key: `${key}/${ns}/${name}`,
        d,
        ns: ns === '-' ? '' : ns,
        name,
        o: {} as K8sObject,
      },
    )
  }, [searchParams, setSearchParams, data])

  const apply = async (obj: K8sObject) => {
    await resourceApi.applyYaml(cluster, toYaml(obj))
  }

  const removeRow = async (r: Row) => {
    await resourceApi.remove(cluster, r.d, r.name, r.ns)
  }

  const confirmDelete = (r: Row) => {
    modal.confirm({
      title: `删除 ${r.name}？`,
      content: `删除${KIND_BY_KEY[r.d.key].d.label}会同时回收其容器组，此操作不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeRow(r)
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
      title: `批量删除 ${targets.length} 项工作负载？`,
      content: '删除会同时回收其容器组，此操作不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        const failed: string[] = []
        for (const r of targets) {
          try {
            await removeRow(r)
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
      await apply(obj)
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
      setYamlText({ title: `编辑 YAML · ${r.name}`, text: toYaml(obj), obj, d: r.d })
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  /** 重新创建 = 读改写：给 Pod 模板打 restartedAt 注解（等价 rollout restart，仅模板类资源） */
  const recreate = async (r: Row) => {
    setBusy(true)
    try {
      const obj = await resourceApi.read(cluster, r.d, r.name, r.ns)
      const spec = (obj.spec ?? {}) as Record<string, unknown>
      const holder: Record<string, unknown> = r.d.key === 'cronjobs' ? ((spec.jobTemplate as { spec?: Record<string, unknown> })?.spec ?? spec) : spec
      const template = ((holder.template ?? {}) as Record<string, unknown>)
      const meta = ((template.metadata ?? {}) as Record<string, unknown>)
      meta.annotations = { ...((meta.annotations ?? {}) as Record<string, string>), [RESTART_KEY]: new Date().toISOString() }
      template.metadata = meta
      holder.template = template
      if (r.d.key === 'cronjobs') spec.jobTemplate = { spec: holder }
      obj.spec = spec
      await apply(obj)
      message.success('已触发重新创建')
      refresh()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
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

  const createItems = KINDS.map((k) => ({ key: k.d.key, label: `创建 ${k.short}` }))

  return (
    <div className="space-y-4">
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
            <DeploymentUnitOutlined />
          </span>
          <div>
            <div className="text-xl font-bold" style={{ color: '#15233a' }}>工作负载</div>
            <div className="mt-1 text-[13px]" style={{ color: '#6b7a92' }}>
              管理集群中的各类工作负载，包括 Deployment、StatefulSet、DaemonSet、Job 等。
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

      <Tabs
        activeKey={tab}
        onChange={(k) => { setTab(k); setSelected([]) }}
        items={[{ key: 'all', label: '全部' }, ...KINDS.map((k) => ({ key: k.d.key, label: k.short }))]}
      />

      {/* 统计卡 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {KINDS.map((k) => {
          const c = data?.counts[k.d.key] ?? { total: 0, ready: 0 }
          return (
            <div
              key={k.d.key}
              className="flex cursor-pointer items-center justify-between rounded-lg bg-white px-4 py-3 transition-shadow hover:shadow-md"
              style={{ border: `1px solid ${tab === k.d.key ? k.color : '#e6ebf1'}` }}
              onClick={() => { setTab(k.d.key); setSelected([]) }}
            >
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-lg text-lg" style={{ background: k.bg, color: k.color }}>
                  {k.icon}
                </span>
                <div>
                  <div className="text-xs" style={{ color: '#8f9aa9' }}>{k.short}</div>
                  <div className="text-xl font-bold leading-6" style={{ color: '#15233a' }}>
                    {c.total}
                    <span className="ml-1 text-xs font-normal" style={{ color: '#8f9aa9' }}>就绪 {c.ready}</span>
                  </div>
                </div>
              </div>
              <RightOutlined style={{ color: '#c9d2de', fontSize: 12 }} />
            </div>
          )
        })}
      </div>

      {/* 表格卡片 */}
      <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Dropdown menu={{ items: createItems, onClick: ({ key }) => setCreateKind(String(key)) }}>
            <Button type="primary" style={{ background: 'linear-gradient(90deg, #3f8cff, #1f5fe0)', borderColor: '#1f5fe0' }}>
              创建工作负载 <DownOutlined />
            </Button>
          </Dropdown>
          <Dropdown
            disabled={!selected.length}
            menu={{
              items: [{ key: 'delete', label: `批量删除（${selected.length}）`, danger: true, onClick: batchDelete }],
            }}
          >
            <Button disabled={!selected.length}>
              批量操作 <DownOutlined />
            </Button>
          </Dropdown>
          <Select
            allowClear
            placeholder="全部命名空间"
            style={{ width: 160 }}
            value={filterNs}
            onChange={setFilterNs}
            options={nsOptions}
          />
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 120 }}
            value={filterStatus}
            onChange={setFilterStatus}
            options={['运行中', '更新中', '等待中', '已完成', '失败', '已停止', '正常'].map((t) => ({ label: t, value: t }))}
          />
          <Input.Search
            className="ml-auto"
            style={{ width: 220 }}
            placeholder="搜索工作负载名称..."
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading} />
        </div>
        <Table<Row>
          rowKey="key"
          size="middle"
          loading={loading || busy}
          dataSource={rows}
          scroll={{ x: 1080 }}
          rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
          pagination={{
            defaultPageSize: 10,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (t) => `共 ${t} 条`,
          }}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              sorter: (a, b) => a.name.localeCompare(b.name),
              render: (_, r) => {
                const k = KIND_BY_KEY[r.d.key]
                return (
                  <div className="flex items-center gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full text-sm" style={{ background: k.bg, color: k.color }}>
                      {k.icon}
                    </span>
                    <div className="min-w-0">
                      <a className="truncate font-medium" style={{ color: '#15233a' }} onClick={() => openDetail(r)}>
                        {r.name}
                      </a>
                      <div className="truncate text-xs" style={{ color: '#8f9aa9' }}>{annotation(r.o, ALIAS_KEY) || '-'}</div>
                    </div>
                  </div>
                )
              },
            },
            {
              title: '类型',
              width: 120,
              filters: KINDS.map((k) => ({ text: k.short, value: k.d.key })),
              onFilter: (v, r) => r.d.key === v,
              render: (_, r) => {
                const k = KIND_BY_KEY[r.d.key]
                return (
                  <span className="inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs" style={{ background: k.bg, color: k.color }}>
                    {r.d.kind}
                  </span>
                )
              },
            },
            { title: '命名空间', dataIndex: 'ns', width: 130 },
            {
              title: '镜像',
              ellipsis: true,
              render: (_, r) => {
                const img = mainImage(r.d, r.o)
                // 只有 Deployment 能就地换镜像；其余类型的镜像属于各自 spec，走编辑 YAML
                return r.d.key === 'deployments' ? (
                  <ImageVersionSelect cluster={cluster} namespace={r.ns} name={r.name} image={img} onChanged={refresh} />
                ) : (
                  <span className="kbd-mono text-xs">{img}</span>
                )
              },
            },
            {
              title: '副本数',
              width: 90,
              render: (_, r) => replicaText(r.d, r.o),
            },
            {
              title: '状态',
              width: 110,
              render: (_, r) => {
                const s = rowStatus(r.d, r.o)
                return (
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <span className="size-[7px] shrink-0 rounded-full" style={{ background: TONE_COLOR[s.tone] }} />
                    <span style={{ color: '#15233a' }}>{s.text}</span>
                  </span>
                )
              },
            },
            {
              title: '创建时间',
              width: 160,
              sorter: (a, b) => (a.o.metadata?.creationTimestamp ?? '').localeCompare(b.o.metadata?.creationTimestamp ?? ''),
              render: (_, r) => <span className="text-xs" style={{ color: '#5b6a80' }}>{datetime(r.o.metadata?.creationTimestamp)}</span>,
            },
            {
              title: '操作',
              width: 120,
              render: (_, r) => (
                <span className="whitespace-nowrap">
                  <Button size="small" type="link" style={{ paddingLeft: 0 }} onClick={() => openDetail(r)}>
                    查看
                  </Button>
                  <Dropdown
                    menu={{
                      items: [
                        { key: 'info', label: '编辑信息', onClick: () => openInfo(r) },
                        { key: 'yaml', label: '编辑 YAML', onClick: () => void openYaml(r) },
                        ...(r.d.key === 'cronjobs' ? [] : [{ key: 'recreate', label: '重新创建', onClick: () => void recreate(r) }]),
                        { key: 'delete', label: '删除', danger: true, onClick: () => confirmDelete(r) },
                      ],
                    }}
                    trigger={['click']}
                  >
                    <Button size="small" type="link">
                      更多 <DownOutlined />
                    </Button>
                  </Dropdown>
                </span>
              ),
            },
          ]}
        />
      </div>

      {/* 创建：Deployment 走结构化表单，其余走 YAML 模板 */}
      {createKind === 'deployments' && (
        <CreateDeploymentModal open onClose={() => setCreateKind(null)} cluster={cluster} namespace={namespace} onCreated={refresh} />
      )}
      {createKind && createKind !== 'deployments' && (
        <Modal
          open
          width={680}
          title={`创建 ${KIND_BY_KEY[createKind].d.kind}（YAML）`}
          onCancel={() => setCreateKind(null)}
          onOk={() => { setYamlText({ title: `创建 ${KIND_BY_KEY[createKind].d.kind}`, text: YAML_TEMPLATES[createKind] }); setCreateKind(null) }}
          okText="编辑并创建"
        >
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            将打开预填的 YAML 模板，按需修改名称、命名空间与镜像后创建。
          </Typography.Text>
        </Modal>
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
            <Input placeholder="为工作负载设置别名（可选）" maxLength={63} />
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
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {yamlText?.obj ? '保存将按 YAML 替换集群中的该资源。' : '确认字段后提交创建。'}
        </Typography.Text>
        <Input.TextArea
          className="kbd-mono mt-2"
          value={yamlText?.text ?? ''}
          onChange={(e) => setYamlText((v) => (v ? { ...v, text: e.target.value } : v))}
          autoSize={{ minRows: 16, maxRows: 26 }}
          style={{ fontSize: 12 }}
        />
      </Modal>

      {detailRow?.d.key === 'deployments' && (
        <DeploymentDetailDrawer
          cluster={cluster}
          namespace={detailRow.ns}
          name={detailRow.name}
          onClose={closeDetail}
          onOpenPod={(ns, name) => setDetailPod({ ns, name })}
          onDeleted={closeDetail}
          onChanged={refresh}
        />
      )}

      {detailRow?.d.key === 'pods' && (
        <PodDetailDrawer
          cluster={cluster}
          namespace={detailRow.ns}
          name={detailRow.name}
          onClose={closeDetail}
          onDeleted={closeDetail}
        />
      )}

      {detailRow && detailRow.d.key !== 'deployments' && detailRow.d.key !== 'pods' && (
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
