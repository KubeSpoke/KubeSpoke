import { RightOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'

/**
 * 统计卡（各页顶部那排可点筛选的小卡）。
 *
 * 选中态不是"再叠一层淡色"就完事：卡面换成品牌浅底后，
 * 里面的说明文字如果还留在 --ks-muted，就会陷进底色里，越选越看不清。
 * 所以选中时同时把标签/副数值提到 --ks-body，图标砖翻成白底，箭头变品牌色。
 * 这些规则统一写在 index.css 的 .ks-stat-active 下，页面里不用再各写一套。
 */
export interface StatCardProps {
  label: string
  value: number | string
  /** 分母：不传就不显示「/ N」 */
  total?: number
  /** 右侧比例文案，如 "40%" */
  pct?: string
  /** 数值后缀单位，如 "核" */
  unit?: string
  /** 右侧自定义尾注（与 pct 二选一） */
  tail?: ReactNode
  color?: string
  bg?: string
  icon: ReactNode
  /** 当前是否处于筛选选中态 */
  active?: boolean
  onClick?: () => void
}

export function StatCard({
  label,
  value,
  total,
  pct,
  unit,
  tail,
  color,
  bg,
  icon,
  active,
  onClick,
}: StatCardProps) {
  const accent = color ?? 'var(--color-brand)'
  const iconBg = bg ?? 'var(--ks-brand-bg)'
  const clickable = Boolean(onClick)

  return (
    <div
      className={[
        'flex items-center justify-between px-4 py-3 ks-panel',
        clickable ? 'cursor-pointer ks-panel-hover' : '',
        active ? 'ks-stat-active' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={active ? { background: 'var(--ks-brand-bg)' } : undefined}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-pressed={clickable ? Boolean(active) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
    >
      <div className="flex items-center gap-3">
        <span
          className="ks-stat-icon grid size-10 place-items-center rounded-lg text-lg"
          style={{ background: iconBg, color: accent }}
        >
          {icon}
        </span>
        <div>
          <div className="ks-stat-label text-xs" style={{ color: 'var(--ks-muted)' }}>
            {label}
          </div>
          <div className="text-xl font-bold leading-6" style={{ color: 'var(--ks-ink)' }}>
            {value}
            {total !== undefined && (
              <span className="ks-stat-sub ml-1 text-xs font-normal" style={{ color: 'var(--ks-muted)' }}>
                / {total}
              </span>
            )}
            {unit && (
              <span className="ks-stat-sub ml-1 text-xs font-normal" style={{ color: 'var(--ks-muted)' }}>
                {unit}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {pct && (
          <span className="ks-stat-sub text-xs" style={{ color: 'var(--ks-muted)' }}>
            {pct}
          </span>
        )}
        {tail != null && (
          <span className="ks-stat-sub whitespace-nowrap text-xs" style={{ color: 'var(--ks-muted)' }}>
            {tail}
          </span>
        )}
        {clickable && <RightOutlined className="ks-stat-arrow" style={{ color: 'var(--ks-faint)', fontSize: 12 }} />}
      </div>
    </div>
  )
}

export default StatCard
