# 视觉审查报告 v2.6

## 执行摘要

- **审查页面数**：19 对（app vs design）
- **总体相似度**：约 78/100
- **问题分级**：P0 必须修复 6 项、P1 明显差异 10 项、P2 可优化 6 项
- **审查维度**：整体布局、间距、对齐、字体字号、按钮样式、元素顺序、缺失/多余元素、色块卡片、hover 状态、启动页标题居中、设置页侧边栏、Monitor 时间范围切换、ModelSettings 思考强度选择器、新增功能模块视觉堆叠等。
- **审查说明**：所有结论均基于 `scripts/browser-check/screenshots/` 目录下实际截图内容，未做假设；相似度评分综合考虑了布局结构、元素一致性、视觉风格三维度。

---

## 逐页详细对比

### boot

- **相似度**：75/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-boot.png` / `design-boot.png`
- **问题清单**：
  1. **[P0] 背景动效完全不符**：设计稿为对角线彩色光带（橙/蓝/白渐变流光），实际应用为深色背景配四角蓝色辉光，视觉风格差异显著。→ 修复 `src/renderer/src/pages/BootPage.tsx` 中 Three.js shader 背景或替换为设计稿对应的 CSS/SVG/Canvas 对角流光。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\BootPage.tsx`。
  2. **[P1] 进入按钮样式差异**：设计稿中央仅一条细长进度/分隔线，实际应用显示“进入工作台”按钮+进度条组合，元素形态不同。→ 核对设计稿 boot 页最终交付形态，若设计稿为准则移除按钮或改为纯线条。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\BootPage.tsx`（约 205-260 行区域）。
  3. **[P2] 标题字间距视觉偏移**：虽然代码已做 `text-indent` 补偿，但在某些分辨率下仍可感知轻微偏移，需继续验证多分辨率居中。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\BootPage.tsx`。

### workbench

- **相似度**：82/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-workbench.png` / `design-workbench.png`
- **问题清单**：
  1. **[P0] 顶部多余 macOS 三色圆点**：设计稿工作台顶部栏左侧无红/黄/绿圆点，实际应用多出 3 个 12px 圆点，破坏设计稿纯净度。→ 移除 `WorkbenchTitlebar.tsx` 中 `<div className="flex items-center gap-2 mr-1" aria-hidden="true">` 三个圆点。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\components\workbench\WorkbenchTitlebar.tsx`（约 44-49 行）。
  2. **[P1] AI 面板模块间距/密度差异**：实际 AI 面板中“深度思考、Skill 调用、执行步骤、知识库”等模块堆叠较紧，与设计稿卡片间距不一致。→ 调整 `AIPanel.tsx` 中 `flex flex-col gap-3 p-3` 及 `ToolPanel` 的 `my-1`/`p-2` 间距。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\components\workbench\AIPanel.tsx`。
  3. **[P1] 右侧工具按钮缺少“终端面板”图标**：设计稿右侧标题栏有搜索/AI/终端/布局/设置，实际缺少独立的终端面板 toggle。→ 在 `WorkbenchTitlebar.tsx` 图标按钮组补充终端面板按钮。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\components\workbench\WorkbenchTitlebar.tsx`（约 65-87 行）。
  4. **[P2] 活动栏图标尺寸/间距微调**：实际 36×36 按钮区域与设计稿 36×36 一致，但视觉重心略偏上，可微调 `py-2`/`gap-1`。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\components\workbench\ActivityRail.tsx`。

### tutorial

- **相似度**：78/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-tutorial.png` / `design-tutorial.png`
- **问题清单**：
  1. **[P0] 顶部 Hero 统计卡数据与设计稿不符**：设计稿为“12 门课程 / 48 课时 / 3.2k 学习人次”，实际应用为“6 门课程 / 54 分钟学习时长 / 一条无数据占位”。→ 核对并更新 `TutorialPage.tsx` 中 `statOverviews` 或 HeroStats 数据与文案。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\TutorialPage.tsx`。
  2. **[P1] 右上角多出“刷新教程”按钮**：设计稿仅“返回工作台”按钮，实际多出一个“刷新教程”按钮。→ 移除多余按钮或确认设计稿是否已更新。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\TutorialPage.tsx`。
  3. **[P1] 精选课程卡片按钮文案不一致**：设计稿为“开始学习”，实际为“继续学习 →”，需统一。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\TutorialPage.tsx` 中 `FeaturedCourseCard` 组件。
  4. **[P2] 分类标签栏样式**：实际“全部/Linux 基础/网络运维…”标签为紧凑按钮，设计稿标签圆角与间距略有不同，可微调。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\TutorialPage.tsx`。

