import type { ReactNode } from 'react'
import type { App } from 'antd'
import type { ResourceDescriptor } from '../config/nav'
import { resourceApi } from '../api/resources'
import type { K8sObject } from '../api/resources'
import { toYaml } from '../utils/yaml'

/** 就是 App.useApp() 给的那个 modal，调用点直接传进来即可，不用再造形状也不用强转 */
type ModalApi = Pick<ReturnType<typeof App.useApp>['modal'], 'confirm'>

type Row = { path: string; from: string; to: string }

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const show = (v: unknown): string => {
  if (v === undefined) return '（无）'
  if (v === null) return 'null'
  if (typeof v === 'object') return Array.isArray(v) ? `[${v.length} 项]` : '{…}'
  const s = String(v)
  return s.length > 90 ? `${s.slice(0, 87)}…` : s
}

/** 浅层比对：只关心「哪些字段变了」，数组按下标展开，够人眼核对一次提交 */
function collectDiff(base: unknown, next: unknown, path: string, out: Row[], depth: number): void {
  if (out.length >= 40) return
  if (isMap(base) && isMap(next)) {
    for (const k of new Set([...Object.keys(base), ...Object.keys(next)])) {
      if (k === 'metadata' && depth === 0) {
        collectDiff(base.metadata, next.metadata, 'metadata', out, depth + 1)
        continue
      }
      if (k === 'status' || k === 'managedFields') continue
      collectDiff(base[k], next[k], path ? `${path}.${k}` : k, out, depth + 1)
    }
    return
  }
  if (Array.isArray(base) && Array.isArray(next)) {
    if (base.length !== next.length) out.push({ path: `${path}（长度）`, from: String(base.length), to: String(next.length) })
    for (let i = 0; i < Math.max(base.length, next.length); i++) {
      collectDiff(base[i], next[i], `${path}[${i}]`, out, depth + 1)
    }
    return
  }
  if (JSON.stringify(base) !== JSON.stringify(next)) out.push({ path: path || '（根）', from: show(base), to: show(next) })
}

/** 相对界面渲染时那份对象，本次提交会改哪些字段 */
export function diffRows(seeded: K8sObject, next: K8sObject): Row[] {
  const out: Row[] = []
  collectDiff(seeded, next, '', out, 0)
  return out.filter((r) => r.path !== 'metadata.resourceVersion' && r.path !== 'metadata.uid')
}

/**
 * 服务端回填的字段不能跟着 apply 打回去：resourceVersion 对不上会被 409 顶回来，
 * status / managedFields 只是噪声。所有调用点统一在这里剥一次，别各自记着调。
 */
export function cleanForApply(o: K8sObject): K8sObject {
  const next: K8sObject = structuredClone(o)
  delete next.status
  const md = { ...(next.metadata ?? {}) }
  delete md.managedFields
  delete md.resourceVersion
  next.metadata = md
  return next
}

/**
 * 写操作统一守卫：重新读线上对象 → 在最新对象上打补丁 → 展示差异并在被别人改过时警告 → 返回待提交 YAML。
 * 返回 null 表示「不该提交」：用户放弃，或比对后没有任何字段变化（此时调用方给一句「没有变化」即可）。
 * build 必须在传入的 live 上打补丁并返回新对象，别去改界面上那份旧快照。
 * 提交前会自动剥掉 status / managedFields / resourceVersion，build 里不用再清。
 */
export async function confirmApply(opts: {
  modal: ModalApi
  cluster: string
  descriptor: ResourceDescriptor
  name: string
  namespace?: string
  /** 界面渲染时读到的那份对象，用于判断是否已被他人改动 */
  seeded?: K8sObject
  /** 在线上最新对象上打补丁，返回要提交的对象 */
  build: (live: K8sObject) => K8sObject
  title?: string
  /** 差异表上方的一句说明，例如「会把该版本的 Pod 模板写回部署，触发滚动更新」 */
  intro?: ReactNode
  okText?: string
}): Promise<string | null> {
  const live = await resourceApi.read(opts.cluster, opts.descriptor, opts.name, opts.namespace)
  const next = opts.build(live)
  const stale = !!opts.seeded && String(opts.seeded.metadata?.resourceVersion ?? '') !== String(live.metadata?.resourceVersion ?? '')

  const rows = opts.seeded ? diffRows(opts.seeded, next) : []
  const changed = rows.length > 0 || stale
  if (!changed) return null

  const body = (
    <div>
      {opts.intro ? <div style={{ marginBottom: 8 }}>{opts.intro}</div> : null}
      {stale && (
        <div style={{ color: '#d94f4f', marginBottom: 8 }}>
          该对象在你打开页面之后已被他人修改，继续提交会覆盖对方的改动。
        </div>
      )}
      <div style={{ maxHeight: 320, overflow: 'auto' }}>
        {rows.map((r) => (
          <div key={r.path} style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: '22px', borderBottom: '1px solid #f0f2f5' }}>
            <span style={{ flex: '1 1 auto', minWidth: 140, wordBreak: 'break-all' }}>{r.path}</span>
            <span style={{ flex: '0 0 auto', maxWidth: '38%', color: '#8f9aa9', textDecoration: 'line-through', wordBreak: 'break-all' }}>{r.from}</span>
            <span style={{ flex: '0 0 auto', maxWidth: '38%', color: '#15233a', wordBreak: 'break-all' }}>{r.to}</span>
          </div>
        ))}
      </div>
    </div>
  )

  const isConfirmed = await new Promise<boolean>((resolve) => {
    opts.modal.confirm({
      title: opts.title ?? `确认修改 ${opts.name}？`,
      content: body,
      okText: opts.okText ?? '提交',
      cancelText: '放弃',
      okButtonProps: stale ? { danger: true } : undefined,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })
  return isConfirmed ? toYaml(cleanForApply(next)) : null
}
