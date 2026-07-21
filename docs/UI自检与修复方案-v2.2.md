# UI 自检与第二轮修复方案 — v2.2

> **日期**：2026-07-17  
> **审计范围**：`方案书-v0.7.0-Phase5j-UI精致微调.md` 中全部 P0 项 + 关联组件  
> **核心结论**：P0 改动已 100% 落地，但"丑"的问题不在 P0，而在**系统性设计语言**。必须做第二轮"美学重构"，而非继续微调。

---

## 1. 代码与方案书差异审计

### 1.1 P0 必改项落实情况

| P0 编号 | 方案书要求 | 实际代码位置 | 实际代码内容 | 是否落实 | 问题等级 |
|---|---|---|---|---|---|
| P0-1 | MetricCard 加语义化图标，定义 `METRIC_ICONS`，新增 `.monitor-metric-header` / `.monitor-metric-icon` | `MonitorPanel.tsx:60-69`, `:77-84`；`MonitorPanel.css:179-205` | 已实现图标映射、头部 flex 布局、label 11.5px | ✅ 已落实 | — |
| P0-2 | 用户消息气泡阴影改为多层 `alpha-25/10` | `ChatPanel.css:159-168` | 已改为 `0 4px 14px -2px var(--color-link-alpha-25), 0 1px 2px var(--color-link-alpha-10)` | ✅ 已落实 | — |
| P0-3 | AI 消息 hover 只加 `shadow-sm`，不变边框色 | `ChatPanel.css:179-181` | 已移除 `border-color`，仅保留 `box-shadow: var(--shadow-sm)` | ✅ 已落实 | — |
| P0-4 | ChatPanel 头部字号缩至 `var(--font-size-sm)` | `ChatPanel.css:49` | 已改为 `font-size: var(--font-size-sm)` | ✅ 已落实 | — |
| P0-5 | MetricCard label 11.5px + `letter-spacing: 0.04em` | `MonitorPanel.css:199-204` | 已改为 11.5px / 0.04em | ✅ 已落实 | — |
| P0-6 | 告警卡背景硬编码改为 token | `MonitorPanel.css:170-177` | 已改为 `var(--color-error-alpha-04/08)` | ✅ 已落实 | — |
| P0-7 | DecisionCard 硬编码字号改为 token | `DecisionCard.css:31-32`, `:77`, `:85` | problem→base, section-content→sm, section-label→xs | ✅ 已落实 | — |
| P0-8 | DecisionCard 头部用 `SectionTitle` | `DecisionCard.tsx:181-187` | 已引入 `<SectionTitle icon={<BulbOutlined/>} .../>` | ✅ 已落实 | 但 `SectionTitle` 本身设计有缺陷（见根因 5） |
| P0-9 | AgentWorkflow `reason→ExperimentOutlined`，`verify→CheckCircleFilled` | `AgentWorkflowPanel.tsx:50,54` | 已替换图标 | ✅ 已落实 | 但 `.css` 与 `.tsx` 类名不匹配，大量样式未生效 |
| P0-10 | CpuChart/MemoryChart 标题加图标 + `.monitor-chart-header` | `CpuChart.tsx:69-70`；`MemoryChart.tsx:69-70`；`MonitorPanel.css:120-149` | 已添加 `DashboardOutlined` / `DatabaseOutlined` 与 header 样式 | ✅ 已落实 | 但图表内部仍有大量硬编码颜色（见根因 6） |

### 1.2 非 P0 但严重影响视觉的问题

| 位置 | 问题 | 违反规范 | 问题等级 |
|---|---|---|---|
| `CpuChart.tsx:46-53,79-112` | 图表颜色全部硬编码（`#0071e3`、`#34c759`、`#3a3a3c` 等） | 禁止硬编码颜色 | P0 |
| `MemoryChart.tsx:46-53,79-117` | 同上，且渐变 ID 无唯一前缀，多实例会冲突 | 禁止硬编码颜色 | P0 |
| `DecisionCard.tsx:51-70` | `RISK_CONFIG` / `STATUS_CONFIG` 全部使用 `#` 硬编码颜色 | 禁止硬编码颜色 | P0 |
| `SectionTitle.tsx:72,82,95` | 内联样式存在 fallback 硬编码色（`#f0f0f0`、`#1d1d1f`）且底部带 `border-bottom` | 硬编码颜色 + 视觉多余 | P1 |
| `AgentWorkflowPanel.css:10-147` | 定义了 `.agent-workflow-panel`/`.agent-workflow-step` 等样式，但 `AgentWorkflowPanel.tsx` 使用 Ant Design `Steps` 组件，类名是 `.agent-workflow` / `.agent-workflow-steps`，**70% 样式未生效** | 代码与样式不匹配 | P0 |
| `global.css:484,491,495,499` | Ant Design 覆盖里残留 `rgba(0, 113, 227, 0.x)` 硬编码 | 禁止硬编码颜色 | P1 |
| `ChatPanel.tsx:373-381` | 附件按钮 `disabled` 且提示"即将支持"，强烈半成品感 | 产品完成度 | P1 |