### monitor

- **相似度**：65/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-monitor.png` / `design-monitor.png`
- **问题清单**：
  1. **[P0] KPI 卡片展示形式完全错误**：设计稿为“数字 + 迷你折线（Sparkline）”样式，实际应用使用“圆形仪表盘 + 内部数值”，与设计稿不一致。→ 重构 `MonitorPage.tsx` 中 `KpiCard` 组件，改为设计稿的数字+折线卡片。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\MonitorPage.tsx` 及 `KpiCard` 子组件。
  2. **[P0] 缺少右上角时间范围切换按钮**：设计稿右上角有“返回 / 1H / 6H / 24H”时间范围切换组，实际应用没有。→ 在 Monitor 页 Header 补充时间范围切换按钮组。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\MonitorPage.tsx`。
  3. **[P1] 图表容器间距不一致**：设计稿图表区域卡片间距更宽松，实际 `gap-2` 显得拥挤。→ 调整 `MonitorPage.tsx` 中 `grid gap-2` 为更大间距。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\MonitorPage.tsx`。
  4. **[P1] 告警列表标签样式差异**：设计稿告警级别标签为圆角胶囊且颜色更鲜明，实际标签尺寸略小。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\MonitorPage.tsx` 中告警列表组件。

### history

- **相似度**：80/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-history.png` / `design-history.png`
- **问题清单**：
  1. **[P1] 决策记录卡片时间轴节点样式差异**：设计稿时间节点为圆点+细线，实际节点略大且时间标签位置不同。→ 调整 `DecisionCard` 组件中时间轴节点与标签样式。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\HistoryPage.tsx` 及 `DecisionCard`。
  2. **[P1] 底部数字分页设计稿未显示**：实际底部有 1/2/3 分页，设计稿截图未展示分页区域，可能为新增元素或截断导致，需确认。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\HistoryPage.tsx`。
  3. **[P2] 统计卡数字字体**：设计稿数字更粗、更大，实际 `text-2xl` 类可能偏小。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\HistoryPage.tsx` 中 `StatCard`。

### knowledge

- **相似度**：78/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-knowledge.png` / `design-knowledge.png`
- **问题清单**：
  1. **[P1] “AI 知识沉淀”模块位置错误**：设计稿中该模块位于右侧边栏底部，实际应用固定在页面底部横条，与右侧边栏分离。→ 将 `KnowledgePage.tsx` 中 AI 知识沉淀区块移入右侧 `Sidebar` 组件底部。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\KnowledgePage.tsx` 及 `Sidebar` 组件。
  2. **[P1] 知识条目卡片右侧标签/元信息布局差异**：设计稿右侧显示“匹配度百分比+查看详情”，实际标签样式与位置略有不同。→ 调整 `KnowledgeCard` 组件。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\KnowledgePage.tsx`。
  3. **[P2] 搜索框高度与圆角**：实际搜索框更高、圆角更大，设计稿更扁。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\KnowledgePage.tsx` 中搜索输入框。

### logs

- **相似度**：85/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-logs.png` / `design-logs.png`
- **问题清单**：
  1. **[P1] 顶部“AI 日志分析”按钮位置/样式**：设计稿中该按钮位于 Level filter 右侧且为独立按钮，实际与自动滚动开关间距略近。→ 调整 `LogsPage.tsx` / `LogToolbar` 中按钮组间距。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\LogsPage.tsx`（约 225-236 行）。
  2. **[P2] 日志源侧边栏宽度**：设计稿左侧侧边栏略宽，实际 180px 显得有些窄。→ 调整 `LogSidebar` 宽度。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\components\logs\v1\LogSidebar.tsx`。
  3. **[P2] 日志行高/字号**：设计稿日志文本更紧凑，实际行高略大。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\components\logs\v1\LogViewer.tsx`。

### settings-general

- **相似度**：80/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-settings-general.png` / `design-settings-general.png`
- **问题清单**：
  1. **[P1] 左侧设置导航文案差异**：设计稿导航项为“通用 / SSH 连接 / AI 引擎 / 风险控制 / 终端设置 / 外观 / 关于”，实际代码中 SettingsLayout 的 `SETTINGS_NAV` 为“通用 / SSH 连接 / AI 引擎 / 风险控制 / 终端设置 / 外观 / 决策控制 / 关于”。两者多了一项“决策控制”，需确认设计稿是否已删减。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\SettingsLayout.tsx`（约 39-48 行）。
  2. **[P2] 卡片内行高与字号**：设计稿设置项标题与描述间距更小，整体更紧凑。→ 调整 `SettingsRow` 组件或 `GeneralSettings.tsx` 中间距。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\GeneralSettings.tsx`。
  3. **[P2] Select 触发器宽度/对齐**：实际 Select 显示较宽，设计稿更窄且右对齐。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\GeneralSettings.tsx` 中 `RowSelect`。

### settings-model

- **相似度**：75/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-settings-model.png` / `design-settings-model.png`
- **问题清单**：
  1. **[P0] 新增功能模块视觉堆叠严重**：实际截图中 API 接入与测试、Token 使用统计、功能调用统计、对话记录、预算与告警等模块全部堆叠在一屏以下，导致信息密度过高、可读性差；设计稿中各模块间距更合理，且未在同一屏内展示全部内容。→ 重新规划 `ModelSettings.tsx` 各 Section 间距与卡片内边距，必要时采用分栏/折叠/分页。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\ModelSettings.tsx`。
  2. **[P1] 思考强度选择器样式**：设计稿为分段按钮（低/中/高），实际为分段按钮但边框/激活态颜色与设计稿略有差异。→ 核对 `ModelSettings.tsx` 中 `THINKING_LEVELS` 按钮样式。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\ModelSettings.tsx`（约 421-440 行）。
  3. **[P1] API 测试日志卡片背景色**：设计稿测试日志区域背景更深或与卡片区分明显，实际混入主卡片背景。→ 调整测试日志 `rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-default)]` 样式。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\ModelSettings.tsx`（约 605-624 行）。
  4. **[P2] KPI 统计行卡片圆角/阴影**：设计稿 KPI 卡片更扁平，实际阴影略重。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\components\settings\ModelKpiBar.tsx`。

