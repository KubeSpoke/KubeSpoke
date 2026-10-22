import { theme as antdTheme } from 'antd'
import type { ThemeConfig } from 'antd'

/**
 * KubeSpoke 全局 UI 配置文件（唯一入口）
 * ------------------------------------------------------------------
 * 目标：把控制台整体配色 / 圆角 / 间距 / 组件观感对齐 KubeSphere 后台。
 * 改这一个文件即可全站生效：
 *   - ksTheme  → antd ConfigProvider（main.tsx 消费）
 *   - KS       → 布局度量与调色板，供外壳与内联样式引用
 *   - ksTokens → index.css 里 @theme 的镜像（Tailwind 侧同源，避免两处漂移）
 * 所有颜色都来自 KubeSphere 官方控制台取色，品牌强调色对齐站内蓝（#2f6fed，与 logo/登录页/仪表盘同源）。
 */

/** 站内调色板 —— 品牌蓝取自 logo 与登录页，中性色按 KubeSphere 控制台逐像素取色（v4.2.1 实例） */
export const palette = {
  /** 品牌强调色（蓝）：链接悬停、选中菜单文字、Tab 下划线、开关 */
  brand: '#2f6fed',
  brandHover: '#4f8bff',
  brandActive: '#1f5fe0',
  brandBg: '#e8f1ff',
  /** 顶栏 / logo 深色 */
  ink: '#242e42',
  /** 标题文字（深，带蓝调） */
  text: '#222b45',
  /** 正文 */
  textBody: '#36435c',
  /** 次要 / 表头 / 说明文字 */
  textMuted: '#8f9aa9',
  /** 占位 / 禁用 */
  textPlaceholder: '#a0aab8',
  /** 卡片 / 容器背景 */
  surface: '#ffffff',
  /** 页面画布背景 */
  canvas: '#f9fbfd',
  /** 分区 / 表头 / 搜索框浅底 */
  subtle: '#f4f6fa',
  /** 主分隔线 / 卡片边框 */
  border: '#ebeef2',
  /** 弱分隔线（表格行） */
  borderLight: '#ebeef2',
  /** 行悬停 */
  rowHover: '#f9fbfc',
  /** 状态色，对齐 KS 资源健康点 */
  success: '#59c492',
  warning: '#f5a623',
  danger: '#d94f4f',
  info: '#2f6fed',
} as const

/** 布局度量 —— 复刻 KubeSphere 应用外壳尺寸 */
export const KS = {
  headerH: 54,
  siderW: 240,
  siderCollapsedW: 64,
  breadcrumbH: 46,
  contentPadding: 24,
  radiusCard: 4,
  radiusControl: 4,
  palette,
} as const

/**
 * Tailwind v4 的 @theme 令牌镜像，写入 index.css 使用。
 * 保持与 antd token 同源；如改色，改这里 + palette 一起。
 */
export const ksTokens = {
  '--color-brand': palette.brand,
  '--color-brand-hover': palette.brandHover,
  '--color-ink': palette.ink,
  '--color-canvas': palette.canvas,
  '--color-shell': palette.ink,
  '--color-line': palette.border,
  '--color-ok': palette.success,
  '--color-warn': palette.warning,
  '--color-danger': palette.danger,
} as const

/** antd 全局主题 —— 交给 ConfigProvider.theme */
export const ksTheme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: palette.brand,
    colorInfo: palette.brand,
    colorSuccess: palette.success,
    colorWarning: palette.warning,
    colorError: palette.danger,
    colorText: palette.text,
    colorTextSecondary: palette.textMuted,
    colorTextDescription: palette.textMuted,
    colorBorder: palette.border,
    colorBorderSecondary: palette.border,
    colorBgLayout: palette.canvas,
    borderRadius: KS.radiusControl,
    fontSize: 13,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    controlHeight: 32,
    wireframe: false,
  },
  components: {
    Layout: {
      headerBg: palette.surface,
      headerHeight: KS.headerH,
      headerPadding: '0 20px',
      bodyBg: palette.canvas,
      siderBg: palette.surface,
      triggerBg: palette.surface,
    },
    Menu: {
      // KubeSphere 上下文左侧菜单：白底、分组小灰标题、选中浅蓝底 + 品牌字（无左侧强调条）
      itemBg: 'transparent',
      itemHeight: 40,
      itemColor: palette.textBody,
      itemHoverBg: palette.subtle,
      itemHoverColor: palette.brand,
      itemSelectedBg: palette.brandBg,
      itemSelectedColor: palette.brand,
      itemActiveBg: palette.brandBg,
      iconMarginInlineEnd: 10,
      iconSize: 15,
      groupTitleColor: palette.textPlaceholder,
      groupTitleFontSize: 12,
      subMenuItemBg: 'transparent',
      activeBarBorderWidth: 0,
    },
    Card: {
      borderRadiusLG: KS.radiusCard,
      paddingLG: 20,
      colorBorderSecondary: palette.border,
    },
    Table: {
      // KubeSphere 表头：极浅蓝灰底 + 中灰小字 + 单条浅分隔线
      headerBg: palette.subtle,
      headerColor: palette.textMuted,
      headerSplitColor: 'transparent',
      borderColor: palette.border,
      rowHoverBg: palette.rowHover,
      cellPaddingBlockSM: 12,
      cellFontSizeSM: 13,
      headerBorderRadius: 0,
    },
    Button: {
      // 主按钮＝品牌蓝实心（全站唯一来源，页面不要再写内联渐变覆盖）
      colorPrimary: palette.brand,
      colorPrimaryHover: palette.brandHover,
      colorPrimaryActive: palette.brandActive,
      borderRadius: 6,
      fontWeight: 400,
      primaryShadow: 'none',
      defaultShadow: 'none',
      controlHeightSM: 28,
      paddingInlineSM: 14,
    },
    Tabs: {
      // 胶囊式类型切换由 index.css .ks-tabs 承接
      horizontalItemPadding: '6px 16px',
      inkBarColor: palette.brand,
      itemSelectedColor: palette.brand,
      itemHoverColor: palette.brand,
    },
    Breadcrumb: {
      itemColor: palette.textMuted,
      lastItemColor: palette.text,
      separatorColor: palette.textPlaceholder,
      fontSize: 13,
    },
    Tag: {
      borderRadiusSM: 2,
      defaultBg: palette.subtle,
    },
    Input: { controlHeight: 32 },
    Select: { controlHeight: 32 },
    Segmented: {
      itemSelectedBg: palette.brand,
      itemSelectedColor: '#fff',
      trackBg: palette.subtle,
    },
    Descriptions: {
      titleColor: palette.text,
      contentColor: palette.textBody,
      labelBg: palette.subtle,
    },
    Statistic: {
      contentFontSize: 22,
      titleFontSize: 12,
    },
  },
}

export default ksTheme
