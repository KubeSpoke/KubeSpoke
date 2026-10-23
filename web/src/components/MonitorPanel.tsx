import { Typography } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { clusterApi } from '../api/cluster'
import { bytes, cpuCores, memory } from '../utils/format'

interface Sample {
  t: number
  cpu: number // cores
  mem: number // bytes
}
const CAP = 40
const INTERVAL = 15000

/** 资源监控：每 15s 采样 metrics-server 的 CPU/内存，累积成迷你实时折线（打开页面起的采样）。kind='cluster' 时加总所有节点用量，name 可省略 */
export function MonitorPanel({ cluster, kind, name, capacity }: { cluster: string; kind: 'node' | 'pod' | 'cluster'; name?: string; capacity?: { cpu: number; mem: number } }) {
  const [samples, setSamples] = useState<Sample[]>([])
  const seq = useRef(0)

  const poll = useCallback(async () => {
    if (!cluster || (kind !== 'cluster' && !name)) return
    const id = ++seq.current
    try {
      const list = kind === 'pod' ? await clusterApi.podMetrics(cluster) : await clusterApi.nodeMetrics(cluster)
      let cpu = 0
      let mem = 0
      if (kind === 'cluster') {
        for (const m of list ?? []) {
          cpu += cpuCores(m.usage?.cpu)
          mem += bytes(m.usage?.memory)
        }
      } else {
        const m = (list ?? []).find((x) => x.metadata?.name === name)
        cpu = cpuCores(m?.usage?.cpu)
        mem = bytes(m?.usage?.memory)
      }
      const sample: Sample = { t: Date.now(), cpu, mem }
      // 仅接受最新一次请求结果，避免竞态
      if (id === seq.current) setSamples((prev) => (prev.length >= CAP ? [...prev.slice(1), sample] : [...prev, sample]))
    } catch {
      /* 无 metrics-server 时静默 */
    }
  }, [cluster, kind, name])

  useEffect(() => {
    setSamples([])
    void poll()
    const timer = setInterval(() => void poll(), INTERVAL)
    return () => clearInterval(timer)
  }, [poll])

  const latest = samples[samples.length - 1]
  const cur = kind === 'node' ? { cpu: cpuCores, mem: memory } : { cpu: cpuCores, mem: memory }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Gauge
        title="CPU 使用量"
        unit=""
        cur={`${(latest?.cpu ?? 0).toFixed(3)} 核`}
        cap={capacity ? `总量 ${capacity.cpu.toFixed(1)} 核` : undefined}
        values={samples.map((s) => s.cpu)}
        color="#329dce"
      />
      <Gauge
        title="内存使用量"
        unit=""
        cur={cur.mem(latest?.mem)}
        cap={capacity ? `总量 ${memory(capacity.mem)}` : undefined}
        values={samples.map((s) => s.mem)}
        color="#3ca96a"
      />
      {samples.length === 0 && (
        <Typography.Text type="secondary" className="col-span-full !text-xs">
          暂无指标数据（需集群安装 metrics-server）。有数据后每 15 秒采样一个点。
        </Typography.Text>
      )}
    </div>
  )
}

function Gauge({ title, unit, cur, cap, values, color }: { title: string; unit: string; cur: string; cap?: string; values: number[]; color: string }) {
  const w = 320
  const h = 70
  const max = Math.max(...values, 1)
  const pts = values.map((v, i) => {
    const x = values.length > 1 ? (i / (values.length - 1)) * w : 0
    const y = h - (v / max) * (h - 8) - 4
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const line = pts.join(' ')
  const area = values.length ? `0,${h} ${line} ${w},${h}` : ''

  return (
    <div className="rounded-lg border border-slate-100 p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-slate-500">{title}</span>
        {cap && <span className="text-xs text-slate-400">{cap}</span>}
      </div>
      <div className="mt-1 text-xl font-semibold text-slate-800">
        {cur}
        {unit ? <span className="ml-1 text-xs font-normal text-slate-400">{unit}</span> : null}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-[70px] w-full" preserveAspectRatio="none">
        {values.length > 1 && (
          <>
            <polygon points={area} fill={color} opacity={0.12} />
            <polyline points={line} fill="none" stroke={color} strokeWidth={1.6} />
          </>
        )}
      </svg>
    </div>
  )
}

export default MonitorPanel
