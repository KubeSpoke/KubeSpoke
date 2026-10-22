import { get, post } from './http'

/** 一条告警：服务端 AlertController.List 的 JSON 字段（camelCase，时间已由服务端转成本地时区） */
export interface AlertRow {
  id: number
  cluster: string
  /** 信号类型：NodeNotReady / PodContainerWaiting / PodFailed / DeploymentUnderReplicas / WarningEvent */
  kind: string
  namespace: string
  resource: string
  reason: string
  message: string
  severity: 'critical' | 'warning' | string
  count: number
  firstSeen: string
  lastSeen: string
  resolvedAt: string | null
  /** 静默到期时间；还没到点就不推送、也不计进未确认角标 */
  muteUntil: string | null
  acked: boolean
  ackedBy: string
  ackedAt: string | null
}

export interface AlertPage {
  total: number
  items: AlertRow[]
}

export interface AlertListParams {
  state?: 'active' | 'resolved' | 'all'
  cluster?: string
  severity?: 'critical' | 'warning'
  take?: number
  skip?: number
}

/** 通用 Webhook 通知渠道：服务端只存 id 和 url */
export interface AlertChannel {
  id: number
  url: string
}

/** 一次推送的投递回执 */
export interface AlertNotifyLog {
  id: number
  time: string
  cluster: string
  url: string
  firing: number
  resolved: number
  success: boolean
  /** 成功时是 HTTP 状态码，失败时是状态码或异常消息 */
  message: string
}

export const alertApi = {
  list: (params: AlertListParams) => get<AlertPage>('/Alert/List', { ...params }),

  /** 侧栏角标用的未确认条数，服务端直接回一个裸数字 */
  unackedCount: () => get<number>('/Alert/UnackedCount'),

  /** id 走 query，没有 body；只对还在告的条目生效 */
  ack: (id: number) => post<boolean>(`/Alert/Ack?id=${encodeURIComponent(id)}`),

  /** GET /Alert/Channels，不分页，裸数组包在 items 里 */
  channels: () => get<{ items: AlertChannel[] }>('/Alert/Channels'),

  /** POST /Alert/AddChannel?url=，同样走 query 没有 body，返回新建的那条 */
  addChannel: (url: string) =>
    post<AlertChannel>(`/Alert/AddChannel?url=${encodeURIComponent(url)}`),

  /** POST /Alert/RemoveChannel?id=，服务端直接回一个裸 bool */
  removeChannel: (id: number) => post<boolean>(`/Alert/RemoveChannel?id=${encodeURIComponent(id)}`),

  /** POST /Alert/Mute?id=&minutes=，minutes 传 0 取消静默；只对还在告的条目生效 */
  mute: (id: number, minutes: number) =>
    post<boolean>(`/Alert/Mute?id=${encodeURIComponent(id)}&minutes=${encodeURIComponent(minutes)}`),

  /** GET /Alert/NotifyLogs，最近几次推送结果，新的在前 */
  notifyLogs: (take = 20) => get<{ items: AlertNotifyLog[] }>('/Alert/NotifyLogs', { take }),
}
