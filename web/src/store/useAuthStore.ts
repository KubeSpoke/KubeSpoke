import { create } from 'zustand'
import { authApi } from '../api/auth'

/** unknown = 还没问过服务端；authed = 有会话；anon = 明确未登录 */
export type AuthStatus = 'unknown' | 'authed' | 'anon'

/** 强制改密页的路径，守卫和 403 拦截都往这里送 */
export const CHANGE_PASSWORD_PATH = '/change-password'

/** 平台管理员账号名固定，初始化只设口令 */
export const ADMIN_USERNAME = 'admin'

/** 首次安装的口令设置页，守卫据此把人送过去 */
export const INIT_PATH = '/init'

interface AuthState {
  username: string
  status: AuthStatus
  /** 口令还是别人代设的那个值，改密前控制台不让进 */
  mustChangePassword: boolean
  /** 库里还没有任何账号，需要先设置管理员口令 */
  needsInit: boolean
  /** 启动 / 进路由时探测会话，未登录就先去 /login，避免整屏请求被 401 打回 */
  probe: () => Promise<AuthStatus>
  login: (username: string, password: string) => Promise<void>
  init: (password: string) => Promise<void>
  logout: () => Promise<void>
}

/** 同一时刻只允许一个 /auth/me 在飞（StrictMode 双挂载、多处守卫都会复用） */
let probing: Promise<AuthStatus> | null = null

const anon = { username: '', status: 'anon' as AuthStatus, mustChangePassword: false, needsInit: false }

export const useAuthStore = create<AuthState>()((set, get) => ({
  username: '',
  status: 'unknown',
  mustChangePassword: false,
  needsInit: false,

  probe: async () => {
    if (get().status !== 'unknown') return get().status
    if (probing) return probing
    probing = (async () => {
      try {
        if (!(await authApi.status())) {
          // 未初始化时没有账号可登，登录页本身没意义
          set({ ...anon, needsInit: true })
          return 'anon'
        }
        // 200 即视为已登录（契约里未登录是 401）；万一 body 形态有出入，username 留空也比误判成未登录好
        const session = await authApi.me()
        set({ username: session.username, mustChangePassword: session.mustChangePassword, status: 'authed' })
      } catch {
        set(anon)
      }
      return get().status
    })().finally(() => {
      probing = null
    })
    return probing
  },

  login: async (username, password) => {
    try {
      const session = await authApi.login(username, password)
      set({ username: session.username, mustChangePassword: session.mustChangePassword, status: 'authed', needsInit: false })
    } catch (e) {
      const res = (e as { response?: { status?: number; data?: { message?: string } } }).response
      if (res?.status === 401) throw new Error(res.data?.message ?? '用户名或密码错误')
      if (res?.status) throw new Error(res.data?.message ?? `登录失败（${res.status}）`)
      throw e
    }
  },

  init: async (password) => {
    try {
      const session = await authApi.init(password)
      set({ username: session.username, mustChangePassword: false, status: 'authed', needsInit: false })
    } catch (e) {
      const res = (e as { response?: { status?: number; data?: { message?: string } } }).response
      if (res?.status === 409) {
        // 别人已经初始化过了，本地那个 needsInit 是旧结论，回登录页重新探一次
        set(anon)
        probing = null
        throw new Error(res.data?.message ?? '系统已初始化，请登录')
      }
      if (res?.status) throw new Error(res.data?.message ?? `设置失败（${res.status}）`)
      throw e
    }
  },

  logout: async () => {
    try {
      await authApi.logout()
    } catch {
      // 会话已失效也要清掉本地状态，保证 UI 回到未登录
    }
    set(anon)
  },
}))
