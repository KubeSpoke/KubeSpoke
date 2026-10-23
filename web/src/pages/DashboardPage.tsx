import {
  ApartmentOutlined,
  CodeOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FileProtectOutlined,
  GlobalOutlined,
  ReloadOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { App, Button, Empty, Modal, Progress, Spin, Table, Tag, Typography } from 'antd'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { clusterApi } from '../api/cluster'
import { resourceApi, toItems } from '../api/resources'
import type { K8sObject } from '../api/resources'
import { clusterPath } from '../config/nav'
import type { ResourceDescriptor } from '../config/nav'
import { useResource } from '../hooks/useResource'
import { useClusterStore } from '../store/useClusterStore'
import { MonitorPanel } from '../components/MonitorPanel'
import { cpuCores, bytes, datetime, percent } from '../utils/format'
import { internalIp, nodeRolesText, nodeStatusText } from './NodesPage'
import type { Metrics, V1Event, V1Node } from '../types/k8s'

/** 集群基本信息（名称/别名/描述/类型）挂在 kube-system 项目注解上，与 KubeSphere 的工作空间注解同构 */
const KUBE_SYSTEM = 'kube-system'
const ANNOTATION_ALIAS = 'kubespoke.io/alias-name'
const ANNOTATION_TYPE = 'kubespoke.io/type'

/** 概览页自用的内联描述符：只用来取数量/分组，不进左侧菜单，故不注册到 nav.tsx */
const D = {
  namespaces: {
    key: 'namespaces', label: '项目', kind: 'Namespace', group: '', version: 'v1',
    plural: 'namespaces', scope: 'Cluster', statusKind: 'none',
  },
  pods: {
    key: 'pods', label: '容器组', kind: 'Pod', group: '', version: 'v1',
    plural: 'pods', scope: 'Namespaced', statusKind: 'phase',
  },
  deployments: {
    key: 'deployments', label: '部署', kind: 'Deployment', group: 'apps', version: 'v1',
    plural: 'deployments', scope: 'Namespaced', statusKind: 'readyReplicas',
  },
  statefulsets: {
    key: 'statefulsets', label: '有状态副本集', kind: 'StatefulSet', group: 'apps', version: 'v1',
    plural: 'statefulsets', scope: 'Namespaced', statusKind: 'readyReplicas',
  },
  daemonsets: {
    key: 'daemonsets', label: '守护进程集', kind: 'DaemonSet', group: 'apps', version: 'v1',
    plural: 'daemonsets', scope: 'Namespaced', statusKind: 'readyReplicas',
  },
  jobs: {
    key: 'jobs', label: '任务', kind: 'Job', group: 'batch', version: 'v1',
    plural: 'jobs', scope: 'Namespaced', statusKind: 'conditions',
  },
  cronjobs: {
    key: 'cronjobs', label: '定时任务', kind: 'CronJob', group: 'batch', version: 'v1',
    plural: 'cronjobs', scope: 'Namespaced', statusKind: 'none',
  },
  persistentvolumeclaims: {
    key: 'persistentvolumeclaims', label: '持久卷声明', kind: 'PersistentVolumeClaim', group: '', version: 'v1',
    plural: 'persistentvolumeclaims', scope: 'Namespaced', statusKind: 'phase',
  },
  services: {
    key: 'services', label: '服务', kind: 'Service', group: '', version: 'v1',
    plural: 'services', scope: 'Namespaced', statusKind: 'none',
  },
} satisfies Record<string, ResourceDescriptor>

const WORKLOAD_KEYS = ['deployments', 'statefulsets', 'daemonsets', 'jobs', 'cronjobs'] as const

/** 与「节点管理」页一致的色调 token */
const TONE_COLOR: Record<string, string> = { ok: '#59c492', warn: '#f5a623', danger: '#d94f4f', muted: '#9aa7b8' }

interface NodeRow {
  name: string
  roles: string
  status: string
  cpuPct: number | null
  memPct: number | null
}

interface AlertItem {
  level: 'error' | 'warn'
  text: string
}

interface Overview {
  counts: { namespaces: number; workloads: number; services: number; pvcs: number }
  /** 各资源「覆盖多少个项目」，用于统计卡右侧的小字（口径与页面已有数据一致，不额外请求接口） */
  coverage: { activeNs: number; workloadNs: number; serviceNs: number; pvcNs: number }
  nsRows: { name: string; workloads: number; pods: number; active: boolean }[]
  nodeRows: NodeRow[]
  readyNodes: number
  version: string
  alias: string
  type: string
  apiAddr: string
  created?: string
  usage: { cpuUsed: number; cpuTotal: number; memUsed: number; memTotal: number; diskTotal: number }
  metricsAvailable: boolean
  events: V1Event[]
  alerts: AlertItem[]
}

const KUBECTL_COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: 'kubectl get nodes -o wide', desc: '查看集群节点与内网地址' },
  { cmd: 'kubectl get namespaces', desc: '查看全部项目' },
  { cmd: 'kubectl get pods -A', desc: '查看所有项目下的容器组' },
  { cmd: 'kubectl get pods -n <project-name>', desc: '查看指定项目下的容器组' },
  { cmd: 'kubectl describe pod <pod-name> -n <project-name>', desc: '查看容器组详情与事件' },
  { cmd: 'kubectl logs -f <pod-name> -n <project-name>', desc: '实时跟踪容器日志' },
  { cmd: 'kubectl exec -it <pod-name> -n <project-name> -- sh', desc: '进入容器执行命令' },
  { cmd: 'kubectl get deploy,rs,sts,ds -A', desc: '查看各类工作负载' },
  { cmd: 'kubectl get svc,ing -A', desc: '查看服务与应用路由' },
  { cmd: 'kubectl top nodes', desc: '查看节点资源用量（需 metrics-server）' },
]

const shortTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'

const groupByNs = (items: K8sObject[]) => {
  const map = new Map<string, number>()
  for (const o of items) {
    const ns = o.metadata?.namespace ?? ''
    map.set(ns, (map.get(ns) ?? 0) + 1)
  }
  return map
}

export default function DashboardPage() {
  const cluster = useClusterStore((s) => s.cluster)
  const navigate = useNavigate()
  const [kubectlOpen, setKubectlOpen] = useState(false)
  const [kubeconfigOpen, setKubeconfigOpen] = useState(false)

  const { data, error, loading, refresh } = useResource<Overview | null>(
    async () => {
      if (!cluster) return null
      const lists: Record<string, K8sObject[]> = {}
      await Promise.all(
        Object.entries(D).map(([k, d]) =>
          resourceApi
            .list(cluster, d)
            .then((r) => {
              lists[k] = toItems(r)
            })
            .catch(() => {
              lists[k] = []
            }),
        ),
      )
      const [nodes, metrics, events] = await Promise.all([
        clusterApi.nodes(cluster).catch(() => [] as V1Node[]),
        clusterApi.nodeMetrics(cluster).catch(() => [] as Metrics[]),
        clusterApi.events(cluster).catch(() => [] as V1Event[]),
      ])

      const kubeSystem = (lists.namespaces ?? []).find((o) => o.metadata?.name === KUBE_SYSTEM)
      const annotations = kubeSystem?.metadata?.annotations ?? {}

      const podsByNs = groupByNs(lists.pods ?? [])
      const workloadByNs = new Map<string, number>()
      for (const k of WORKLOAD_KEYS) {
        for (const [ns, n] of groupByNs(lists[k] ?? [])) workloadByNs.set(ns, (workloadByNs.get(ns) ?? 0) + n)
      }
      const nsRows = (lists.namespaces ?? [])
        .map((o) => ({
          name: o.metadata?.name ?? '',
          workloads: workloadByNs.get(o.metadata?.name ?? '') ?? 0,
          pods: podsByNs.get(o.metadata?.name ?? '') ?? 0,
          active: (o as { status?: { phase?: string } }).status?.phase !== 'Terminating',
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      const metricByName = new Map((metrics ?? []).map((m) => [m.metadata?.name ?? '', m]))
      const nodeRows: NodeRow[] = (nodes ?? []).map((n) => {
        const m = metricByName.get(n.metadata?.name ?? '')
        const allocCpu = cpuCores(n.status?.allocatable?.cpu)
        const allocMem = bytes(n.status?.allocatable?.memory)
        return {
          name: n.metadata?.name ?? '-',
          roles: nodeRolesText(n),
          status: nodeStatusText(n),
          cpuPct: m && allocCpu ? percent(cpuCores(m.usage?.cpu), allocCpu) : null,
          memPct: m && allocMem ? percent(bytes(m.usage?.memory), allocMem) : null,
        }
      })

      const cpuTotal = (nodes ?? []).reduce((s, n) => s + cpuCores(n.status?.allocatable?.cpu), 0)
      const memTotal = (nodes ?? []).reduce((s, n) => s + bytes(n.status?.allocatable?.memory), 0)
      const cpuUsed = (metrics ?? []).reduce((s, m) => s + cpuCores(m.usage?.cpu), 0)
      const memUsed = (metrics ?? []).reduce((s, m) => s + bytes(m.usage?.memory), 0)
      const diskTotal = (nodes ?? []).reduce((s, n) => s + bytes(n.status?.allocatable?.['ephemeral-storage']), 0)

      const alerts: AlertItem[] = []
      for (const r of nodeRows) {
        if (r.status !== '运行中') alerts.push({ level: 'error', text: `节点 ${r.name} ${r.status}` })
        else if (r.cpuPct !== null && r.cpuPct >= 80) alerts.push({ level: 'warn', text: `节点 ${r.name} CPU 使用率超过 80%` })
      }
      for (const p of lists.pods ?? []) {
        const statuses = (p as { status?: { containerStatuses?: { waiting?: { reason?: string } }[] } }).status
          ?.containerStatuses
        if (statuses?.some((cs) => cs.waiting?.reason === 'CrashLoopBackOff')) {
          alerts.push({ level: 'error', text: `Pod ${p.metadata?.namespace}/${p.metadata?.name} 处于 CrashLoopBackOff` })
        }
      }

      const sortedEvents = [...(events ?? [])].sort((a, b) =>
        (b.lastTimestamp ?? b.firstTimestamp ?? '').localeCompare(a.lastTimestamp ?? a.firstTimestamp ?? ''),
      )

      return {
        counts: {
          namespaces: (lists.namespaces ?? []).length,
          workloads: WORKLOAD_KEYS.reduce((s, k) => s + (lists[k] ?? []).length, 0),
          services: (lists.services ?? []).length,
          pvcs: (lists.persistentvolumeclaims ?? []).length,
        },
        coverage: {
          activeNs: nsRows.filter((r) => r.active).length,
          workloadNs: [...workloadByNs.values()].filter((n) => n > 0).length,
          serviceNs: groupByNs(lists.services ?? []).size,
          pvcNs: groupByNs(lists.persistentvolumeclaims ?? []).size,
        },
        nsRows,
        nodeRows,
        readyNodes: nodeRows.filter((r) => r.status === '运行中').length,
        version: nodes?.[0]?.status?.nodeInfo?.kubeletVersion ?? '-',
        alias: annotations[ANNOTATION_ALIAS] ?? '',
        type: annotations[ANNOTATION_TYPE] || '自建集群',
        apiAddr: nodes?.length ? `https://${internalIp(nodes[0]) ?? ''}:6443` : '',
        created: kubeSystem?.metadata?.creationTimestamp,
        usage: { cpuUsed, cpuTotal, memUsed, memTotal, diskTotal },
        metricsAvailable: (metrics ?? []).length > 0,
        events: sortedEvents.slice(0, 6),
        alerts: alerts.slice(0, 6),
      }
    },
    [cluster],
  )

  if (!cluster) return <Empty description="请先选择一个在线集群" className="py-24" />
  if (loading && !data) {
    return (
      <div className="grid h-64 place-items-center">
        <Spin />
      </div>
    )
  }

  const running = (data?.readyNodes ?? 0) > 0
  const u = data?.usage
  const nodeTotal = data?.nodeRows.length ?? 0
  const okNodes = data?.readyNodes ?? 0
  const nsTotal = data?.counts.namespaces ?? 0

  return (
    <>
      <div className="space-y-4">
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error} <Button size="small" onClick={refresh}>重试</Button>
          </div>
        )}

        {/* 页头横幅（与节点管理页同款渐变 + 图标砖块） */}
        <div
          className="relative flex items-center justify-between overflow-hidden rounded-lg px-6 py-5"
          style={{ background: 'linear-gradient(90deg, #f2f7ff 0%, #e9f1fd 60%, #eef4fe 100%)' }}
        >
          <div className="flex min-w-0 items-start gap-4">
            <span
              className="grid size-14 shrink-0 place-items-center rounded-xl text-2xl text-white"
              style={{ background: 'linear-gradient(135deg, #5ea0ff, #1668dc)' }}
            >
              <ApartmentOutlined />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xl font-bold" style={{ color: '#15233a' }}>集群概览</span>
                <span className="max-w-[260px] truncate text-[13px] font-medium" style={{ color: '#2f6fed' }}>
                  {cluster}
                </span>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs"
                  style={running ? { color: '#27a06a', background: '#e9f8f0' } : { color: '#d94f4f', background: '#fdecec' }}
                >
                  <span className="size-[6px] rounded-full" style={{ background: running ? TONE_COLOR.ok : TONE_COLOR.danger }} />
                  {running ? '运行中' : '异常'}
                </span>
              </div>
              <div className="mt-1 truncate text-[13px]" style={{ color: '#6b7a92' }}>
                {data?.alias ? `${data.alias} · ` : ''}
                查看集群整体状态、资源用量、节点健康与最近事件。
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]" style={{ color: '#5b6a80' }}>
                <span><ThunderboltOutlined style={{ marginRight: 4 }} />Kubernetes {data?.version ?? '-'}</span>
                <span><TeamOutlined style={{ marginRight: 4 }} />{nodeTotal} 个节点</span>
                <span><ApartmentOutlined style={{ marginRight: 4 }} />{nsTotal} 个命名空间</span>
                <span>
                  集群类型：<Tag color="blue" variant="filled" style={{ borderRadius: 6 }}>{data?.type ?? '-'}</Tag>
                </span>
                <span className="flex items-center gap-1" style={{ color: '#8f9aa9' }}>
                  API 地址：{data?.apiAddr || '-'}
                  {data?.apiAddr && <CopyButton text={data.apiAddr} />}
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={refresh}
            >
              刷新
            </Button>
            <img
              src="/login-hero.svg"
              alt=""
              className="pointer-events-none hidden h-24 w-auto xl:block"
              style={{
                objectFit: 'contain',
                objectPosition: 'right',
                maskImage: 'linear-gradient(90deg, transparent, #000 30%)',
                WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 30%)',
              }}
            />
          </div>
        </div>

        {/* 统计卡（节点管理同款：图标砖块 + 大数字 + 占比/单位小字） */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard
            label="命名空间" value={nsTotal} unit="个" tail={`正常 ${data?.coverage.activeNs ?? 0}/${nsTotal}`}
            color="#2f6fed" bg="#e8f1ff" icon={<ApartmentOutlined />}
            onClick={() => navigate(clusterPath(cluster, 'projects'))}
          />
          <StatCard
            label="工作负载" value={data?.counts.workloads ?? 0} unit="个" tail={`覆盖 ${data?.coverage.workloadNs ?? 0} 个项目`}
            color="#27a06a" bg="#e6f7ef" icon={<DeploymentUnitOutlined />}
            onClick={() => navigate(clusterPath(cluster, 'deployments'))}
          />
          <StatCard
            label="服务" value={data?.counts.services ?? 0} unit="个" tail={`覆盖 ${data?.coverage.serviceNs ?? 0} 个项目`}
            color="#7c5cff" bg="#f0ebff" icon={<GlobalOutlined />}
            onClick={() => navigate(clusterPath(cluster, 'res/services'))}
          />
          <StatCard
            label="存储卷" value={data?.counts.pvcs ?? 0} unit="个" tail={`覆盖 ${data?.coverage.pvcNs ?? 0} 个项目`}
            color="#f5a623" bg="#fdf3e3" icon={<DatabaseOutlined />}
            onClick={() => navigate(clusterPath(cluster, 'res/persistentvolumeclaims'))}
          />
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            {/* 资源使用率 + 节点状态 */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,3fr)]">
              <Panel title="资源使用率" extra={!data?.metricsAvailable && <span className="text-xs" style={{ color: '#b3bdcc' }}>集群未安装 metrics-server，暂无实时用量</span>}>
                <div className="flex flex-wrap items-start justify-around gap-2 py-1">
                  <Donut label="CPU" pct={data?.metricsAvailable && u?.cpuTotal ? percent(u.cpuUsed, u.cpuTotal) : null}
                    sub={u && u.cpuTotal ? `${data?.metricsAvailable ? u.cpuUsed.toFixed(1) : '-'} / ${u.cpuTotal.toFixed(0)} vCPU` : '-'} color="#2f6fed" />
                  <Donut label="内存" pct={data?.metricsAvailable && u?.memTotal ? percent(u.memUsed, u.memTotal) : null}
                    sub={u && u.memTotal ? `${data?.metricsAvailable ? (u.memUsed / 1024 ** 3).toFixed(1) : '-'} / ${(u.memTotal / 1024 ** 3).toFixed(0)} GiB` : '-'} color="#59c492" />
                  <Donut label="磁盘" pct={null}
                    sub={u && u.diskTotal ? `- / ${(u.diskTotal / 1024 ** 3).toFixed(0)} GiB` : '-'} color="#7c5cff" />
                  <Donut label="网络" pct={null} sub="-" color="#29b6a9" />
                </div>
                {data?.metricsAvailable && u && (
                  <div className="mt-3 border-t pt-3" style={{ borderColor: '#eef1f5' }}>
                    <MonitorPanel cluster={cluster} kind="cluster" capacity={{ cpu: u.cpuTotal, mem: u.memTotal }} />
                  </div>
                )}
              </Panel>

              <Panel title="节点状态" extra={
                <span className="flex items-center gap-3 text-xs" style={{ color: '#5b6a80' }}>
                  <Legend color={TONE_COLOR.ok} text={`正常 ${okNodes}`} />
                  <Legend color={TONE_COLOR.danger} text={`异常 ${nodeTotal - okNodes}`} />
                </span>
              }>
                <div className="max-h-[218px] space-y-3 overflow-auto pr-1">
                  {(data?.nodeRows ?? []).map((r) => (
                    <div key={r.name} className="min-w-0">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="truncate font-medium" style={{ color: '#15233a' }}>{r.name}</span>
                        <span style={{ color: r.status === '运行中' ? '#27a06a' : TONE_COLOR.danger }}>{r.status}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress percent={r.cpuPct ?? 0} showInfo={false} size="small" strokeColor="#2f6fed" className="!m-0 flex-1" />
                        <span className="w-9 text-right text-[11px]" style={{ color: '#8f9aa9' }}>{r.cpuPct === null ? '-' : `${r.cpuPct}%`}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <Progress percent={r.memPct ?? 0} showInfo={false} size="small" strokeColor="#59c492" className="!m-0 flex-1" />
                        <span className="w-9 text-right text-[11px]" style={{ color: '#8f9aa9' }}>{r.memPct === null ? '-' : `${r.memPct}%`}</span>
                      </div>
                    </div>
                  ))}
                  {!nodeTotal && <div className="py-2 text-[13px]" style={{ color: '#8f9aa9' }}>暂无节点</div>}
                </div>
              </Panel>
            </div>

            {/* 命名空间 / 节点信息 / 最近事件 */}
            <div className="grid gap-4 lg:grid-cols-3">
              <Panel title="命名空间" link="查看全部" onLink={() => navigate(clusterPath(cluster, 'projects'))}>
                <Table
                  size="small"
                  rowKey="name"
                  pagination={false}
                  dataSource={data?.nsRows.slice(0, 5) ?? []}
                  tableLayout="auto"
                  columns={[
                    { title: '名称', dataIndex: 'name' },
                    { title: '负载', dataIndex: 'workloads', width: 48 },
                    { title: 'Pod', dataIndex: 'pods', width: 48 },
                    {
                      title: '状态',
                      dataIndex: 'active',
                      width: 62,
                      render: (a: boolean) => (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs" style={{ color: a ? '#27a06a' : TONE_COLOR.danger }}>
                          <span className="size-[6px] rounded-full" style={{ background: a ? TONE_COLOR.ok : TONE_COLOR.danger }} />
                          {a ? '正常' : '终止中'}
                        </span>
                      ),
                    },
                  ]}
                />
                {!data?.nsRows.length && <div className="text-[13px]" style={{ color: '#8f9aa9' }}>暂无命名空间</div>}
              </Panel>

              <Panel title="节点信息" link="查看全部" onLink={() => navigate(clusterPath(cluster, 'nodes'))}>
                <Table
                  size="small"
                  rowKey="name"
                  pagination={false}
                  dataSource={data?.nodeRows.slice(0, 5) ?? []}
                  tableLayout="auto"
                  columns={[
                    { title: '名称', dataIndex: 'name' },
                    { title: '角色', dataIndex: 'roles', width: 92, render: (t: string) => <span className="whitespace-nowrap text-xs">{t}</span> },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 70,
                      render: (s: string) => (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
                          <span className="size-[6px] rounded-full" style={{ background: s === '运行中' ? TONE_COLOR.ok : TONE_COLOR.danger }} />
                          <span style={{ color: '#15233a' }}>{s}</span>
                        </span>
                      ),
                    },
                    {
                      title: 'CPU / 内存',
                      key: 'usage',
                      width: 96,
                      render: (_: unknown, r: NodeRow) => (
                        <span className="text-xs" style={{ color: '#5b6a80' }}>
                          {r.cpuPct === null ? '-' : `${r.cpuPct}%`} / {r.memPct === null ? '-' : `${r.memPct}%`}
                        </span>
                      ),
                    },
                  ]}
                />
                {!nodeTotal && <div className="text-[13px]" style={{ color: '#8f9aa9' }}>暂无节点</div>}
              </Panel>

              <Panel title="最近事件">
                {data?.events.length ? (
                  <div className="space-y-2.5">
                    {(data?.events ?? []).map((e, i) => (
                      <div key={e.metadata?.uid ?? i} className="flex gap-3 text-xs">
                        <span className="mt-1 size-[7px] shrink-0 rounded-full" style={{ background: e.type === 'Warning' ? TONE_COLOR.warn : TONE_COLOR.ok }} />
                        <span className="w-[86px] shrink-0" style={{ color: '#8f9aa9' }}>{shortTime(e.lastTimestamp ?? e.firstTimestamp)}</span>
                        <span className="min-w-0 flex-1 truncate" style={{ color: '#5b6a80' }}>
                          <span style={{ color: e.type === 'Warning' ? TONE_COLOR.danger : '#15233a', fontWeight: 500 }}>
                            {e.involvedObject?.kind} {e.involvedObject?.name}
                          </span>
                          {' '}{e.reason}{e.message ? ` · ${e.message}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px]" style={{ color: '#8f9aa9' }}>暂无事件</div>
                )}
              </Panel>
            </div>
          </div>

          {/* 右侧信息栏 */}
          <div className="space-y-4">
            <Panel title="集群信息" link="编辑" onLink={() => navigate(clusterPath(cluster, 'settings/base-info'))}>
              <div className="space-y-3">
                <InfoRow label="集群名称">{cluster}</InfoRow>
                <InfoRow label="集群类型">{data?.type ?? '-'}</InfoRow>
                <InfoRow label="Kubernetes">{data?.version ?? '-'}</InfoRow>
                <InfoRow label="API 地址">
                  <span className="break-all">{data?.apiAddr || '-'}</span>
                </InfoRow>
                <InfoRow label="创建时间">{datetime(data?.created)}</InfoRow>
              </div>
            </Panel>

            <Panel title="快速操作">
              <div className="-mx-4 -my-3">
                <QuickAction icon={<FileProtectOutlined />} label="查看 kubeconfig" onClick={() => setKubeconfigOpen(true)} />
                <QuickAction icon={<CodeOutlined />} label="kubectl 常用命令" onClick={() => setKubectlOpen(true)} />
                <QuickAction icon={<GlobalOutlined />} label="查看日志" onClick={() => navigate(clusterPath(cluster, 'res/pods'))} />
                <QuickAction icon={<SafetyCertificateOutlined />} label="集群设置" onClick={() => navigate(clusterPath(cluster, 'settings/base-info'))} last />
              </div>
            </Panel>

            <Panel title="告警信息" link={data?.alerts.length ? '查看全部' : undefined} onLink={() => navigate(clusterPath(cluster, 'res/pods'))}>
              {data?.alerts.length ? (
                <div className="space-y-3">
                  {(data?.alerts ?? []).map((a, i) => (
                    <div key={i} className="flex gap-2.5 text-[13px]">
                      <span className="mt-1.5 size-[7px] shrink-0 rounded-full" style={{ background: a.level === 'error' ? TONE_COLOR.danger : TONE_COLOR.warn }} />
                      <span style={{ color: '#5b6a80' }}>{a.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[13px]" style={{ color: '#8f9aa9' }}>暂无告警</div>
              )}
            </Panel>
          </div>
        </div>
      </div>

      <Modal open={kubectlOpen} title="kubectl" width={680} onCancel={() => setKubectlOpen(false)} footer={<Button onClick={() => setKubectlOpen(false)}>关闭</Button>}>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          kubectl 是 Kubernetes 官方命令行工具。请先在本地安装对应版本的 kubectl，再按需复制下面的常用命令；
          尖括号部分是占位符，需要替换成实际的项目名与资源名。
        </Typography.Paragraph>
        <div className="space-y-2">
          {KUBECTL_COMMANDS.map((item) => (
            <div key={item.cmd} className="flex items-center justify-between gap-3 rounded border border-[#ebeef2] bg-[#f9fbfd] px-3 py-2">
              <div className="min-w-0 flex-1">
                <Typography.Text className="kbd-mono !text-xs" ellipsis={{ tooltip: item.cmd }}>{item.cmd}</Typography.Text>
                <div className="mt-0.5 truncate text-[11px] text-[#8f9aa9]">{item.desc}</div>
              </div>
              <CopyButton text={item.cmd} />
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={kubeconfigOpen}
        title="kubeconfig"
        onCancel={() => setKubeconfigOpen(false)}
        footer={
          <>
            <Button onClick={() => setKubeconfigOpen(false)}>取消</Button>
            <Button type="primary" onClick={() => { setKubeconfigOpen(false); navigate('/clusters?add=1') }}>
              前往集群接入
            </Button>
          </>
        }
      >
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          KubeSpoke 不直接暴露 API Server 地址：控制台通过集群内的 Agent 反向接入来读写资源，
          请到「集群接入」获取 Agent 安装清单并完成接入。
        </Typography.Paragraph>
      </Modal>
    </>
  )
}

/** 白色分区卡（与节点管理页同款：46px 标题栏 + 分隔线 + 14px 600 标题） */
function Panel({ title, extra, link, onLink, children }: { title: string; extra?: ReactNode; link?: string; onLink?: () => void; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
      <div className="flex items-center justify-between px-4" style={{ height: 46, borderBottom: '1px solid #eef1f5' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#15233a' }}>{title}</span>
        <span className="flex items-center gap-2">
          {extra}
          {link && (
            <a className="flex items-center gap-1 whitespace-nowrap" style={{ fontSize: 12, color: '#2f6fed' }} onClick={onLink}>
              {link} <RightOutlined style={{ fontSize: 10 }} />
            </a>
          )}
        </span>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}

/** 统计卡（节点管理页同款造型；点击行为沿用原「资源计数卡」的跳转） */
function StatCard({ label, value, unit, tail, color, bg, icon, onClick }: {
  label: string; value: number; unit?: string; tail?: string; color: string; bg: string; icon: ReactNode; onClick?: () => void
}) {
  return (
    <div
      className="flex cursor-pointer items-center justify-between rounded-lg bg-white px-4 py-3 transition-shadow hover:shadow-md"
      style={{ border: '1px solid #e6ebf1' }}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg text-lg" style={{ background: bg, color }}>{icon}</span>
        <div>
          <div className="text-xs" style={{ color: '#8f9aa9' }}>{label}</div>
          <div className="text-xl font-bold leading-6" style={{ color: '#15233a' }}>
            {value}
            {unit && <span className="ml-1 text-xs font-normal" style={{ color: '#8f9aa9' }}>{unit}</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap text-xs" style={{ color: '#8f9aa9' }}>{tail}</span>
        <RightOutlined style={{ color: '#c9d2de', fontSize: 12 }} />
      </div>
    </div>
  )
}

function Donut({ label, pct, sub, color }: { label: string; pct: number | null; sub: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
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
            <span style={{ fontSize: 14, fontWeight: 600, color: '#15233a' }}>{pct}%</span>
          )
        }
      />
      <div className="text-sm font-medium" style={{ color: '#15233a' }}>{label}</div>
      <div className="text-xs" style={{ color: '#8f9aa9' }}>{sub}</div>
    </div>
  )
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-[7px] rounded-full" style={{ background: color }} />
      {text}
    </span>
  )
}

function QuickAction({ icon, label, onClick, last }: { icon: ReactNode; label: string; onClick: () => void; last?: boolean }) {
  return (
    <div
      className={`flex cursor-pointer items-center gap-3 px-4 py-3 text-[13px] transition-colors hover:bg-[#f5f8fd] ${last ? '' : 'border-b border-[#f0f3f7]'}`}
      style={{ color: '#5b6a80' }}
      onClick={onClick}
    >
      <span className="text-base" style={{ color: '#2f6fed' }}>{icon}</span>
      <span className="flex-1">{label}</span>
      <RightOutlined style={{ fontSize: 11, color: '#c9d2de' }} />
    </div>
  )
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-[13px]">
      <span className="w-[88px] shrink-0" style={{ color: '#8f9aa9' }}>{label}</span>
      <span className="min-w-0 flex-1 break-all" style={{ color: '#15233a' }}>{children}</span>
    </div>
  )
}

/** 复制按钮：写剪贴板失败时退回 execCommand，保证 http 环境下也可用 */
function CopyButton({ text }: { text: string }) {
  const { message } = App.useApp()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      message.success('已复制')
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      if (ok) message.success('已复制')
      else message.error('复制失败，请手动选择文本')
    }
  }
  return (
    <Button size="small" type="text" icon={<CopyOutlined />} className="!h-7 w-7 shrink-0 p-0 text-[#5c6b80]" onClick={copy} />
  )
}
