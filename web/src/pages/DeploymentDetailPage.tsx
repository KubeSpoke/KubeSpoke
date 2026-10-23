import { App, Alert, Button, Drawer, Dropdown, Empty, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd'
import type { TablePaginationConfig } from 'antd'
import { ContainerOutlined, DownOutlined, MinusOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { NameCell } from '../components/PageShell'
import { DetailDrawer } from '../components/DetailDrawer'
import EventsPanel from '../components/EventsPanel'
import PodLogStream from '../components/PodLogStream'
import { PodTerminal } from '../components/PodTerminal'
import { confirmApply } from '../components/ApplyGuard'
import { clusterApi } from '../api/cluster'
import { resourceApi, toItems } from '../api/resources'
import type { K8sObject } from '../api/resources'
import { useResource } from '../hooks/useResource'
import { useClusterStore } from '../store/useClusterStore'
import { datetime } from '../utils/format'
import { toYaml } from '../utils/yaml'
import { resourceDescriptors, clusterPath } from '../config/nav'
import type { ResourceDescriptor } from '../config/nav'
import type { V1Pod } from '../types/k8s'

const DEPLOYMENTS: ResourceDescriptor = {
  key: 'deployments',
  label: '部署',
  kind: 'Deployment',
  group: 'apps',
  version: 'v1',
  plural: 'deployments',
  scope: 'Namespaced',
  statusKind: 'readyReplicas',
}

const REPLICASETS: ResourceDescriptor = {
  key: 'replicasets',
  label: '副本集',
  kind: 'ReplicaSet',
  group: 'apps',
  version: 'v1',
  plural: 'replicasets',
  scope: 'Namespaced',
}

const ALIAS_KEY = 'kubesphere.io/alias-name'
const DESC_KEY = 'kubesphere.io/description'
const CREATOR_KEY = 'kubesphere.io/creator'
const RESTART_KEY = 'kubespoke.io/restartedAt'
/** k8s 自己维护的修订号：每次模板变更 +1，回退历史就靠它认版本 */
const REVISION_KEY = 'deployment.kubernetes.io/revision'

const TONE_COLOR: Record<string, string> = { ok: '#59c492', warn: '#f5a623', danger: '#d94f4f', muted: '#9aa7b8' }

function StatusText({ text, tone, extra }: { text: string; tone: 'ok' | 'warn' | 'danger' | 'muted'; extra?: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="size-[7px] shrink-0 rounded-full" style={{ background: TONE_COLOR[tone] }} />
      <span style={{ fontWeight: 500, color: '#15233a' }}>{text}</span>
      {extra && <span className="text-[#8f9aa9]">{extra}</span>}
    </span>
  )
}

const PHASE_CN: Record<string, { text: string; tone: 'ok' | 'warn' | 'danger' | 'muted' }> = {
  Running: { text: '运行中', tone: 'ok' },
  Pending: { text: '等待中', tone: 'warn' },
  Succeeded: { text: '成功', tone: 'ok' },
  Failed: { text: '失败', tone: 'danger' },
  Unknown: { text: '未知', tone: 'muted' },
}

/** status.conditions[].lastUpdateTime 最大值，缺省回落 creationTimestamp（与列表口径一致） */
function updateTime(o: K8sObject | undefined): string {
  const conditions = ((o?.status as { conditions?: { lastUpdateTime?: string }[] } | undefined)?.conditions) ?? []
  let max = ''
  for (const c of conditions) {
    const t = c?.lastUpdateTime
    if (t && t > max) max = t
  }
  return max || o?.metadata?.creationTimestamp || ''
}

function annotation(o: K8sObject | undefined, key: string): string {
  return (o?.metadata?.annotations ?? {})[key] ?? ''
}

function writeAnnotation(o: K8sObject, key: string, value: string) {
  const meta = (o.metadata ?? {}) as NonNullable<K8sObject['metadata']>
  const ann = { ...meta.annotations } as Record<string, string>
  if (value) ann[key] = value
  else delete ann[key]
  meta.annotations = ann
  o.metadata = meta
}

type Container = {
  name?: string
  image?: string
  ports?: { name?: string; containerPort?: number; protocol?: string }[]
  env?: { name?: string; value?: string; valueFrom?: Record<string, { name?: string; key?: string; fieldPath?: string }> }[]
  envFrom?: { configMapRef?: { name?: string }; secretRef?: { name?: string } }[]
}

type DepSpec = {
  replicas?: number
  selector?: { matchLabels?: Record<string, string> }
  template?: { metadata?: Record<string, unknown>; spec?: { containers?: Container[] } & Record<string, unknown> }
}

type HpaSpec = {
  scaleTargetRef?: { kind?: string; name?: string }
  minReplicas?: number
  maxReplicas?: number
}

type DepStatus = {
  replicas?: number
  readyReplicas?: number
  updatedReplicas?: number
  conditions?: { type?: string; lastUpdateTime?: string }[]
}

type EnvVar = NonNullable<Container['env']>[number]

function envValueText(e: EnvVar): string {
  if (e.value !== undefined) return e.value
  const vf = e.valueFrom ?? {}
  if (vf.configMapKeyRef) return `ConfigMap: ${vf.configMapKeyRef.name}/${vf.configMapKeyRef.key}`
  if (vf.secretKeyRef) return `Secret: ${vf.secretKeyRef.name}/${vf.secretKeyRef.key}`
  if (vf.fieldRef) return `Field: ${vf.fieldRef.fieldPath}`
  return '-'
}

/** 读改写补丁：把 restartedAt 注解打到 Pod 模板上（等价 rollout restart），在传入的 live 上返回新对象 */
function withRestartAnnotation(obj: K8sObject): K8sObject {
  const spec = { ...(obj.spec as Record<string, unknown> | undefined) }
  const template = { ...((spec.template as Record<string, unknown> | undefined) ?? {}) }
  const meta = { ...((template.metadata as Record<string, unknown> | undefined) ?? {}) }
  meta.annotations = { ...((meta.annotations as Record<string, string> | undefined) ?? {}), [RESTART_KEY]: new Date().toISOString() }
  template.metadata = meta
  spec.template = template
  return { ...obj, spec }
}

function MetaBlock({ title, data }: { title: string; data?: Record<string, string> }) {
  const rows = Object.entries(data ?? {}).map(([k, v]) => ({ k, v }))
  return (
    <div className="mb-6">
      <Typography.Text strong>{title}</Typography.Text>
      <Table
        size="small"
        className="mt-2"
        rowKey="k"
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: '无' }}
        columns={[
          { title: '名称', dataIndex: 'k', render: (v: string) => <Tag>{v}</Tag> },
          { title: '值', dataIndex: 'v', render: (v: string) => <span className="kbd-mono text-xs">{v}</span> },
        ]}
      />
    </div>
  )
}

