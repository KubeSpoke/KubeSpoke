import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr'
import type { HubConnection } from '@microsoft/signalr'
import { Alert, App, Breadcrumb, Button, Input, Modal, Progress, Space, Table, Typography, Upload } from 'antd'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpOutlined,
  FileOutlined,
  FolderAddOutlined,
  FolderOutlined,
  LinkOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { clusterApi } from '../api/cluster'
import type { PodFileEntry } from '../api/cluster'
import { datetime, memory } from '../utils/format'

interface Props {
  cluster: string
  namespace: string
  pod: string
  container: string
  running: boolean
}

type Row = PodFileEntry & { up?: boolean }
type Status = 'queued' | 'uploading' | 'error' | 'canceled'
interface UploadItem {
  id: string
  name: string
  size: number
  sent: number
  status: Status
  error?: string
}

const CHUNK = 256 * 1024

/** 二进制安全：btoa 只吃 Latin-1，逐段 fromCharCode 拼，避免整块展开把栈打爆 */
const toBase64 = (bytes: Uint8Array) => {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const normalizePath = (raw: string) => {
  const t = raw.trim()
  if (!t) return '/'
  const s = t.startsWith('/') ? t : `/${t}`
  return s.length > 1 ? s.replace(/\/+$/, '') : '/'
}
const parentOf = (p: string) => {
  const seg = p.split('/').filter(Boolean)
  seg.pop()
  return seg.length ? `/${seg.join('/')}` : '/'
}
const joinPath = (dir: string, name: string) => (dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`)

let seq = 0
const nextId = () => `up-${Date.now()}-${(seq += 1)}`

/**
 * 容器文件管理：列表走 /api/Cluster/ListPodFiles（响应 camelCase），增删走 POST，
 * 下载是浏览器直接打开的 GET，上传走 SignalR /pod-file（StartUpload→Write→FinishUpload）。
 */
export function PodFiles({ cluster, namespace, pod, container, running }: Props) {
  const { message, modal } = App.useApp()

  const [path, setPath] = useState('/')
  const [jump, setJump] = useState('/')
  const [entries, setEntries] = useState<PodFileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [mkdirOpen, setMkdirOpen] = useState(false)
  const [mkdirName, setMkdirName] = useState('')
  const [mkdirBusy, setMkdirBusy] = useState(false)

  const [queue, setQueue] = useState<UploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)

  const connRef = useRef<HubConnection | null>(null)
  const jobsRef = useRef(new Map<string, { file: File; target: string }>())
  const pendingRef = useRef<string[]>([])
  const cancelRef = useRef(new Set<string>())
  const pumpingRef = useRef(false)
  const activeIdRef = useRef<string | null>(null)
  const activeSessionRef = useRef<string | null>(null)
  const dragDepth = useRef(0)

  const load = useCallback(
    async (p: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await clusterApi.listPodFiles(cluster, namespace, pod, container, p)
        setEntries(res.items ?? [])
        const canonical = res.path ? normalizePath(res.path) : p
        setPath(canonical)
        setJump(canonical)
      } catch (e) {
        setError((e as Error).message)
        setEntries([])
      } finally {
        setLoading(false)
      }
    },
    [cluster, namespace, pod, container],
  )

  useEffect(() => {
    if (!running) return
    void load('/')
  }, [running, load])

  // 卸载（含切走标签页）时把在途会话在 server 端 AbortUpload 掉再断开连接
  useEffect(
    () => () => {
      const conn = connRef.current
      const s = activeSessionRef.current
      if (conn && s) void conn.invoke('AbortUpload', s).catch(() => {})
      void conn?.stop()
      connRef.current = null
    },
    [],
  )

  const go = (p: string) => {
    setJump(p)
    void load(p)
  }

  const ensureConn = async () => {
    if (connRef.current?.state === HubConnectionState.Connected) return connRef.current
    const conn = new HubConnectionBuilder().withUrl(clusterApi.podFileHubUrl(cluster, namespace, pod, container)).build()
    connRef.current = conn
    await conn.start()
    return conn
  }

  const patch = (id: string, p: Partial<UploadItem>) => setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...p } : it)))
  const dropItem = (id: string) => setQueue((q) => q.filter((it) => it.id !== id))

  const uploadOne = async (id: string) => {
    const job = jobsRef.current.get(id)
    if (!job) return
    if (cancelRef.current.has(id)) {
      jobsRef.current.delete(id)
      cancelRef.current.delete(id)
      patch(id, { status: 'canceled' })
      return
    }
    patch(id, { status: 'uploading', sent: 0 })
    let sessionId = ''
    try {
      const conn = await ensureConn()
      sessionId = await conn.invoke<string>('StartUpload', job.target)
      activeSessionRef.current = sessionId
      activeIdRef.current = id
      const total = job.file.size
      let offset = 0
      while (offset < total) {
        if (cancelRef.current.has(id)) break
        const end = Math.min(offset + CHUNK, total)
        const buf = new Uint8Array(await job.file.slice(offset, end).arrayBuffer())
        await conn.invoke('Write', sessionId, toBase64(buf))
        offset += buf.length
        patch(id, { sent: offset })
      }
      if (cancelRef.current.has(id)) {
        await conn.invoke('AbortUpload', sessionId).catch(() => {})
        patch(id, { status: 'canceled' })
        return
      }
      const err = await conn.invoke<string | null>('FinishUpload', sessionId)
      if (err) {
        patch(id, { status: 'error', error: String(err) })
        message.error(`上传失败：${String(err)}`)
      } else {
        dropItem(id)
        void load(parentOf(job.target))
      }
    } catch (e) {
      if (cancelRef.current.has(id)) patch(id, { status: 'canceled' })
      else {
        patch(id, { status: 'error', error: (e as Error).message })
        message.error(`上传失败：${(e as Error).message}`)
      }
    } finally {
      activeSessionRef.current = null
      activeIdRef.current = null
      jobsRef.current.delete(id)
      cancelRef.current.delete(id)
    }
  }

  const pump = async () => {
    if (pumpingRef.current) return
    pumpingRef.current = true
    setUploading(true)
    try {
      while (pendingRef.current.length) {
        const id = pendingRef.current.shift() as string
        await uploadOne(id)
      }
    } finally {
      pumpingRef.current = false
      setUploading(false)
    }
  }

  const add = (file: File) => {
    const id = nextId()
    jobsRef.current.set(id, { file, target: joinPath(path, file.name) })
    pendingRef.current.push(id)
    setQueue((q) => [...q, { id, name: file.name, size: file.size, sent: 0, status: 'queued' }])
    void pump()
  }

  const cancelUpload = (id: string) => {
    cancelRef.current.add(id)
    if (id !== activeIdRef.current) {
      pendingRef.current = pendingRef.current.filter((x) => x !== id)
      jobsRef.current.delete(id)
      patch(id, { status: 'canceled' })
    }
  }

  const clearSettled = () => setQueue((q) => q.filter((it) => it.status === 'uploading' || it.status === 'queued'))

  const openMkdir = () => {
    setMkdirName('')
    setMkdirOpen(true)
  }

  const submitMkdir = async () => {
    const name = mkdirName.trim()
    if (!name) {
      message.error('请输入目录名')
      return
    }
    setMkdirBusy(true)
    try {
      await clusterApi.makePodDirectory(cluster, namespace, pod, container, joinPath(path, name))
      message.success('目录已创建')
      setMkdirOpen(false)
      void load(path)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setMkdirBusy(false)
    }
  }

  const remove = (r: Row) => {
    const full = joinPath(path, r.name)
    modal.confirm({
      title: `删除「${r.name}」？`,
      content: '删除后不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await clusterApi.removePodFiles(cluster, namespace, pod, container, [full])
          message.success('已删除')
          void load(path)
        } catch (e) {
          message.error((e as Error).message)
        }
      },
    })
  }

  const download = (r: Row) => {
    window.open(clusterApi.podFileDownloadUrl(cluster, namespace, pod, container, joinPath(path, r.name)), '_blank')
  }

  const iconFor = (r: Row): ReactNode => {
    if (r.up) return <ArrowUpOutlined style={{ color: 'var(--ks-muted)' }} />
    if (r.type === 'dir') return <FolderOutlined style={{ color: 'var(--color-brand)' }} />
    if (r.type === 'link') return <LinkOutlined style={{ color: 'var(--color-warn)' }} />
    return <FileOutlined style={{ color: 'var(--ks-muted)' }} />
  }

  const rows: Row[] = []
  if (path !== '/') {
    rows.push({ name: '..', type: 'dir', size: 0, modified: '', mode: '', owner: '', group: '', up: true })
  }
  for (const e of entries) rows.push(e)

  const segs = path.split('/').filter(Boolean)
  const crumbs: { title: ReactNode }[] = []
  let acc = ''
  segs.forEach((seg, i) => {
    acc += `/${seg}`
    const at = acc
    crumbs.push({
      title: i === segs.length - 1 ? <span style={{ color: 'var(--ks-ink)' }}>{seg}</span> : <a onClick={() => go(at)}>{seg}</a>,
    })
  })
  const crumbItems = [{ title: segs.length ? <a onClick={() => go('/')}>根目录</a> : <span style={{ color: 'var(--ks-ink)' }}>根目录</span> }, ...crumbs]

  const showUpload = queue.length > 0

  if (!running) {
    return <Typography.Text type="secondary">容器未在运行，无法打开文件管理。</Typography.Text>
  }

  return (
    <div
      className="relative"
      onDragEnter={(e) => {
        if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return
        e.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer?.files ?? [])
        if (!files.length) return
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        files.forEach(add)
      }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Input
          size="small"
          className="kbd-mono !w-72"
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          onPressEnter={() => go(normalizePath(jump))}
        />
        <Button size="small" onClick={() => go(normalizePath(jump))}>
          跳转
        </Button>
        <Space size={4} className="ml-auto">
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => load(path)}>
            刷新
          </Button>
          <Button size="small" icon={<FolderAddOutlined />} onClick={openMkdir}>
            新建目录
          </Button>
          <Upload
            multiple
            showUploadList={false}
            beforeUpload={(file) => {
              add(file)
              return Upload.LIST_IGNORE
            }}
          >
            <Button size="small" icon={<UploadOutlined />} loading={uploading}>
              上传
            </Button>
          </Upload>
        </Space>
      </div>

      <Breadcrumb items={crumbItems} className="mb-2" />

      {error ? (
        <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => load(path)}>重试</Button>} />
      ) : (
        <Table<Row>
          rowKey={(r) => (r.up ? '__up__' : r.name)}
          size="small"
          pagination={false}
          loading={loading}
          dataSource={rows}
          locale={{ emptyText: '该目录为空' }}
          onRow={(r) => ({
            onClick: () => {
              if (r.up) go(parentOf(path))
              else if (r.type === 'dir') go(joinPath(path, r.name))
            },
            className: r.up || r.type === 'dir' ? 'cursor-pointer' : undefined,
          })}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              render: (_, r) => (
                <span className="inline-flex items-center gap-2">
                  {iconFor(r)}
                  <span className="kbd-mono" style={{ color: r.up ? 'var(--ks-muted)' : 'var(--ks-body)' }}>
                    {r.name}
                  </span>
                  {r.type === 'link' && r.link ? <span className="text-xs" style={{ color: 'var(--ks-muted)' }}>→ {r.link}</span> : null}
                </span>
              ),
            },
            { title: '大小', width: 110, align: 'right', render: (_, r) => (r.up || r.type === 'dir' ? '' : memory(r.size)) },
            { title: '修改时间', width: 170, render: (_, r) => (r.up ? '' : <span className="kbd-mono text-xs">{datetime(r.modified)}</span>) },
            { title: '权限', width: 130, render: (_, r) => (r.up ? '' : <span className="kbd-mono text-xs">{r.mode}</span>) },
            {
              title: '操作',
              width: 130,
              render: (_, r) =>
                r.up ? null : (
                  <Space size={4}>
                    {r.type === 'file' ? (
                      <Button size="small" type="link" onClick={(e) => { e.stopPropagation(); download(r) }}>
                        下载
                      </Button>
                    ) : null}
                    <Button size="small" type="text" danger onClick={(e) => { e.stopPropagation(); remove(r) }}>
                      删除
                    </Button>
                  </Space>
                ),
            },
          ]}
        />
      )}

      {showUpload && (
        <div className="mt-3 rounded-xl bg-[var(--ks-fill-soft)] p-3">
          <div className="mb-1 flex items-center justify-between">
            <Typography.Text type="secondary" className="!text-xs">
              上传队列
            </Typography.Text>
            <Button size="small" type="text" onClick={clearSettled}>
              清空
            </Button>
          </div>
          {queue.map((it) => (
            <div key={it.id} className="mb-1 last:mb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="kbd-mono truncate text-xs" title={it.name}>
                  {it.name}
                </span>
                {it.status === 'uploading' || it.status === 'queued' ? (
                  <Button size="small" type="text" danger onClick={() => cancelUpload(it.id)}>
                    取消
                  </Button>
                ) : null}
              </div>
              <Progress
                percent={it.size ? Math.min(100, Math.round((it.sent / it.size) * 100)) : 0}
                size="small"
                status={it.status === 'error' ? 'exception' : 'normal'}
              />
              {it.status === 'error' && it.error ? (
                <div className="text-xs" style={{ color: 'var(--color-danger)' }}>
                  {it.error}
                </div>
              ) : null}
              {it.status === 'canceled' ? (
                <div className="text-xs" style={{ color: 'var(--ks-muted)' }}>
                  已取消
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {dragging ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded border-2 border-dashed"
          style={{ borderColor: 'var(--color-brand)', background: 'var(--ks-brand-bg)' }}
        >
          <Typography.Text style={{ color: 'var(--color-brand)' }}>松开以上传到 {path}</Typography.Text>
        </div>
      ) : null}

      <Modal open={mkdirOpen} title={`新建目录 · ${path}`} onCancel={() => setMkdirOpen(false)} onOk={submitMkdir} okText="创建" confirmLoading={mkdirBusy}>
        <Input placeholder="目录名称" value={mkdirName} onChange={(e) => setMkdirName(e.target.value)} onPressEnter={submitMkdir} autoFocus />
      </Modal>
    </div>
  )
}

export default PodFiles
