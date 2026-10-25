import { DownOutlined } from '@ant-design/icons'
import { App, Dropdown, Spin } from 'antd'
import { useCallback, useState } from 'react'
import { clusterApi } from '../api/cluster'

/** 下拉最多列多少个：仓库里几百个 tag 时全列出来反而没法选，倒序的前几个就是要切的 */
const MAX_ITEMS = 12

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
 * 就地切镜像版本：点镜像文字拉出仓库里最近的 tag，选中即触发滚动更新。
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

  const { repo, tag, digest } = splitImage(image)
  const current = tag || 'latest'

  const text = (
    <span className="kbd-mono inline-flex cursor-pointer items-center gap-1 text-xs hover:text-[#2f6fed]!">
      {image}
      <DownOutlined style={{ fontSize: 9 }} />
    </span>
  )

  const load = useCallback(async () => {
    if (tags !== null || loading) return
    setLoading(true)
    try {
      const res = await clusterApi.imageTags(cluster, image, namespace)
      setTags(res?.tags ?? [])
      setNotice(res?.notice ?? '')
    } catch (e) {
      setTags([])
      setNotice((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [cluster, image, namespace, tags, loading])

  if (!cluster || !name || !image || image === '-' || digest) return <span className="kbd-mono text-xs">{image}</span>

  const apply = (next: string) => {
    if (next === image) return
    modal.confirm({
      title: '切换镜像版本？',
      content: (
        <div className="text-sm">
          <div className="kbd-mono text-xs" style={{ color: '#8f9aa9' }}>
            {repo}
          </div>
          <div className="mt-2 kbd-mono">
            {current} <span className="mx-1 font-sans text-[#8f9aa9]">→</span> {next.slice(repo.length + 1)}
          </div>
          <div className="mt-2 text-xs" style={{ color: '#8f9aa9' }}>
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

  const items = (tags ?? []).slice(0, MAX_ITEMS).map((t) => ({
    key: t,
    label: (
      <span className="kbd-mono text-xs">
        {t}
        {t === current && (
          <span className="ml-2 font-sans text-xs" style={{ color: '#8f9aa9' }}>
            当前
          </span>
        )}
      </span>
    ),
  }))

  return (
    <Dropdown
      trigger={['click']}
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) void load()
      }}
      menu={{ items, onClick: ({ key }) => apply(`${repo}:${key}`) }}
      popupRender={(menu) => (
        <div style={{ minWidth: 190 }}>
          {loading ? (
            <div className="p-4 text-center">
              <Spin size="small" />
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-2 text-xs" style={{ color: '#8f9aa9' }}>
              没有可选版本
            </div>
          ) : (
            menu
          )}
          {notice && (
            <div className="border-t border-[#edf1f6] px-3 py-2 text-xs" style={{ color: '#8f9aa9', maxWidth: 320 }}>
              {notice}
            </div>
          )}
        </div>
      )}
    >
      {text}
    </Dropdown>
  )
}
