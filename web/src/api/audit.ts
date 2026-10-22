import { get } from './http'

/** 审计日志一行：后端 camelCase，time 已带本地时区偏移，交给 utils/format 的 datetime 渲染 */
export interface AuditRow {
  id: number
  time: string
  actor: string
  action: string
  cluster: string
  namespace: string
  resource: string
  detail: string
  ip: string
  success: boolean
  message: string
}

export interface AuditPage {
  total: number
  items: AuditRow[]
}

/** GET /api/Audit/List：take/skip 分页，keyword 命中 action/resource/namespace/detail/message，success 省略即全部 */
export const auditApi = {
  list: (params: {
    cluster?: string
    keyword?: string
    success?: boolean
    take?: number
    skip?: number
  }) => {
    const query: Record<string, unknown> = {
      take: params.take ?? 50,
      skip: params.skip ?? 0,
    }
    if (params.cluster) query.cluster = params.cluster
    if (params.keyword) query.keyword = params.keyword
    if (params.success !== undefined) query.success = params.success
    return get<AuditPage>('/Audit/List', query)
  },
}
