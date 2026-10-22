import {
  AlertOutlined,
  ApartmentOutlined,
  BarChartOutlined,
  BlockOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  ClusterOutlined,
  ContainerOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FileTextOutlined,
  FunctionOutlined,
  GlobalOutlined,
  HddOutlined,
  HistoryOutlined,
  KeyOutlined,
  PartitionOutlined,
  RetweetOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type { ReactNode } from 'react'

/** 顶栏作用域切换（对齐 KubeSphere 顶部 平台 / 集群 / 应用 等入口） */
export interface TopScope {
  key: string
  label: string
  icon: ReactNode
  /** 落地路径 */
  path: string
  /** 该作用域左侧菜单 */
  nav: NavGroup[]
  disabled?: boolean
  hint?: string
}

/** 左侧菜单分组（KubeSphere 的分组小标题 + 条目） */
export interface NavItem {
  key: string // 集群作用域＝相对子路径（overview / res/pods）；其他作用域＝绝对路由
  label: string
  icon?: ReactNode
}
export interface NavGroup {
  title?: string
  items: NavItem[]
}

/** 通用 K8s 资源描述符：驱动资源列表页 / 详情页 */
export interface ResourceDescriptor {
  key: string // 路由段 res/:key
  label: string // 中文菜单名
  kind: string // K8s Kind
  group: string // '' 表示 core
  version: string
  plural: string
  scope: 'Namespaced' | 'Cluster'
  icon?: ReactNode
  /** 列表副标题（名称列下的次要信息字段路径） */
  subField?: string
  /** 状态派生方式 */
  statusKind?: 'conditions' | 'phase' | 'readyReplicas' | 'none'
  /** 有专属详情页时，覆盖默认的通用详情路由（返回集群作用域内的相对子路径，如 Pod） */
  detailPathFor?: (o: { metadata?: { name?: string; namespace?: string } }) => string
}

/** 集群作用域路由：/clusters/<集群标识>/<子路径> */
export const clusterPath = (clusterId: string, sub = ''): string => {
  const base = `/clusters/${encodeURIComponent(clusterId)}`
  const s = sub.replace(/^\/+/, '')
  return s ? `${base}/${s}` : base
}

// ---------------------------------------------------------------- 集群管理左侧菜单
// 1:1 KubeSphere v4.2 集群控制台左侧导航（本机 localhost:30880 实测抓取）：
// 概览 / 集群节点 / 项目 ｜ 工作负载(部署·有状态副本集·守护进程集·任务·定时任务·容器组·工作负载模板)
// ｜ 服务与网络(服务·应用路由) ｜ 存储(持久卷声明·存储类)
// ｜ 配置(保密字典·配置字典·服务帐户·定制资源定义) ｜ 集群设置(基本信息·集群可见性·集群角色·集群成员)
// key 为集群作用域内的相对子路径，渲染时由 clusterPath(当前集群, key) 拼成完整路由。
export const clusterNav: NavGroup[] = [
  {
    items: [
      { key: 'overview', label: '概览', icon: <BarChartOutlined /> },
      { key: 'nodes', label: '节点管理', icon: <CloudServerOutlined /> },
      { key: 'projects', label: '项目', icon: <ApartmentOutlined /> },
    ],
  },
  {
    title: '工作负载',
    items: [
      { key: 'workloads', label: '工作负载', icon: <DeploymentUnitOutlined /> },
      { key: 'res/pods', label: '容器组', icon: <ContainerOutlined /> },
      { key: 'res/workloadtemplates', label: '工作负载模板', icon: <FileTextOutlined /> },
    ],
  },
  {
    title: '服务与发现',
    items: [
      { key: 'services', label: 'Service', icon: <GlobalOutlined /> },
      { key: 'services/ingresses', label: 'Ingress', icon: <PartitionOutlined /> },
      { key: 'services/dns', label: 'DNS', icon: <ApartmentOutlined /> },
      { key: 'services/endpoints', label: 'Endpoint', icon: <ThunderboltOutlined /> },
    ],
  },
  {
    title: '存储',
    items: [
      { key: 'res/persistentvolumeclaims', label: '持久卷声明', icon: <DatabaseOutlined /> },
      { key: 'res/storageclasses', label: '存储类', icon: <SettingOutlined /> },
    ],
  },
  {
    title: '配置',
    items: [
      { key: 'res/secrets', label: '保密字典', icon: <KeyOutlined /> },
      { key: 'res/configmaps', label: '配置字典', icon: <FileTextOutlined /> },
      { key: 'res/serviceaccounts', label: '服务帐户', icon: <TeamOutlined /> },
      { key: 'res/customresourcedefinitions', label: '定制资源定义', icon: <FunctionOutlined /> },
    ],
  },
  {
    title: '集群设置',
    items: [
      { key: 'settings/base-info', label: '基本信息', icon: <FileTextOutlined /> },
      { key: 'settings/visibility', label: '集群可见性', icon: <GlobalOutlined /> },
      { key: 'settings/roles', label: '集群角色', icon: <SafetyCertificateOutlined /> },
      { key: 'settings/members', label: '集群成员', icon: <TeamOutlined /> },
    ],
  },
  {
    // 这两页是平台级的，不随当前集群走，所以 key 用绝对路径（MainLayout 按 / 前缀直通）
    title: '平台运维',
    items: [
      { key: '/alerts', label: '告警中心', icon: <AlertOutlined /> },
      { key: '/audit', label: '审计日志', icon: <HistoryOutlined /> },
      { key: '/settings', label: '系统设置', icon: <SettingOutlined /> },
    ],
  },
]

// ---------------------------------------------------------------- 顶栏作用域
export const topScopes: TopScope[] = [
  {
    key: 'clusters',
    label: '集群管理',
    icon: <ClusterOutlined />,
    path: '/clusters',
    nav: clusterNav,
  },
  {
    key: 'access',
    label: '访问控制',
    icon: <TeamOutlined />,
    path: '/access',
    nav: [
      {
        items: [
          { key: '/access', label: '用户', icon: <TeamOutlined /> },
          { key: '/access/roles', label: '角色', icon: <SafetyCertificateOutlined /> },
        ],
      },
    ],
  },
]

// ---------------------------------------------------------------- 通用资源描述符
// 这些页面通过后端通用 K8s 接口读写，覆盖 KubeSphere 集群管理下尚未有专属页面的资源。
export const resourceDescriptors: Record<string, ResourceDescriptor> = {
  pods: {
    key: 'pods', label: '容器组', kind: 'Pod', group: '', version: 'v1',
    plural: 'pods', scope: 'Namespaced', icon: <ContainerOutlined />, statusKind: 'phase',
    detailPathFor: (o) => `pods/${o.metadata?.namespace ?? 'default'}/${o.metadata?.name ?? ''}`,
  },
  services: {
    key: 'services', label: '服务', kind: 'Service', group: '', version: 'v1',
    plural: 'services', scope: 'Namespaced', icon: <GlobalOutlined />, statusKind: 'none',
  },
  ingresses: {
    key: 'ingresses', label: '应用路由', kind: 'Ingress', group: 'networking.k8s.io', version: 'v1',
    plural: 'ingresses', scope: 'Namespaced', icon: <PartitionOutlined />, statusKind: 'none',
  },
  endpoints: {
    key: 'endpoints', label: 'Endpoint', kind: 'Endpoints', group: '', version: 'v1',
    plural: 'endpoints', scope: 'Namespaced', icon: <ThunderboltOutlined />, statusKind: 'none',
  },
  statefulsets: {
    key: 'statefulsets', label: '有状态副本集', kind: 'StatefulSet', group: 'apps', version: 'v1',
    plural: 'statefulsets', scope: 'Namespaced', icon: <BlockOutlined />, statusKind: 'readyReplicas',
  },
  daemonsets: {
    key: 'daemonsets', label: '守护进程集', kind: 'DaemonSet', group: 'apps', version: 'v1',
    plural: 'daemonsets', scope: 'Namespaced', icon: <RetweetOutlined />, statusKind: 'readyReplicas',
  },
  jobs: {
    key: 'jobs', label: '任务', kind: 'Job', group: 'batch', version: 'v1',
    plural: 'jobs', scope: 'Namespaced', icon: <ThunderboltOutlined />, statusKind: 'conditions',
  },
  cronjobs: {
    key: 'cronjobs', label: '定时任务', kind: 'CronJob', group: 'batch', version: 'v1',
    plural: 'cronjobs', scope: 'Namespaced', icon: <ClockCircleOutlined />, statusKind: 'none',
  },
  serviceaccounts: {
    key: 'serviceaccounts', label: '服务帐户', kind: 'ServiceAccount', group: '', version: 'v1',
    plural: 'serviceaccounts', scope: 'Namespaced', icon: <TeamOutlined />, statusKind: 'none',
  },
  secrets: {
    key: 'secrets', label: '保密字典', kind: 'Secret', group: '', version: 'v1',
    plural: 'secrets', scope: 'Namespaced', icon: <KeyOutlined />, statusKind: 'none',
  },
  configmaps: {
    key: 'configmaps', label: '配置字典', kind: 'ConfigMap', group: '', version: 'v1',
    plural: 'configmaps', scope: 'Namespaced', icon: <FileTextOutlined />, statusKind: 'none',
  },
  persistentvolumeclaims: {
    key: 'persistentvolumeclaims', label: '持久卷声明', kind: 'PersistentVolumeClaim', group: '', version: 'v1',
    plural: 'persistentvolumeclaims', scope: 'Namespaced', icon: <DatabaseOutlined />, statusKind: 'phase',
  },
  workloadtemplates: {
    key: 'workloadtemplates', label: '工作负载模板', kind: 'Template', group: 'templating.kubesphere.io',
    version: 'v1alpha1', plural: 'templates', scope: 'Namespaced', icon: <FileTextOutlined />, statusKind: 'none',
  },
  roles: {
    key: 'roles', label: '角色', kind: 'Role', group: 'rbac.authorization.k8s.io', version: 'v1',
    plural: 'roles', scope: 'Namespaced', icon: <SafetyCertificateOutlined />, statusKind: 'none',
  },
  clusterroles: {
    key: 'clusterroles', label: '集群角色', kind: 'ClusterRole', group: 'rbac.authorization.k8s.io', version: 'v1',
    plural: 'clusterroles', scope: 'Cluster', icon: <SafetyCertificateOutlined />, statusKind: 'none',
  },
  persistentvolumes: {
    key: 'persistentvolumes', label: '持久卷', kind: 'PersistentVolume', group: '', version: 'v1',
    plural: 'persistentvolumes', scope: 'Cluster', icon: <HddOutlined />, statusKind: 'phase',
  },
  storageclasses: {
    key: 'storageclasses', label: '存储类', kind: 'StorageClass', group: 'storage.k8s.io', version: 'v1',
    plural: 'storageclasses', scope: 'Cluster', icon: <SettingOutlined />, statusKind: 'none',
  },
  customresourcedefinitions: {
    key: 'customresourcedefinitions', label: '定制资源定义', kind: 'CustomResourceDefinition',
    group: 'apiextensions.k8s.io', version: 'v1', plural: 'customresourcedefinitions',
    scope: 'Cluster', icon: <FunctionOutlined />, statusKind: 'conditions',
  },
}

export const findDescriptor = (key?: string): ResourceDescriptor | undefined =>
  (key && resourceDescriptors[key]) || undefined
