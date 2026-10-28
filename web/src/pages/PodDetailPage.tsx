import { App, Alert, Button, Card, Descriptions, Dropdown, Empty, Input, Modal, Popconfirm, Space, Table, Tabs, Tag, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { ContainerOutlined, DownOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DetailDrawer } from '../components/DetailDrawer'
import { EventsPanel } from '../components/EventsPanel'
import { PodLogStream } from '../components/PodLogStream'
import { PodTerminal } from '../components/PodTerminal'
import { PodFiles } from '../components/PodFiles'
import { clusterApi, containerLogsUrl } from '../api/cluster'
import { resourceApi } from '../api/resources'
import type { K8sObject } from '../api/resources'
import { useResource } from '../hooks/useResource'
import { useClusterStore } from '../store/useClusterStore'
import { toYaml } from '../utils/yaml'
import { datetime } from '../utils/format'
import { clusterPath } from '../config/nav'
import type { ResourceDescriptor } from '../config/nav'

const PODS: ResourceDescriptor = { key: 'pods', label: '容器组', kind: 'Pod', group: '', version: 'v1', plural: 'pods', scope: 'Namespaced', statusKind: 'phase' }

const labelStyle = { fontSize: 12, color: 'var(--ks-muted)' }
const valueStyle = { fontSize: 13, fontWeight: 500, color: 'var(--ks-ink)' }
const ANNO_CREATOR = 'kubesphere.io/creator'

const STATUS_CN: Record<string, string> = {
  Running: '运行中',
  Pending: '等待中',
  Succeeded: '成功完成',
  Failed: '失败',
  Unknown: '未知',
  Bound: '已绑定',
  Active: '活跃',
}
const STATUS_COLOR: Record<string, string> = {
  Running: 'var(--ks-ok-text)',
  Succeeded: 'var(--ks-ok-text)',
  Bound: 'var(--ks-ok-text)',
  Active: 'var(--ks-ok-text)',
  Ready: 'var(--ks-ok-text)',
  Pending: 'var(--color-warn)',
  ContainerCreating: 'var(--color-warn)',
  Terminating: 'var(--color-warn)',
  Unknown: 'var(--ks-muted)',
  Failed: 'var(--ks-danger-text)',
  CrashLoopBackOff: 'var(--ks-danger-text)',
  Error: 'var(--ks-danger-text)',
  ImagePullBackOff: 'var(--ks-danger-text)',
}

const cnStatus = (v?: string) => (v ? STATUS_CN[v] ?? v : '-')

type Dict = Record<string, unknown>
const dict = (v: unknown): Dict => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : {})
const objArr = (v: unknown): Dict[] => (Array.isArray(v) ? (v as Dict[]) : [])
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const numv = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

function StatusText({ phase }: { phase?: string }) {
  if (!phase) return <span style={valueStyle}>-</span>
  return <span style={{ ...valueStyle, color: STATUS_COLOR[phase] ?? 'var(--ks-body)' }}>{cnStatus(phase)}</span>
}

