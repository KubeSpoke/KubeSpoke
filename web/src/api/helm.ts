import { get, http, post } from './http'

/**
 * Helm 接口。响应走 MVC 默认 camelCase 序列化，请求体大小写不敏感，因此和隧道一样用 camelCase key。
 * 仓库凭据不在这里出现：浏览器只带 repoId，口令由服务端查库后注入给 agent。
 */

/** 已配置的 chart 仓库。口令不回传，只回 hasPassword 标记 */
export interface HelmRepoRow {
  id: number
  name: string
  url: string
  username: string
  insecure: boolean
  hasPassword: boolean
  addedAt: string
  createdBy: string
}

export interface HelmChartVersion {
  version: string
  appVersion: string
  deprecated: boolean
  created: string
}

/** 仓库索引里的一个 chart */
export interface HelmChart {
  repo: string
  name: string
  version: string
  appVersion: string
  description: string
  icon: string
  home: string
  kubeVersion: string
  deprecated: boolean
  type: string
  keywords: string[]
  versions: HelmChartVersion[]
}

/** helm list 的一行 */
export interface HelmRelease {
  name: string
  namespace: string
  revision: number
  /** helm 原样给出的时间串 */
  updated: string
  status: string
  chart: string
  version: string
  appVersion: string
  description: string
}

/** helm history 的一行，回滚候选来自这里 */
export interface HelmRevision {
  revision: number
  updated: string
  status: string
  chart: string
  version: string
  appVersion: string
  description: string
}

export interface HelmReleaseDetail {
  name: string
  namespace: string
  chart: string
  version: string
  appVersion: string
  status: string
  revision: number
  values: string
  manifest: string
  notes: string
}

/** 一次写操作的结果：message 非空即失败，output 是 helm 自己的输出 */
export interface HelmOperation {
  name: string
  namespace: string
  revision: number
  status: string
  chart: string
  version: string
  message: string
  output: string
}

export interface HelmCapability {
  ready: boolean
  helmVersion: string
  error: string
}

export interface CatalogResult {
  repo: string
  repoUrl: string
  total: number
  fetchedAt?: string | null
  items: HelmChart[]
}

export interface HelmRepoPayload {
  name: string
  url: string
  username?: string
  password?: string
  insecure: boolean
}

export interface HelmInstallPayload {
  clustName: string
  name: string
  namespace: string
  chart: string
  chartVersion?: string
  repoId?: number
  values?: string
  createNamespace: boolean
  wait: boolean
  waitForJobs: boolean
  rollbackOnFailure: boolean
  timeoutSec: number
}

export interface HelmUpgradePayload {
  clustName: string
  name: string
  namespace: string
  chart: string
  chartVersion?: string
  repoId?: number
  values?: string
  reuseValues: boolean
  historyMax: number
  wait: boolean
  rollbackOnFailure: boolean
  timeoutSec: number
}

export interface HelmRollbackPayload {
  clustName: string
  name: string
  namespace: string
  revision: number
  wait: boolean
  timeoutSec: number
}

export interface HelmUninstallPayload {
  clustName: string
  name: string
  namespace: string
  keepHistory: boolean
  timeoutSec: number
}

export interface HelmTemplatePayload {
  clustName: string
  name: string
  namespace: string
  chart: string
  chartVersion?: string
  repoId?: number
  values?: string
  skipCrds: boolean
}

/**
 * 装/升/回滚这三条要按 agent 侧 300s 的 RPC 窗口等：http.ts 的默认 120s 会在服务端还在
 * 等 helm 退出时先把浏览器侧的请求掐掉，界面就只剩一条看不出是失败还是超时的提示。
 */
const WRITE_TIMEOUT = 320_000

/** 索引可能几十 MB，拉取窗口也要比默认值宽 */
const SLOW_READ_TIMEOUT = 100_000

const write = async <T>(url: string, body: unknown): Promise<T> => {
  const { data } = await http.post<T>(url, body, { timeout: WRITE_TIMEOUT })
  return data
}

export const helmApi = {
  repos: () => get<{ items: HelmRepoRow[] }>('/Helm/Repos'),
  addRepo: (payload: HelmRepoPayload) => post<{ id: number; name: string; url: string }>('/Helm/AddRepo', payload),
  removeRepo: (id: number) => post<{ removed: boolean }>(`/Helm/RemoveRepo?id=${encodeURIComponent(id)}`),

  /** cluster 只是这次代为取索引的跑腿集群，目录内容跟它无关 */
  catalog: (cluster: string, repoId: number, query?: string, refresh?: boolean) =>
    http.get<CatalogResult>('/Helm/Catalog', {
      timeout: SLOW_READ_TIMEOUT,
      params: { cluster, repoId, query: query || undefined, refresh: refresh || undefined },
    }).then((r) => r.data),

  capability: (cluster: string) => get<HelmCapability>('/Helm/Capability', { cluster }),

  releases: (cluster: string, namespace?: string) =>
    get<{ total: number; items: HelmRelease[] }>('/Helm/Releases', { cluster, namespace: namespace || undefined }),
  history: (cluster: string, namespace: string, name: string) =>
    get<{ items: HelmRevision[] }>('/Helm/History', { cluster, namespace, name }),
  release: (cluster: string, namespace: string, name: string, revision?: number) =>
    get<HelmReleaseDetail>('/Helm/Release', { cluster, namespace, name, revision: revision || undefined }),

  install: (payload: HelmInstallPayload) => write<HelmOperation>('/Helm/Install', payload),
  upgrade: (payload: HelmUpgradePayload) => write<HelmOperation>('/Helm/Upgrade', payload),
  rollback: (payload: HelmRollbackPayload) => write<HelmOperation>('/Helm/Rollback', payload),
  uninstall: (payload: HelmUninstallPayload) => post<HelmOperation>('/Helm/Uninstall', payload),
  template: (payload: HelmTemplatePayload) =>
    http.post<{ yaml: string }>('/Helm/Template', payload, { timeout: SLOW_READ_TIMEOUT }).then((r) => r.data),
}
