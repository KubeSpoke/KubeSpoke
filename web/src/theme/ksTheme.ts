import { theme as antdTheme } from 'antd'
import type { ThemeConfig } from 'antd'

/**
 * KubeSpoke 全局 UI 配置文件（唯一入口）
 * ------------------------------------------------------------------
 * 目标：把控制台整体配色 / 圆角 / 间距 / 组件观感对齐 KubeSphere 后台。
 *   - buildKsTheme(mode) → antd ConfigProvider（main.tsx 消费，明暗两套）
 *   - ksTokens           → index.css 里 @theme 的镜像（Tailwind 侧同源）
 *
 * 明暗两套的取色策略不同：
 *   亮色：自定义 KubeSphere 调色板（白外壳 → 画布 #f2f5f9 → 白卡片）。
 *   暗色：antd 默认暗黑配色 —— 只切 darkAlgorithm，不再覆盖任何颜色 token，
 *         容器 #141414 / 浮层 #1f1f1f / 画布 #000（跟 antd 官方控制台一致观感）。
 *         暗色的 CSS 变量（index.css 的 [data-theme='dark'] 块）与这里的默认值保持同源。
 */

export type ThemeMode = 'light' | 'dark'

/** 一套调色板的字段结构（明暗两套共用，只换值不换键） */
export interface KsPalette {
  brand: string
  brandHover: string
  brandActive: string
  brandBg: string
  ink: string
  text: string
  textBody: string
  textMuted: string
  textPlaceholder: string
  surface: string
  canvas: string
  subtle: string
  fill: string
  fillHover: string
  fillActive: string
  border: string
  borderLight: string
  rowHover: string
  field: string
  fieldHover: string
  success: string
  warning: string
  danger: string
  info: string
  ring: string
  selectedBg: string
  shadowPopup: string
}

/** 亮色调色板 —— 品牌蓝取自 logo 与登录页，中性色按 KubeSphere 控制台逐像素取色 */
export const palette: KsPalette = {
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
  /** 页面画布背景（比白面略深一档，用来替代分区线） */
  canvas: '#f2f5f9',
  /** 分区 / 表头 / 搜索框浅底 */
  subtle: '#f2f5f9',
  /** 控件底色（去线后按钮 / 输入框都靠底色区分） */
  fill: '#f2f5f9',
  fillHover: '#eaeff7',
  fillActive: '#e2e9f3',
  /** 主分隔线 / 卡片边框 */
  border: '#eef1f5',
  /** 弱分隔线（表格行） */
  borderLight: '#f1f4f8',
  /** 行悬停 */
  rowHover: '#f4f7fb',
  /** 可编辑控件的描边（表单里"看得见框"的唯一来源） */
  field: '#dbe2ed',
  fieldHover: '#c2cede',
  /** 状态色，对齐 KS 资源健康点 */
  success: '#59c492',
  warning: '#f5a623',
  danger: '#d94f4f',
  info: '#2f6fed',
  /** 焦点光环 */
  ring: 'rgba(47,111,237,0.14)',
  /** 选中项浅底（下拉选项 / 行高亮） */
  selectedBg: '#eef4ff',
  /** 弹层/卡片投影 */
  shadowPopup: '0 16px 40px -16px rgba(16,24,40,0.24), 0 4px 10px -6px rgba(16,24,40,0.1)',
}

