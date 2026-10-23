import { Alert, Button, Empty, Space, Table, Tabs, Tag, Typography } from 'antd'
import { ContainerOutlined, DownOutlined, ReloadOutlined } from '@ant-design/icons'
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { NameCell } from '../components/PageShell'
import { DetailDrawer } from '../components/DetailDrawer'
import { EventsPanel } from '../components/EventsPanel'
import { MonitorPanel } from '../components/MonitorPanel'
import { clusterApi } from '../api/cluster'
import { deriveStatus, resourceApi, toItems } from '../api/resources'
import type { K8sObject } from '../api/resources'
import { useResource } from '../hooks/useResource'
import { useClusterStore } from '../store/useClusterStore'
import { bytes, cpu, cpuCores, datetime, memory } from '../utils/format'
import { clusterPath } from '../config/nav'
import type { ResourceDescriptor } from '../config/nav'
import type { V1Node } from '../types/k8s'
import { ALIAS_ANNOTATION, NodeActions, NodeStatusDot, internalIp, nodeRolesText } from './NodesPage'

const PODS: ResourceDescriptor = {
  key: 'pods',
  label: '容器组',
  kind: 'Pod',
  group: '',
  version: 'v1',
  plural: 'pods',
  scope: 'Namespaced',
  statusKind: 'phase',
}

/** status.nodeInfo 的完整字段（前端的 V1Node 只声明了常用几项） */
interface NodeSystemInfo {
  kubeletVersion?: string
  kubeProxyVersion?: string
  containerRuntimeVersion?: string
  kernelVersion?: string
  osImage?: string
  operatingSystem?: string
  architecture?: string
}

/** KubeSphere 对每种节点 conditions 的说明文案 */
const CONDITION_DOC: Record<string, string> = {
  'Memory Pressure': '节点的剩余内存是否小于阈值。',
  'Disk Pressure': '节点的剩余磁盘空间或 Inode 数量是否小于阈值。',
  'PID Pressure': '允许在节点上创建的进程数量是否小于阈值。',
  Ready: '节点是否可以接收容器组。',
}

const TONE_COLOR: Record<string, string> = { ok: '#3ca96a', warn: '#f5a623', danger: '#ca2621', muted: '#9aa7b8' }

/** 系统架构按 KubeSphere 的写法显示为大写形式：x86_64 → AMD64、aarch64 → ARM64 */
const archText = (arch?: string): string => {
  if (!arch) return '-'
  const map: Record<string, string> = { x86_64: 'AMD64', amd64: 'AMD64', aarch64: 'ARM64', arm64: 'ARM64' }
  return map[arch.toLowerCase()] ?? arch.toUpperCase()
}

