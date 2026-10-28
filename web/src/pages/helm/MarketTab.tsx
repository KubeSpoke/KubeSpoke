import { ShopOutlined } from '@ant-design/icons'
import { App, Button, Empty, Input, Pagination, Select, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import { helmApi } from '../../api/helm'
import type { HelmChart, HelmRepoRow } from '../../api/helm'
import { PageShell } from '../../components/PageShell'
import { useResource } from '../../hooks/useResource'
import { helmTime, isInstallable } from './util'
import InstallForm from './InstallForm'

interface Props {
  cluster: string
  repos: HelmRepoRow[]
  repoId?: number
  onRepoChange: (id: number) => void
  /** 一个仓库都没配时引去仓库页 */
  onManageRepos: () => void
  /** 安装提交成功后转去已安装应用，状态流转在那边看 */
  onInstalled: () => void
}

const PAGE_SIZE = 12

/** index.yaml 里的 icon 常是相对地址，得按仓库地址补全 */
function iconUrl(chart: HelmChart, repoUrl: string): string {
  const raw = chart.icon.trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('/')) {
    try {
      return new URL(repoUrl).origin + raw
    } catch {
      return ''
    }
  }
  return `${repoUrl.replace(/\/+$/, '')}/${raw.replace(/^\.?\//, '')}`
}