---

## 2. 视觉根因分析（为什么还是"丑"）

### 根因 1：颜色系统"浑浊"，缺乏高级灰阶
当前亮模式：
- `--color-bg-card: #fafafa` 与 `--color-bg-primary: #ffffff` 差值仅 10/255，**卡片浮在背景上几乎看不见边界**。
- `--color-border: #f0f0f0` 在 `#fafafa` 上对比度约 1.03:1，**边框是装饰性而非结构性**。
- 主色 `#0071e3` 是饱和度极高的"系统蓝"，与 `#fafafa` 搭配产生廉价"AI 味"。

参考 Linear（`#5e6ad2` 低饱和靛蓝 + `#f7f7f8` 暖灰）、Notion（`#f7f6f3` 纸白 + `#37352f` 墨黑），**高级感来自"低饱和主色 + 足够对比的灰阶"**，而非鲜艳蓝白。

### 根因 2：卡片/边框过多，界面"碎"成九宫格
MonitorPanel 单屏包含：
- 系统信息卡（1 个带 8 行）
- MetricCard（8 个小卡，每个带边框）
- ChartCard（2 个，每个带标题下划线）
- 再加上 `.monitor-section-title` 无统一组件

每个元素都"自我封闭"，没有"背景即容器"的整体感。像 ChatGPT/Claude 的做法是：**用背景色分层，而非边框堆砌**。

### 根因 3：Ant Design 标准组件痕迹过重
- `Steps` 组件默认样式（圆点、数字、连接线颜色）与自定义设计语言冲突。
- `Tag` 组件默认圆角/字重/内边距未完全覆盖。
- `Collapse` 组件的折叠箭头、header padding 仍是 Ant Design 默认。
- `Button` 虽然覆盖了 primary，但 `danger` / `default` / `text` 状态仍有 Ant Design 原生影子。

结果：界面像"Ant Design 皮肤"而不是"独立产品"。

### 根因 4：字体层级"重"且"平"
- 标题大量用 `font-weight: 600`（SectionTitle、monitor-chart-title、decision-card-problem、monitor-metric-value 全是 600）。
- 正文/辅助区分仅靠颜色（`#1d1d1f` vs `#4a4a4a` vs `#86868b`），字号差异小。
- 11.5px 大写 label 与 20px 数字之间没有中间层级，**跳跃感强**。

### 根因 5：SectionTitle 组件本身就是视觉噪音
- 每个 SectionTitle 底部带 1px `var(--color-border)`，在卡片内部又切一刀。
- marginBottom 13px + paddingBottom 8px，**让 DecisionCard 头部到问题文字之间出现 21px+ 的空白**，破坏紧凑感。
- 图标与标题同尺寸同字重，**没有主次**。

### 根因 6：硬编码颜色"处处漏"
虽然 P0 消灭了大部分硬编码，但：
- 图表 Recharts 的 stroke/fill/tooltip 全部硬编码。
- DecisionCard 的风险/状态配置硬编码。
- SectionTitle fallback 硬编码。
- global.css 中 Ant Design 按钮阴影硬编码。

这些"漏网之鱼"让暗色模式切换时出现颜色跳变、不协调。

### 根因 7：半成品/占位元素破坏信任感
- ChatPanel 输入区有一个 **disabled 的附件按钮**，提示"即将支持"。
- AgentWorkflowPanel 使用了 `.css` 中未生效的样式，实际渲染是 Ant Design 默认 Steps。
- 空状态（`monitor-panel-empty`）只是简单 `<p>` + `<Spin/>`。

这些都在告诉用户："这还没做完"。

### 根因 8：间距系统执行不统一
- ChatPanel：header `16px 21px`，workflow `8px 21px`，messages `21px`，input `13px 21px 21px`。
- DecisionCard：padding `16px`，gap `12px`，但 SectionTitle 又额外加 `margin-bottom: 13px` + `padding-bottom: 8px`。
- 同一份设计里，**上下间距没有统一节奏**，导致"呼吸感"不均匀。

### 根因 9：缺乏"少即是多"的交互克制
- `.monitor-card:hover` 同时改变 border-color、box-shadow、transform（三种变化）。
- `.chat-panel-send-btn:hover` 同时改变 background、transform、scale、box-shadow。
- 过多同时发生的动画显得"花哨"，降低高级感。

### 根因 10：暗色模式是"反色"而非"重新设计"
暗色下 `--color-bg-card: #2c2c2e` 与 `--color-bg-primary: #1d1d1f` 对比度不足，卡片边缘模糊；主色 `#0a84ff` 在深色下过亮刺眼，缺乏 Raycast/Arc 暗色那种"深邃但有层次"的感觉。

---

## 3. 第二轮修复方案（P0/P1/P2）

### 3.1 P0 — 必须执行（不做不能交付）

