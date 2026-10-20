import { Spin } from 'antd'
import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { CHANGE_PASSWORD_PATH, INIT_PATH, useAuthStore } from '../store/useAuthStore'

/**
 * 登录墙：先探一次会话，未初始化先去 /init 设管理员口令，未登录直接去 /login 并带上原路径。
 * 放在 MainLayout 外层，保证守卫通过后页面里的请求不会成批 401。
 * 已登录但还在用代设口令的，只能停在改密页。
 */
export function RequireAuth() {
  const status = useAuthStore((s) => s.status)
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword)
  const needsInit = useAuthStore((s) => s.needsInit)
  const probe = useAuthStore((s) => s.probe)
  const location = useLocation()

  useEffect(() => {
    void probe()
  }, [probe])

  if (status === 'authed') {
    const onChangePasswordPage = location.pathname === CHANGE_PASSWORD_PATH
    if (mustChangePassword && !onChangePasswordPage) return <Navigate to={CHANGE_PASSWORD_PATH} replace />
    if (!mustChangePassword && onChangePasswordPage) return <Navigate to="/clusters" replace />
    return <Outlet />
  }

  if (status === 'unknown') {
    return (
      <div className="grid h-full place-items-center">
        <Spin />
      </div>
    )
  }

  const redirect = encodeURIComponent(location.pathname + location.search)
  return <Navigate to={needsInit ? INIT_PATH : `/login?redirect=${redirect}`} replace />
}
