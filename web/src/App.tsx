import { Button, Empty } from 'antd'
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { RequireAuth } from './components/RequireAuth'
import { MainLayout } from './layouts/MainLayout'
import { clusterPath } from './config/nav'
import AlertsPage from './pages/AlertsPage'
import AuditPage from './pages/AuditPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import ClustersManagePage from './pages/ClustersManagePage'
import DashboardPage from './pages/DashboardPage'
import DeploymentDetailPage from './pages/DeploymentDetailPage'
import InitPage from './pages/InitPage'
import LoginPage from './pages/LoginPage'
import NodeDetailPage from './pages/NodeDetailPage'
import NodesPage from './pages/NodesPage'
import PodDetailPage from './pages/PodDetailPage'
import ProjectsPage from './pages/ProjectsPage'
import RecycleBinPage from './pages/RecycleBinPage'
import ResourceDetailPage from './pages/ResourceDetailPage'
import ResourceListPage from './pages/ResourceListPage'
import ServicesPage from './pages/ServicesPage'
import SystemSettingsPage from './pages/SystemSettingsPage'
import WorkloadsPage from './pages/WorkloadsPage'
import BaseInfoPage from './pages/settings/BaseInfoPage'
import ClusterRolesPage from './pages/settings/ClusterRolesPage'
import MembersPage from './pages/settings/MembersPage'
import VisibilityPage from './pages/settings/VisibilityPage'
import { useClusterStore } from './store/useClusterStore'

/** 集群管理（列表）；进入某个集群后，所有页面统一挂在 /clusters/<集群标识>/ 下 */
const CLUSTERS = '/clusters'

/** 旧路径（不带集群段）→ 当前集群下的同名子路径 */
const legacyRoutes: [path: string, sub: string][] = [
  ['/clusters/overview', 'overview'],
  ['/clusters/nodes', 'nodes'],
  ['/clusters/projects', 'projects'],
  ['/clusters/workloads', 'workloads'],
  ['/clusters/services', 'services'],
  ['/clusters/network', 'services'],
  ['/clusters/storage', 'res/persistentvolumeclaims'],
  ['/clusters/config', 'res/configmaps'],
  ['/clusters/canary', 'overview'],
  ['/clusters/events', 'overview'],
  ['/clusters/logs', 'res/pods'],
  ['/clusters/settings', 'settings/base-info'],
  ['/nodes', 'nodes'],
  ['/workloads', 'workloads'],
  ['/network', 'services'],
  ['/storage', 'res/persistentvolumeclaims'],
  ['/config', 'res/configmaps'],
  ['/canary', 'overview'],
  ['/events', 'overview'],
  ['/logs', 'res/pods'],
]

/** 平台/工作空间层（KubeSphere IAM）占位：本模块起步聚焦「集群管理」 */
function PlatformPlaceholder({ title }: { title: string }) {
  const navigate = useNavigate()
  return (
    <Empty
      description={
        <span>
          「{title}」属于平台 / 企业空间层的访问控制能力，本次聚焦集群管理。可先前往集群管理。
        </span>
      }
      className="py-24"
    >
      <Button type="primary" onClick={() => navigate(CLUSTERS)}>
        返回集群管理
      </Button>
    </Empty>
  )
}

/** /clusters/<集群标识> → 该集群概览 */
function ClusterHome() {
  const { clusterId } = useParams()
  return <Navigate to={clusterPath(clusterId ?? '', 'overview')} replace />
}

/** 集群作用域内的重定向：sub 为相对子路径 */
function ClusterSubRedirect({ sub }: { sub: string }) {
  const { clusterId } = useParams()
  return <Navigate to={clusterPath(clusterId ?? '', sub)} replace />
}

/** 旧路径补上集群段；没有当前集群时回集群管理列表 */
function LegacyClusterRedirect({ sub }: { sub: string }) {
  const cluster = useClusterStore((s) => s.cluster)
  const location = useLocation()
  if (!cluster) return <Navigate to={CLUSTERS} replace />
  return <Navigate to={`${clusterPath(cluster, sub)}${location.search}`} replace />
}

