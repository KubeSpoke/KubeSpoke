import axios from 'axios'

/**
 * 服务端 BXExceptionFilter 会把异常包成 { success:false, message } 且状态码仍为 200，
 * 因此错误判断必须看响应体而不是 HTTP 状态。
 */
export const http = axios.create({ baseURL: '/api', timeout: 120000 })

http.interceptors.response.use(
  (response) => {
    const body = response.data
    if (body && typeof body === 'object' && body.success === false) {
      throw new Error(body.message || '请求失败')
    }
    return response
  },
  (error) => {
    // 未登录（含会话过期）统一去登录页，并把当前页面带成 redirect 参数。
    // /auth/* 自己的 401 属于「用户名密码错误」这类业务反馈，交给调用方处理。
    const status = error.response?.status as number | undefined
    const url: string = (error.config as { url?: string } | undefined)?.url ?? ''
    if (status === 401 && !url.startsWith('/auth/')) redirectToLogin()
    // 初始口令没改之前服务端拦掉所有业务接口，整页送回去改密
    if (status === 403 && error.response?.data?.code === 'must_change_password') {
      if (typeof window !== 'undefined' && window.location.pathname !== CHANGE_PASSWORD_PATH) {
        window.location.replace(CHANGE_PASSWORD_PATH)
      }
    }
    return Promise.reject(error)
  },
)

/** 与 store/useAuthStore 同一个常量，这里本地声明以免 http 反向依赖 store */
const CHANGE_PASSWORD_PATH = '/change-password'

/** 整页跳到 /login：绕开路由守卫，顺带把 zustand 里的脏数据清干净 */
function redirectToLogin() {
  if (typeof window === 'undefined') return
  const { pathname, search } = window.location
  if (pathname === '/login') return
  window.location.replace(`/login?redirect=${encodeURIComponent(pathname + search)}`)
}

export const get = async <T>(url: string, params?: Record<string, unknown>): Promise<T> => {
  const { data } = await http.get<T>(url, { params })
  return data
}

export const post = async <T>(url: string, body?: unknown): Promise<T> => {
  const { data } = await http.post<T>(url, body)
  return data
}

export const del = async <T>(url: string, params?: Record<string, unknown>): Promise<T> => {
  const { data } = await http.delete<T>(url, { params })
  return data
}