### settings-appearance

- **相似度**：85/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-settings-appearance.png` / `design-settings-appearance.png`
- **问题清单**：
  1. **[P2] 主题模式卡片选中态阴影/边框**：设计稿选中卡片边框与背景色对比更柔和，实际 `bg-[var(--trae-bg-brand-popup)]` 偏蓝。→ 核对设计稿 token 后调整。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\AppearanceSettings.tsx`（约 231-277 行）。
  2. **[P2] 字号/行高滑块刻度值显示**：设计稿在滑块右侧显示当前值，实际显示一致但字体略小。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\AppearanceSettings.tsx` 中 `SettingsSlider`。
  3. **[P2] 代码高亮主题卡片预览代码行高**：实际预览代码 `leading-[16px]` 与设计稿略有差异。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\AppearanceSettings.tsx`（约 406-418 行）。

### settings-risk

- **相似度**：82/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-settings-risk.png` / `design-settings-risk.png`
- **问题清单**：
  1. **[P1] 风险等级标签颜色**：设计稿中“极高”为红色、“高”为橙色，实际颜色饱和度略低。→ 核对 `LEVEL_TAG_CLASS` 中的 token。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\RiskSettings.tsx`（约 84-92 行）。
  2. **[P1] 命令风险规则表表头/行高**：设计稿表格行高更紧凑，实际 `py-2.5` 略大。→ 调整 `RiskSettings.tsx` 中表格 `td`/`th` 的 padding。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\RiskSettings.tsx`（约 253-322 行）。
  3. **[P2] 操作列按钮尺寸**：实际“编辑/删除”按钮高度 28px，设计稿约 24px。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\RiskSettings.tsx`。