#### P0-1 重构全局颜色系统（高级灰阶 + 低饱和主色）
目标：从"苹果系统蓝+浅灰"升级为"Notion/Arc 式高级灰 + 低饱和靛蓝"。

```css
/* global.css :root 替换 */
--color-bg-primary: #ffffff;
--color-bg-card: #f7f7f8;      /* 比纯白稍暖，足够与主背景分离 */
--color-bg-elevated: #ffffff;
--color-bg-inset: #f0f0f2;      /* 输入框/内嵌区域 */

--color-text-primary: #18181b;
--color-text-secondary: #52525b;
--color-text-tertiary: #a1a1aa;
--color-text-quaternary: #d4d4d8;

--color-border: #e8e8ea;
--color-border-strong: #d4d4d8;

/* 主色从 #0071e3 改为更沉稳的靛蓝 */
--color-link: #4f46e5;
--color-link-hover: #6366f1;
--color-link-active: #4338ca;

/* 状态色降低饱和度，避免"脏" */
--color-success: #22c55e;
--color-warning: #f59e0b;
--color-error: #ef4444;
--color-info: #4f46e5;

/* 风险等级色 */
--color-risk-safe: #22c55e;
--color-risk-low: #06b6d4;
--color-risk-medium: #f59e0b;
--color-risk-high: #f97316;
--color-risk-critical: #ef4444;
```

暗色模式：

```css
[data-theme='dark'] {
  --color-bg-primary: #09090b;
  --color-bg-card: #141416;
  --color-bg-elevated: #1c1c1f;
  --color-bg-inset: #0f0f11;

  --color-text-primary: #fafafa;
  --color-text-secondary: #a1a1aa;
  --color-text-tertiary: #71717a;
  --color-text-quaternary: #3f3f46;

  --color-border: #27272a;
  --color-border-strong: #3f3f46;

  --color-link: #818cf8;
  --color-link-hover: #a5b4fc;
  --color-link-active: #6366f1;

  --color-success: #4ade80;
  --color-warning: #fbbf24;
  --color-error: #f87171;
  --color-info: #818cf8;
}
```

并同步更新所有 `--color-link-alpha-*` / `--color-error-alpha-*` / `--color-success-alpha-*` / `--color-warning-alpha-*` 的基色。

#### P0-2 消灭所有硬编码颜色
- `CpuChart.tsx` / `MemoryChart.tsx`：全部 `#0071e3`、`#34c759`、`#3a3a3c` 等改为 `var(--color-*)`。
- `DecisionCard.tsx`：`RISK_CONFIG` / `STATUS_CONFIG` 全部改为引用 `var(--color-risk-*)` / `var(--color-text-*)` 等。
- `SectionTitle.tsx`：移除 fallback 硬编码颜色，全部使用 `var(--color-*)`。
- `global.css`：Ant Design 按钮阴影硬编码 rgba 改为 `--color-link-alpha-*`。

#### P0-3 统一卡片设计语言（减边框、靠背景分层）
所有卡片统一：
```css
background: var(--color-bg-card);
border: 1px solid var(--color-border);  /* 或完全移除，视层级而定 */
border-radius: var(--radius-md);        /* 10px */
padding: var(--space-4);                /* 16px */
```

移除：
- `.monitor-card:hover` 的 border-color 变化 + translateY。
- `.chat-message.ai:hover` 的阴影（本身已很克制，但可进一步移除）。
- `.monitor-metric-card:hover` 的 border-color 变化 + translateY。

hover 只允许 **一种** 变化：阴影或背景色，不可叠加。

#### P0-4 修复 AgentWorkflowPanel 样式-组件不匹配
两种方案：
- **方案 A（推荐）**：弃用 Ant Design `Steps`，改用 `AgentWorkflowPanel.css` 中已有的自定义 step 样式，重写 TSX 以匹配。
- 方案 B：如果保留 `Steps`，则删除 `AgentWorkflowPanel.css` 中未使用的样式，改为覆盖 Ant Design Steps 的 token。

推荐方案 A，因为当前自定义 step 设计更简洁，且能摆脱 Ant Design 痕迹。

#### P0-5 重构 SectionTitle 组件
- 移除底部 `border-bottom`。
- 字号：sm→`var(--font-size-xs)`（12px），md→`var(--font-size-sm)`（13.5px），lg→`var(--font-size-md)`（16px）。
- 图标颜色改为 `var(--color-text-tertiary)`，比标题弱一级。
- marginBottom 统一为 `var(--space-3)`（13px），不再加 paddingBottom。
- 在 DecisionCard 中，将 SectionTitle 的 icon 从 `BulbOutlined` 改为 `ExperimentOutlined`，与工作流图标一致。

#### P0-6 移除半成品占位元素
- ChatPanel 输入区：移除 disabled 的附件按钮。如果 v0.8 才实现，本期应完全隐藏，不应展示不可用的控件。
- 或者用更克制的方式：在输入框 placeholder 中提示"粘贴日志或描述问题"，不显示附件图标。

