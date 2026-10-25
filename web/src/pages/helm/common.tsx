import { helmTone } from './util'

/** 彩点 + 原文状态：helm 的账目不翻成中文，避免和 K8s 的 Phase 混成两套说法 */
export function HelmStatus({ status }: { status?: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="size-[7px] shrink-0 rounded-full" style={{ background: helmTone(status) }} />
      <span style={{ fontWeight: 500, color: '#15233a' }}>{status || '-'}</span>
    </span>
  )
}