### settings-ssh

- **相似度**：85/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-settings-ssh.png` / `design-settings-ssh.png`
- **问题清单**：
  1. **[P2] 已连接服务器列表行高与按钮组**：设计稿服务器行更紧凑，右侧按钮组更小巧。→ 调整 `SshSettings.tsx` 中服务器列表项 padding 与按钮尺寸。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\SshSettings.tsx`。
  2. **[P2] SSH 密钥管理卡片缺少复选框**：设计稿密钥项左侧有选择复选框，实际没有。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\SshSettings.tsx`。

### settings-terminal

- **相似度**：85/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-settings-terminal.png` / `design-settings-terminal.png`
- **问题清单**：
  1. **[P2] 设置项行高/间距**：设计稿各项更紧凑，实际 `SettingsRow` 间距略大。→ 调整 `TerminalSettings.tsx` 中 `SettingsCard` 内边距或 `SettingsRow` 默认高度。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\TerminalSettings.tsx`。
  2. **[P2] Slider 轨道颜色**：实际滑块激活段颜色与设计稿主色有轻微色差。→ 核对 `SettingsSlider` 组件 token。

### settings-decision

- **相似度**：75/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-settings-decision.png` / `design-settings-decision.png`
- **问题清单**：
  1. **[P1] 页面内容截断/堆叠**：实际截图中“决策流程配置”“证据源权重配置”“风险控制策略”等区块堆叠且部分被截断，设计稿展示更完整。→ 检查 `DecisionSettings.tsx` 中卡片间距与 `main` 区域滚动行为，确保各卡片完整可见。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\DecisionSettings.tsx`。
  2. **[P1] 证据源权重滑块数值**：设计稿权重总和显示为 398，实际代码中 `totalWeight` 计算可能未实时同步（截图未明确显示总和，需核对）。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\DecisionSettings.tsx` 中权重状态与求和逻辑。
  3. **[P2] 风险策略命令黑名单背景**：设计稿命令黑名单区域背景为独立深色块，实际与卡片背景融合。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\DecisionSettings.tsx`。

### settings-about

- **相似度**：70/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-settings-about.png` / `design-settings-about.png`
- **问题清单**：
  1. **[P0] 不应显示左侧设置导航边栏**：设计稿 `settings-about.html` 为独立居中布局（无左侧导航），实际应用仍嵌套在 `SettingsLayout` 中，左侧显示 220px 导航卡片。→ 将 `/settings/about` 路由从 `SettingsLayout` 嵌套中移出，或使用独立布局渲染 `AboutSettings`。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\AboutSettings.tsx`、`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\SettingsLayout.tsx` 及路由配置。
  2. **[P1] Hero 区域垂直间距过大**：实际 About 页内容偏上，设计稿内容垂直居中更均衡。→ 调整 `AboutSettings.tsx` 中 `pt-12` 与 `pb-16` 的比例。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\AboutSettings.tsx`（约 153 行）。
  3. **[P2] 链接卡片 hover 阴影**：设计稿 hover 时阴影更细腻，实际 `hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)]` 可再优化。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\AboutSettings.tsx`（约 239-263 行）。

### history-detail

- **相似度**：80/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-history-detail.png` / `design-history-detail.png`
- **问题清单**：
  1. **[P1] 页面标题编号格式不一致**：设计稿为“决策记录 #DEC-2024-0718-001”，实际为“决策记录 #1”。→ 更新 `HistoryDetailPage.tsx` 中标题渲染，使用完整决策 ID。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\HistoryDetailPage.tsx`。
  2. **[P2] 决策摘要卡片内边距**：实际卡片 `px-4 py-3.5` 与设计稿相比略紧凑。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\HistoryDetailPage.tsx`。
  3. **[P2] 证据链步骤时间戳字体**：设计稿时间戳更小、颜色更淡。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\HistoryDetailPage.tsx` 中 `EvidenceTimeline`。

