import { http } from './http'

/**
 * 会话接口：服务端只下发 HttpOnly Cookie，前端不持有 token，也不需要做 CSRF。
 * 成功响应一般是裸对象（BXExceptionFilter 只包裹异常），但为兼容可能存在的
 * { success, data } 信封，这里统一从两种形态里取字段。
 */
export interface AuthSession {
  username: string
  /** 口令还是建号时那个值，必须先改密才能用控制台 */
  mustChangePassword: boolean
}

interface InitStatusBody {
  initialized?: boolean
  data?: { initialized?: boolean }
}

interface AuthBody {
  username?: string
  mustChangePassword?: boolean
  data?: { username?: string; mustChangePassword?: boolean }
}

const pickSession = (body: AuthBody | null | undefined, fallbackUsername: string): AuthSession => {
  const source = body?.data ?? body
  return {
    username: source?.username ?? fallbackUsername,
    mustChangePassword: source?.mustChangePassword === true,
  }
}

export const authApi = {
  /** 是否已有账号：未初始化的实例要先进设置口令页，而不是登录页 */
  status: async (): Promise<boolean> => {
    const { data } = await http.get<InitStatusBody>('/auth/status')
    const source = (data as { data?: InitStatusBody })?.data ?? data
    return source?.initialized === true
  },

  /** 首次安装设置管理员口令，成功后服务端已种好会话 */
  init: async (password: string): Promise<AuthSession> => {
    const { data } = await http.post<AuthBody>('/auth/init', { password })
    return pickSession(data, 'admin')
  },

  /** 登录：200 表示会话 cookie 已种上，401 表示用户名或密码错误 */
  login: async (username: string, password: string): Promise<AuthSession> => {
    const { data } = await http.post<AuthBody>('/auth/login', { username, password })
    return pickSession(data, username)
  },

  logout: async (): Promise<void> => {
    await http.post('/auth/logout')
  },

  /** 修改成功后服务端已登出，调用方需清本地会话并回登录页 */
  changePassword: async (oldPassword: string, newPassword: string): Promise<void> => {
    await http.post('/auth/password', { oldPassword, newPassword })
  },

  /** 当前登录用户；未登录时服务端返回 401，axios 会抛出，由调用方按状态码判定 */
  me: async (): Promise<AuthSession> => {
    const { data } = await http.get<AuthBody>('/auth/me')
    return pickSession(data, '')
  },
}
