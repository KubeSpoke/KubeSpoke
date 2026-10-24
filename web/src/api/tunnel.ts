import { get, post } from './http'

/** HTTP 子域名穿透条目 */
export interface TunnelWeb {
  localIp: string
  localPort: number
  subDomain: string
}

/** TCP/UDP 端口转发条目 */
export interface TunnelForward {
  localIp: string
  localPort: number
  remotePort: number
  protocol: string
}

/** 一条隧道：服务端 TunnelController.List 的投影（camelCase，token 不回传） */
export interface TunnelRow {
  id: number
  cluster: string
  name: string
  namespace: string
  podName: string
  image: string
  serverAddr: string
  serverPort: number
  hasToken: boolean
  webs: TunnelWeb[]
  forwards: TunnelForward[]
  createdBy: string
  createdAt: string
}

/** 隧道的实时 Pod 状态，按需查 */
export interface TunnelStatus {
  id: number
  podName: string
  phase: string
  ready: boolean
  startTime?: string | null
  podIp?: string
}

export interface TunnelCreatePayload {
  clustName: string
  name: string
  namespace: string
  image?: string
  serverAddr: string
  serverPort: number
  token?: string
  webs: TunnelWeb[]
  forwards: TunnelForward[]
}

export interface TunnelDefaults {
  image: string
  serverPort: number
}

export const tunnelApi = {
  list: (cluster: string) => get<{ items: TunnelRow[] }>('/Tunnel/List', { cluster }),
  status: (id: number) => get<TunnelStatus>('/Tunnel/Status', { id }),
  create: (payload: TunnelCreatePayload) => post<TunnelRow>('/Tunnel/Create', payload),
  delete: (id: number) => post<boolean>(`/Tunnel/Delete?id=${encodeURIComponent(id)}`),
  defaults: () => get<TunnelDefaults>('/Tunnel/Defaults'),
}
