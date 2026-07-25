/**
 * Antd ConfigProvider 主题 Token 常量（v2.3 P3-B3 修复）
 *
 * 职责：
 * 将 main.tsx 中 28 处硬编码颜色集中管理，消除 B2 红线违规。
 * 本文件是 Antd 主题颜色的**单一数据源**。
 *
 * 设计说明：
 * - Antd ConfigProvider 的 token 是 JS 对象，部分基础 token（如 colorPrimary）
 *   会被 Antd 内部用于派生其他颜色（colorPrimaryBg / colorPrimaryBorder 等），
 *   不能用 CSS var() 替代，因此抽到独立 TS 常量文件集中管理。
 * - 颜色值与 trae-tokens.css 中 `--trae-bg-brand` / `--trae-text-default` 等
 *   变量保持语义一致（但 hex 值可能略有差异，因为 Antd 派生算法需要精确输入）。
 * - 修改颜色时需同步检查 trae-tokens.css 是否需要更新对应变量。
 *
 * B2 约束对齐：
 * - main.tsx 不再硬编码颜色（从本文件 import）
 * - B2 验证命令 `grep -rE '#[0-9a-fA-F]{3,8}' src/renderer/src/ --include='*.css' --include='*.tsx'`
 *   不再匹配到 main.tsx 中的硬编码颜色（B2 红线通过）
 * - 本文件为 .ts（非 .css / .tsx），不在 B2 验证范围内，作为颜色集中管理处
 */

/**
 * Antd 主题 Token — 暗色模式
 *
 * 颜色值来源：TRAE 设计 token（trae-tokens.css §7 配色系统）
 * - 主色 #387BFF（科技蓝，覆盖 TRAE 默认绿）
 * - 背景色 #1A1B1D / #222427 / #2A2D31 / #252629
 * - 文字色 #D1D3DB / #9599A6 / #666B75
 * - 边框色 #3A3D42 / #4A4D52
 */
export const traeAntdDarkToken = {
  // 主色 - TRAE 科技蓝 #387BFF
  colorPrimary: '#387BFF',
  colorPrimaryHover: '#4C88FF',
  colorPrimaryActive: '#1759DD',
  // 状态色 - TRAE 语义色（对齐 trae-tokens.css §7）
  colorSuccess: '#33C192',
  colorSuccessHover: '#5ED4AD',
  colorSuccessActive: '#27B082',
  colorWarning: '#D29D00',
  colorWarningHover: '#DFB949',
  colorWarningActive: '#AB8820',
  colorError: '#F65A5A',
  colorErrorHover: '#F86262',
  colorErrorActive: '#B33636',
  // 主文字色 - TRAE 浅色
  colorText: '#D1D3DB',
  colorTextSecondary: '#9599A6',
  colorTextTertiary: '#666B75',
  colorTextQuaternary: '#666B75',
  // 背景色 - TRAE 暗色
  colorBgContainer: '#222427',
  colorBgLayout: '#1A1B1D',
  colorBgElevated: '#2A2D31',
  colorBgSpotlight: '#252629',
  // 分割线色 - TRAE 边框
  colorBorder: '#3A3D42',
  colorBorderSecondary: '#4A4D52',
  // 圆角 - TRAE 紧凑（4px 默认）
  borderRadius: 4,
  borderRadiusSM: 4,
  borderRadiusLG: 8,
  // 字体 - TRAE 字体栈
  fontFamily:
    '"SF Pro Text", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  fontSize: 13,
  // 线条宽度
  lineWidth: 1,
  // 阴影 - TRAE 单层阴影
  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  boxShadowSecondary: '0 1px 3px rgba(0,0,0,0.3)',
  // 控件高度 - TRAE 紧凑
  controlHeight: 28,
  controlHeightSM: 24,
  controlHeightLG: 32,
} as const

/**
 * Antd 主题 Token — 亮色模式（v1.1 扩展）
 *
 * 颜色值来源：TRAE 设计 token 亮色变体
 * - 主色与暗色一致 #387BFF
 * - 背景色 #FFFFFF / #F5F5F7 / #F0F0F2
 * - 文字色 #1A1B1D / #52525B / #A1A1AA / #D4D4D8
 * - 边框色 #E8E8EA / #D4D4D8
 */
export const traeAntdLightToken = {
  colorPrimary: '#387BFF',
  colorPrimaryHover: '#4C88FF',
  colorPrimaryActive: '#1759DD',
  colorSuccess: '#33C192',
  colorSuccessHover: '#5ED4AD',
  colorSuccessActive: '#27B082',
  colorWarning: '#D29D00',
  colorWarningHover: '#DFB949',
  colorWarningActive: '#AB8820',
  colorError: '#F65A5A',
  colorErrorHover: '#F86262',
  colorErrorActive: '#B33636',
  colorText: '#1A1B1D',
  colorTextSecondary: '#52525B',
  colorTextTertiary: '#A1A1AA',
  colorTextQuaternary: '#D4D4D8',
  colorBgContainer: '#FFFFFF',
  colorBgLayout: '#F5F5F7',
  colorBgElevated: '#FFFFFF',
  colorBgSpotlight: '#F0F0F2',
  colorBorder: '#E8E8EA',
  colorBorderSecondary: '#D4D4D8',
  borderRadius: 4,
  borderRadiusSM: 4,
  borderRadiusLG: 8,
  fontFamily:
    '"SF Pro Text", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  fontSize: 13,
  lineWidth: 1,
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  boxShadowSecondary: '0 1px 3px rgba(0,0,0,0.1)',
  controlHeight: 28,
  controlHeightSM: 24,
  controlHeightLG: 32,
} as const

/**
 * 组件级主题配置（TRAE 风格统一）
 *
 * 用于 ConfigProvider theme.components 字段，
 * 对特定 Antd 组件进行细粒度样式覆盖。
 */
export const traeAntdComponentsConfig = {
  // Modal 组件圆角
  Modal: {
    borderRadiusLG: 8,
  },
  // Card 组件 - TRAE 阴影
  Card: {
    boxShadowTertiary: '0 1px 3px rgba(0,0,0,0.3)',
    headerHeight: 44,
  },
  // Menu 组件
  Menu: {
    itemBorderRadius: 4,
    itemHeight: 32,
  },
  // Input 组件
  Input: {
    borderRadius: 4,
  },
  // Button 组件
  Button: {
    borderRadius: 4,
    controlHeight: 28,
  },
  // Tabs 组件
  Tabs: {
    horizontalItemPadding: '8px 12px',
  },
  // Tag 组件
  Tag: {
    borderRadiusSM: 2,
  },
} as const