### 3.2 P1 — 应该执行（显著提升）

#### P1-1 监控面板 section title 统一使用 SectionTitle
当前 `MonitorPanel.tsx:277,294,333` 使用 `<div className="monitor-section-title">`，应改为 `<SectionTitle size="sm" icon={...} title="..."/>`，保持全产品标题组件一致。

#### P1-2 重绘图表配色与坐标轴
- 坐标轴字号改为 `var(--font-size-xs)`（12px），而非硬编码 10px。
- 网格线颜色改为 `var(--color-border)`。
- CPU 线条颜色使用 `var(--color-link)`；内存 Area 使用 `var(--color-success-alpha-10)` 填充 + `var(--color-success)` 描边。
- Tooltip 背景使用 `var(--color-bg-elevated)`，边框 `var(--color-border)`，文字使用 `var(--color-text-primary)`。

#### P1-3 决策卡片视觉瘦身
- 移除左侧 4px 风险色带（或改为更 subtle 的 2px）。
- 命令块背景改为 `var(--color-bg-inset)` 而非终端黑，减少突兀感。
- 置信度仪表盘缩小至 64px，避免"贴图感"。
- 操作按钮区域改为右对齐，与卡片 header 的"标题-操作"结构一致。

#### P1-4 全局 Ant Design 覆盖去"原生感"
- `Tag`：移除默认背景色，使用更 subtle 的 `color="default"` + 自定义 class。
- `Collapse`：完全自定义 header padding、箭头图标、内容区背景。
- `Alert`：错误 alert 背景改为 `var(--color-error-alpha-08)`，边框 `var(--color-error-alpha-12)`。

### 3.3 P2 — 可选（锦上添花）

#### P2-1 MetricCard 加 sparkline
如方案书评估，开销大，但如果要提升"Stripe 感"，可作为高级视图。

#### P2-2 完整胶囊输入区
参考 ChatGPT/Claude，将附件、思考开关、语音整合进一个圆角容器。本期工作量过大，建议 v0.8。

#### P2-3 微交互动画统一
- 所有 hover 统一为 `transition: all 150ms var(--ease-out-quad)`。
- 按钮按下统一 `transform: scale(0.97)`。
- 卡片 hover 仅提升 `box-shadow`，无位移。

---

## 4. 具体改动清单（文件 + 行级）

### 4.1 global.css

#### 改动 1：替换 :root 颜色系统（第 30-97 行）
完全替换为 P0-1 中的新颜色值，并重新计算 alpha token：

```css
--color-link-alpha-10: rgba(79, 70, 229, 0.10);
--color-link-alpha-15: rgba(79, 70, 229, 0.15);
--color-link-alpha-20: rgba(79, 70, 229, 0.20);
--color-link-alpha-25: rgba(79, 70, 229, 0.25);
--color-link-alpha-30: rgba(79, 70, 229, 0.30);
--color-link-alpha-35: rgba(79, 70, 229, 0.35);

--color-error-alpha-04: rgba(239, 68, 68, 0.04);
--color-error-alpha-08: rgba(239, 68, 68, 0.08);
--color-error-alpha-12: rgba(239, 68, 68, 0.12);
--color-success-alpha-10: rgba(34, 197, 94, 0.10);
--color-success-alpha-14: rgba(34, 197, 94, 0.14);
--color-warning-alpha-10: rgba(245, 158, 11, 0.10);
--color-warning-alpha-14: rgba(245, 158, 11, 0.14);
```

#### 改动 2：替换 [data-theme='dark'] 颜色系统（第 102-172 行）
完全替换为 P0-1 中的暗色值，alpha token 同步更新：

```css
--color-link-alpha-10: rgba(129, 140, 248, 0.10);
--color-link-alpha-15: rgba(129, 140, 248, 0.18);
--color-link-alpha-20: rgba(129, 140, 248, 0.25);
--color-link-alpha-25: rgba(129, 140, 248, 0.30);
--color-link-alpha-30: rgba(129, 140, 248, 0.35);
--color-link-alpha-35: rgba(129, 140, 248, 0.45);

--color-error-alpha-04: rgba(248, 113, 113, 0.08);
--color-error-alpha-08: rgba(248, 113, 113, 0.12);
--color-error-alpha-12: rgba(248, 113, 113, 0.18);
--color-success-alpha-10: rgba(74, 222, 128, 0.10);
--color-success-alpha-14: rgba(74, 222, 128, 0.14);
--color-warning-alpha-10: rgba(251, 191, 36, 0.10);
--color-warning-alpha-14: rgba(251, 191, 36, 0.14);
```