function Attrs({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap items-start gap-x-10 gap-y-3">
      <span className="mt-0.5 inline-flex items-center rounded bg-[var(--ks-fill)] px-2 py-1 text-xs font-medium text-[var(--ks-body)]">容器组</span>
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <Typography.Text strong className="!text-[13px]">
        {title}
      </Typography.Text>
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

/** 卷来源：把 spec.volumes 的判别字段拼成人话 */
function volumeSource(v: Dict): { type: string; detail: string } {
  const projected = dict(v.projected)
  if (projected.sources) {
    const parts = objArr(projected.sources).map((s) => {
      if (dict(s.serviceAccountToken).audience !== undefined) return 'Projected:服务帐户令牌'
      if (text(dict(s.secret).name)) return `Projected:保密字典 ${dict(s.secret).name}`
      if (text(dict(s.configMap).name)) return `Projected:配置字典 ${dict(s.configMap).name}`
      if (objArr(dict(s.downwardAPI).items).length) return 'Projected:向下 API'
      return 'Projected:未知来源'
    })
    return { type: 'Projected', detail: parts.join('、') || '聚合多种来源' }
  }
  if (text(dict(v.secret).secretName)) return { type: 'Secret', detail: `保密字典 ${dict(v.secret).secretName}` }
  if (text(dict(v.configMap).name)) return { type: 'ConfigMap', detail: `配置字典 ${dict(v.configMap).name}` }
  if (objArr(dict(v.downwardAPI).items).length) {
    const fields = objArr(dict(v.downwardAPI).items).map((i) => text(dict(i.fieldRef).fieldPath)).filter(Boolean)
    return { type: 'DownwardAPI', detail: fields.length ? fields.join('、') : '容器与容器组字段' }
  }
  if (text(dict(v.persistentVolumeClaim).claimName)) return { type: 'PersistentVolumeClaim', detail: `持久卷声明 ${dict(v.persistentVolumeClaim).claimName}` }
  if (text(dict(v.hostPath).path)) return { type: 'HostPath', detail: `宿主机路径 ${dict(v.hostPath).path}` }
  if (dict(v.emptyDir)) return { type: 'EmptyDir', detail: text(dict(v.emptyDir).medium) ? `介质 ${dict(v.emptyDir).medium}` : '临时目录' }
  if (text(dict(v.nfs).server)) return { type: 'NFS', detail: `${dict(v.nfs).server}:${text(dict(v.nfs).path) ?? '/'}` }
  const key = Object.keys(v).find((k) => k !== 'name')
  return { type: key ?? '-', detail: key ? `来源字段 ${key}` : '-' }
}

function envValueOf(e: Dict): string {
  if (e.value !== undefined) return String(e.value ?? '')
  const vf = dict(e.valueFrom)
  if (dict(vf.configMapKeyRef).name) return `配置字典 ${dict(vf.configMapKeyRef).name}/${dict(vf.configMapKeyRef).key ?? '-'}`
  if (dict(vf.secretKeyRef).name) return `保密字典 ${dict(vf.secretKeyRef).name}/${dict(vf.secretKeyRef).key ?? '-'}`
  if (dict(vf.fieldRef).fieldPath) return `字段 ${dict(vf.fieldRef).fieldPath}`
  if (dict(vf.resourceFieldRef).resource) return `资源 ${dict(vf.resourceFieldRef).resource}`
  return '-'
}

function envFromOf(c: Dict): string {
  const refs = objArr(c.envFrom)
  return refs
    .map((r) => {
      const cm = dict(r.configMapRef)
      const sec = dict(r.secretRef)
      if (cm.name) return `配置字典 ${cm.name}`
      if (sec.name) return `保密字典 ${sec.name}`
      return '-'
    })
    .join('、')
}

/** 容器组详情整页正文：各列表页的详情抽屉共用（YAML、删除等写操作就地完成） */
export function PodDetailBody({
  cluster,
  namespace,
  name,
  onDeleted,
}: {
  cluster: string
  namespace?: string
  name?: string
  onDeleted?: () => void
}) {
  const { message } = App.useApp()
  const ns = namespace ?? 'default'
  const pod = name ? decodeURIComponent(name) : ''

  const [yamlOpen, setYamlOpen] = useState(false)
  const [yamlText, setYamlText] = useState('')
  const [viewOpen, setViewOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const { data, error, loading, refresh } = useResource<K8sObject>(
    () => (cluster && pod ? resourceApi.read(cluster, PODS, pod, ns) : Promise.resolve({} as K8sObject)),
    [cluster, ns, pod],
  )

  const nodesRes = useResource(() => (cluster ? clusterApi.nodes(cluster).catch(() => []) : Promise.resolve([])), [cluster])

  const spec = dict(data?.spec)
  const status = dict(data?.status)
  const containers = objArr(spec.containers)
  const initContainers = objArr(spec.initContainers)
  const statuses = objArr(status.containerStatuses)
  const allStatuses = [...statuses, ...objArr(status.initContainerStatuses)]
  const nodeName = text(spec.nodeName)
  const nodeIp = (nodesRes.data ?? []).find((n) => n.metadata?.name === nodeName)?.status?.addresses?.find((a) => a.type === 'InternalIP')?.address
  const restarts = statuses.reduce((acc, c) => acc + (numv(c.restartCount) ?? 0), 0)
  const labels = dict(data?.metadata?.labels)
  const app = text(labels['app.kubernetes.io/name']) ?? text(labels.app) ?? '-'
  const creator = data?.metadata?.annotations?.[ANNO_CREATOR]
  const phase = text(status.phase)

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const saveYaml = run(async () => {
    await resourceApi.applyYaml(cluster, yamlText)
    message.success('已保存')
    setYamlOpen(false)
    refresh()
  })

  const doDelete = run(async () => {
    await resourceApi.remove(cluster, PODS, pod, ns)
    message.success('已删除')
    onDeleted?.()
  })

  const menuItems: MenuProps['items'] = [
    { key: 'viewYaml', label: '查看 YAML' },
    { key: 'editYaml', label: '编辑 YAML' },
    {
      key: 'delete',
      danger: true,
      label: (
        <Popconfirm title={`删除 ${pod}？`} description="删除后不可恢复。" okText="删除" okButtonProps={{ danger: true }} onConfirm={doDelete}>
          <span className="block w-full text-left" onClick={(e) => e.stopPropagation()}>
            删除
          </span>
        </Popconfirm>
      ),
    },
  ]

  const onMenuClick: MenuProps['onClick'] = ({ key: k }) => {
    if (k === 'viewYaml') setViewOpen(true)
    if (k === 'editYaml') {
      setYamlText(toYaml(data ?? {}))
      setYamlOpen(true)
    }
  }

  if (!cluster) return <Empty description="请先选择在线集群" className="py-24" />

  const attrs = [
    { label: '集群', value: cluster },
    { label: '项目', value: ns },
    { label: '应用', value: app },
    { label: '状态', value: <StatusText phase={phase} /> },
    { label: '容器组 IP 地址', value: <span className="kbd-mono">{text(status.podIP) ?? '-'}</span> },
    { label: '节点名称', value: nodeName ?? '-' },
    { label: '节点 IP 地址', value: <span className="kbd-mono">{nodeIp ?? '-'}</span> },
    { label: '重启次数', value: restarts },
    { label: 'QoS 类别', value: text(status.qosClass) ?? '-' },
    { label: '创建时间', value: datetime(data?.metadata?.creationTimestamp) },
    { label: '创建者', value: creator ?? '-' },
  ]

  /* ------------------------------------------------------------ 资源状态 */

  const volumes = objArr(spec.volumes)

  /* ------------------------------------------------------------ 其余标签页 */

  const tolerations = objArr(spec.tolerations)

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
            {ns} / {pod}
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
        <Attrs items={attrs} />
      </div>

      <Tabs
        className="ks-tabs px-1"
          items={[
            {
              key: 'status',
              label: '资源状态',
              children: (
                <div className="p-5">
                  {[
                    ...containers.map((c, i) => (
                      <ContainerCard
                        key={`app-${text(c.name) ?? i}`}
                        cluster={cluster}
                        ns={ns}
                        pod={pod}
                        container={c}
                        statuses={allStatuses}
                        podPhase={phase}
                        kindLabel="应用容器"
                      />
                    )),
                    ...initContainers.map((c, i) => (
                      <ContainerCard
                        key={`init-${text(c.name) ?? i}`}
                        cluster={cluster}
                        ns={ns}
                        pod={pod}
                        container={c}
                        statuses={allStatuses}
                        podPhase={phase}
                        kindLabel="初始化容器"
                      />
                    )),
                  ]}
                  <Section title="卷">
                    <Table
                      rowKey={(r) => text(r.name) ?? ''}
                      size="small"
                      pagination={false}
                      dataSource={volumes}
                      locale={{ emptyText: '没有卷' }}
                      columns={[
                        { title: '名称', width: 260, render: (_, v) => <span className="kbd-mono text-xs">{text(v.name) ?? '-'}</span> },
                        { title: '类型', width: 200, render: (_, v) => volumeSource(v).type },
                        { title: '来源', render: (_, v) => volumeSource(v).detail },
                      ]}
                    />
                  </Section>
                </div>
              ),
            },
            {
              key: 'schedule',
              label: '调度信息',
              children: (
                <div className="p-5">
                  <Descriptions
                    size="small"
                    column={2}
                    styles={{ label: labelStyle }}
                    items={[
                      { key: 'node', label: '节点名称', children: nodeName ?? '-' },
                      { key: 'nodeip', label: '节点 IP', children: <span className="kbd-mono text-xs">{nodeIp ?? '-'}</span> },
                      { key: 'qos', label: 'QoS 类别', children: text(status.qosClass) ?? '-' },
                      { key: 'tol', label: '容忍条数', children: tolerations.length },
                    ]}
                  />
                  <Section title="容忍">
                    <Table
                      rowKey={(r, i) => `${text(r.key) ?? ''}-${i ?? 0}`}
                      size="small"
                      pagination={false}
                      dataSource={tolerations}
                      locale={{ emptyText: '没有容忍' }}
                      columns={[
                        { title: '名称', render: (_, r) => <span className="kbd-mono text-xs">{text(r.key) ?? '-'}</span> },
                        { title: '效果', width: 160, render: (_, r) => text(r.effect) ?? '-' },
                        { title: '运算符', width: 120, render: (_, r) => text(r.operator) ?? '-' },
                        { title: '值', width: 160, render: (_, r) => text(r.value) ?? '-' },
                      ]}
                    />
                  </Section>
                </div>
              ),
            },
            {
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
                    <Table
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
                    <Typography.Text style={{ fontSize: 13 }}>{creator ?? '-'}</Typography.Text>
                  </Section>
                </div>
              ),
            },
            {
              key: 'env',
              label: '环境变量',
              children: (
                <div className="p-5">
                  {[...containers, ...initContainers].map((c, idx) => {
                    const cname = text(c.name) ?? `容器 ${idx + 1}`
                    const envs = objArr(c.env)
                    return (
                      <Section key={`${cname}-${idx}`} title={`容器「${cname}」`}>
                        <Table
                          rowKey={(r, i) => `${text(r.name) ?? ''}-${i ?? 0}`}
                          size="small"
                          pagination={false}
                          dataSource={envs}
                          locale={{ emptyText: '没有环境变量' }}
                          columns={[
                            { title: '名称', width: 260, render: (_, r) => <Tag>{text(r.name) ?? '-'}</Tag> },
                            { title: '值', render: (_, r) => <span className="kbd-mono text-xs">{envValueOf(r)}</span> },
                          ]}
                        />
                        <div className="mt-2" style={labelStyle}>
                          引用的配置来源：{envFromOf(c) || '无'}
                        </div>
                      </Section>
                    )
                  })}
                </div>
              ),
            },
            {
              key: 'events',
              label: '事件',
              children: (
                <div className="p-5">
                  <EventsPanel cluster={cluster} kind="Pod" name={pod} namespace={ns} />
                </div>
              ),
            },
          ]}
        />

      <Modal open={yamlOpen} title={`编辑 YAML · ${pod}`} width={720} confirmLoading={busy} onCancel={() => setYamlOpen(false)} onOk={saveYaml} okText="提交">
        <Input.TextArea className="kbd-mono" spellCheck={false} value={yamlText} onChange={(e) => setYamlText(e.target.value)} autoSize={{ minRows: 16, maxRows: 26 }} style={{ fontSize: 12 }} />
      </Modal>

      <Modal open={viewOpen} title={`查看 YAML · ${pod}`} width={720} onCancel={() => setViewOpen(false)} footer={<Button onClick={() => setViewOpen(false)}>关闭</Button>}>
        <pre className="kbd-mono m-0 max-h-[60vh] overflow-auto rounded bg-[var(--ks-fill-soft)] p-3 text-xs">{toYaml(data ?? {})}</pre>
      </Modal>
    </>
  )
}

/** 容器组详情抽屉：供节点/工作负载/资源列表等就地打开 */
export function PodDetailDrawer({
  cluster,
  namespace,
  name,
  onClose,
  onDeleted,
}: {
  cluster: string
  namespace?: string
  name?: string
  onClose: () => void
  onDeleted?: () => void
}) {
  return (
    <DetailDrawer open={!!name} title={`容器组详情 · ${name ?? ''}`} onClose={onClose}>
      {name && <PodDetailBody cluster={cluster} namespace={namespace} name={name} onDeleted={onDeleted} />}
    </DetailDrawer>
  )
}

/** 旧整页详情路由的兼容壳：同一路径直接以抽屉呈现 */
export default function PodDetailPage() {
  const { clusterId, namespace, name } = useParams<{ clusterId?: string; namespace?: string; name?: string }>()
  const storeCluster = useClusterStore((s) => s.cluster)
  const navigate = useNavigate()
  return (
    <PodDetailDrawer
      cluster={clusterId ?? storeCluster}
      namespace={namespace}
      name={name}
      onClose={() => navigate(-1)}
      onDeleted={() => navigate(clusterPath(clusterId ?? storeCluster, 'res/pods'))}
    />
  )
}

/* ------------------------------------------------------------ 容器卡 */

/** 一次性拉取容器历史日志（走 GetContainerLogs，需容器运行时支持） */
function OnceLog({ cluster, containerId }: { cluster: string; containerId: string }) {
  const { message } = App.useApp()
  const [log, setLog] = useState('')
  const [fetching, setFetching] = useState(false)
  return (
    <div className="mt-3">
      <Button
        size="small"
        icon={<ReloadOutlined />}
        loading={fetching}
        disabled={!containerId}
        title={containerId ? '按容器 ID 拉取历史日志' : '缺少容器 ID'}
        onClick={async () => {
          setFetching(true)
          try {
            const res = await fetch(containerLogsUrl(cluster, containerId))
            setLog(await res.text())
          } catch (e) {
            message.error((e as Error).message)
          } finally {
            setFetching(false)
          }
        }}
      >
        拉取该容器历史日志
      </Button>
      {log && <pre className="log-stream mt-2 max-h-64 overflow-auto rounded-md p-3">{log}</pre>}
    </div>
  )
}

function ContainerCard({
  cluster,
  ns,
  pod,
  container,
  statuses,
  podPhase,
  kindLabel,
}: {
  cluster: string
  ns: string
  pod: string
  container: Dict
  statuses: Dict[]
  podPhase?: string
  kindLabel: string
}) {
  const cname = text(container.name) ?? '-'
  const cs = statuses.find((s) => text(s.name) === cname) ?? {}
  const stateKey = Object.keys(dict(cs.state))[0]
  const stateReason = text(dict(dict(cs.state)[stateKey ?? '']).reason) ?? text(dict(cs.lastState).reason) ?? stateKey
  const containerId = text(cs.containerId)?.split('://')[1] ?? ''
  const ports = objArr(container.ports)
  return (
    <Card
      size="small"
      className="mb-4"
      title={
        <Space size={8}>
          <ContainerOutlined className="text-[var(--ks-body)]" />
          <span className="font-medium">{cname}</span>
          <Tag variant="filled">{kindLabel}</Tag>
        </Space>
      }
    >
      <Descriptions
        size="small"
        column={2}
        styles={{ label: labelStyle }}
        items={[
          { key: 'img', label: '镜像', children: <span className="kbd-mono text-xs">{text(container.image) ?? '-'}</span> },
          { key: 'st', label: '状态', children: <StatusText phase={stateReason ?? podPhase} /> },
          { key: 'rs', label: '重启次数', children: numv(cs.restartCount) ?? 0 },
          { key: 'ready', label: '就绪', children: cs.ready === true ? '是' : '否' },
          {
            key: 'ports',
            label: '端口列表',
            children: ports.length ? (
              <Space size={4} wrap>
                {ports.map((p, i) => (
                  <Tag key={i} variant="filled" className="kbd-mono">
                    {numv(p.containerPort) ?? '-'}
                    {p.hostPort ? `:${numv(p.hostPort)}` : ''}/{text(p.protocol) ?? 'TCP'}
                  </Tag>
                ))}
              </Space>
            ) : (
              '无'
            ),
          },
        ]}
      />
      <Tabs
        size="small"
        className="ks-tabs mt-2"
        items={[
          {
            key: 'log',
            label: '容器日志',
            children: (
              <div>
                <Typography.Text type="secondary" className="!text-xs">
                  容器「{cname}」实时日志（连接日志通道后推送）
                </Typography.Text>
                <div className="mt-2">
                  <PodLogStream cluster={cluster} namespace={ns} pod={pod} />
                </div>
                <OnceLog cluster={cluster} containerId={containerId} />
              </div>
            ),
          },
          {
            key: 'term',
            label: '终端',
            children: (
              <PodTerminal
                cluster={cluster}
                namespace={ns}
                pod={pod}
                container={cname}
                running={stateKey === 'running'}
              />
            ),
          },
          {
            key: 'files',
            label: '文件',
            children: (
              <PodFiles
                cluster={cluster}
                namespace={ns}
                pod={pod}
                container={cname}
                running={stateKey === 'running'}
              />
            ),
          },
        ]}
      />
    </Card>
  )
}
