import { get, post } from './http'

/** 回收站一行：不含原文，YAML 按 id 单独取 */
export interface DeletedRow {
  id: number
  time: string
  actor: string
  cluster: string
  namespace: string
  kind: string
  name: string
  expires: string
  restored?: string | null
}

export interface DeletedPage {
  total: number
  keepDays: number
  items: DeletedRow[]
}

/**
 * 回收站接口。删除走 /RecycleBin/Delete（后端先抓快照再删，抓不到就直接删），
 * 恢复走 /RecycleBin/Restore，id 用查询参数传，和系统设置那类 POST 接口保持一致。
 */
export const recycleApi = {
  list: (params: { cluster?: string; kind?: string; keyword?: string; take?: number; skip?: number }) => {
    const query: Record<string, unknown> = { take: params.take ?? 50, skip: params.skip ?? 0 }
    if (params.cluster) query.cluster = params.cluster
    if (params.kind) query.kind = params.kind
    if (params.keyword) query.keyword = params.keyword
    return get<DeletedPage>('/RecycleBin/List', query)
  },

  yaml: (id: number) => get<{ id: number; yaml: string }>('/RecycleBin/Get', { id }),

  restore: (id: number) => post<string>(`/RecycleBin/Restore?id=${id}`),

  drop: (id: number) => post<boolean>(`/RecycleBin/Drop?id=${id}`),
}
