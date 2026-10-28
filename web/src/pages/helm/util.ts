import { datetime } from '../../utils/format'

/**
 * helm 的状态串是小写连字符形式（deployed / pending-install / failed …），
 * PageShell 的 StatusDot 认的是 K8s Phase，所以配色自己出一份。
 */
const GREEN = 'var(--color-ok)'
const ORANGE = 'var(--color-warn)'
const RED = 'var(--color-danger)'
const GREY = 'var(--ks-muted)'

export const helmTone = (status?: string): string => {
  const s = (status ?? '').toLowerCase()
  if (s === 'deployed' || s === 'installed') return GREEN
  if (s === 'uninstalled' || s === 'superseded') return GREY
  if (s.startsWith('pending') || s === 'uninstalling') return ORANGE
  if (s === 'failed') return RED
  return GREY
}

/** helm 给的时间多数是 RFC3339，个别仓库里是原文串，解析不动就原样显示 */
export function helmTime(raw?: string | null): string {
  if (!raw) return '-'
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? raw : datetime(raw)
}

/** 名称列的 chart 副标题：列表里 chart 名和版本本来就要贴在一起看 */
export const chartLabel = (chart: string, version: string): string =>
  [chart, version].filter(Boolean).join(' · ')

/** library 类型的 chart 只是一段模板，不能直接安装 */
export const isInstallable = (type?: string): boolean => (type ?? '').toLowerCase() !== 'library'

/** helm 能直接吃的引用：打包好的 .tgz 链接或 oci:// 路径，这种来源不需要再选仓库 */
export function isChartRef(chart: string): boolean {
  const raw = chart.trim()
  return /^oci:\/\//i.test(raw) || /\.tgz($|\?)/i.test(raw)
}

/** release 名按 helm 的 DNS-1123 子域校验（小写字母数字、连字符、点，最长 53），界面先拦一句免得白等一次 RPC */
export const NAME_RULE = [
  { required: true, message: '请填写 release 名称' },
  { max: 53, message: 'release 名不超过 53 个字符' },
  {
    pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/,
    message: '只能用小写字母、数字、连字符和点，且不能以连字符或点开头结尾',
  },
]
