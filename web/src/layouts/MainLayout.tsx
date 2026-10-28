import {
  LockOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SunOutlined,
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
import { useThemeStore } from '../store/useThemeStore'

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
  /** 折叠状态记在本地：控制台菜单很长，用户收起后多半希望一直保持 */
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('ks.sider') === 'collapsed'
    } catch {
      return false
    }
  })
  const onCollapse = (v: boolean) => {
    setCollapsed(v)
    try {
      localStorage.setItem('ks.sider', v ? 'collapsed' : 'expanded')
    } catch {
      /* 隐私模式写不了，忽略即可 */
    }
  }
  const [passwordOpen, setPasswordOpen] = useState(false)
  const { agents, cluster, loadAgents, loadingAgents } = useClusterStore()
  const username = useAuthStore((s) => s.username)
  const signOut = useAuthStore((s) => s.logout)
  const themeMode = useThemeStore((s) => s.mode)
  const toggleTheme = useThemeStore((s) => s.toggle)

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

  /**
   * 折叠后只剩一列图标：分组标题没有横向空间（会被压成「配…」这种断面），
   * 改成整条隐藏 + 组间留白分隔；菜单名与所属分组移到悬停 tooltip 里。
   */
  const menuItems = useMemo(() => {
    const itemOf = (it: NavItem, groupTitle?: string) => {
      const hot = it.key === '/alerts' && unackedAlerts > 0
      return {
        key: to(it.key),
        // 折叠态角标挂到图标上（label 被隐藏，挂在 label 上就看不见了）
        icon: hot && collapsed ? (
          <Badge dot offset={[2, -1]}>
            <span className="ks-menu-icon-dot">{it.icon}</span>
          </Badge>
        ) : (
          it.icon
        ),
        label: navLabel(it),
        title: collapsed ? (groupTitle ? `${groupTitle} · ${it.label}` : it.label) : undefined,
      }
    }
    return scope.nav.map((g, gi) =>
      g.title
        ? {
            key: `g${gi}`,
            label: (
              <span className="ks-menu-group-label" style={{ fontSize: 12, color: 'var(--ks-faint)', fontWeight: 500 }}>
                {g.title}
              </span>
            ),
            type: 'group' as const,
            children: g.items.map((it) => itemOf(it, g.title)),
          }
        : { key: `u${gi}`, type: 'group' as const, children: g.items.map((it) => itemOf(it)) },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, scopedCluster, unackedAlerts, collapsed])

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
            <Typography.Text strong style={{ fontSize: 16, color: 'var(--ks-ink)', letterSpacing: 0.2 }}>
              KubeSpoke
            </Typography.Text>
          </div>
          {!bare && (
            <Space size={8}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                当前集群
              </Typography.Text>
              {/* 没有在线集群时不摆一个空下拉：灰胶囊既点不开又和筛选器长得一样，改成纯文字提示 */}
              {!loadingAgents && agents.length === 0 ? (
                <Typography.Text style={{ fontSize: 12, color: 'var(--ks-muted)' }}>未接入</Typography.Text>
              ) : (
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
                    <span className="flex items-center gap-1.5 font-medium text-[var(--ks-ink)]">
                      <img src="/kubernetes.svg" alt="" className="h-[15px] w-[15px]" />
                      {item.label}
                    </span>
                  )}
                />
              )}
            </Space>
          )}
        </div>

        <Space size={12}>
          <Space size={2}>
            <Tooltip title="GitHub 仓库">
              <a
                href="https://github.com/KubeSpoke/KubeSpoke"
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub 仓库"
                className="ks-icon-btn"
              >
                <img src="/github.svg" alt="" className="ks-mono-icon h-[18px] w-[18px]" />
              </a>
            </Tooltip>
            <Tooltip title="Gitee 仓库">
              <a
                href="https://gitee.com/KubeSpoke/KubeSpoke"
                target="_blank"
                rel="noreferrer"
                aria-label="Gitee 仓库"
                className="ks-icon-btn"
              >
                <img src="/gitee.svg" alt="" className="ks-mono-icon h-[18px] w-[18px]" />
              </a>
            </Tooltip>
            {/* 主题切换：图标显示的是"点了会切到哪"，暗色下给太阳、亮色下给月亮 */}
            <Tooltip title={themeMode === 'dark' ? '切换到浅色主题' : '切换到暗黑主题'}>
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={themeMode === 'dark' ? '切换到浅色主题' : '切换到暗黑主题'}
                aria-pressed={themeMode === 'dark'}
                className="ks-icon-btn cursor-pointer"
              >
                {themeMode === 'dark' ? (
                  <SunOutlined style={{ fontSize: 17 }} />
                ) : (
                  <MoonOutlined style={{ fontSize: 17 }} />
                )}
              </button>
            </Tooltip>
          </Space>
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
                <Typography.Text style={{ fontSize: 12, color: 'var(--ks-body)' }} ellipsis={{ tooltip: username }}>
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
          onCollapse={onCollapse}
          width={240}
          collapsedWidth={64}
          className="ks-sider"
          trigger={
            <Tooltip title={collapsed ? '展开菜单' : '收起菜单'} placement="right">
              <span
                className="ks-sider-toggle"
                role="button"
                tabIndex={0}
                aria-label={collapsed ? '展开菜单' : '收起菜单'}
                aria-expanded={!collapsed}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onCollapse(!collapsed)
                  }
                }}
              >
                {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              </span>
            </Tooltip>
          }
        >
          {/* 底部预留折叠按钮的高度（46）+ 上方淡出渐变（16），滚到底时最后一项不被压住 */}
          <div className="ks-sider-scroll min-h-0 flex-1 overflow-y-auto" style={{ paddingBottom: 64 }}>
            <Menu
              className="ks-menu !border-r-0"
              mode="inline"
              items={menuItems}
              selectedKeys={[selectedKey]}
              onClick={({ key }) => key.startsWith('/') && navigate(key)}
              style={{ borderInlineEnd: 'none', padding: '6px 0 10px' }}
            />
          </div>
        </Sider>
        )}

        <Content className="overflow-auto">
          <div style={{ padding: '20px 24px 32px' }}>
            {!cluster && !loadingAgents && !sub.startsWith('settings') && (
              <div className="mb-5 rounded-xl px-5 py-3.5 text-sm" style={{ background: 'var(--ks-warn-bg)', color: 'var(--ks-warn-text)' }}>
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