#### 改动 3：修正 Ant Design 主按钮阴影硬编码（第 484-499 行）
```css
/* 改前 */
box-shadow: 0 1px 2px rgba(0, 113, 227, 0.20);
/* 改后 */
box-shadow: 0 1px 2px var(--color-link-alpha-20);

/* 改前 */
box-shadow: 0 4px 12px rgba(0, 113, 227, 0.30);
/* 改后 */
box-shadow: 0 4px 12px var(--color-link-alpha-30);

/* 暗色同理 */
box-shadow: 0 1px 2px var(--color-link-alpha-30);
box-shadow: 0 4px 12px var(--color-link-alpha-45);
```

#### 改动 4：调整阴影系统，更柔和（第 258-276 行）
将阴影 rgba 的黑色不透明度整体降低，避免新灰阶下阴影过重：

```css
--shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.03);
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 1px rgba(0, 0, 0, 0.03);
--shadow-md: 0 3px 5px -1px rgba(0, 0, 0, 0.05), 0 2px 3px -2px rgba(0, 0, 0, 0.04);
--shadow-lg: 0 8px 12px -3px rgba(0, 0, 0, 0.06), 0 4px 6px -4px rgba(0, 0, 0, 0.05);
--shadow-xl: 0 16px 20px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.06);
--shadow-2xl: 0 25px 50px -12px rgba(0, 0, 0, 0.12);
```

暗色模式同步降低：
```css
--shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.15);
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.20), 0 1px 1px rgba(0, 0, 0, 0.15);
--shadow-md: 0 3px 5px -1px rgba(0, 0, 0, 0.30), 0 2px 3px -2px rgba(0, 0, 0, 0.25);
--shadow-lg: 0 8px 12px -3px rgba(0, 0, 0, 0.40), 0 4px 6px -4px rgba(0, 0, 0, 0.30);
--shadow-xl: 0 16px 20px -5px rgba(0, 0, 0, 0.50), 0 8px 10px -6px rgba(0, 0, 0, 0.40);
--shadow-2xl: 0 25px 50px -12px rgba(0, 0, 0, 0.60);
```

### 4.2 MonitorPanel.css

#### 改动 5：MetricCard 减法设计（第 151-214 行）
```css
.monitor-metric-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);  /* 13px 16px */
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: box-shadow var(--duration-fast) var(--ease-out-quad);
  min-height: 64px;
}

.monitor-metric-card:hover {
  box-shadow: var(--shadow-sm);
  /* 移除 border-color 变化、移除 transform */
}

.monitor-metric-card.warning {
  border-color: var(--color-error);
  background: var(--color-error-alpha-04);
}

[data-theme='dark'] .monitor-metric-card.warning {
  background: var(--color-error-alpha-08);
}

.monitor-metric-header {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
}

.monitor-metric-icon {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  line-height: 1;
  display: inline-flex;
  align-items: center;
}

.monitor-metric-card.warning .monitor-metric-icon {
  color: var(--color-error);
}

.monitor-metric-label {
  font-size: var(--font-size-xs);  /* 改回 12px，保持 token 一致性 */
  font-weight: var(--font-weight-medium);
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.monitor-metric-value {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  letter-spacing: var(--letter-spacing-tight);
  line-height: var(--line-height-tight);
  font-variant-numeric: tabular-nums;
}

.monitor-metric-card.warning .monitor-metric-value {
  color: var(--color-error);
}
```

#### 改动 6：系统信息卡与图表区统一（第 35-53, 112-149 行）
```css
.monitor-card {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  transition: box-shadow var(--duration-base) var(--ease-out-quad);
}

.monitor-card:hover {
  box-shadow: var(--shadow-sm);
  /* 移除 border-color 与 transform */
}

.monitor-chart-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.monitor-chart-icon {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  line-height: 1;
}

.monitor-chart-title {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.monitor-chart-current {
  margin-left: auto;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-link);
  font-variant-numeric: tabular-nums;
}
```

### 4.3 ChatPanel.css

#### 改动 7：头部与工作流间距统一（第 34-60 行）
```css
.chat-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-5);  /* 13px 21px，与输入区呼应 */
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-card);
}

.chat-panel-workflow {
  padding: var(--space-3) var(--space-5);  /* 13px 21px，统一 rhythm */
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-card);
}
```

#### 改动 8：AI 消息 hover 进一步简化（第 178-181 行）
```css
/* 完全移除 hover 效果，保持静态 */
.chat-message.ai:hover .chat-message-bubble {
  box-shadow: none;
}
```

#### 改动 9：发送按钮减少 hover 变化（第 312-325 行）
```css
.chat-panel-send-btn:hover:not(:disabled) {
  background: var(--gradient-primary-hover) !important;
  box-shadow: 0 4px 12px var(--color-link-alpha-30);
  /* 移除 transform: translateY(-1px) scale(1.05) */
}

.chat-panel-send-btn:active:not(:disabled) {
  transform: scale(0.97);  /* 统一按压反馈 */
  transition-duration: var(--duration-instant);
}
```

#### 改动 10：移除附件按钮样式（第 341-359 行）
如 P0-6 移除 disabled 附件按钮，则整段删除 `.chat-panel-attach-btn` 样式。

