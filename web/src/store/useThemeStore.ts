import { create } from 'zustand'
import type { ThemeMode } from '../theme/ksTheme'

/**
 * 明暗主题状态
 * ------------------------------------------------------------------
 * 值只有 light / dark 两态，初始值优先取用户上次选择，其次跟随系统偏好。
 * 持久化用手写 localStorage（不是 zustand/persist），因为 index.html 里有一段
 * 内联脚本要在首屏渲染前抢先读到同一个 key，避免暗色用户看到一帧白屏。
 * 两处必须保持同一个 key 名与取值格式：ks.theme = 'light' | 'dark'。
 */
export const THEME_KEY = 'ks.theme'

/** 与 index.html 内联脚本保持一致的取值逻辑 */
export function readInitialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* 隐私模式下 localStorage 可能不可用，退回系统偏好 */
  }
  const prefersDark =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'light'
}

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: readInitialMode(),

  setMode: (mode) => {
    try {
      localStorage.setItem(THEME_KEY, mode)
    } catch {
      /* 存不下就只在本次会话生效 */
    }
    set({ mode })
  },

  toggle: () => get().setMode(get().mode === 'dark' ? 'light' : 'dark'),
}))
