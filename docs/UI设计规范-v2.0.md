# TDSF-Linux Desktop — UI 设计规范 v2.0（生产交付级极致美学）

> **版本**：v2.0（2026-07-16 发布）
> **核心升级**：从 v1.0 的"实用极简"升级为"商业级极致美学"
> **对标体系**：Apple HIG · Linear · Notion · Arc · Raycast · ChatGPT · Claude · LobeChat · Cherry Studio
> **维护人**：TDSF 前端架构组
> **适用范围**：`tdsf-linux-desktop` 全部 renderer 端代码

---

## 目录

- [1. 设计哲学](#1-设计哲学)
- [2. 数学基础（NEW）](#2-数学基础)
- [3. 颜色系统](#3-颜色系统)
- [4. 字体系统](#4-字体系统)
- [5. 间距系统](#5-间距系统)
- [6. 圆角系统](#6-圆角系统)
- [7. 阴影系统（NEW）](#7-阴影系统)
- [8. 动效曲线（NEW）](#8-动效曲线)
- [9. 交互模式](#9-交互模式)
- [10. 组件使用规范](#10-组件使用规范)
- [11. 图标与插画](#11-图标与插画)
- [12. 暗黑模式精修](#12-暗黑模式精修)
- [13. 响应式](#13-响应式)
- [14. 性能与可访问性（NEW）](#14-性能与可访问性)
- [15. 禁止的反模式](#15-禁止的反模式)
- [16. 检查清单（NEW）](#16-检查清单)

---

## 1. 设计哲学

### 1.1 核心理念

> **极致美学 = 数学 + 留白 + 节奏 + 微动效**

TDSF Desktop 2.0 不再是"能用即可"，而是追求**对标 Apple 官网 / Linear / Notion / Arc / Claude / ChatGPT** 的商业级品质。

四个核心关键词：

| 关键词 | 含义 | 实践 |
|--------|------|------|
| **克制** | 不多不少，恰到好处 | 移除一切冗余装饰，每个元素都有存在理由 |
| **精准** | 像素级对齐，黄金比例推导 | 所有尺寸基于 φ 数学推导 |
| **呼吸** | 大量留白，视觉舒适感 | 容器内边距 26px、区块间距 42px |
| **节奏** | 字号/间距/动效曲线统一 | 一致的视觉节拍 |

### 1.2 设计决策原则（WHY）

每个视觉决策必须回答三个问题：
1. **基于什么数学原理？**（φ = 1.618）
2. **参考了什么设计体系？**（Apple HIG / Linear / ...）
3. **带来什么体验提升？**（呼吸感 / 节奏感 / 可读性）

---

## 2. 数学基础（NEW）

### 2.1 黄金分割 φ = 1.6180339887

**φ 是自然界最高频出现的数学常数**：鹦鹉螺、向日葵、星系、人体比例。

**为什么 UI 要用 φ？**
- 人眼对 φ 比例天然感到"舒服"
- 它能产生无限递进的层次感
- 字号、间距、圆角、阴影全都能用 φ 推导

### 2.2 φ 在 UI 中的三大应用

#### 2.2.1 字号阶梯（Type Scale）

| Token | 像素 | 推导公式 | 用途 |
|-------|------|---------|------|
| `font-size-xs` | 12px | 基础 | 极小标签 |
| `font-size-sm` | 13.5px | 12 × 1.125 | 元信息 |
| `font-size-base` | 14px | 基础正文 | 默认文字 |
| `font-size-md` | 16px | 14 × 1.143 | 强调正文 |
| `font-size-lg` | 20px | 16 × 1.25 | 区块标题 |
| `font-size-xl` | 24px | 16 × 1.5 | 模态标题 |
| `font-size-2xl` | 32px | 20 × 1.6 ≈ φ | 页面标题 |
| `font-size-3xl` | 42px | 32 × 1.3125 | Hero 区 |
| `font-size-4xl` | 56px | 32 × 1.75 | 大屏 Hero |
| `font-size-5xl` | 72px | 56 × 1.286 | 极大标题 |
| `font-size-hero` | 96px | 仅 hero | 营销页 |

#### 2.2.2 间距系统（8px 栅格 + φ 衍生）

| Token | 像素 | 推导 | 场景 |
|-------|------|------|------|
| `--space-1` | 4px | 0.5 单位 | 极紧凑 |
| `--space-2` | 8px | 1 单位 | 组件内 |
| `--space-3` | 13px | φ × 8 ≈ 12.94 | 中等 |
| `--space-4` | 16px | 2 单位 | 容器内边距 |
| `--space-5` | 21px | 13 × φ ≈ 21.03 | 区块内 |
| `--space-6` | 26px | 16 × φ ≈ 25.88 | 容器内边距（主用） |
| `--space-7` | 34px | 21 × φ ≈ 33.97 | 区块间距 |
| `--space-8` | 42px | 26 × φ ≈ 42.07 | 大区块（主用） |
| `--space-9` | 55px | 34 × φ ≈ 55.0 | 页面级 |
| `--space-10` | 68px | 42 × φ ≈ 67.94 | 大页面 |
| `--space-11` | 89px | 55 × φ ≈ 88.99 | Hero |
| `--space-12` | 110px | 68 × φ ≈ 109.9 | 顶部留白 |

#### 2.2.3 圆角（φ 比例）

| Token | 像素 | 推导 | 应用 |
|-------|------|------|------|
| `--radius-xs` | 4px | 基础 | 小标签 |
| `--radius-sm` | 6px | 4 × 1.5 | 输入框 |
| `--radius-md` | 10px | 6 × 1.67 ≈ φ | 按钮/卡片 |
| `--radius-lg` | 16px | 10 × 1.6 ≈ φ | 弹窗 |
| `--radius-xl` | 26px | 16 × 1.625 ≈ φ | 大型弹窗 |
| `--radius-2xl` | 42px | 26 × 1.615 ≈ φ | Hero 卡片 |

### 2.3 行高 / 字距的数学关系

**行高 = φ × 基础值**：

| 场景 | line-height | 推导 |
|------|-------------|------|
| 紧凑（大标题） | 1.2 | 视觉紧凑 |
| 略紧（小标题） | 1.4 | 平衡可读 |
| **正文** | **1.618** | **黄金比例，呼吸感最强** |
| 长文本 | 1.8 | 极舒适 |
| 代码 | 1.5 | 等宽对齐 |

**字距（letter-spacing）**：

| 场景 | 值 | 视觉 |
|------|-----|------|
| 大标题 | -0.04em | 紧凑、专业 |
| 标题 | -0.02em | 略紧 |
| 正文 | 0 | 默认 |
| 小标签 | +0.02em | 透气 |
| 大写按钮 | +0.08em | 工业感 |

### 2.4 三栏布局的黄金比例

```
主面板三栏（serverList : main : ai）= 1 : 1.618 : 1
侧边详情（list : detail）= 1 : 1.618
对话框（input : button）= 8 : 1
```

**实际像素推导**（1440px 屏）：
- 总宽度 = 1440px - 280px(边距) = 1160px
- 主面板分割：220 : 580 : 360 ≈ 1 : 1.62 : 1.6
- 侧边详情：280 : 460 ≈ 1 : 1.64

---

## 3. 颜色系统

### 3.1 三层架构

```
原始色（Primitive）  →  语义色（Semantic）  →  组件色（Component）
--color-blue-500      →  --color-link         →  --button-primary-bg
--color-gray-900      →  --color-text-primary →  --text-title
```

### 3.2 完整 CSS 变量（v2.0 升级）

```css
:root {
  /* ===== 品牌色（链接蓝） ===== */
  --color-link: #0071e3;
  --color-link-hover: #0077ed;
  --color-link-active: #0058b0;
  --color-link-alpha-10: rgba(0, 113, 227, 0.10);
  --color-link-alpha-15: rgba(0, 113, 227, 0.15);
  --color-link-alpha-20: rgba(0, 113, 227, 0.20);
  --color-link-alpha-30: rgba(0, 113, 227, 0.30);

  /* ===== 品牌渐变（5% 暗度差） ===== */
  --gradient-primary: linear-gradient(
    180deg,
    var(--color-link) 0%,
    color-mix(in srgb, var(--color-link) 92%, black) 100%
  );

  /* ===== 背景三级 ===== */
  --color-bg-primary: #ffffff;
  --color-bg-card: #fafafa;
  --color-bg-elevated: #ffffff;

  /* ===== 文字四级（新增 tertiary） ===== */
  --color-text-primary: #1d1d1f;
  --color-text-secondary: #4a4a4a;
  --color-text-tertiary: #86868b;
  --color-text-quaternary: #c7c7cc;

  /* ===== 边框 ===== */
  --color-border: #f0f0f0;
  --color-border-strong: #e5e5e7;
  --color-border-focus: var(--color-link);

  /* ===== 状态色 ===== */
  --color-success: #34c759;
  --color-warning: #ff9500;
  --color-error: #ff3b30;
  --color-info: #0071e3;

  /* ===== 风险等级色（5 级） ===== */
  --color-risk-safe: #34c759;
  --color-risk-low: #30b0c7;
  --color-risk-medium: #ff9500;
  --color-risk-high: #ff6b35;
  --color-risk-critical: #ff3b30;

  /* ===== 终端色（始终深色） ===== */
  --color-terminal-bg: #1a1a1a;
  --color-terminal-text: #e8e8e8;
}
```

### 3.3 暗黑模式 5 级灰阶

```css
[data-theme='dark'] {
  /* 5 级灰阶（从深到浅） */
  --color-bg-primary: #1d1d1f;     /* 主背景（最深） */
  --color-bg-card: #2c2c2e;        /* 卡片背景 */
  --color-bg-elevated: #3a3a3c;    /* 弹窗背景 */
  --color-text-tertiary: #48484a;  /* 描边 */
  --color-text-quaternary: #636366;/* 极弱描边 */

  /* 文字 */
  --color-text-primary: #f5f5f7;
  --color-text-secondary: #d1d1d6;
  --color-text-tertiary: #86868b;

  /* 链接蓝（更亮更纯净） */
  --color-link: #0a84ff;
  --color-link-hover: #409cff;
}
```

### 3.4 颜色使用映射

| 场景 | 变量 | 示例 |
|------|------|------|
| 页面背景 | `--color-bg-primary` | `<body>` |
| 卡片背景 | `--color-bg-card` | `<Card>` |
| 弹窗/Modal | `--color-bg-elevated` | `<Modal>` |
| 标题文字 | `--color-text-primary` | `<h1>-<h3>` |
| 正文 | `--color-text-secondary` | `<p>` |
| 元信息 | `--color-text-tertiary` | 时间戳 |
| 极弱文字 | `--color-text-quaternary` | 占位符 |
| 链接 | `--color-link` | `<a>` |
| 风险高 | `var(--color-risk-high)` | 风险卡片左边框 |
| Focus 环 | `var(--color-link-alpha-15)` | `box-shadow` |

### 3.5 反模式（绝对禁止）

- ❌ 硬编码颜色（必须 `var(--color-*)`）
- ❌ 蓝紫渐变（`linear-gradient(135deg, #6366f1, #8b5cf6)`）
- ❌ 纯黑/纯白（暗黑模式禁用 `#000`、亮色禁用纯白卡片堆叠）
- ❌ 超过 3 种主色同时出现

---

## 4. 字体系统

### 4.1 字体栈（按优先级）

```css
/* 中英文字体优先级（系统优先 + 跨平台兼容） */
--font-family: -apple-system, BlinkMacSystemFont, 'SF Pro', 'PingFang SC',
  'Microsoft YaHei', 'HarmonyOS Sans', 'Inter', 'Segoe UI', Roboto,
  'Helvetica Neue', sans-serif;

/* 等宽字体（终端/代码） */
--font-family-mono: 'SF Mono', 'JetBrains Mono', 'Menlo', 'Consolas',
  Monaco, 'Courier New', monospace;
```

### 4.2 字号阶梯（11 档 φ 比例）

| Token | 像素 | 场景 |
|-------|------|------|
| `--font-size-xs` | 12px | 极小标签 |
| `--font-size-sm` | 13.5px | 元信息 |
| `--font-size-base` | 14px | 默认正文 |
| `--font-size-md` | 16px | 强调正文 |
| `--font-size-lg` | 20px | 区块标题 |
| `--font-size-xl` | 24px | 模态标题 |
| `--font-size-2xl` | 32px | 页面标题 |
| `--font-size-3xl` | 42px | Hero 区 |
| `--font-size-4xl` | 56px | 大屏 Hero |
| `--font-size-5xl` | 72px | 极大标题 |
| `--font-size-hero` | 96px | 营销 Hero |

### 4.3 行高（5 档）

| 场景 | 行高 | 变量 |
|------|------|------|
| 大标题 | 1.2 | `--line-height-tight` |
| 小标题 | 1.4 | `--line-height-snug` |
| **正文** | **1.618** | `--line-height-base` |
| 长文本 | 1.8 | `--line-height-loose` |
| 代码 | 1.5 | `--line-height-code` |

### 4.4 字距（5 档）

| 场景 | 值 | 变量 |
|------|-----|------|
| 大标题 | -0.04em | `--letter-spacing-tighter` |
| 标题 | -0.02em | `--letter-spacing-tight` |
| 正文 | 0 | `--letter-spacing-normal` |
| 小标签 | +0.02em | `--letter-spacing-wide` |
| 大写按钮 | +0.08em | `--letter-spacing-wider` |

### 4.5 字重（5 档）

| 档位 | 数值 | 场景 |
|------|------|------|
| Light | 300 | 大标题（仅展示） |
| Regular | 400 | 默认正文 |
| Medium | 500 | 强调 |
| Semibold | 600 | 标题 |
| Bold | 700 | 主标题/数字 |

### 4.6 字体抗锯齿 + 渲染优化

```css
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-feature-settings: 'kern' 1, 'liga' 1, 'calt' 1, 'ss01' 1;
}
```

### 4.7 数字等宽（tabular-nums）

```css
.tabular-nums {
  font-variant-numeric: tabular-nums;
}
```

---

## 5. 间距系统

### 5.1 12 档间距（4 → 110px）

完整列表见 §2.2.2。

### 5.2 使用场景

| 场景 | 推荐值 | 变量 |
|------|--------|------|
| 组件内 padding | 8-13px | `--space-2/3` |
| 卡片 padding | 16-21px | `--space-4/5` |
| 卡片间距 | 26px | `--space-6` |
| 区块间距 | 42px | `--space-8` |
| 容器内边距 | 26px | `--space-6` |
| 页面边距 | 34-42px | `--space-7/8` |

### 5.3 三栏布局比例

```css
/* 主面板：1 : 1.618 : 1 */
.main-layout-left { width: 220px; }     /* 1 单位 */
.main-layout-center { flex: 1.618; }    /* φ 单位 */
.main-layout-right { width: 360px; }    /* 约 1.6 单位 */

/* 实际像素（1440px 屏）：240 : 580 : 360 ≈ 1 : 2.42 : 1.5 */
/* 注：实际应用会根据内容调整，比例核心是中心占主导 */
```

---

## 6. 圆角系统

### 6.1 6 档圆角（φ 衍生）

完整列表见 §2.2.3。

### 6.2 应用场景

| 元素 | 圆角 | 变量 |
|------|------|------|
| Tag/小标签 | 4-6px | `--radius-xs/sm` |
| 输入框 | 10px | `--radius-md` |
| 按钮 | 10px | `--radius-md` |
| 卡片 | 12-16px | `--radius-md/lg` |
| 弹窗/Modal | 16-26px | `--radius-lg/xl` |
| 消息气泡 | 18px | 自定义 |
| 头像/徽章 | 50% | `--radius-full` |

---

## 7. 阴影系统（NEW）

### 7.1 7 级阴影

| Token | CSS | 应用 |
|-------|-----|------|
| `--shadow-xs` | `0 1px 2px rgba(0, 0, 0, 0.04)` | 微悬浮 |
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)` | 卡片默认 |
| `--shadow-md` | `0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -2px rgba(0,0,0,0.06)` | 卡片 hover |
| `--shadow-lg` | `0 10px 15px -3px rgba(0,0,0,0.10), 0 4px 6px -4px rgba(0,0,0,0.08)` | 弹窗 |
| `--shadow-xl` | `0 20px 25px -5px rgba(0,0,0,0.12), 0 8px 10px -6px rgba(0,0,0,0.08)` | Dropdown |
| `--shadow-2xl` | `0 25px 50px -12px rgba(0, 0, 0, 0.20)` | Modal |
| `--shadow-inner` | `inset 0 2px 4px 0 rgba(0, 0, 0, 0.04)` | 内陷 |
| `--shadow-ring` | `0 0 0 3px rgba(0, 113, 227, 0.15)` | Focus 环 |

### 7.2 暗黑模式（弱化 + 内发光）

```css
[data-theme='dark'] {
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.20);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.30), 0 1px 2px rgba(0, 0, 0, 0.20);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.40), 0 2px 4px -2px rgba(0, 0, 0, 0.30);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.50), 0 4px 6px -4px rgba(0, 0, 0, 0.40);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.60), 0 8px 10px -6px rgba(0, 0, 0, 0.50);
}
```

### 7.3 应用映射

| 组件 | 默认 | Hover | Active |
|------|------|-------|--------|
| Card | shadow-xs | shadow-md | - |
| Modal | shadow-2xl | - | - |
| Dropdown | shadow-xl | - | - |
| Tooltip | shadow-md | - | - |
| Button | shadow-xs | shadow-md + translateY(-1px) | scale(0.98) |

---

## 8. 动效曲线（NEW）

### 8.1 7 种贝塞尔曲线

| Token | cubic-bezier | 视觉 | 应用 |
|-------|--------------|------|------|
| `--ease-in-quad` | `cubic-bezier(0.55, 0.085, 0.68, 0.53)` | 慢-快 | 退出 |
| `--ease-out-quad` | `cubic-bezier(0.25, 0.46, 0.45, 0.94)` | 快-慢 | 进入 |
| `--ease-in-out-quad` | `cubic-bezier(0.455, 0.03, 0.515, 0.955)` | 对称 | 状态切换 |
| `--ease-out-expo` | `cubic-bezier(0.19, 1, 0.22, 1)` | 极快-极慢 | **推荐** 卡片悬浮 |
| `--ease-in-out-expo` | `cubic-bezier(0.87, 0, 0.13, 1)` | 戏剧化 | 页面切换 |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 弹性 | Toast 弹入 |
| `--ease-ios` | `cubic-bezier(0.32, 0.72, 0, 1)` | iOS 标配 | Modal |

### 8.2 6 档时长

| Token | 毫秒 | 应用 |
|-------|------|------|
| `--duration-instant` | 100ms | 即时反馈 |
| `--duration-fast` | 150ms | 按钮/Tag |
| `--duration-base` | 200ms | **默认** |
| `--duration-slow` | 300ms | Modal |
| `--duration-slower` | 500ms | 页面过渡 |
| `--duration-slowest` | 800ms | Hero 动画 |

### 8.3 微动效清单

| 元素 | 状态 | 效果 |
|------|------|------|
| 按钮 | hover | `translateY(-1px)` + shadow-md |
| 按钮 | active | `scale(0.98)` |
| 卡片 | hover | `translateY(-2px)` + shadow-lg |
| 列表项 | hover | 背景淡化 + 1px translateX |
| 选中项 | active | 左侧 3px 主色条 |
| Modal | enter | fadeInUp 200ms |
| 消息气泡 | enter | fadeInUp 200ms |
| Toast | enter | spring 弹入 |

### 8.4 关键帧动画

```css
/* 渐入上移（最常用） */
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* 列表错位进入 */
@keyframes fadeInUpStagger {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* 打字机脉冲 */
@keyframes typingPulse {
  0%, 100% { opacity: 0.3; }
  50%      { opacity: 1; }
}
```

### 8.5 减少动画偏好

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 9. 交互模式

### 9.1 Hover

```css
.interactive {
  transition: all var(--duration-base) var(--ease-out-quad);
}
.interactive:hover {
  /* 卡片：背景淡化 + 1-2px 提升 + 阴影 */
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}
```

### 9.2 Active / Press

```css
.interactive:active {
  transform: scale(0.98);
  transition-duration: var(--duration-instant);
}
```

### 9.3 Focus（键盘可见）

```css
*:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--color-link-alpha-15);
  transition: box-shadow var(--duration-instant) ease;
}
```

### 9.4 Selection（文本选中）

```css
::selection {
  background: var(--color-link-alpha-20);
  color: var(--color-text-primary);
}
```

### 9.5 Disabled

```css
:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}
```

### 9.6 Drag

```css
.dragging {
  cursor: grabbing;
  opacity: 0.7;
  transform: scale(0.98);
}
```

---

## 10. 组件使用规范

### 10.1 按钮

| 类型 | 场景 | 实现 |
|------|------|------|
| Primary | 主操作（保存/确认） | 渐变背景 + 阴影 + hover 提升 |
| Default | 次要操作 | 边框 + 透明背景 |
| Text | 三级操作 | 无边框 |
| Danger | 删除/高危 | 红色（仅危险场景） |

**状态**：default / hover / active / focus / disabled / loading

```css
.ant-btn-primary {
  background: var(--gradient-primary);
  border: none;
  font-weight: 500;
  letter-spacing: 0.01em;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-xs);
  transition: all var(--duration-fast) var(--ease-out-quad);
}
.ant-btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
.ant-btn-primary:active {
  transform: scale(0.98);
}
```

### 10.2 卡片

- 默认：白底 + 1px 边框 + radius 12-16px
- Hover：边框变主色 + shadow-md + translateY(-2px)
- 选中：左侧 3px 主色条 + 背景淡化

### 10.3 表单

- 高度 40px（黄金比例）
- 圆角 10px
- Focus：3px alpha 焦点环
- Placeholder：tertiary 色

### 10.4 表格

- 行 hover：背景淡化
- 表头：次要文字 + semibold
- 排序：图标 + 主色

### 10.5 列表

- 基础列表：行高 1.618
- 可拖拽：cursor: grab + active 态
- 虚拟滚动：保持流畅 60fps

### 10.6 弹窗

- 圆角 16-26px
- 阴影 2xl
- 进入：scale(0.95) + opacity 0 → 1
- 背景遮罩：blur(4px) + rgba(0,0,0,0.4)

### 10.7 通知

- Message：顶部居中，3s 自动消失
- Notification：右上角，5s 自动消失
- Modal.confirm：阻塞操作

### 10.8 Loading

- Spin：默认 spinner
- Skeleton：内容占位
- Button.loading：按钮内 spinner
- Progress：进度条

---

## 11. 图标与插画

### 11.1 铁律

- **统一使用 Ant Design Icons**
- **禁止 emoji 作为功能图标**
- 装饰图标：14-16px
- 状态图标：搭配 Tag/Badge

### 11.2 业务图标映射

| 业务 | 推荐 | Ant Design 名 |
|------|------|---------------|
| 部署 | RocketOutlined / CloudServerOutlined | 火箭/云服务器 |
| 教程 | BookOutlined / ReadOutlined | 书籍 |
| AI | RobotOutlined / MessageOutlined | 机器人 |
| 服务器 | DesktopOutlined / ApiOutlined | 桌面 |
| 监控 | LineChartOutlined / DashboardOutlined | 折线图 |
| 风险 | WarningOutlined / AlertOutlined | 警告 |
| 日志 | FileSearchOutlined / CodeOutlined | 文件搜索 |
| 设置 | SettingOutlined / ToolOutlined | 设置 |

### 11.3 图标尺寸

| 用途 | 尺寸 |
|------|------|
| 内联 | 14px |
| 按钮内 | 16px |
| 列表项 | 18-20px |
| 标题旁 | 20-24px |
| 大型展示 | 32px |

### 11.4 SVG 插画风格

- 线性（stroke-width 1.5-2）
- 几何（少用曲线，多用直线）
- 极简（不超 3 种颜色）

---

## 12. 暗黑模式精修

### 12.1 5 级灰阶（iOS 风格）

| Token | 亮色 | 暗色 | 用途 |
|-------|------|------|------|
| 1 | #ffffff | #1d1d1f | 主背景 |
| 2 | #fafafa | #2c2c2e | 卡片 |
| 3 | #f5f5f7 | #3a3a3c | 弹窗 |
| 4 | #e5e5e7 | #48484a | 描边 |
| 5 | #c7c7cc | #636366 | 极弱描边 |

### 12.2 暗黑铁律

- ❌ 禁用纯黑 `#000`（OLED 烧屏 + 视觉过暗）
- ❌ 禁用纯白 `#fff`（暗黑背景下过亮刺眼）
- ✅ 阴影透明度提高（暗背景下阴影更明显）
- ✅ 文字用 `#f5f5f7`（减轻视觉疲劳）
- ✅ 链接蓝用 `#0a84ff`（更亮更纯净）

### 12.3 暗黑阴影减弱

详见 §7.2。

### 12.4 暗黑链接色（iOS 风格）

```css
[data-theme='dark'] {
  --color-link: #0a84ff;        /* iOS 暗黑链接蓝 */
  --color-link-hover: #409cff;  /* 悬停时更亮 */
}
```

---

## 13. 响应式

### 13.1 6 断点

| 断点 | 范围 | 列数 |
|------|------|------|
| xs | <576px | 1 |
| sm | ≥576px | 2 |
| md | ≥768px | 2-3 |
| lg | ≥992px | 3-4 |
| xl | ≥1200px | 4-6 |
| xxl | ≥1600px | 6+ |

### 13.2 容器最大宽度

| 断点 | 最大宽度 |
|------|----------|
| sm | 640px |
| md | 768px |
| lg | 1024px |
| xl | 1280px |
| xxl | 1536px |

> TDSF 桌面端为主：优先保证 ≥992px 体验。

---

## 14. 性能与可访问性（NEW）

### 14.1 性能

**减少重绘**：
- 使用 `transform` 和 `opacity`（GPU 加速）
- 避免 `top/left/width/height` 动画
- 使用 `will-change: transform` 预告

**GPU 加速**：
```css
.gpu {
  will-change: transform;
  transform: translateZ(0);
}
```

**动画帧率**：保持 60fps

### 14.2 可访问性

- **颜色对比度**：正文 ≥ 4.5:1，大文本 ≥ 3:1
- **触摸目标**：≥ 44×44pt
- **键盘导航**：完整 Tab 顺序
- **屏幕阅读器**：aria-label、role、aria-describedby
- **prefers-reduced-motion**：尊重用户偏好

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 15. 禁止的反模式

### 15.1 20 条铁律

| # | 反模式 | 原因 | 替代方案 |
|---|--------|------|----------|
| 1 | ❌ 任何 emoji | 视觉不专业 | 统一 Ant Design Icons |
| 2 | ❌ 蓝紫渐变 | AI 味重 | 单一深色 + 微弱分层 |
| 3 | ❌ 灰底白卡堆叠 | 缺乏层次 | 卡片用边框 + 极轻阴影 |
| 4 | ❌ 标准 Hero 段落 | 模板感 | 直接展示功能 |
| 5 | ❌ 硬编码颜色 | 难以维护 | 全部 `var(--color-*)` |
| 6 | ❌ AI 味设计 | 千篇一律 | 极简 + 语义化 |
| 7 | ❌ 多色按钮（>3 种） | 视觉杂乱 | 主色 + 危险色 2 种 |
| 8 | ❌ 闪烁/旋转/跳动 | 干扰注意力 | 仅功能反馈 |
| 9 | ❌ 弹窗套弹窗 | 焦点丢失 | 最多一层 |
| 10 | ❌ 阴影堆叠（>3 层） | 视觉过载 | 最多 2 层 |
| 11 | ❌ 文字溢出不处理 | 排版崩塌 | 截断 / 滚动 / 省略 |
| 12 | ❌ 像素级不齐 | 不专业 | 8px 栅格 + flex/grid |
| 13 | ❌ 间距不规律 | 节奏乱 | 全部走 `--space-*` |
| 14 | ❌ 字号跳跃 | 视觉断层 | φ 比例阶梯 |
| 15 | ❌ 圆角不统一 | 风格混乱 | 6 档统一 |
| 16 | ❌ 动效时长不一致 | 节奏乱 | 6 档统一 |
| 17 | ❌ focus 状态不明显 | 键盘不可用 | 3px alpha 焦点环 |
| 18 | ❌ 禁用状态不区分 | 反馈缺失 | opacity + cursor |
| 19 | ❌ 文字对比度不足 | 不可读 | WCAG AA 4.5:1 |
| 20 | ❌ 响应式断层 | 设备不适配 | 6 断点全覆盖 |

---

## 16. 检查清单（NEW）

### 16.1 视觉层

- [ ] 所有颜色使用 `var(--color-*)`，无硬编码
- [ ] 所有字号来自 `--font-size-*` 阶梯
- [ ] 所有间距来自 `--space-*`（4-110px）
- [ ] 所有圆角来自 `--radius-*`（4-42px）
- [ ] 所有阴影来自 `--shadow-*`（xs/2xl）
- [ ] 所有动效曲线来自 `--ease-*`
- [ ] 所有时长来自 `--duration-*`

### 16.2 交互层

- [ ] Hover：颜色淡化 + 提升 + 阴影
- [ ] Active：scale(0.98) + 阴影减弱
- [ ] Focus：3px alpha 焦点环（键盘可见）
- [ ] Selection：主题色背景
- [ ] Disabled：opacity + cursor

### 16.3 暗黑层

- [ ] 所有颜色变量在 `[data-theme='dark']` 中重定义
- [ ] 链接蓝用 iOS 暗黑色 `#0a84ff`
- [ ] 阴影透明度提高
- [ ] 文字不用纯白 `#fff`

### 16.4 响应层

- [ ] xs/sm/md/lg/xl/xxl 全部测试
- [ ] 容器最大宽度正确
- [ ] 移动端最低支持 768px

### 16.5 动效层

- [ ] 时长 ≤ 300ms（Hero 例外）
- [ ] 使用贝塞尔曲线（不用 linear）
- [ ] 列表错位进入（stagger 30ms）
- [ ] Modal fadeInUp 200ms
- [ ] 尊重 `prefers-reduced-motion`

### 16.6 可访问性

- [ ] aria-label / role 完整
- [ ] 键盘 Tab 顺序合理
- [ ] 对比度 ≥ 4.5:1（用工具验证）
- [ ] 触摸目标 ≥ 44×44pt

---

## 附录 A：变更记录

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| v1.0 | 2026-07-16 | 首次发布（v0.7.0 对应） |
| v2.0 | 2026-07-16 | 升级为生产交付级极致美学 |

### v2.0 重大升级点

1. **数学基础**（新增第二章）
   - 引入 φ = 1.6180339887 作为设计核心
   - 字号 11 档全部基于 φ 推导
   - 间距 12 档、圆角 6 档基于 φ 推导
   - 三栏布局按 1 : 1.618 : 1 比例

2. **阴影系统**（新增第七章）
   - 7 级阴影（xs → 2xl + inner + ring）
   - 暗黑模式阴影减弱策略

3. **动效曲线**（新增第八章）
   - 7 种贝塞尔曲线
   - 6 档时长
   - 微动效清单
   - 关键帧动画

4. **可访问性**（新增第十四章）
   - WCAG 2.2 标准
   - 性能优化（GPU 加速）
   - prefers-reduced-motion 支持

5. **检查清单**（新增第十六章）
   - 6 大维度（视觉/交互/暗黑/响应/动效/无障碍）
   - 可逐项打勾验收

6. **反模式扩充**
   - 从 v1.0 的 11 条扩展到 20 条
   - 新增阴影堆叠、字号跳跃、圆角不统一等

---

## 附录 B：参考资源

- **Apple Human Interface Guidelines**：https://developer.apple.com/design/human-interface-guidelines/
- **Ant Design 5 Design Token**：https://ant.design/docs/react/customize-theme
- **Material Design 3**：https://m3.material.io
- **Linear Design**：https://linear.app
- **Notion Design**：https://www.notion.so
- **shadcn/ui Themes**：https://ui.shadcn.com/themes
- **WCAG 2.2 Guidelines**：https://www.w3.org/WAI/WCAG22/
- **LobeChat 设计参考**：https://github.com/lobehub/lobe-chat
- **Cherry Studio 设计参考**：https://github.com/kangfenmao/cherry-studio

---

> **维护说明**：本规范是活文档。每次新增组件/修改样式前必须先查阅本规范。WHY 比 WHAT 更重要——每个设计决策都要说明背后的原理。