#### 改动 11：输入区背景统一（第 232-240 行）
```css
.chat-panel-input {
  display: flex;
  align-items: flex-end;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5) var(--space-4);  /* 13/21/16 */
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-card);
}
```

### 4.4 DecisionCard.tsx

#### 改动 12：硬编码颜色改 token（第 51-70 行）
```tsx
const RISK_CONFIG: Record<RiskLevel, { color: string; label: string; bgColor: string }> = {
  SAFE: { color: 'var(--color-risk-safe)', label: '安全', bgColor: 'var(--color-success-alpha-10)' },
  LOW: { color: 'var(--color-risk-low)', label: '低风险', bgColor: 'var(--color-link-alpha-10)' },
  MEDIUM: { color: 'var(--color-risk-medium)', label: '中风险', bgColor: 'var(--color-warning-alpha-10)' },
  HIGH: { color: 'var(--color-risk-high)', label: '高风险', bgColor: 'var(--color-error-alpha-08)' },
  CRITICAL: { color: 'var(--color-risk-critical)', label: '极高风险', bgColor: 'var(--color-error-alpha-12)' },
}

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  pending: { label: '待确认', color: 'var(--color-text-tertiary)', icon: <ClockCircleOutlined /> },
  approved: { label: '已批准', color: 'var(--color-link)', icon: <CheckCircleOutlined /> },
  rejected: { label: '已拒绝', color: 'var(--color-text-tertiary)', icon: <CloseCircleOutlined /> },
  executed: { label: '已执行', color: 'var(--color-warning)', icon: <PlayCircleOutlined /> },
  verified: { label: '已验证', color: 'var(--color-success)', icon: <CheckCircleOutlined /> },
  failed: { label: '执行失败', color: 'var(--color-error)', icon: <ExclamationCircleOutlined /> },
}
```

#### 改动 13：SectionTitle icon 一致性（第 181-187 行）
```tsx
<SectionTitle
  icon={<ExperimentOutlined />}
  title="决策建议"
  tag={{ label: riskConfig.label, color: riskConfig.color }}
  size="sm"
  className="decision-card-title"
/>
```

### 4.5 DecisionCard.css

#### 改动 14：卡片瘦身（第 6-16 行）
```css
.decision-card {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-left: 2px solid var(--color-border);  /* 从 4px 减为 2px，更 subtle */
  border-radius: var(--radius-md);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);  /* 13px 统一节奏 */
}
```

#### 改动 15：命令块背景融入卡片（第 113-126 行）
```css
.decision-card-command {
  background: var(--color-bg-inset);
  color: var(--color-text-primary);
  padding: 10px 12px;
  padding-right: 36px;
  border-radius: var(--radius-sm);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  max-height: 120px;
  overflow-y: auto;
}
```

#### 改动 16：操作按钮右对齐（第 144-150 行）
```css
.decision-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}
```

#### 改动 17：SectionTitle 在卡片内紧凑化（第 152-156 行）
```css
.decision-card-title {
  margin-bottom: var(--space-2) !important;
  /* 移除 padding-bottom 与 border-bottom */
}
```

### 4.6 SectionTitle.tsx

#### 改动 18：移除 border-bottom 与硬编码 fallback（第 64-77 行）
```tsx
<div
  className={className}
  style={{
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    marginBottom: 'var(--space-3)',
    animation: 'fadeInUp 200ms cubic-bezier(0.19, 1, 0.22, 1) both',
    ...style,
  }}
>
```

#### 改动 19：调整字号映射与图标颜色（第 56-60, 78-88, 90-99 行）
```tsx
const sizeMap = {
  sm: { fontSize: 'var(--font-size-xs)', titleWeight: 500 },     // 12px
  md: { fontSize: 'var(--font-size-sm)', titleWeight: 600 },     // 13.5px
  lg: { fontSize: 'var(--font-size-md)', titleWeight: 600 },     // 16px
}

{icon && (
  <span
    style={{
      fontSize: 'var(--font-size-sm)',
      color: 'var(--color-text-tertiary)',
      display: 'inline-flex',
      alignItems: 'center',
    }}
  >
    {icon}
  </span>
)}

<h3
  style={{
    margin: 0,
    fontSize: currentSize.fontSize,
    fontWeight: currentSize.titleWeight,
    color: 'var(--color-text-primary)',
    lineHeight: 'var(--line-height-snug)',
    letterSpacing: 'var(--letter-spacing-tight)',
  }}
>
```

### 4.7 CpuChart.tsx

#### 改动 20：颜色全部 token 化（第 44-55 行）
```tsx
const colors = useMemo(
  () => ({
    grid: 'var(--color-border)',
    axisLine: 'var(--color-border-strong)',
    tick: 'var(--color-text-tertiary)',
    tooltipBg: 'var(--color-bg-elevated)',
    tooltipBorder: 'var(--color-border)',
    tooltipLabel: 'var(--color-text-tertiary)',
    tooltipText: 'var(--color-text-primary)',
  }),
  []
)
```

