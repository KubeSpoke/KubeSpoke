import { useId } from 'react'

/** 品牌标：蓝色渐变六边形 + 白色舵轮，登录页、顶栏与 favicon 共用 */
export default function BrandMark({ size = 44 }: { size?: number }) {
  const gradientId = `ks-hex-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const spokes = [0, 45, 90, 135].map((deg) => (
    <line
      key={deg}
      x1={24}
      y1={24}
      x2={24 + 13 * Math.cos((deg * Math.PI) / 180)}
      y2={24 + 13 * Math.sin((deg * Math.PI) / 180)}
      stroke="#fff"
      strokeWidth={2.6}
      strokeLinecap="round"
    />
  ))
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5EA0FF" />
          <stop offset="1" stopColor="#1668DC" />
        </linearGradient>
      </defs>
      <path d="M24 2 43 13v22L24 46 5 35V13L24 2Z" fill={`url(#${gradientId})`} />
      <circle cx="24" cy="24" r="13" stroke="#fff" strokeWidth="2.6" />
      {spokes}
      <circle cx="24" cy="24" r="4" fill="#fff" />
    </svg>
  )
}
