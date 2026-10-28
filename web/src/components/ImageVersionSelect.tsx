import { DownOutlined, LeftOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons'
import { App, Dropdown, Input, Spin } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { clusterApi } from '../api/cluster'

/** 一页列多少个 tag：再多就要在下拉里滚动了，翻页比滚动好选 */
const PAGE_SIZE = 10

/** 镜像全名拆成「仓库路径 + tag」。digest 地址没有 tag 可换，由调用方退化成纯文本 */
function splitImage(image: string) {
  const at = image.indexOf('@')
  if (at >= 0) return { repo: image.slice(0, at), tag: '', digest: true }
  const slash = image.lastIndexOf('/')
  const colon = image.lastIndexOf(':')
  if (colon > slash) return { repo: image.slice(0, colon), tag: image.slice(colon + 1), digest: false }
  return { repo: image, tag: '', digest: false }
}

/**
 * 就地切镜像版本：点镜像文字拉出仓库里的 tag，可搜索、按页翻，选中即触发滚动更新。
 * tag 由代理端走 registry v2 接口取，凭证用的是集群里已有的 imagePullSecret，不在控制台里另存。
 * 只有 Deployment 能这么改——Pod 的镜像不可变，StatefulSet/DaemonSet 走各自的编辑入口。
 */
export default function ImageVersionSelect({
  cluster,
  namespace,
  name,
  containerName,
  image,
  onChanged,
}: {
  cluster: string
  namespace: string
  name: string
  containerName?: string
  image: string
  onChanged?: () => void
}) {
  const { message, modal } = App.useApp()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [tags, setTags] = useState<string[] | null>(null)
  const [notice, setNotice] = useState('')
  const [failed, setFailed] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(0)

  const { repo, tag, digest } = splitImage(image)
  const current = tag || 'latest'

  const text = (
    <span className="kbd-mono inline-flex cursor-pointer items-center gap-1 text-xs hover:text-[var(--color-brand)]!">
      {image}
      <DownOutlined style={{ fontSize: 9 }} />
    </span>
  )

  const load = useCallback(async () => {
    if ((tags !== null && !failed) || loading) return
    setLoading(true)
    try {
      const res = await clusterApi.imageTags(cluster, image, namespace)
      const list = res?.tags ?? []
      setTags(list)
      setNotice(res?.notice ?? '')
      setFailed(false)
      // 正在跑的版本往往不在最新一页，打开时直接翻到它那一页
      const at = list.indexOf(current)
      setPage(at >= 0 ? Math.floor(at / PAGE_SIZE) : 0)
    } catch (e) {
      setTags([])
      setNotice((e as Error).message)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [cluster, image, namespace, tags, loading, current, failed])

  const filtered = useMemo(() => {
    const all = tags ?? []
    const kw = keyword.trim().toLowerCase()
    return kw ? all.filter((t) => t.toLowerCase().includes(kw)) : all
  }, [tags, keyword])

  if (!cluster || !name || !image || image === '-' || digest) return <span className="kbd-mono text-xs">{image}</span>

  const apply = (next: string) => {
    if (next === image) return
    modal.confirm({
      title: '切换镜像版本？',
      content: (
        <div className="text-sm">
          <div className="kbd-mono text-xs" style={{ color: 'var(--ks-muted)' }}>
            {repo}
          </div>
          <div className="mt-2 kbd-mono">
            {current} <span className="mx-1 font-sans" style={{ color: 'var(--ks-muted)' }}>→</span> {next.slice(repo.length + 1)}
          </div>
          <div className="mt-2 text-xs" style={{ color: 'var(--ks-muted)' }}>
            确认后立即触发滚动更新{containerName ? `（容器 ${containerName}）` : ''}。
          </div>
        </div>
      ),
      okText: '切换',
      onOk: async () => {
        try {
          await clusterApi.replaceImage(cluster, {
            Name: name,
            Namespace: namespace,
            Image: next,
            ...(containerName ? { ContainerName: containerName } : {}),
          })
          message.success('已切换，滚动更新中')
          onChanged?.()
        } catch (e) {
          message.error((e as Error).message)
        }
      },
    })
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const rows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  const step = (delta: number) => {
    setPage(Math.min(Math.max(safePage + delta, 0), totalPages - 1))
  }

  const pagerBtn = (label: string, delta: number, disabled: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => step(delta)}
      className="inline-flex items-center gap-0.5 border-none bg-transparent p-0 text-xs"
      style={{ color: disabled ? 'var(--ks-faint)' : 'var(--color-brand)', cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      {delta < 0 ? <LeftOutlined style={{ fontSize: 10 }} /> : null}
      {label}
      {delta > 0 ? <RightOutlined style={{ fontSize: 10 }} /> : null}
    </button>
  )

  // 空列表时分三种情况说清楚：拉取失败 / 搜不到 / 仓库确实没给 tag（后端的 notice 就是原因）
  let hint: ReactNode = null
  if (rows.length === 0) {
    if (failed)
      hint = (
        <div
          className="mx-2 my-1 rounded px-2 py-1.5 text-xs leading-5"
          style={{ background: 'var(--ks-danger-bg)', color: 'var(--color-danger)', maxWidth: 420, wordBreak: 'break-word' }}
        >
          <div className="mb-1 font-sans">拉取 tag 失败</div>
          <span className="kbd-mono">{notice}</span>
        </div>
      )
    else if (keyword)
      hint = (
        <div className="px-3 py-3 text-xs" style={{ color: 'var(--ks-muted)' }}>
          没有匹配「{keyword}」的 tag
        </div>
      )
    else if (notice)
      hint = (
        <div
          className="mx-2 my-1 rounded px-2 py-1.5 text-xs leading-5"
          style={{ background: 'var(--ks-warn-bg)', color: 'var(--ks-warn-text)', maxWidth: 420, wordBreak: 'break-word' }}
        >
          {notice}
        </div>
      )
    else
      hint = (
        <div className="px-3 py-3 text-xs" style={{ color: 'var(--ks-muted)' }}>没有可选版本</div>
      )
  }

  const panel = (
    <div
      style={{
        minWidth: 240,
        background: 'var(--ks-surface)',
        borderRadius: 12,
        boxShadow: '0 16px 40px -16px rgba(16,24,40,0.24), 0 4px 10px -6px rgba(16,24,40,0.1)',
        padding: '4px 0',
      }}
    >
      <div className="px-2 pb-1 pt-2">
        <Input
          size="small"
          allowClear
          placeholder="搜索 tag"
          style={{ maxWidth: 260 }}
          prefix={<SearchOutlined style={{ color: 'var(--ks-faint)' }} />}
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value)
            setPage(0)
          }}
        />
      </div>

      {loading ? (
        <div className="p-4 text-center">
          <Spin size="small" />
        </div>
      ) : rows.length === 0 ? (
        hint
      ) : (
        <div>
          {rows.map((t) => {
            const isCurrent = t === current
            return (
              <div
                key={t}
                onClick={() => apply(`${repo}:${t}`)}
                className="mx-1 flex cursor-pointer items-center gap-2 rounded px-2 py-1.5"
                style={{
                  background: isCurrent ? 'var(--ks-brand-bg)' : 'transparent',
                  color: isCurrent ? 'var(--color-brand)' : 'var(--ks-body)',
                }}
                onMouseEnter={(e) => {
                  if (!isCurrent) e.currentTarget.style.background = 'var(--ks-hover)'
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent) e.currentTarget.style.background = 'transparent'
                }}
              >
                <span className="kbd-mono text-xs">{t}</span>
                {isCurrent && (
                  <span
                    className="shrink-0 rounded-sm px-1.5 py-px font-sans text-[11px] leading-4"
                    style={{ background: 'var(--color-brand)', color: '#fff' }}
                  >
                    当前使用
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!loading && filtered.length > PAGE_SIZE && (
        <div
          className="mt-1 flex items-center justify-between px-3 py-2"
        >
          <span className="text-xs" style={{ color: 'var(--ks-muted)' }}>
            共 {filtered.length} 个
          </span>
          <span className="inline-flex items-center gap-2">
            {pagerBtn('上一页', -1, safePage === 0)}
            <span className="kbd-mono text-xs" style={{ color: 'var(--ks-muted)' }}>
              {safePage + 1}/{totalPages}
            </span>
            {pagerBtn('下一页', 1, safePage >= totalPages - 1)}
          </span>
        </div>
      )}

      {notice && rows.length > 0 && (
        <div
          className="px-3 py-2 text-xs"
          style={{ color: 'var(--ks-muted)', maxWidth: 380 }}
        >
          {notice}
        </div>
      )}
    </div>
  )

  return (
    <Dropdown
      trigger={['click']}
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setKeyword('')
          const at = (tags ?? []).indexOf(current)
          setPage(at >= 0 ? Math.floor(at / PAGE_SIZE) : 0)
          void load()
        }
      }}
      menu={{ items: [] }}
      popupRender={() => panel}
    >
      {text}
    </Dropdown>
  )
}