#### 改动 21：坐标轴字号 token 化（第 81-92 行）
```tsx
<XAxis
  dataKey="time"
  tick={{ fontSize: 'var(--font-size-xs)', fill: 'var(--color-text-tertiary)' }}
  axisLine={{ stroke: 'var(--color-border-strong)' }}
  tickLine={false}
  interval="preserveStartEnd"
/>
<YAxis
  domain={[0, 100]}
  tick={{ fontSize: 'var(--font-size-xs)', fill: 'var(--color-text-tertiary)' }}
  axisLine={false}
  tickLine={false}
  unit="%"
/>
```

#### 改动 22：Line 颜色 token 化（第 104-112 行）
```tsx
<Line
  type="monotone"
  dataKey="cpu"
  stroke="var(--color-link)"
  strokeWidth={2}
  dot={false}
  activeDot={{ r: 4, fill: 'var(--color-link)' }}
  isAnimationActive={false}
/>
```

### 4.8 MemoryChart.tsx

#### 改动 23：颜色全部 token 化（第 44-55 行）
与 CpuChart 相同，改为 `var(--color-*)`。

#### 改动 24：渐变 ID 唯一化（第 79-82 行）
```tsx
const gradientId = useMemo(() => `memoryGradient-${Math.random().toString(36).slice(2, 9)}`, [])

<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.3} />
  <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
</linearGradient>
```