/** 应用详情整页正文：列表页右侧抽屉与直达链接共用（写操作就地完成） */
export function DeploymentDetailBody({
  cluster,
  namespace,
  name,
  onOpenPod,
  onDeleted,
  onChanged,
}: {
  cluster: string
  namespace?: string
  name?: string
  onOpenPod?: (namespace: string, podName: string) => void
  onDeleted?: () => void
  onChanged?: () => void
}) {
  const { message, modal } = App.useApp()
  const ns = namespace ?? 'default'
  const depName = name ?? ''

  const deploy = useResource(
    () => (cluster && depName ? resourceApi.read(cluster, DEPLOYMENTS, depName, ns) : Promise.resolve({} as K8sObject)),
    [cluster, ns, depName],
  )
  const rsRes = useResource(
    () =>
      cluster
        ? clusterApi.replicaSets(cluster, ns).then((r) => (r ?? []) as unknown as K8sObject[])
        : Promise.resolve([] as K8sObject[]),
    [cluster, ns],
  )
  const podsRes = useResource(
    // 用通用接口取完整 Pod（GetPods 是裁剪过的 DTO，没有 containerStatuses）
    () =>
      cluster
        ? resourceApi.list(cluster, resourceDescriptors.pods, ns).then((r) => toItems(r) as unknown as V1Pod[])
        : Promise.resolve([] as V1Pod[]),
    [cluster, ns],
  )
  const hpaRes = useResource(
    () =>
      cluster
        ? resourceApi.list(cluster, resourceDescriptors.horizontalpodautoscalers, ns).then((r) => toItems(r))
        : Promise.resolve([] as K8sObject[]),
    [cluster, ns],
  )

  const [busy, setBusy] = useState(false)
  const [pageSize, setPageSize] = useState(10)
  const [logPod, setLogPod] = useState<string | null>(null)
  const [termPod, setTermPod] = useState<V1Pod | null>(null)
  const [termContainer, setTermContainer] = useState('')
  const [infoOpen, setInfoOpen] = useState(false)
  const [alias, setAlias] = useState('')
  const [desc, setDesc] = useState('')
  const [yamlModal, setYamlModal] = useState<{ title: string; text: string; editable: boolean } | null>(null)
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [rollbackSel, setRollbackSel] = useState<string>('')
  const [scaleOpen, setScaleOpen] = useState(false)
  const [settings, setSettings] = useState<{ replicas: number; containers: { name: string; image: string }[] } | null>(null)
  /** 期望副本数的草稿值，null 表示未编辑；换集群/项目/应用时丢弃 */
  const [repDraft, setRepDraft] = useState<number | null>(null)
  useEffect(() => setRepDraft(null), [cluster, ns, depName])

  const containers = useMemo(() => ((deploy.data?.spec as DepSpec | undefined)?.template?.spec?.containers ?? []), [deploy.data])
  const matchLabels = useMemo(() => ((deploy.data?.spec as DepSpec | undefined)?.selector?.matchLabels ?? {}), [deploy.data])
  const spec = (deploy.data?.spec ?? {}) as DepSpec
  const status = (deploy.data?.status ?? {}) as DepStatus
  const desired = Number(spec.replicas ?? 0)
  const targetReplicas = repDraft ?? desired
  const replicasDirty = targetReplicas !== desired
  const ready = Number(status.readyReplicas ?? 0)
  const current = Number(status.replicas ?? 0)
  const readyTone: 'ok' | 'warn' | 'danger' | 'muted' =
    desired === 0 ? 'muted' : ready >= desired ? 'ok' : ready === 0 ? 'danger' : 'warn'
  const labels = deploy.data?.metadata?.labels ?? {}
  const appLabel = labels['app.kubernetes.io/name'] || labels['app'] || '-'
  const creator = annotation(deploy.data, CREATOR_KEY) || '-'
  const currentRevision = annotation(deploy.data, REVISION_KEY)

  const rsRows = useMemo(() => {
    const list = (rsRes.data ?? []).filter((o) => {
      const owners = (o.metadata?.ownerReferences ?? o.ownerReferences) as { kind?: string; name?: string }[] | undefined
      return owners?.some((r) => r.kind === 'Deployment' && r.name === depName)
    })
    return list.sort((a, b) => (b.metadata?.creationTimestamp ?? '').localeCompare(a.metadata?.creationTimestamp ?? ''))
  }, [rsRes.data, depName])

  const podRows = useMemo(() => {
    const entries = Object.entries(matchLabels)
    if (!entries.length) return [] as V1Pod[]
    return (podsRes.data ?? []).filter((p) => entries.every(([k, v]) => p.metadata?.labels?.[k] === v))
  }, [podsRes.data, matchLabels])

  /** scaleTargetRef 指向本部署的 HPA：存在时副本数由它决定，手调会被打回 */
  const hpa = useMemo(
    () =>
      (hpaRes.data ?? []).find((o) => {
        const ref = (o.spec as HpaSpec | undefined)?.scaleTargetRef
        return ref?.kind === 'Deployment' && ref?.name === depName
      }),
    [hpaRes.data, depName],
  )
  const hpaSpec = (hpa?.spec ?? {}) as HpaSpec
  const hpaRange = hpaSpec.minReplicas && hpaSpec.maxReplicas ? ` ${hpaSpec.minReplicas}-${hpaSpec.maxReplicas}` : ''

  const refreshAll = () => {
    deploy.refresh()
    rsRes.refresh()
    podsRes.refresh()
    hpaRes.refresh()
  }

  if (!cluster) return <Empty description="请先选择在线集群" className="py-24" />

  const readDeploy = () => resourceApi.read(cluster, DEPLOYMENTS, depName, ns)

  const submitInfo = async () => {
    setBusy(true)
    try {
      const yaml = await confirmApply({
        modal: modal,
        cluster,
        descriptor: DEPLOYMENTS,
        name: depName,
        namespace: ns,
        seeded: deploy.data,
        title: `保存 ${depName} 的信息？`,
        okText: '保存',
        build: (live) => {
          writeAnnotation(live, ALIAS_KEY, alias.trim())
          writeAnnotation(live, DESC_KEY, desc.trim())
          return live
        },
      })
      if (yaml === null) {
        message.info('没有变化')
        return
      }
      await resourceApi.applyYaml(cluster, yaml)
      message.success('已保存')
      setInfoOpen(false)
      refreshAll()
      onChanged?.()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitYaml = async () => {
    if (!yamlModal?.editable) return
    setBusy(true)
    try {
      await resourceApi.applyYaml(cluster, yamlModal.text)
      message.success('已保存')
      setYamlModal(null)
      refreshAll()
      onChanged?.()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const openInfo = () => {
    setAlias(annotation(deploy.data, ALIAS_KEY))
    setDesc(annotation(deploy.data, DESC_KEY))
    setInfoOpen(true)
  }

  const openYaml = async () => {
    setBusy(true)
    try {
      setYamlModal({ title: '编辑 YAML', text: toYaml(await readDeploy()), editable: true })
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const viewRsYaml = async (rsName: string) => {
    setBusy(true)
    try {
      const obj = await resourceApi.read(cluster, REPLICASETS, rsName, ns)
      setYamlModal({ title: `YAML · ${rsName}`, text: toYaml(obj), editable: false })
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const recreate = async () => {
    setBusy(true)
    try {
      const yaml = await confirmApply({
        modal: modal,
        cluster,
        descriptor: DEPLOYMENTS,
        name: depName,
        namespace: ns,
        seeded: deploy.data,
        title: `重新创建 ${depName}？`,
        intro: '会给 Pod 模板打一个重启注解，触发滚动更新。',
        okText: '重建',
        build: withRestartAnnotation,
      })
      if (yaml === null) {
        message.info('没有变化')
        return
      }
      await resourceApi.applyYaml(cluster, yaml)
      message.success('已触发重新创建')
      refreshAll()
      onChanged?.()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** 回退：把历史 ReplicaSet 的 spec.template 写回部署（经由 confirmApply 重新读取线上部署后打补丁） */
  const rollbackTo = async (rsName: string) => {
    setBusy(true)
    try {
      const rs = await resourceApi.read(cluster, REPLICASETS, rsName, ns)
      const yaml = await confirmApply({
        modal: modal,
        cluster,
        descriptor: DEPLOYMENTS,
        name: depName,
        namespace: ns,
        seeded: deploy.data,
        title: `回退到 ${rsName}？`,
        intro: '会把该版本的 Pod 模板写回部署，触发滚动更新。',
        okText: '回退',
        build: (live) => {
          const depSpec = { ...(live.spec as Record<string, unknown> | undefined) }
          depSpec.template = (rs.spec as { template?: unknown } | undefined)?.template
          live.spec = depSpec
          return live
        },
      })
      if (yaml === null) {
        message.info('没有变化')
        return
      }
      await resourceApi.applyYaml(cluster, yaml)
      message.success(`已回退到 ${rsName}`)
      setRollbackOpen(false)
      refreshAll()
      onChanged?.()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** 就地扩缩容：只改 spec.replicas，经 confirmApply 在线上最新对象上打补丁 */
  const submitReplicas = async () => {
    if (!replicasDirty) return
    setBusy(true)
    try {
      const yaml = await confirmApply({
        modal: modal,
        cluster,
        descriptor: DEPLOYMENTS,
        name: depName,
        namespace: ns,
        seeded: deploy.data,
        okText: '调整',
        build: (live) => {
          live.spec = { ...(live.spec as DepSpec | undefined), replicas: targetReplicas }
          return live
        },
      })
      if (yaml === null) {
        message.info('没有变化')
        return
      }
      await resourceApi.applyYaml(cluster, yaml)
      message.success(`副本数已调整为 ${targetReplicas}`)
      setRepDraft(null)
      setScaleOpen(false)
      refreshAll()
      onChanged?.()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const openSettings = () => {
    setSettings({
      replicas: desired,
      containers: containers.map((c) => ({ name: c.name ?? '', image: c.image ?? '' })),
    })
  }

  const submitSettings = async () => {
    if (!settings) return
    const snapshot = settings
    setBusy(true)
    try {
      const yaml = await confirmApply({
        modal: modal,
        cluster,
        descriptor: DEPLOYMENTS,
        name: depName,
        namespace: ns,
        seeded: deploy.data,
        build: (live) => {
          const depSpec = { ...(live.spec as DepSpec | undefined) }
          depSpec.replicas = snapshot.replicas
          const template = { ...(depSpec.template ?? {}) }
          const tSpec = { ...(template.spec ?? {}) }
          const orig = (tSpec.containers ?? []) as Container[]
          tSpec.containers = snapshot.containers.map((c, i) => ({ ...(orig[i] ?? {}), name: c.name, image: c.image }))
          template.spec = tSpec
          depSpec.template = template
          live.spec = depSpec
          return live
        },
      })
      if (yaml === null) {
        message.info('没有变化')
        return
      }
      await resourceApi.applyYaml(cluster, yaml)
      message.success('已保存')
      setSettings(null)
      refreshAll()
      onChanged?.()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = () => {
    modal.confirm({
      title: `删除 ${depName}？`,
      content: '删除部署会同时回收其容器组；删除前会先把对象存进回收站，七天内可以还原。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const { saved } = await resourceApi.remove(cluster, DEPLOYMENTS, depName, ns)
          message.success(saved ? '已删除，可在回收站还原' : '已删除')
          onDeleted?.()
        } catch (e) {
          message.error((e as Error).message)
        }
      },
    })
  }

  const headerMenu = {
    items: [
      { key: 'info', label: '编辑信息', onClick: openInfo },
      { key: 'rollback', label: '回退', onClick: () => { setRollbackSel(''); setRollbackOpen(true) } },
      { key: 'settings', label: '编辑设置', onClick: openSettings },
      { key: 'yaml', label: '编辑 YAML', onClick: () => void openYaml() },
      { key: 'recreate', label: '重新创建', onClick: () => void recreate() },
      { key: 'delete', label: '删除', danger: true, onClick: confirmDelete },
    ],
  }

  const portRows = containers.flatMap((c) => c.ports ?? [])
  const pagination: TablePaginationConfig = {
    pageSize,
    onShowSizeChange: (_, s) => setPageSize(s),
    showSizeChanger: true,
    pageSizeOptions: [10, 20, 50, 100],
    showTotal: (t) => `每页显示：${pageSize} 总数：${t}`,
  }

  return (
    <>
      {(deploy.error || rsRes.error || podsRes.error) && (
        <Alert
          className="mx-5 mt-4"
          type="error"
          showIcon
          message={
            <Space>
              <Tag color="red" variant="filled">接口错误</Tag>
              {deploy.error || rsRes.error || podsRes.error}
            </Space>
          }
        />
      )}

      <div className="px-5 pb-4 pt-4">
        <div className="mb-3 flex items-center gap-2">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {ns} / {depName}
          </Typography.Text>
          <span className="ml-auto flex items-center gap-2">
            <Button size="small" icon={<ReloadOutlined />} loading={deploy.loading || busy} onClick={refreshAll} />
            <Space size={8}>
              <Tag color="blue" variant="filled" className="!mr-0">
                部署
              </Tag>
              <Dropdown menu={headerMenu} trigger={['click']}>
                <Button size="small">
                  更多操作 <DownOutlined />
                </Button>
              </Dropdown>
            </Space>
          </span>
        </div>

        {/* 属性条：集群 / 项目 / 应用 / 创建时间 / 更新时间 / 创建者 */}
        <div className="mt-1 flex flex-wrap gap-x-14 gap-y-3">
          {[
            { label: '集群', value: cluster },
            { label: '项目', value: ns },
            { label: '应用', value: appLabel },
            { label: '创建时间', value: datetime(deploy.data?.metadata?.creationTimestamp) },
            { label: '更新时间', value: datetime(updateTime(deploy.data) || undefined) },
            { label: '创建者', value: creator },
          ].map((it) => (
            <div key={it.label} className="min-w-0">
              <div className="text-xs text-[#8f9aa9]">{it.label}</div>
              <div className="mt-1 truncate text-sm font-medium" style={{ color: '#15233a' }} title={it.value}>
                {it.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Tabs
        className="ks-tabs px-1"
        items={[
            {
              key: 'resources',
              label: '资源状态',
              children: (
                <div className="p-4">
                  <div className="mb-6 grid grid-cols-3 divide-x divide-[#edf1f6] overflow-hidden rounded-lg border border-[#edf1f6] bg-[#fafbfc]">
                    <div className="px-5 py-4">
                      <div className="flex items-center gap-2 text-xs text-[#8f9aa9]">
                        <span className="size-[7px] shrink-0 rounded-full" style={{ background: TONE_COLOR[readyTone] }} />
                        就绪副本
                      </div>
                      <div className="mt-2 text-2xl font-semibold leading-none" style={{ color: '#15233a' }}>
                        {ready}
                        <span className="ml-1 text-sm font-normal text-[#8f9aa9]">/ {desired}</span>
                      </div>
                    </div>
                    <div className="px-5 py-4">
                      <div className="text-xs text-[#8f9aa9]">当前副本</div>
                      <div className="mt-2 text-2xl font-semibold leading-none" style={{ color: '#15233a' }}>
                        {current}
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-5 py-4">
                      <div>
                        <div className="text-xs text-[#8f9aa9]">期望副本</div>
                        <div className="mt-2 flex items-center gap-2 text-2xl font-semibold leading-none" style={{ color: '#15233a' }}>
                          {desired}
                          {hpa && (
                            <Tooltip
                              title={`由弹性伸缩 ${hpa.metadata?.name ?? ''} 托管，副本数会被自动调整，手动扩缩容不会生效`}
                            >
                              <Tag color="orange" variant="filled" className="!mr-0 text-xs">
                                {`HPA 托管${hpaRange}`}
                              </Tag>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                      <Button
                        size="small"
                        disabled={!cluster || busy}
                        onClick={() => {
                          setRepDraft(null)
                          setScaleOpen(true)
                        }}
                      >
                        扩缩容
                      </Button>
                    </div>
                  </div>

                  <Typography.Text strong>端口</Typography.Text>
                  <Table
                    size="small"
                    className="!mt-2 !mb-6"
                    rowKey={(_, i) => String(i)}
                    pagination={false}
                    dataSource={portRows}
                    locale={{ emptyText: '没有端口' }}
                    columns={[
                      { title: '名称', render: (_, p) => p.name || '-' },
                      { title: '协议', width: 120, render: (_, p) => p.protocol || 'TCP' },
                      { title: '端口', width: 120, render: (_, p) => p.containerPort ?? '-' },
                    ]}
                  />

                  <Typography.Text strong>容器组</Typography.Text>
                  <Table<V1Pod>
                    size="small"
                    className="!mt-2"
                    rowKey={(p) => p.metadata?.uid ?? `${p.metadata?.namespace}/${p.metadata?.name}`}
                    loading={podsRes.loading}
                    dataSource={podRows}
                    scroll={{ x: 900 }}
                    pagination={pagination}
                    columns={[
                      {
                        title: '名称',
                        render: (_, p) => (
                          <a onClick={() => onOpenPod?.(p.metadata?.namespace ?? ns, p.metadata?.name ?? '')}>
                            <NameCell icon={<ContainerOutlined />} title={p.metadata?.name} sub={p.status?.podIP} />
                          </a>
                        ),
                      },
                      {
                        title: '状态',
                        width: 150,
                        render: (_, p) => {
                          const cs = p.status?.containerStatuses ?? []
                          const ph = PHASE_CN[p.status?.phase ?? 'Unknown'] ?? { text: p.status?.phase ?? '未知', tone: 'muted' as const }
                          return <StatusText text={ph.text} tone={ph.tone} extra={`(${cs.filter((c) => c.ready).length}/${cs.length})`} />
                        },
                      },
                      {
                        title: '就绪',
                        width: 90,
                        render: (_, p) => {
                          const cs = p.status?.containerStatuses ?? []
                          return `${cs.filter((c) => c.ready).length}/${cs.length}`
                        },
                      },
                      {
                        title: '重启次数',
                        width: 90,
                        render: (_, p) => (p.status?.containerStatuses ?? []).reduce((a, c) => a + c.restartCount, 0),
                      },
                      { title: '创建时间', width: 170, render: (_, p) => datetime(p.metadata?.creationTimestamp) },
                      {
                        title: '操作',
                        width: 150,
                        render: (_, p) => (
                          <Space>
                            <Button size="small" type="link" onClick={() => setLogPod(p.metadata?.name ?? '')}>
                              查看日志
                            </Button>
                            <Button
                              size="small"
                              type="link"
                              onClick={() => {
                                setTermPod(p)
                                setTermContainer(p.spec?.containers?.[0]?.name ?? '')
                              }}
                            >
                              终端
                            </Button>
                            <Button
                              size="small"
                              type="link"
                              danger
                              onClick={() =>
                                modal.confirm({
                                  title: `删除 Pod ${p.metadata?.name}？`,
                                  okText: '删除',
                                  okButtonProps: { danger: true },
                                  onOk: async () => {
                                    try {
                                      await clusterApi.deletePod(cluster, p.metadata?.namespace ?? ns, p.metadata?.name ?? '')
                                      message.success('已删除')
                                      podsRes.refresh()
                                      onChanged?.()
                                    } catch (e) {
                                      message.error((e as Error).message)
                                    }
                                  },
                                })
                              }
                            >
                              删除
                            </Button>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </div>
              ),
            },
            {
              key: 'revisions',
              label: '修改记录',
              children: (
                <div className="p-4">
                  <Table<K8sObject>
                    size="small"
                    rowKey={(r) => r.metadata?.uid ?? `${r.metadata?.namespace}/${r.metadata?.name}`}
                    loading={rsRes.loading}
                    dataSource={rsRows}
                    scroll={{ x: 900 }}
                    pagination={pagination}
                    locale={{ emptyText: '没有历史版本' }}
                    columns={[
                      {
                        title: '版本',
                        width: 100,
                        render: (_, r) => {
                          const rev = annotation(r, REVISION_KEY)
                          return (
                            <span className="whitespace-nowrap">
                              {rev || '-'}
                              {rev && rev === currentRevision && (
                                <Tag color="blue" variant="filled" style={{ marginLeft: 6 }}>
                                  当前
                                </Tag>
                              )}
                            </span>
                          )
                        },
                      },
                      {
                        title: '名称',
                        render: (_, r) => <span className="kbd-mono text-xs">{r.metadata?.name ?? '-'}</span>,
                      },
                      {
                        title: '状态',
                        width: 150,
                        render: (_, r) => {
                          const d = Number((r.spec as { replicas?: number } | undefined)?.replicas ?? 0)
                          const rd = Number((r.status as { readyReplicas?: number } | undefined)?.readyReplicas ?? 0)
                          return <span>副本 {rd}/{d}</span>
                        },
                      },
                      {
                        title: '镜像',
                        ellipsis: true,
                        render: (_, r) => {
                          const image = (r.spec as DepSpec | undefined)?.template?.spec?.containers?.[0]?.image ?? '-'
                          return (
                            <span className="kbd-mono !text-xs" title={image}>
                              {image}
                            </span>
                          )
                        },
                      },
                      { title: '创建时间', width: 170, render: (_, r) => datetime(r.metadata?.creationTimestamp) },
                      {
                        title: '操作',
                        width: 120,
                        render: (_, r) => {
                          const rsName = r.metadata?.name ?? ''
                          return (
                            <Dropdown
                              trigger={['click']}
                              menu={{
                                items: [
                                  { key: 'yaml', label: '查看 YAML', onClick: () => void viewRsYaml(rsName) },
                                  {
                                    key: 'rollback',
                                    label: '回退到此版本',
                                    onClick: () => void rollbackTo(rsName),
                                  },
                                  {
                                    key: 'delete',
                                    label: '删除',
                                    danger: true,
                                    onClick: () =>
                                      modal.confirm({
                                        title: `删除 ${rsName}？`,
                                        okText: '删除',
                                        okButtonProps: { danger: true },
                                        onOk: async () => {
                                          try {
                                            await resourceApi.remove(cluster, REPLICASETS, rsName, ns)
                                            message.success('已删除')
                                            refreshAll()
                                            onChanged?.()
                                          } catch (e) {
                                            message.error((e as Error).message)
                                          }
                                        },
                                      }),
                                  },
                                ],
                              }}
                            >
                              <Button size="small" type="link">
                                操作 <DownOutlined />
                              </Button>
                            </Dropdown>
                          )
                        },
                      },
                    ]}
                  />
                </div>
              ),
            },
            {
              key: 'metadata',
              label: '元数据',
              children: (
                <div className="p-4">
                  <MetaBlock title="标签" data={deploy.data?.metadata?.labels} />
                  <MetaBlock title="注解" data={deploy.data?.metadata?.annotations} />
                  <div className="mb-6">
                    <Typography.Text strong>所有者引用</Typography.Text>
                    <div className="mt-2 text-sm text-[#5c6b80]">无</div>
                  </div>
                  <div>
                    <Typography.Text strong>创建者</Typography.Text>
                    <div className="mt-2 text-sm" style={{ color: '#15233a' }}>
                      {creator}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              key: 'env',
              label: '环境变量',
              children: (
                <div className="p-4">
                  {containers.length === 0 && <Empty description="没有容器" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                  {containers.map((c, i) => (
                    <div key={c.name ?? i} className="mb-6">
                      <Typography.Text strong>容器：{c.name || `#${i + 1}`}</Typography.Text>
                      <Table
                        size="small"
                        className="mt-2"
                        rowKey={(_, j) => String(j)}
                        pagination={false}
                        dataSource={c.env ?? []}
                        locale={{ emptyText: '没有环境变量' }}
                        columns={[
                          { title: '名称', dataIndex: 'name', width: 220 },
                          {
                            title: '值',
                            render: (_, e) => <span className="kbd-mono text-xs">{envValueText(e)}</span>,
                          },
                        ]}
                      />
                      {(c.envFrom?.length ?? 0) > 0 && (
                        <div className="mt-2">
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            整包引用：
                          </Typography.Text>{' '}
                          {(c.envFrom ?? []).flatMap((f) => [
                            f.configMapRef ? <Tag key={`cm-${f.configMapRef.name}`}>ConfigMap: {f.configMapRef.name}</Tag> : null,
                            f.secretRef ? <Tag key={`sec-${f.secretRef.name}`}>Secret: {f.secretRef.name}</Tag> : null,
                          ])}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ),
            },
            {
              key: 'events',
              label: '事件',
              children: <div className="p-4"><EventsPanel cluster={cluster} kind="Deployment" name={depName} namespace={ns} /></div>,
            },
          ]}
        />

      <Modal
        open={infoOpen}
        title={`编辑信息 · ${depName}`}
        onCancel={() => setInfoOpen(false)}
        onOk={() => void submitInfo()}
        okButtonProps={{ loading: busy }}
        confirmLoading={busy}
      >
        <div className="flex flex-col gap-4">
          <div>
            <Typography.Text type="secondary" className="mb-1 block" style={{ fontSize: 12 }}>
              别名（{ALIAS_KEY}）
            </Typography.Text>
            <Input value={alias} maxLength={63} onChange={(e) => setAlias(e.target.value)} placeholder="为部署设置别名（可选）" />
          </div>
          <div>
            <Typography.Text type="secondary" className="mb-1 block" style={{ fontSize: 12 }}>
              描述（{DESC_KEY}）
            </Typography.Text>
            <Input.TextArea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="为部署添加描述（可选）" />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!yamlModal}
        title={yamlModal?.title}
        width={720}
        onCancel={() => setYamlModal(null)}
        onOk={() => void submitYaml()}
        okButtonProps={{ loading: busy, style: yamlModal?.editable ? undefined : { display: 'none' } }}
        cancelButtonProps={{ style: yamlModal?.editable ? undefined : { display: 'none' }}}
        confirmLoading={busy}
      >
        {yamlModal?.editable ? (
          <Input.TextArea
            className="kbd-mono"
            spellCheck={false}
            value={yamlModal.text}
            onChange={(e) => setYamlModal({ ...yamlModal, text: e.target.value })}
            autoSize={{ minRows: 16, maxRows: 26 }}
            style={{ fontSize: 12 }}
          />
        ) : (
          <pre className="kbd-mono m-0 overflow-auto rounded bg-slate-50 p-3 text-xs" style={{ maxHeight: 520 }}>
            {yamlModal?.text}
          </pre>
        )}
      </Modal>

      <Modal
        open={rollbackOpen}
        title={`回退 · ${depName}`}
        width={720}
        onCancel={() => setRollbackOpen(false)}
        onOk={() => rollbackSel && void rollbackTo(rollbackSel)}
        okButtonProps={{ disabled: !rollbackSel, loading: busy }}
        okText="回退"
      >
        <Table<K8sObject>
          size="small"
          rowKey={(r) => r.metadata?.name ?? ''}
          loading={rsRes.loading}
          dataSource={rsRows}
          pagination={false}
          locale={{ emptyText: '没有历史版本' }}
          rowSelection={{
            type: 'radio',
            selectedRowKeys: rollbackSel ? [rollbackSel] : [],
            onChange: (keys) => setRollbackSel(String(keys[0] ?? '')),
          }}
          columns={[
            { title: '名称', render: (_, r) => <span className="kbd-mono text-xs">{r.metadata?.name ?? '-'}</span> },
            {
              title: '状态',
              width: 130,
              render: (_, r) => {
                const d = Number((r.spec as { replicas?: number } | undefined)?.replicas ?? 0)
                const rd = Number((r.status as { readyReplicas?: number } | undefined)?.readyReplicas ?? 0)
                return <span>副本 {rd}/{d}</span>
              },
            },
            {
              title: '镜像',
              ellipsis: true,
              render: (_, r) => (r.spec as DepSpec | undefined)?.template?.spec?.containers?.[0]?.image ?? '-',
            },
            { title: '创建时间', width: 170, render: (_, r) => datetime(r.metadata?.creationTimestamp) },
          ]}
        />
      </Modal>

      <Modal
        open={!!settings}
        title={`编辑设置 · ${depName}`}
        width={640}
        onCancel={() => setSettings(null)}
        onOk={() => void submitSettings()}
        okButtonProps={{ loading: busy }}
        confirmLoading={busy}
      >
        {settings && (
          <div className="flex flex-col gap-4">
            <div>
              <Typography.Text type="secondary" className="mb-1 block" style={{ fontSize: 12 }}>
                副本数
              </Typography.Text>
              <InputNumber
                min={0}
                value={settings.replicas}
                onChange={(v) => setSettings({ ...settings, replicas: Number(v ?? 0) })}
                className="w-32"
              />
            </div>
            <div>
              <Typography.Text type="secondary" className="mb-1 block" style={{ fontSize: 12 }}>
                容器镜像
              </Typography.Text>
              <div className="flex flex-col gap-2">
                {settings.containers.map((c, i) => (
                  <Space.Compact key={i} className="w-full">
                    <Input
                      style={{ width: 180 }}
                      value={c.name}
                      placeholder="容器名"
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          containers: settings.containers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                        })
                      }
                    />
                    <Input
                      className="kbd-mono"
                      value={c.image}
                      placeholder="image:tag"
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          containers: settings.containers.map((x, j) => (j === i ? { ...x, image: e.target.value } : x)),
                        })
                      }
                    />
                  </Space.Compact>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={scaleOpen}
        title={`扩缩容 · ${depName}`}
        width={420}
        onCancel={() => {
          setScaleOpen(false)
          setRepDraft(null)
        }}
        onOk={() => void submitReplicas()}
        okText="调整"
        okButtonProps={{ disabled: !replicasDirty, loading: busy }}
        confirmLoading={busy}
      >
        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#5c6b80]">当前副本数</span>
            <span className="font-medium" style={{ color: '#15233a' }}>
              {current}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#5c6b80]">期望副本数</span>
            <Space.Compact>
              <Button
                icon={<MinusOutlined />}
                disabled={busy || targetReplicas <= 0}
                onClick={() => setRepDraft(targetReplicas - 1)}
              />
              <InputNumber
                min={0}
                controls={false}
                value={targetReplicas}
                onChange={(v) => setRepDraft(Number(v ?? 0))}
                onPressEnter={() => void submitReplicas()}
                className="!w-[72px] [&_input]:text-center"
              />
              <Button icon={<PlusOutlined />} disabled={busy} onClick={() => setRepDraft(targetReplicas + 1)} />
            </Space.Compact>
          </div>
          {hpa && (
            <Alert
              type="warning"
              showIcon
              message={`由弹性伸缩 ${hpa.metadata?.name ?? ''} 托管，副本数会被自动调整，手动扩缩容不会生效`}
            />
          )}
        </div>
      </Modal>

      <Drawer open={!!logPod} onClose={() => setLogPod(null)} size={760} title={`容器组日志 · ${logPod ?? ''}`} destroyOnHidden>
        <PodLogStream cluster={cluster} namespace={ns} pod={logPod ?? ''} />
      </Drawer>

      <Drawer
        open={!!termPod}
        onClose={() => setTermPod(null)}
        size={860}
        title={`容器组终端 · ${termPod?.metadata?.name ?? ''}`}
        destroyOnHidden
      >
        {termPod && (
          <>
            {(termPod.spec?.containers?.length ?? 0) > 1 && (
              <Space size={8} className="mb-2">
                <Typography.Text type="secondary" className="!text-xs">
                  容器
                </Typography.Text>
                <Select
                  size="small"
                  className="!w-48"
                  value={termContainer}
                  onChange={setTermContainer}
                  options={(termPod.spec?.containers ?? []).map((c) => ({ value: c.name, label: c.name }))}
                />
              </Space>
            )}
            <PodTerminal
              cluster={cluster}
              namespace={termPod.metadata?.namespace ?? ns}
              pod={termPod.metadata?.name ?? ''}
              container={termContainer}
              running={termPod.status?.phase === 'Running'}
            />
          </>
        )}
      </Drawer>
    </>
  )
}

/** 应用详情抽屉：正文自带操作区，抽屉只负责标题与关闭 */
export function DeploymentDetailDrawer({
  cluster,
  namespace,
  name,
  onClose,
  onOpenPod,
  onDeleted,
  onChanged,
}: {
  cluster: string
  namespace?: string
  name?: string
  onClose: () => void
  onOpenPod?: (namespace: string, podName: string) => void
  onDeleted?: () => void
  onChanged?: () => void
}) {
  return (
    <DetailDrawer open={!!name} title={`应用详情 · ${name ?? ''}`} onClose={onClose}>
      {name && (
        <DeploymentDetailBody
          cluster={cluster}
          namespace={namespace}
          name={name}
          onOpenPod={onOpenPod}
          onDeleted={onDeleted}
          onChanged={onChanged}
        />
      )}
    </DetailDrawer>
  )
}

/** 旧整页详情路由的兼容壳：同一路径直接以抽屉呈现 */
export default function DeploymentDetailPage() {
  const { clusterId, namespace, name } = useParams<{ clusterId?: string; namespace?: string; name?: string }>()
  const storeCluster = useClusterStore((s) => s.cluster)
  const navigate = useNavigate()
  const cluster = clusterId ?? storeCluster
  return (
    <DeploymentDetailDrawer
      cluster={cluster}
      namespace={namespace}
      name={name}
      onClose={() => navigate(-1)}
      onOpenPod={(ns, podName) => navigate(clusterPath(cluster, `pods/${ns}/${podName}`))}
      onDeleted={() => navigate(clusterPath(cluster, 'workloads'))}
    />
  )
}
