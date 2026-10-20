/** k8s Quantity / 相对时间等展示换算 */

export const age = (iso?: string | null): string => {
  if (!iso) return '-'
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return '-'
  const units: [number, string][] = [
    [31536000, '年'],
    [2592000, '月'],
    [86400, '天'],
    [3600, '小时'],
    [60, '分钟'],
  ]
  const sec = Math.max(0, Math.floor(diff / 1000))
  for (const [size, label] of units) {
    if (sec >= size) return `${Math.floor(sec / size)}${label}`
  }
  return `${sec}秒`
}

export const datetime = (iso?: string | null): string => (iso ? new Date(iso).toLocaleString('zh-CN') : '-')

/** "1234567890n" | 1234567 -> "1.23 核" */
export const cpu = (value?: string | number): string => {
  if (value === undefined || value === null || value === '') return '-'
  const raw = String(value)
  const num = raw.endsWith('n')
    ? Number(raw.slice(0, -1)) / 1e9
    : raw.endsWith('m')
      ? Number(raw.slice(0, -1)) / 1e3
      : Number(raw)
  if (Number.isNaN(num)) return raw
  return `${num.toFixed(2)} 核`
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
const SUFFIX: Record<string, number> = { k: 1e3, M: 1e6, G: 1e9, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4 }

/** "12345678" | "128Mi" -> "12.3 MiB" */
export const memory = (value?: string | number): string => {
  if (value === undefined || value === null || value === '') return '-'
  const raw = String(value)
  const match = /^([\d.]+)([A-Za-z]+)?$/.exec(raw)
  if (!match) return raw
  let bytes = Number(match[1])
  if (match[2]) bytes *= SUFFIX[match[2]] ?? 1
  if (Number.isNaN(bytes)) return raw
  let i = 0
  while (bytes >= 1024 && i < UNITS.length - 1) {
    bytes /= 1024
    i += 1
  }
  return `${bytes.toFixed(i === 0 ? 0 : 1)} ${UNITS[i]}`
}

export const percent = (used?: number, total?: number): number => {
  if (!used || !total) return 0
  return Math.min(100, Math.round((used / total) * 100))
}

export const cpuCores = (value?: string | number): number => {
  const raw = String(value ?? '')
  if (raw.endsWith('n')) return Number(raw.slice(0, -1)) / 1e9
  if (raw.endsWith('m')) return Number(raw.slice(0, -1)) / 1e3
  return Number(raw) || 0
}

export const bytes = (value?: string | number): number => {
  const raw = String(value ?? '')
  const match = /^([\d.]+)([A-Za-z]+)?$/.exec(raw)
  if (!match) return 0
  return Number(match[1]) * (match[2] ? (SUFFIX[match[2]] ?? 1) : 1)
}