#### 改动 25：Area 颜色 token 化（第 110-117 行）
```tsx
<Area
  type="monotone"
  dataKey="memory"
  stroke="var(--color-success)"
  strokeWidth={2}
  fill={`url(#${gradientId})`}
  isAnimationActive={false}
/>
```

### 4.9 AgentWorkflowPanel.tsx

#### 改动 26：弃用 Ant Design Steps，使用自定义结构（第 117-170 行重写）
```tsx
return (
  <div className="agent-workflow-panel">
    <div className="agent-workflow-header">
      <span className={`agent-workflow-status-dot ${state.error ? 'error' : 'running'}`} />
      <span>Agent 工作流</span>
    </div>
    <div className="agent-workflow-steps">
      {STEP_CONFIG.map((stepConfig, index) => {
        const status = getStepStatus(stepConfig.key)
        const detail = state.stepDetails[stepConfig.key]
        return (
          <Popover
            key={stepConfig.key}
            content={
              detail ? (
                <div className="agent-workflow-detail">
                  <div className="agent-workflow-detail-title">
                    {stepConfig.label} - {stepConfig.desc}
                  </div>
                  <div className="agent-workflow-detail-content">{detail}</div>
                </div>
              ) : (
                <div className="agent-workflow-detail-title">{stepConfig.desc}</div>
              )
            }
            title={stepConfig.label}
            trigger="click"
            open={selectedStep === stepConfig.key}
            onOpenChange={(open) => setSelectedStep(open ? stepConfig.key : null)}
          >
            <div
              className={`agent-workflow-step ${status}`}
              onClick={() =>
                setSelectedStep(selectedStep === stepConfig.key ? null : stepConfig.key)
              }
            >
              <span className="agent-workflow-step-num">{index + 1}</span>
              <span className="agent-workflow-step-icon">{stepConfig.icon}</span>
              <span className="agent-workflow-step-label">{stepConfig.label}</span>
            </div>
          </Popover>
        )
      })}
    </div>

    {state.error && (
      <div className="agent-workflow-error">
        <CloseCircleOutlined style={{ marginRight: 6 }} />
        <span>错误: {state.error}</span>
      </div>
    )}

    {state.waitingForConfirmation && state.currentStep === 'confirm' && (
      <div className="agent-workflow-waiting-hint">
        <TeamOutlined style={{ marginRight: 6 }} />
        <span>等待人工确认，请审核决策卡片</span>
      </div>
    )}
  </div>
)
```

### 4.10 AgentWorkflowPanel.css

#### 改动 27：补充 step 图标样式与调整间距
```css
.agent-workflow-step {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  transition: all var(--duration-fast) var(--ease-out-quad);
  cursor: default;
  animation: fadeInUpStagger 200ms cubic-bezier(0.19, 1, 0.22, 1) both;
}

.agent-workflow-step-icon {
  display: inline-flex;
  align-items: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  line-height: 1;
}

.agent-workflow-step.active .agent-workflow-step-icon {
  color: var(--color-link);
}

.agent-workflow-step.completed .agent-workflow-step-icon {
  color: var(--color-success);
}

.agent-workflow-step.error .agent-workflow-step-icon {
  color: var(--color-error);
}
```

### 4.11 ChatPanel.tsx

#### 改动 28：移除 disabled 附件按钮（第 373-381 行）
直接删除以下代码：
```tsx
<Tooltip title="上传日志或截图（即将支持）">
  <Button
    type="text"
    shape="circle"
    icon={<PaperClipOutlined />}
    disabled
    className="chat-panel-attach-btn"
  />
</Tooltip>
```

同时移除 `PaperClipOutlined` 的 import。

#### 改动 29：工具调用区图标颜色（第 352-355 行）
```tsx
<div className="chat-panel-tool-calls-title">
  <ThunderboltOutlined style={{ color: 'var(--color-text-tertiary)', marginRight: 6 }} />
  LLM 调用了 {toolCalls.length} 个工具
</div>
```

### 4.12 MonitorPanel.tsx

#### 改动 30：section title 改用 SectionTitle（第 276-288, 292-329, 332-338 行）
例如：
```tsx
<div className="monitor-section">
  <SectionTitle icon={<DashboardOutlined />} title="系统信息" size="sm" />
  <div className="monitor-info-card">
    ...
  </div>
</div>
```

并移除原有的 `<div className="monitor-section-title">` 样式或改为针对 SectionTitle 的微调。

---

## 5. 预期前后对比

### 5.1 颜色系统
**改前**：`#fafafa` 卡片浮在 `#ffffff` 上，边界模糊；`#0071e3` 高饱和蓝主导，AI 味重。  
**改后**：`#f7f7f8` 卡片在 `#ffffff` 上有清晰但柔和的边界；`#4f46e5` 低饱和靛蓝更沉稳，暗色下 `#141416` 卡片在 `#09090b` 上层次分明。

### 5.2 监控面板
**改前**：系统信息卡 + 8 个 metric 卡 + 2 个 chart 卡，每个都有边框，视觉上"碎"。  
**改后**：统一卡片背景分层，边框更 subtle，hover 仅轻微阴影，整体感更强。

### 5.3 决策卡片
**改前**：左侧 4px 粗色带 + SectionTitle 底部边框 + 终端黑命令块 + 左对齐按钮，元素风格不统一。  
**改后**：2px 左侧色带 + 无下划线标题 + 融入卡片的命令块 + 右对齐操作按钮，更紧凑、更专业。

### 5.4 Agent 工作流
**改前**：Ant Design Steps 默认样式，与产品其他自定义组件风格不一致。  
**改后**：自定义纵向步骤列表，左侧高亮条、柔和 hover、状态色点，更像 Trae/Claude 的 Agent 面板。

### 5.5 ChatPanel
**改前**：输入区有 disabled 附件按钮，显半成品；发送按钮 hover 同时位移+缩放+阴影。  
**改后**：输入区干净无占位；发送按钮 hover 仅阴影加深，按压统一 scale(0.97)。

---

## 6. 验收标准

- [ ] 全局无硬编码颜色（组件中无 `#` / `rgba(...)`，global.css 中仅允许在 token 定义处出现）。
- [ ] 所有卡片使用统一设计语言（背景/边框/圆角/padding/hover）。
- [ ] 字体层级清晰：标题 600/500，正文 400，辅助 400 + 浅色。
- [ ] AgentWorkflowPanel 不再使用 Ant Design Steps 默认外观。
- [ ] 暗色模式下卡片与背景有 ≥ 3:1 对比度。
- [ ] 无 disabled 占位按钮。
- [ ] TypeScript 0 错误，Build 通过。

---

## 7. 风险与回退

| 风险 | 影响 | 回退 |
|---|---|---|
| 主色从 #0071e3 改为 #4f46e5，用户可能不适应 | 中 | 保留 #0071e3，仅调整饱和度和灰阶 |
| 移除终端黑命令块背景，代码可读性下降 | 低 | 使用 `--color-bg-inset` 仍能保持对比 |
| 弃用 Ant Design Steps 需要重写 TSX | 中 | 方案 B：保留 Steps，但深度覆盖样式 |
| 移除附件按钮后 v0.8 重新引入需要重做 | 低 | v0.8 直接从新设计接入完整胶囊输入区 |
| 颜色系统大改可能影响其他未审计页面 | 中 | 全局搜索 `--color-*` 引用，逐页回归 |

---

## 8. 附录：被推翻的 P0 微调 vs 第二轮重构

| 维度 | Phase 5j 微调 | 第二轮重构 |
|---|---|---|
| 颜色 | 维持 `#0071e3` 系统蓝 | 改为 `#4f46e5` 低饱和靛蓝 + 高级灰阶 |
| 卡片 | 加图标、调阴影 | 减边框、统一背景分层、简化 hover |
| 字体 | 11.5px label 等局部调整 | 全局层级重新定义（500/600 区分） |
| 组件 | 使用 Ant Design 默认组件 | 逐步替换为自定义组件 |
| 完成度 | 保留 disabled 附件按钮 | 移除占位元素 |
| 暗色 | 基于亮色的反色 | 独立设计的深色灰阶 |

> **说明**：本方案不是否定 Phase 5j，而是在其基础上发现"微调无法解决系统性设计语言问题"，因此升级为第二轮美学重构。