/** URL 里的集群段即当前集群：切集群一律走路由，这里负责把集群段同步进 store */
function ClusterScope() {
  const raw = useParams<{ clusterId: string }>().clusterId
  const clusterId = raw ? decodeURIComponent(raw) : ''
  const cluster = useClusterStore((s) => s.cluster)
  const setCluster = useClusterStore((s) => s.setCluster)

  useEffect(() => {
    if (clusterId && clusterId !== cluster) setCluster(clusterId)
  }, [clusterId, cluster, setCluster])

  return <Outlet />
}

export default function App() {
  return (
    <Routes>
      {/* 公开路由：登录页 */}
      <Route path="/login" element={<LoginPage />} />

      {/* 首次安装：还没有账号时先设管理员口令 */}
      <Route path="/init" element={<InitPage />} />

      {/* 已登录但口令还是初始值的账号只能停在这里，所以放在 MainLayout 外层 */}
      <Route element={<RequireAuth />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />

        {/* 集群接入收进集群管理页的「添加集群」抽屉；旧路径直接重定向，不套布局 */}
        <Route path="/clusters/list" element={<Navigate to={`${CLUSTERS}?add=1`} replace />} />
        {legacyRoutes.map(([path, sub]) => (
          <Route key={path} path={path} element={<LegacyClusterRedirect sub={sub} />} />
        ))}

        <Route element={<MainLayout />}>
          <Route index element={<Navigate to={CLUSTERS} replace />} />

          {/* 集群管理：1:1 KubeSphere v4 集群控制台 22 项导航 */}
          <Route path={CLUSTERS} element={<ClustersManagePage />} />

          <Route path="/clusters/:clusterId" element={<ClusterScope />}>
            <Route index element={<ClusterHome />} />
            <Route path="overview" element={<DashboardPage />} />
            <Route path="nodes" element={<NodesPage />} />
            <Route path="nodes/:name" element={<NodeDetailPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="workloads" element={<WorkloadsPage />} />
            <Route path="services/:tab?" element={<ServicesPage />} />
            <Route path="deployments" element={<ClusterSubRedirect sub="workloads" />} />
            <Route path="deployments/:namespace/:name" element={<DeploymentDetailPage />} />

            {/* 通用 K8s 资源列表/详情（跨所有项目，对齐 KubeSphere 列结构） */}
            <Route path="res/services" element={<ClusterSubRedirect sub="services" />} />
            <Route path="res/ingresses" element={<ClusterSubRedirect sub="services/ingresses" />} />
            <Route path="res/:key" element={<ResourceListPage />} />
            <Route path="res/:key/:namespace/:name" element={<ResourceDetailPage />} />
            <Route path="res/:key/:name" element={<ResourceDetailPage />} />
            <Route path="pods/:namespace/:name" element={<PodDetailPage />} />

            {/* 集群设置 */}
            <Route path="settings" element={<ClusterSubRedirect sub="settings/base-info" />} />
            <Route path="settings/base-info" element={<BaseInfoPage />} />
            <Route path="settings/visibility" element={<VisibilityPage />} />
            <Route path="settings/roles" element={<ClusterRolesPage />} />
            <Route path="settings/members" element={<MembersPage />} />
          </Route>

          {/* 平台层作用域（占位） */}
          <Route path="/access" element={<PlatformPlaceholder title="用户与访问控制" />} />
          <Route path="/access/roles" element={<PlatformPlaceholder title="平台角色" />} />

          {/* 平台运维：跨集群的告警与写操作留痕 */}
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/recycle" element={<RecycleBinPage />} />

          {/* 控制台自身参数，不属于任何集群 */}
          <Route path="/settings" element={<SystemSettingsPage />} />

          <Route path="*" element={<Navigate to={CLUSTERS} replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