function ChartIcon({ chart, repoUrl }: { chart: HelmChart; repoUrl: string }) {
  const src = iconUrl(chart, repoUrl)
  const [broken, setBroken] = useState(false)
  if (!src || broken) {
    return (
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[var(--ks-brand-soft)] text-base font-semibold text-[#5c7bb8]">
        {(chart.name[0] ?? '?').toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setBroken(true)}
      className="size-10 shrink-0 rounded-lg bg-[var(--ks-fill-soft)] object-contain"
    />
  )
}

export default function MarketTab({ cluster, repos, repoId, onRepoChange, onManageRepos, onInstalled }: Props) {
  const { message } = App.useApp()
  const [keyword, setKeyword] = useState('')
  const [typed, setTyped] = useState('')
  const [page, setPage] = useState(1)
  const [nonce, setNonce] = useState(0)
  const [target, setTarget] = useState<HelmChart | null>(null)

  const repo = useMemo(() => repos.find((r) => r.id === repoId), [repos, repoId])

  const { data, error, loading } = useResource(
    () => (repo && cluster ? helmApi.catalog(cluster, repo.id, keyword).catch((e: Error) => {
      message.error(e.message)
      return undefined
    }) : Promise.resolve(undefined)),
    // 关键字在服务端只过滤缓存好的目录，换关键字不会重拉索引
    [cluster, repo?.id, keyword, nonce],
  )

  const charts = useMemo(() => data?.items ?? [], [data])
  const visible = useMemo(() => charts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [charts, page])
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  if (repos.length === 0) {
    return (
      <PageShell
        title="应用市场"
        description="浏览 chart 仓库的目录，直接装到集群里。"
        icon={<ShopOutlined />}
        namespaced={false}
        bare
      >
        <Empty
          className="!py-16"
          description={
            <span style={{ color: 'var(--ks-muted)' }}>
              还没有 Chart 仓库。添加一个 index.yaml 仓库地址（如 https://charts.bitnami.com/bitnami）即可浏览应用。
            </span>
          }
        >
          <Button type="primary" onClick={onManageRepos}>
            去添加仓库
          </Button>
        </Empty>
      </PageShell>
    )
  }

  return (
    <PageShell
      title="应用市场"
      description="目录由 agent 直接读仓库索引，不依赖集群里的 helm；安装才会真正下发资源。"
      icon={<ShopOutlined />}
      namespaced={false}
      bare
      error={error}
      loading={loading}
      onRefresh={reload}
      search={
        <Space size={8} wrap>
          <Select
            style={{ width: 200 }}
            placeholder="选择仓库"
            value={repo?.id}
            onChange={(v) => {
              onRepoChange(v as number)
              setKeyword('')
              setTyped('')
              setPage(1)
            }}
            options={repos.map((r) => ({ label: r.name, value: r.id }))}
          />
          <Input
            style={{ width: 220 }}
            allowClear
            placeholder="按名称、描述、关键字过滤"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value)
              if (!e.target.value) {
                setKeyword('')
                setPage(1)
              }
            }}
            onPressEnter={() => {
              setKeyword(typed.trim())
              setPage(1)
            }}
          />
        </Space>
      }
      actions={
        <Button onClick={onManageRepos}>管理仓库</Button>
      }
    >
      <div className="mb-3 flex items-center justify-between">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {data ? `${data.total} 个 chart · 索引时间 ${helmTime(data.fetchedAt)}` : '正在取目录…'}
        </Typography.Text>
        <Typography.Text type="secondary" className="kbd-mono" style={{ fontSize: 12 }}>
          {repo?.url}
        </Typography.Text>
      </div>

      <Spin spinning={loading}>
        {charts.length === 0 && !loading ? (
          <Empty className="!py-16" description={<span style={{ color: 'var(--ks-muted)' }}>这个仓库里没有匹配的 chart</span>} />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((c) => {
              const canInstall = isInstallable(c.type) && !c.deprecated
              return (
                <div
                  key={c.name}
                  className="flex flex-col gap-2.5 ks-panel p-4 ks-panel-hover"
                >
                  <div className="flex items-start gap-3">
                    <ChartIcon chart={c} repoUrl={repo?.url ?? c.repo} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold" style={{ color: 'var(--ks-ink)' }}>
                          {c.name}
                        </span>
                        {c.deprecated && <Tag color="orange">已废弃</Tag>}
                      </div>
                      <div className="kbd-mono mt-0.5 truncate text-xs" style={{ color: 'var(--ks-muted)' }}>
                        {c.version}
                        {c.appVersion ? ` · app ${c.appVersion}` : ''}
                      </div>
                    </div>
                  </div>

                  <Typography.Paragraph
                    ellipsis={{ rows: 2 }}
                    style={{ marginBottom: 0, minHeight: 38, fontSize: 12, color: 'var(--ks-body)' }}
                  >
                    {c.description || '这个 chart 没有写描述'}
                  </Typography.Paragraph>

                  {!!c.keywords.length && (
                    <div className="flex flex-wrap gap-1">
                      {c.keywords.slice(0, 4).map((k) => (
                        <span key={k} className="rounded bg-[var(--ks-fill)] px-1.5 py-0.5 text-[11px]" style={{ color: 'var(--ks-muted)' }}>
                          {k}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-auto flex items-center justify-between pt-1">
                    <span className="truncate text-[11px]" style={{ color: 'var(--ks-faint)' }}>
                      {c.type || 'application'}
                      {c.kubeVersion ? ` · kube ${c.kubeVersion}` : ''}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {c.home && (
                        <Button size="small" type="text" onClick={() => window.open(c.home, '_blank', 'noopener')}>
                          主页
                        </Button>
                      )}
                      <Tooltip
                        title={
                          c.deprecated
                            ? '仓库里这个 chart 已标记废弃'
                            : isInstallable(c.type)
                              ? undefined
                              : 'library chart 只提供模板，不能直接安装'
                        }
                      >
                        <Button size="small" type="primary" disabled={!canInstall || !cluster} onClick={() => setTarget(c)}>
                          安装
                        </Button>
                      </Tooltip>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Spin>

      {charts.length > PAGE_SIZE && (
        <div className="flex justify-center pt-4">
          <Pagination current={page} pageSize={PAGE_SIZE} total={charts.length} showSizeChanger={false} onChange={setPage} />
        </div>
      )}

      {target && repo && (
        <InstallForm
          mode="install"
          cluster={cluster}
          chart={target}
          repo={repo}
          onClose={() => setTarget(null)}
          onDone={() => {
            setTarget(null)
            onInstalled()
          }}
        />
      )}
    </PageShell>
  )
}
