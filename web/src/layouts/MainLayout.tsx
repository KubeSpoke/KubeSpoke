import {
  LockOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Avatar, Badge, Dropdown, Layout, Menu, Select, Space, Tooltip, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { topScopes, clusterPath } from '../config/nav'
import type { NavGroup, NavItem } from '../config/nav'
import { alertApi } from '../api/alerts'
import { ChangePasswordModal } from '../components/ChangePasswordModal'
import BrandMark from '../components/BrandMark'
import { useAuthStore } from '../store/useAuthStore'
import { useClusterStore } from '../store/useClusterStore'

const { Header, Sider, Content } = Layout

/** 展开分组菜单为扁平条目，用于选中匹配与面包屑 */
function flatten(groups: NavGroup[]) {
  const rows: { key: string; label: string; group?: string }[] = []
  for (const g of groups) for (const it of g.items) rows.push({ key: it.key, label: it.label, group: g.title })
  return rows
}

/** 依据路径推断当前作用域（顶栏切换） */
function scopeOf(pathname: string) {
  if (pathname.startsWith('/access')) return topScopes.find((s) => s.key === 'access') ?? topScopes[0]
  return topScopes.find((s) => s.key === 'clusters') ?? topScopes[0]
}

/** 解析 /clusters/<集群标识>/<子路径>；集群管理列表本身没有集群段 */
function parseClusterPath(pathname: string) {
  const m = /^\/clusters\/([^/]+)(\/.*)?$/.exec(pathname)
  if (!m) return { urlCluster: '', sub: '' }
  return { urlCluster: decodeURIComponent(m[1]), sub: m[2] ? m[2].slice(1) : '' }
}

export function MainLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const { agents, cluster, loadAgents, loadingAgents } = useClusterStore()
  const username = useAuthStore((s) => s.username)
  const signOut = useAuthStore((s) => s.logout)

  /** 清掉会话再回登录页，避免守卫先把 redirect 带回主界面 */
  const doLogout = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  /** 在告且没人确认过的条数，和采集同节奏（一分钟）刷一次角标 */
  const [unackedAlerts, setUnackedAlerts] = useState(0)
  useEffect(() => {
    const load = () => alertApi.unackedCount().then(setUnackedAlerts).catch(() => setUnackedAlerts(0))
    void load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [])

  const navLabel = (item: NavItem) =>
    item.key === '/alerts' && unackedAlerts > 0 ? (
      <Badge count={unackedAlerts} size="small" offset={[10, 0]}>
        {item.label}
      </Badge>
    ) : (
      item.label
    )

  const scope = useMemo(() => scopeOf(location.pathname), [location.pathname])

  /** 集群管理是独立整页：不挂左侧菜单与面包屑，只保留顶栏 */
  const bare = location.pathname === '/clusters'
  const { urlCluster, sub } = useMemo(() => parseClusterPath(location.pathname), [location.pathname])
  /** 菜单与跳转用哪个集群：以 URL 集群段为准，旧路径重定向期间回落到 store 里的当前集群 */
  const scopedCluster = urlCluster || cluster

  /** 相对子路径（overview / res/pods）补成完整路由；其他作用域已是绝对路径 */
  const to = (key: string) => (key.startsWith('/') ? key : clusterPath(scopedCluster, key))

  const flat = useMemo(() => flatten(scope.nav), [scope])

  /** 切换集群：保持当前子页面，只换 URL 里的集群段 */
  const switchCluster = (id: string) => navigate(clusterPath(id, sub || 'overview'))

  // 选中项：按最长前缀匹配（详情页 res/:key/:name 归到 res/:key）
  const selectedKey = useMemo(() => {
    let best = ''
    for (const r of flat) {
      const path = to(r.key)
      if (location.pathname === path || location.pathname.startsWith(path + '/')) {
        if (path.length > best.length) best = path
      }
    }
    return best || scope.path
  }, [flat, location.pathname, scope.path, scopedCluster])

  const menuItems = useMemo(
    () =>
      scope.nav.map((g, gi) =>
        g.title
          ? {
              key: `g${gi}`,
              label: (
                <span style={{ fontSize: 12, color: '#a0aab8', fontWeight: 500 }}>{g.title}</span>
              ),
              type: 'group' as const,
              children: g.items.map((it) => ({ key: to(it.key), icon: it.icon, label: navLabel(it) })),
            }
          : { key: `u${gi}`, type: 'group' as const, children: g.items.map((it) => ({ key: to(it.key), icon: it.icon, label: navLabel(it) })) },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, scopedCluster, unackedAlerts],
  )

  return (
    <Layout className="h-full">
      {/* 顶栏：品牌 + 作用域切换 + 集群选择 + 用户 */}
      <Header className="ks-topbar !sticky !top-0 z-20 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div
            className="flex cursor-pointer items-center gap-2"
            onClick={() => navigate('/clusters')}
          >
            <BrandMark size={26} />
            <Typography.Text strong style={{ fontSize: 16, color: '#24292e', letterSpacing: 0.2 }}>
              KubeSpoke
            </Typography.Text>
          </div>
          {!bare && (
            <Space size={8}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                当前集群
              </Typography.Text>
              <Select
                size="small"
                style={{ minWidth: 180 }}
                value={scopedCluster || undefined}
                placeholder={loadingAgents ? '加载中…' : '无在线集群'}
                loading={loadingAgents}
                onChange={switchCluster}
                options={agents.map((a) => ({ label: a.name, value: a.name }))}
                notFoundContent={agents.length ? '无匹配集群' : '没有已接入的集群'}
                showSearch={{ optionFilterProp: 'label' }}
                variant="filled"
                className="cursor-pointer"
                labelRender={(item) => (
                  <span className="flex items-center gap-1.5 font-medium text-[#15233a]">
                    <img src="/kubernetes.svg" alt="" className="h-[15px] w-[15px]" />
                    {item.label}
                  </span>
                )}
              />
            </Space>
          )}
        </div>

        <Space size={14}>
          <Tooltip title="GitHub 仓库">
            <a
              href="https://github.com/KubeSpoke/KubeSpoke"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub 仓库"
              className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[#eef1f5]"
            >
              <img src="/github.svg" alt="" className="h-[18px] w-[18px]" />
            </a>
          </Tooltip>
          <Tooltip title="Gitee 仓库">
            <a
              href="https://gitee.com/KubeSpoke/KubeSpoke"
              target="_blank"
              rel="noreferrer"
              aria-label="Gitee 仓库"
              className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[#eef1f5]"
            >
              <img src="/gitee.svg" alt="" className="h-[18px] w-[18px]" />
            </a>
          </Tooltip>
          <Dropdown
            menu={{
              items: [
                { key: 'user', label: username || '已登录', disabled: true },
                { type: 'divider' },
                { key: 'settings', label: '个人设置', icon: <UserOutlined /> },
                { key: 'password', label: '修改密码', icon: <LockOutlined /> },
                { type: 'divider' },
                { key: 'logout', label: '退出登录', icon: <LogoutOutlined /> },
              ],
              onClick: ({ key }) => {
                if (key === 'settings') navigate(scopedCluster ? clusterPath(scopedCluster, 'settings/base-info') : '/clusters')
                if (key === 'password') setPasswordOpen(true)
                if (key === 'logout') void doLogout()
              },
            }}
          >
            <Space size={8} style={{ cursor: 'pointer' }}>
              <Avatar size={26} style={{ background: '#329dce', fontSize: 13, fontWeight: 600 }}>
                {username ? username.slice(0, 1).toUpperCase() : <UserOutlined />}
              </Avatar>
              {username && (
                <Typography.Text style={{ fontSize: 12, color: '#36435c' }} ellipsis={{ tooltip: username }}>
                  {username}
                </Typography.Text>
              )}
            </Space>
          </Dropdown>
          <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
        </Space>
      </Header>

      <Layout className="min-h-0 overflow-hidden">
        {/* 上下文左侧菜单（随顶栏作用域切换） */}
        {!bare && (
        <Sider
          theme="light"
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={240}
          collapsedWidth={64}
          className="ks-sider border-r border-[#d8dee5]"
        >
          <div className="ks-sider-scroll min-h-0 flex-1 overflow-y-auto" style={{ paddingBottom: 48 }}>
            <Menu
              className="ks-menu !border-r-0"
              mode="inline"
              items={menuItems}
              selectedKeys={[selectedKey]}
              onClick={({ key }) => key.startsWith('/') && navigate(key)}
              style={{ borderInlineEnd: 'none', padding: '10px 0 4px' }}
            />
          </div>
        </Sider>
        )}

        <Content className="overflow-auto">
          <div style={{ padding: 24 }}>
            {!cluster && !loadingAgents && !sub.startsWith('settings') && (
              <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                当前没有在线集群 Agent，请先在「集群设置」按安装清单部署 kubespoke-agent。
              </div>
            )}
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}