/** 布局度量 —— 去线留白：面更大圆角、控件更圆、间距更松（明暗共用） */
export const KS = {
  headerH: 54,
  siderW: 240,
  siderCollapsedW: 64,
  breadcrumbH: 46,
  contentPadding: 24,
  radiusCard: 14,
  radiusControl: 10,
  /** 白面托底投影（与 index.css 的 --ks-shadow-panel 同源） */
  shadowPanel: '0 1px 2px rgba(16,24,40,0.04), 0 16px 32px -28px rgba(16,24,40,0.3)',
  shadowPopup: '0 16px 40px -16px rgba(16,24,40,0.24), 0 4px 10px -6px rgba(16,24,40,0.1)',
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

/** 明暗共用的组件结构 token：只动「线」与「度量」，颜色交给算法或亮色调色板 */
function ksComponents(dark: boolean, p: KsPalette): ThemeConfig['components'] {
  return {
    Layout: {
      headerHeight: KS.headerH,
      headerPadding: '0 24px',
    },
    Menu: {
      itemHeight: 38,
      itemBorderRadius: KS.radiusControl,
      iconMarginInlineEnd: 10,
      iconSize: 15,
      groupTitleFontSize: 12,
      subMenuItemBg: 'transparent',
      activeBarBorderWidth: 0,
      activeBarWidth: 0,
    },
    Card: {
      borderRadiusLG: KS.radiusCard,
      paddingLG: 24,
      colorBorderSecondary: 'transparent',
    },
    Table: {
      // 表头只剩灰字，行列之间只剩行高
      headerBg: 'transparent',
      headerSplitColor: 'transparent',
      borderColor: 'transparent',
      headerBorderRadius: 0,
      footerBg: 'transparent',
      cellPaddingBlock: 16,
      cellPaddingInline: 16,
      cellPaddingBlockSM: 16,
      cellPaddingInlineSM: 16,
      cellFontSizeSM: 13,
    },
    Button: {
      borderRadius: KS.radiusControl,
      fontWeight: 400,
      primaryShadow: 'none',
      defaultShadow: 'none',
      controlHeightSM: 28,
      paddingInlineSM: 14,
    },
    Tabs: {
      horizontalItemPadding: '14px 4px',
    },
    Breadcrumb: {
      fontSize: 13,
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Input: {
      controlHeight: 34,
    },
    InputNumber: {},
    Select: {
      controlHeight: 34,
      borderRadius: KS.radiusControl,
      optionSelectedFontWeight: 500,
    },
    Segmented: {
      trackPadding: 3,
      borderRadius: KS.radiusControl,
    },
    Descriptions: {
      labelBg: 'transparent',
    },
    Statistic: {
      contentFontSize: 22,
      titleFontSize: 12,
    },
    Modal: {
      borderRadiusLG: 16,
    },
    Popover: {
      borderRadiusLG: 12,
    },
    Tooltip: {
      borderRadius: 8,
    },
    Notification: {
      borderRadiusLG: 12,
    },
    Dropdown: {},
    Pagination: {
      itemBg: 'transparent',
    },
    Collapse: {
      headerBg: 'transparent',
      contentBg: 'transparent',
    },
    ...(dark
      ? {}
      : {
          // —— 亮色专属的配色 token ——
          Layout: {
            headerHeight: KS.headerH,
            headerPadding: '0 24px',
            // 去线后靠色差分块：外壳（顶栏 + 侧栏）一档，内容区退到画布色，卡片再浮回来
            headerBg: p.surface,
            bodyBg: p.canvas,
            siderBg: p.surface,
            lightSiderBg: p.surface,
            triggerBg: p.surface,
          },
          Menu: {
            itemBg: 'transparent',
            itemColor: p.textBody,
            itemHoverBg: p.rowHover,
            itemHoverColor: p.brand,
            itemSelectedBg: p.brandBg,
            itemSelectedColor: p.brand,
            itemActiveBg: p.brandBg,
            groupTitleColor: p.textPlaceholder,
            darkItemBg: 'transparent',
            darkItemColor: p.textBody,
            darkItemSelectedBg: p.brandBg,
            darkItemSelectedColor: p.brand,
            darkItemHoverBg: p.rowHover,
            darkSubMenuItemBg: 'transparent',
          },
          Table: {
            headerColor: p.textMuted,
            rowHoverBg: p.rowHover,
            colorBgContainer: p.surface,
          },
          Button: {
            // 主按钮＝品牌蓝实心（全站唯一来源，页面不要再写内联渐变覆盖）
            colorPrimary: p.brand,
            colorPrimaryHover: p.brandHover,
            colorPrimaryActive: p.brandActive,
            // 次按钮用灰面替代描边
            defaultBg: p.fill,
            defaultColor: p.textBody,
            defaultBorderColor: 'transparent',
            defaultHoverBg: p.fillHover,
            defaultHoverColor: p.text,
            defaultHoverBorderColor: 'transparent',
            defaultActiveBg: p.fillActive,
            defaultActiveColor: p.text,
            defaultActiveBorderColor: 'transparent',
          },
          Tabs: {
            inkBarColor: p.brand,
            itemSelectedColor: p.brand,
            itemHoverColor: p.brand,
            itemColor: p.textMuted,
          },
          Breadcrumb: {
            itemColor: p.textMuted,
            lastItemColor: p.text,
            separatorColor: p.textPlaceholder,
          },
          Tag: {
            defaultBg: p.subtle,
            defaultColor: p.textBody,
          },
          Card: {
            colorBgContainer: p.surface,
          },
          Input: {
            activeBorderColor: 'transparent',
            hoverBorderColor: 'transparent',
            activeShadow: `0 0 0 3px ${p.ring}`,
            activeBg: p.surface,
            colorBgContainer: p.surface,
          },
          InputNumber: {
            activeBorderColor: 'transparent',
            hoverBorderColor: 'transparent',
            activeShadow: `0 0 0 3px ${p.ring}`,
            colorBgContainer: p.surface,
          },
          Select: {
            activeBorderColor: 'transparent',
            hoverBorderColor: 'transparent',
            activeOutlineColor: p.ring,
            optionSelectedBg: p.selectedBg,
            colorBgContainer: p.surface,
            selectorBg: p.surface,
            optionSelectedColor: p.brand,
          },
          Segmented: {
            itemSelectedBg: p.surface,
            itemSelectedColor: p.brand,
            trackBg: '#eef2f8',
          },
          Descriptions: {
            titleColor: p.text,
            contentColor: p.textBody,
          },
          Modal: {
            contentBg: p.surface,
            headerBg: 'transparent',
          },
          Drawer: {
            colorBgElevated: p.surface,
          },
          Popover: {
            colorBgElevated: p.surface,
          },
          Tooltip: {
            colorBgSpotlight: 'rgba(21,35,58,0.92)',
          },
          Empty: {
            colorTextDescription: p.textMuted,
          },
          Dropdown: {
            colorBgElevated: p.surface,
          },
        }),
  }
}

/** 明暗两套主题 —— 交给 ConfigProvider.theme */
export function buildKsTheme(mode: ThemeMode = 'light'): ThemeConfig {
  const p = palette
  const dark = mode === 'dark'

  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      // —— 尺寸与字形：明暗共用 ——
      borderRadius: KS.radiusControl,
      borderRadiusSM: 8,
      borderRadiusLG: KS.radiusCard,
      fontSize: 13,
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      controlHeight: 34,
      wireframe: false,
      // 去线：全局分隔线一律透明（这是「结构去线」的全局开关）。
      // 注意 colorBorder 不能跟着设透明 —— 它是 antd 所有控件边框的唯一来源，
      // 置零会连带抹掉输入框、文本域、复选框、开关、上传框的边界，表单里就"看不见框"。
      colorSplit: 'transparent',
      ...(dark
        ? {
            // 暗色 = antd 默认暗黑配色（容器 #141414 / 浮层 #1f1f1f / 画布 #000，
            // 文字 rgba(255,255,255,.85/.65/.45/.25)，边框 #424242 / #303030），
            // 一个颜色 token 都不覆盖，观感与 antd 官方暗色一致。
          }
        : {
            // —— 亮色专属配色 ——
            colorPrimary: p.brand,
            colorInfo: p.brand,
            colorSuccess: p.success,
            colorWarning: p.warning,
            colorError: p.danger,
            colorText: p.text,
            colorTextSecondary: p.textMuted,
            colorTextDescription: p.textMuted,
            colorTextPlaceholder: p.textPlaceholder,
            colorBgBase: p.surface,
            colorBgContainer: p.surface,
            colorBgElevated: p.surface,
            colorBgLayout: p.canvas,
            colorBorder: p.field,
            colorBorderSecondary: '#e9eef6',
            colorFillAlter: p.subtle,
            // 必须给实色：antd 的 Empty 插画用它做「盒子主体」的填充，
            // 一旦传 undefined，FastColor 会把它算成 #000000，空态就变成一块黑。
            colorFillQuaternary: p.fill,
            boxShadow: p.shadowPopup,
            boxShadowSecondary: p.shadowPopup,
          }),
    },
    components: ksComponents(dark, p),
  }
}

/** 兼容旧引用：默认亮色主题 */
export const ksTheme = buildKsTheme('light')

export default ksTheme