/** 节点详情整页正文：列表页右侧抽屉与直达链接共用（写操作就地完成） */
export function NodeDetailBody({
  cluster,
  name,
  onOpenPod,
  onDeleted,
}: {
  cluster: string
  name: string
  onOpenPod?: (namespace: string, podName: string) => void
  onDeleted?: () => void
}) {
  const { data, error, loading, refresh } = useResource<V1Node[]>(
    () => clusterApi.nodes(cluster).then((list) => list ?? []),
    [cluster],
  )
  const node = useMemo(() => (data ?? []).find((n) => n.metadata?.name === name), [data, name])

  // 本节点上的容器组：全量拉取后按 spec.nodeName 过滤（后端没有按节点筛选的接口）
  const pods = useResource(
    () => (cluster ? resourceApi.list(cluster, PODS) : Promise.resolve([] as K8sObject[])),
    [cluster],
  )
  const nodePods = useMemo(
    () => toItems(pods.data).filter((p) => (p.spec as { nodeName?: string } | undefined)?.nodeName === name),
    [pods.data, name],
  )

  if (!loading && !node) return <Empty description={`未找到节点 ${name}`} className="py-24" />

  const info = (node?.status?.nodeInfo ?? {}) as NodeSystemInfo
  const cap = node?.status?.capacity ?? {}
  const alloc = node?.status?.allocatable ?? {}
  const alias = node?.metadata?.annotations?.[ALIAS_ANNOTATION]
  const osType = info.operatingSystem || (/windows/i.test(info.osImage ?? '') ? 'Windows' : 'Linux')

  const fields: { label: string; value: ReactNode }[] = [
    { label: '状态', value: node ? <NodeStatusDot node={node} /> : '-' },
    { label: 'IP 地址', value: (node ? internalIp(node) : undefined) ?? '-' },
    { label: '角色', value: node ? nodeRolesText(node) : '-' },
    { label: '操作系统版本', value: info.osImage ?? '-' },
    { label: '操作系统类型', value: osType },
    { label: '内核版本', value: info.kernelVersion ?? '-' },
    { label: '容器运行时', value: info.containerRuntimeVersion ?? '-' },
    { label: 'kubelet 版本', value: info.kubeletVersion ?? '-' },
    { label: 'kube-proxy 版本', value: info.kubeProxyVersion ?? '-' },
    { label: '系统架构', value: archText(info.architecture) },
    { label: '创建时间', value: datetime(node?.metadata?.creationTimestamp) },
  ]

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

      <div className="px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <Tag color="blue" variant="filled">集群节点</Tag>
          <Typography.Text strong style={{ fontSize: 13, color: '#15233a' }}>属性</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {alias ? `别名：${alias} · ` : ''}当前集群：{cluster}
          </Typography.Text>
          <span className="ml-auto flex items-center gap-2">
            <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={refresh} />
            {node && (
              <NodeActions
                node={node}
                onChanged={refresh}
                onDeleted={onDeleted}
                trigger={
                  <Button size="small">
                    操作 <DownOutlined style={{ fontSize: 10 }} />
                  </Button>
                }
              />
            )}
          </span>
        </div>
        <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          {fields.map((f) => (
            <div key={f.label} className="min-w-0">
              <div className="text-xs text-[#8f9aa9]">{f.label}</div>
              <div className="mt-1 truncate text-[13px]" style={{ color: '#15233a' }}>
                {f.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Tabs
        className="ks-tabs px-1 pb-4"
        items={[
          {
            key: 'status',
            label: '运行状态',
            children: (
              <div className="p-4">
                <Typography.Title level={5} className="!mt-0">资源容量</Typography.Title>
                <Table
                  size="small"
                  rowKey="res"
                  pagination={false}
                  dataSource={[
                    { res: 'CPU', cap: cpu(cap.cpu), alloc: cpu(alloc.cpu) },
                    { res: '内存', cap: memory(cap.memory), alloc: memory(alloc.memory) },
                    { res: '容器组', cap: cap.pods ?? '-', alloc: alloc.pods ?? '-' },
                  ]}
                  columns={[
                    { title: '资源', dataIndex: 'res', width: 160 },
                    { title: '容量', dataIndex: 'cap' },
                    { title: '可分配', dataIndex: 'alloc' },
                  ]}
                />
              </div>
            ),
          },
          {
            key: 'monitor',
            label: '监控',
            children: (
              <div className="p-4">
                <MonitorPanel
                  cluster={cluster}
                  kind="node"
                  name={name}
                  capacity={node ? { cpu: cpuCores(cap.cpu), mem: bytes(cap.memory) } : undefined}
                />
              </div>
            ),
          },
          {
            key: 'pods',
            label: '容器组',
            children: (
              <div className="p-4">
                <Table<K8sObject>
                  size="small"
                  rowKey={(r) => r.metadata?.uid ?? `${r.metadata?.namespace}/${r.metadata?.name}`}
                  loading={pods.loading}
                  dataSource={nodePods}
                  locale={{ emptyText: '该节点上没有容器组' }}
                  pagination={{ pageSize: 10, hideOnSinglePage: true, showTotal: (t) => `总数：${t}` }}
                  columns={[
                    {
                      title: '名称',
                      render: (_, p) => (
                        <a onClick={() => onOpenPod?.(p.metadata?.namespace ?? 'default', p.metadata?.name ?? '')}>
                          <NameCell icon={<ContainerOutlined />} title={p.metadata?.name} />
                        </a>
                      ),
                    },
                    {
                      title: '状态',
                      width: 130,
                      render: (_, p) => {
                        const s = deriveStatus(PODS, p)
                        return (
                          <span className="inline-flex items-center gap-2 whitespace-nowrap">
                            <span className="size-[7px] shrink-0 rounded-full" style={{ background: TONE_COLOR[s.tone] }} />
                            <span style={{ fontWeight: 500, color: '#15233a' }}>{s.text}</span>
                          </span>
                        )
                      },
                    },
                    { title: '项目', width: 180, render: (_, p) => p.metadata?.namespace ?? '-' },
                    { title: '创建时间', width: 190, render: (_, p) => datetime(p.metadata?.creationTimestamp) },
                  ]}
                />
              </div>
            ),
          },
          {
            key: 'meta',
            label: '元数据',
            children: (
              <div className="p-4">
                <MetaTable title="标签" data={node?.metadata?.labels} />
                <MetaTable title="注解" data={node?.metadata?.annotations} />
              </div>
            ),
          },
          {
            key: 'events',
            label: '事件',
            children: (
              <div className="p-4">
                <EventsPanel cluster={cluster} kind="Node" name={name ?? ''} />
              </div>
            ),
          },
          {
            key: 'health',
            label: '健康状态',
            children: (
              <div className="p-4">
                <Table
                  size="small"
                  rowKey={(r) => `${r.type}-${r.lastTransitionTime ?? ''}`}
                  pagination={false}
                  dataSource={node?.status?.conditions ?? []}
                  locale={{ emptyText: '没有状态条件' }}
                  columns={[
                    {
                      title: '类型',
                      width: 220,
                      render: (_, c) => (
                        <div className="min-w-0">
                          <div style={{ color: '#15233a', fontWeight: 500 }}>{c.type}</div>
                          {CONDITION_DOC[c.type ?? ''] && (
                            <div className="mt-0.5 text-xs text-[#8f9aa9]">{CONDITION_DOC[c.type ?? '']}</div>
                          )}
                        </div>
                      ),
                    },
                    {
                      title: '状态',
                      width: 90,
                      render: (_, c) => (
                        <Tag
                          variant="filled"
                          color={
                            c.type === 'Ready'
                              ? c.status === 'True'
                                ? 'green'
                                : 'red'
                              : c.status === 'True'
                                ? 'red'
                                : 'green'
                          }
                        >
                          {c.status ?? '-'}
                        </Tag>
                      ),
                    },
                    { title: '原因', dataIndex: 'reason', width: 160, render: (v?: string) => v || '-' },
                    { title: '消息', dataIndex: 'message', render: (v?: string) => v || '-' },
                  ]}
                />
              </div>
            ),
          },
        ]}
      />
    </>
  )
}

/** 节点详情抽屉：正文自带操作区，抽屉只负责标题与关闭 */
export function NodeDetailDrawer({
  cluster,
  name,
  onClose,
  onOpenPod,
  onDeleted,
}: {
  cluster: string
  name?: string
  onClose: () => void
  onOpenPod?: (namespace: string, podName: string) => void
  onDeleted?: () => void
}) {
  return (
    <DetailDrawer open={!!name} title={`节点详情 · ${name ?? ''}`} onClose={onClose}>
      {name && <NodeDetailBody cluster={cluster} name={name} onOpenPod={onOpenPod} onDeleted={onDeleted} />}
    </DetailDrawer>
  )
}

/** 旧整页详情路由的兼容壳：同一路径直接以抽屉呈现 */
export default function NodeDetailPage() {
  const { clusterId, name } = useParams<{ clusterId?: string; name?: string }>()
  const storeCluster = useClusterStore((s) => s.cluster)
  const navigate = useNavigate()
  return (
    <NodeDetailDrawer
      cluster={clusterId ?? storeCluster}
      name={name}
      onClose={() => navigate(-1)}
      onOpenPod={(ns, podName) => navigate(clusterPath(clusterId ?? storeCluster, `pods/${ns}/${podName}`))}
    />
  )
}

function MetaTable({ title, data }: { title: string; data?: Record<string, string> }) {
  return (
    <div className="mb-6">
      <Typography.Text strong>{title}</Typography.Text>
      <Table
        size="small"
        className="mt-2"
        rowKey="k"
        pagination={false}
        dataSource={Object.entries(data ?? {}).map(([k, v]) => ({ k, v }))}
        locale={{ emptyText: '无' }}
        columns={[
          { title: '名称', dataIndex: 'k', render: (v: string) => <Tag>{v}</Tag> },
          { title: '值', dataIndex: 'v', render: (v: string) => <span className="kbd-mono text-xs">{v}</span> },
        ]}
      />
    </div>
  )
}