### knowledge-detail

- **相似度**：85/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-knowledge-detail.png` / `design-knowledge-detail.png`
- **问题清单**：
  1. **[P2] 右侧目录激活态样式**：设计稿当前目录项有蓝色背景高亮，实际仅为文字颜色变化。→ 调整 `KnowledgeDetailPage.tsx` 或右侧目录组件激活态样式。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\KnowledgeDetailPage.tsx`。
  2. **[P2] 代码块标题栏**：设计稿代码块标题栏与代码区背景色区分更明显。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\KnowledgeDetailPage.tsx` 中代码块组件。

### decision-detail

- **相似度**：78/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-decision-detail.png` / `design-decision-detail.png`
- **问题清单**：
  1. **[P1] 顶部决策信息条布局差异**：设计稿顶部有“决策ID / 时间 / 场景 / 置信度”等标签横向排列，实际排列更紧凑且标签样式不同。→ 调整 `DecisionDetailPage.tsx` 中顶部信息条。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\DecisionDetailPage.tsx`。
  2. **[P1] 六源证据融合雷达图与列表比例**：设计稿中雷达图与证据列表左右比例更均衡，实际雷达图偏小。→ 调整 `DecisionDetailPage.tsx` 中 `ConfidenceGauge` 与证据列表容器宽度。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\DecisionDetailPage.tsx`（约 80-120 行区域）。
  3. **[P2] 执行命令面板按钮组**：设计稿“采纳执行/修改/拒绝”按钮为横向等分，实际“采纳执行”为蓝色长条，修改/拒绝为图标按钮。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\DecisionDetailPage.tsx` 中 `ExecutionResult` 组件。

### tutorial-detail

- **相似度**：82/100
- **截图路径**：`d:\ai\linux教学一体\tdsf-linux-desktop\scripts\browser-check\screenshots\app-tutorial-detail.png` / `design-tutorial-detail.png`
- **问题清单**：
  1. **[P1] 当前章节内容差异（截图状态不同）**：实际截图显示“第 1 章：Nginx 基础架构”，设计稿显示“第 2 章：内核参数优化”。这是测试截图时页面状态不同导致，但会误导视觉审查；建议统一测试状态后重截。→ 非代码问题，流程问题。
  2. **[P2] 章节进度条节点间距**：设计稿进度条节点与标签对齐更精确，实际略有偏移。→ 调整 `TutorialDetailPage.tsx` 中 `ChapterProgressBar` 组件。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\TutorialDetailPage.tsx`。
  3. **[P2] 知识检查单选按钮样式**：设计稿单选按钮为品牌色圆点，实际为默认样式。→ 涉及文件：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\TutorialDetailPage.tsx` 中 `QuizCard`。

---

## 汇总与优先级

### P0 必须修复

1. **BootPage 背景动效完全不符**：设计稿对角线彩色光带，实际深色+四角蓝光。→ `src/renderer/src/pages/BootPage.tsx`
2. **Monitor 页 KPI 展示形式错误**：设计稿数字+Sparkline，实际圆形仪表盘。→ `src/renderer/src/pages/MonitorPage.tsx`（`KpiCard`）
3. **Monitor 页缺少时间范围切换按钮**：设计稿有 1H/6H/24H，实际缺失。→ `src/renderer/src/pages/MonitorPage.tsx`
4. **WorkbenchTitlebar 多出 macOS 三色圆点**：设计稿无此元素。→ `src/renderer/src/components/workbench/WorkbenchTitlebar.tsx`
5. **TutorialPage Hero 统计卡数据/文案不符**：6/54/空 vs 12/48/3.2k。→ `src/renderer/src/pages/TutorialPage.tsx`
6. **AboutSettings 错误嵌套在 SettingsLayout 中**：设计稿为独立居中布局，实际左侧显示设置导航。→ `src/renderer/src/pages/AboutSettings.tsx`、`src/renderer/src/pages/SettingsLayout.tsx`、路由配置

### P1 明显差异

1. BootPage“进入工作台”按钮形态与设计稿单线不符。→ `src/renderer/src/pages/BootPage.tsx`
2. Workbench AI 面板模块间距/密度差异。→ `src/renderer/src/components/workbench/AIPanel.tsx`
3. WorkbenchTitlebar 缺少终端面板按钮。→ `src/renderer/src/components/workbench/WorkbenchTitlebar.tsx`
4. TutorialPage 多出“刷新教程”按钮、精选课程按钮文案不一致。→ `src/renderer/src/pages/TutorialPage.tsx`
5. Monitor 图表区域间距拥挤。→ `src/renderer/src/pages/MonitorPage.tsx`
6. KnowledgePage“AI 知识沉淀”位置错误。→ `src/renderer/src/pages/KnowledgePage.tsx`
7. Settings-general 左侧导航项数/文案与设计稿不一致。→ `src/renderer/src/pages/SettingsLayout.tsx`
8. ModelSettings 新增模块视觉堆叠、API 测试日志卡片背景混淆、思考强度选择器细节差异。→ `src/renderer/src/pages/ModelSettings.tsx`
9. Settings-decision 内容截断/堆叠。→ `src/renderer/src/pages/DecisionSettings.tsx`
10. History-detail 标题编号格式不一致。→ `src/renderer/src/pages/HistoryDetailPage.tsx`

### P2 可优化

1. 各页面卡片圆角/阴影/ hover 效果可进一步对齐设计稿（如 AboutSettings 链接卡片、AppearanceSettings 主题卡片）。
2. 部分页面设置项行高/字号略大，可压缩（TerminalSettings、GeneralSettings、RiskSettings）。
3. LogsPage 侧边栏宽度与日志行高可微调。
4. HistoryPage 统计卡数字字重/字号可加大。
5. Decision-detail 执行命令面板按钮组样式可改为设计稿横向等分。
6. Tutorial-detail 截图状态需统一，章节进度条与知识检查单选样式可优化。

---

## 附录：截图文件清单

| 页面 | APP 截图 | DESIGN 截图 |
|---|---|---|
| boot | `app-boot.png` | `design-boot.png` |
| workbench | `app-workbench.png` | `design-workbench.png` |
| tutorial | `app-tutorial.png` | `design-tutorial.png` |
| monitor | `app-monitor.png` | `design-monitor.png` |
| history | `app-history.png` | `design-history.png` |
| knowledge | `app-knowledge.png` | `design-knowledge.png` |
| logs | `app-logs.png` | `design-logs.png` |
| settings-general | `app-settings-general.png` | `design-settings-general.png` |
| settings-model | `app-settings-model.png` | `design-settings-model.png` |
| settings-appearance | `app-settings-appearance.png` | `design-settings-appearance.png` |
| settings-risk | `app-settings-risk.png` | `design-settings-risk.png` |
| settings-ssh | `app-settings-ssh.png` | `design-settings-ssh.png` |
| settings-terminal | `app-settings-terminal.png` | `design-settings-terminal.png` |
| settings-decision | `app-settings-decision.png` | `design-settings-decision.png` |
| settings-about | `app-settings-about.png` | `design-settings-about.png` |
| history-detail | `app-history-detail.png` | `design-history-detail.png` |
| knowledge-detail | `app-knowledge-detail.png` | `design-knowledge-detail.png` |
| decision-detail | `app-decision-detail.png` | `design-decision-detail.png` |
| tutorial-detail | `app-tutorial-detail.png` | `design-tutorial-detail.png` |

---

*报告生成时间：2026-07-20*  
*审查范围：仅 UI 视觉表现，未涉及功能逻辑与后端接口。*
