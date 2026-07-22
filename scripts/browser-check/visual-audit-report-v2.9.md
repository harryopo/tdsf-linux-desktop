# TDSF Linux 运维助手桌面应用视觉审查报告 v2.9

> 审查范围：`scripts/browser-check/screenshots-round2/`（当前应用）与 `scripts/browser-check/screenshots/`（设计稿）共 13 对页面对比
> 审查日期：2026-07-22
> 审查人：前端视觉审查员
> 修复轮次：v2.8 → v2.9

---

## 顶部汇总

| 项目 | 数量 | 说明 |
|------|------|------|
| **总问题数** | 67 | 逐页审查后统计的差异项 |
| **P0（必须立即修复）** | 8 | 缺失核心功能区块、与设计稿意图严重冲突、页面结构错误 |
| **P1（影响设计还原）** | 28 | 缺失重要元素、布局偏差、多余死 UI、导航不一致 |
| **P2（细节打磨）** | 22 | 颜色、字号、间距、对齐、徽章样式等视觉细节 |
| **P3（低优先级/可延后）** | 9 | 文案、版本号、微交互提示等轻微差异 |

**整体结论**：

当前 v2.9 版本在 boot、settings 等页面仍有较明显的设计稿偏离，主要表现为：
1. **设置页结构不统一**：模型配置、关于等页面没有使用设计稿的独立布局，仍被包裹在通用 `SettingsLayout` 中，导致出现多余的顶部标题栏、侧边栏项和返回按钮。
2. **功能区块缺失较多**：实时监控缺少顶部指标摘要卡与进程监控；模型配置缺少 Thinking Effort、Max Tokens、API 接入等关键字段；外观设置缺少界面密度与代码高亮主题；终端设置缺少复制粘贴区块。
3. **死 UI / 多余元素**：boot 页存在设计稿没有的操作按钮与进度条；系统日志页存在设计稿没有的「AI 决策树还原」标签与 AI 分析开关；监控页右侧出现设计稿未规划的「关联分析 AI」浮层。
4. **返回按钮不完整**：关于页缺失返回设置入口；部分设置页同时存在「返回工作台」和「返回设置」，与设计稿仅保留「返回设置」不一致。

建议优先完成 **P0/P1** 的结构与缺失元素修复，再进行 P2/P3 的细节打磨。

---

## 逐页审查

### 1. boot（启动页）

**整体匹配度：中低**

| # | 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|---|--------|----------|----------|--------------|
| 1.1 | P0 | 背景缺失 | 当前为纯黑背景，设计稿为对角线蓝/橙/白流光渐变背景，品牌识别度差异巨大 | `src/renderer/src/pages/BootPage.tsx`、`BootPage.css` |
| 1.2 | P1 | 多余元素 | 当前存在「进入工作台」按钮，设计稿无此可点击入口，仅通过横线/标题区暗示进入 | `BootPage.tsx` |
| 1.3 | P2 | 多余元素 | 当前存在细进度条 + 副文案「就绪·点击进入工作台」，设计稿仅有一根极简横线 | `BootPage.tsx` |
| 1.4 | P3 | 多余元素 | 当前底部存在版本/赛事脚注「v2.0 · 2026 火山杯 Agent 创新大赛」，设计稿无底部信息 | `BootPage.tsx` |

---

### 2. workbench（工作台）

**整体匹配度：中**

> 注：当前截图处于「未连接 SSH / 未配置模型」状态，设计稿处于「已连接且运行中」状态。以下列出与状态无关的视觉/结构差异。

| # | 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|---|--------|----------|----------|--------------|
| 2.1 | P1 | 多余元素 | 右侧面板顶部存在「尚未配置模型 Provider」黄色警告条，设计稿无此提示区 | `src/renderer/src/components/workbench/AIPanelHeader.tsx`、`AIPanel.tsx` |
| 2.2 | P1 | 缺失元素 | 当前左侧资源管理器为未连接占位（带「去连接服务器」按钮），设计稿显示已连接服务器文件树 | `src/renderer/src/components/workbench/FileTree.tsx` |
| 2.3 | P2 | 布局/状态 | 中央终端区为黑色占位文案，设计稿为真实 shell 输出；应统一空态文案与样式 | `src/renderer/src/components/terminal/TerminalView.tsx` |
| 2.4 | P2 | 颜色 | 标题栏「未连接服务器」使用灰色，设计稿标题栏为白色且显示具体服务器名 | `src/renderer/src/components/workbench/WorkbenchTitlebar.tsx` |
| 2.5 | P2 | 信息架构 | 底部状态栏显示「SSH未连接 / 0 Errors / AI已配置」，与设计稿底部信息不一致 | `src/renderer/src/components/workbench/StatusBar.tsx` |

---

### 3. tutorial（运维教程）

**整体匹配度：中高**

| # | 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|---|--------|----------|----------|--------------|
| 3.1 | P1 | 缺失元素 | 当前页面底部缺少设计稿中的「推荐学习路径」区域（含运维新手入门 → Linux 基础 → SSH 配置 → Shell 脚本步骤） | `src/renderer/src/components/tutorial/v1/LearningPathRow.tsx`、`TutorialPage.tsx` |
| 3.2 | P2 | 标签样式 | 分类标签「全部」为实心蓝色填充，设计稿为线框/轻填充样式 | `src/renderer/src/pages/TutorialPage.css` |
| 3.3 | P2 | 卡片布局 | 精选课程卡片内按钮与进度条位置、圆角、阴影与设计稿略有偏差 | `src/renderer/src/components/tutorial/v1/FeaturedCourseCard.tsx` |
| 3.4 | P2 | 信息层级 | 普通课程卡片标签（初级/中级/进阶）颜色/位置与设计稿不完全一致 | `src/renderer/src/components/tutorial/v1/CourseCard.tsx` |
| 3.5 | P3 | 间距 | 统计卡片与精选课程之间的垂直间距略大于设计稿 | `TutorialPage.css` |

---

### 4. monitor（实时监控）

**整体匹配度：中低**

| # | 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|---|--------|----------|----------|--------------|
| 4.1 | P0 | 缺失元素 | 当前缺少设计稿顶部的 4 个核心指标摘要卡：CPU（68）、内存（52 / 4.2GB）、磁盘（78 / 156GB）、网络流量（15.2） | `src/renderer/src/pages/MonitorPage.tsx`、`MonitorPage.css` |
| 4.2 | P1 | 缺失元素 | 当前缺少设计稿底部的「进程监控 TOP 5 CPU」表格区域 | `MonitorPage.tsx` |
| 4.3 | P1 | 多余元素 | 当前右侧出现「关联分析 AI」折叠/浮动面板，设计稿右侧无此面板 | `MonitorPage.tsx`、`src/renderer/src/components/ai/AgentWorkflowPanel.tsx` |
| 4.4 | P2 | 多余元素 | 当前标题栏右侧存在「1H / 6H / 24H」时间范围切换按钮，设计稿头部无此控件（或位置不同） | `MonitorPage.tsx` |
| 4.5 | P2 | 文案/颜色 | 告警条文案不同：当前「超过阈值85%」，设计稿「超过阈值95%，建议清理 /var/log 旧日志」；设计稿告警条带操作建议 | `MonitorPage.tsx` |
| 4.6 | P2 | 表格样式 | 告警列表中「级别」徽章颜色/形状（当前为圆角标签）与设计稿（彩色文字）不一致 | `MonitorPage.tsx`、`MonitorPage.css` |

---

### 5. history（历史决策）

**整体匹配度：中高**

| # | 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|---|--------|----------|----------|--------------|
| 5.1 | P1 | 缺失元素 | 当前时间轴可见 4 条决策，设计稿可见 5 条（含底部「重启 Docker 服务 · 失败」），需确认是否为滚动裁切或数据缺失 | `src/renderer/src/pages/HistoryPage.tsx`、`src/renderer/src/components/history/HistoryPage.tsx` |
| 5.2 | P2 | 布局 | 时间轴节点/连线的水平位置、颜色与设计稿略有偏差 | `HistoryPage.css` |
| 5.3 | P2 | 信息密度 | 决策卡片内命令代码块、标签、耗时信息的排列与设计稿不一致，当前卡片更高 | `src/renderer/src/components/history/DecisionCard.tsx` |

---

### 6. knowledge（运维知识库）

**整体匹配度：中**

| # | 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|---|--------|----------|----------|--------------|
| 6.1 | P1 | 布局 | 知识列表项中「查看详情」按钮位置：当前在右侧垂直居中，设计稿在标题下方 | `src/renderer/src/components/knowledge/v1/KnowledgeCard.tsx` |
| 6.2 | P1 | 缺失元素 | 右侧「热门知识」列表缺少排名序号（1-5），当前仅显示圆点 | `src/renderer/src/components/knowledge/v1/Sidebar.tsx` |
| 6.3 | P1 | 信息不完整 | 底部「AI 知识沉淀」区域当前被截断，设计稿完整展示「1,247 条 / 23 条 / 68%」及「贡献知识」按钮 | `src/renderer/src/components/knowledge/v1/ContributionSection.tsx` |
| 6.4 | P2 | 搜索按钮 | 搜索框右侧按钮文案当前为「AI检索」，设计稿为「AI搜索」 | `KnowledgePage.tsx` |
| 6.5 | P2 | 标签样式 | 分类标签（全部/nginx/mysql…）的激活态样式与设计稿不一致 | `KnowledgePage.css` |
| 6.6 | P2 | 卡片间距 | 知识卡片之间的间距略大于设计稿，导致一屏显示条数减少 | `KnowledgePage.css` |

---

### 7. logs（系统日志）

**整体匹配度：中高**

| # | 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|---|--------|----------|----------|--------------|
| 7.1 | P1 | 多余元素 | 当前标题区存在「AI 决策树还原」标签/徽章，设计稿无此元素 | `src/renderer/src/pages/LogsPage.tsx` |
| 7.2 | P1 | 多余元素 | 当前主内容区右上角存在「AI 分析」开关 + 自动滚动/刷新/下载控件，设计稿右上角仅显示日志级别统计徽章 | `LogsPage.tsx` |
| 7.3 | P2 | 布局 | 日志级别统计徽章（INFO/WARN/ERROR/DEBUG）位置：当前位于表格右上角，设计稿位于内容区顶部右侧 | `LogsPage.tsx` |
| 7.4 | P2 | 高亮方式 | WARN/ERROR 行当前使用整行背景色高亮，设计稿仅使用彩色文字，背景保持深色 | `LogsPage.css` |
| 7.5 | P2 | 侧边栏 | 左侧「服务原始日志」子树当前为展开状态，设计稿中该子树未展开或样式不同 | `LogsPage.tsx` |

---

### 8. settings-general（通用设置）

**整体匹配度：中低**

| # | 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|---|--------|----------|----------|--------------|
| 8.1 | P0 | 缺失元素 | 当前「数据与存储」分组仅显示标题，缺少：数据存储路径、日志文件路径、自动清理日志、日志保留天数、导出数据/清除缓存按钮 | `src/renderer/src/pages/GeneralSettings.tsx` |
| 8.2 | P1 | 多余元素 | 当前页面顶部存在「设置」标题栏 + 图标 + 「返回工作台」按钮，设计稿无此顶部栏，仅保留「返回设置」 | `src/renderer/src/pages/SettingsLayout.tsx`、`SettingsPage.tsx` |
| 8.3 | P1 | 多余元素 | 左侧设置侧边栏包含设计稿没有的「决策控制 / 风险控制 / 告警阈值」三项 | `SettingsLayout.tsx`、`router.tsx` |
| 8.4 | P2 | 标题样式 | 内容区「通用」标题左侧带图标，设计稿为纯文字标题 | `GeneralSettings.tsx`、`SettingsSections.tsx` |
| 8.5 | P2 | 控件样式 | 下拉选择框、开关的圆角/高度/颜色与设计稿不完全一致 | `src/renderer/src/components/trae/Select.tsx`、`Switch.tsx` |
| 8.6 | P2 | 分组间距 | 语言与地区 / 启动行为 / 数据与存储 三组之间的间距略大 | `Settings.css` |

---

### 9. settings-ssh（SSH 连接）

**整体匹配度：中**

| # | 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|---|--------|----------|----------|--------------|
| 9.1 | P1 | 缺失元素 | 当前「连接默认设置」缺少设计稿中的「连接超时」与「Keep Alive 间隔」两个滑块 | `src/renderer/src/pages/SshSettings.tsx`、`SshSettings.css` |
| 9.2 | P1 | 状态差异 | 当前服务器列表与密钥列表显示「Electron IPC 不可用」空态，设计稿为正常数据列表；需确认是截图环境问题还是 UI 未接入 | `SshSettings.tsx`、`src/renderer/src/components/ssh/*` |
| 9.3 | P2 | 共享问题 | 同样存在多余顶部设置标题栏、多余侧边栏项（见 8.2 / 8.3） | `SettingsLayout.tsx` |
| 9.4 | P2 | 列表样式 | 已连接服务器的状态点颜色、操作按钮（连接/编辑/断开）样式与设计稿有偏差 | `SshSettings.tsx` |

---

### 10. settings-terminal（终端设置）

**整体匹配度：中低**

| # | 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|---|--------|----------|----------|--------------|
| 10.1 | P1 | 缺失元素 | 当前「默认 Shell 配置」缺少「登录提示」开关 | `src/renderer/src/pages/TerminalSettings.tsx` |
| 10.2 | P1 | 缺失元素 | 当前缺少设计稿中的「复制与粘贴」分组（选中自动复制 / 右键粘贴 / 复制去除换行符） | `TerminalSettings.tsx` |
| 10.3 | P2 | 共享问题 | 同样存在多余顶部设置标题栏、多余侧边栏项 | `SettingsLayout.tsx` |
| 10.4 | P2 | 滑块样式 | 字体大小、行高滑块的轨道高度、thumb 尺寸、数值标签位置与设计稿略有偏差 | `src/renderer/src/components/trae/Slider.tsx` |

---

### 11. settings-model（模型配置）

**整体匹配度：低**

| # | 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|---|--------|----------|----------|--------------|
| 11.1 | P0 | 页面结构 | 当前模型配置仍被包裹在通用 SettingsLayout 中（带侧边栏与顶部「设置」栏），设计稿为独立页面，顶部仅「返回设置」+「保存配置」+ 居中大标题 | `src/renderer/src/pages/ModelSettings.tsx`、`SettingsLayout.tsx` |
| 11.2 | P0 | 缺失元素 | 缺少温度参数预设按钮组：保守 0.1 / 平衡 0.3 / 创新 0.7 | `ModelSettings.tsx` |
| 11.3 | P0 | 缺失元素 | 缺少「思考强度 Thinking Effort」滑块 | `ModelSettings.tsx` |
| 11.4 | P1 | 缺失元素 | 缺少「最大 Token Max Tokens / 上下文窗口 Context Window / 请求超时 Timeout」三个输入项 | `ModelSettings.tsx` |
| 11.5 | P1 | 缺失元素 | 缺少「API 接入与测试」分组（API Endpoint、API Key、测试连接） | `ModelSettings.tsx` |
| 11.6 | P1 | 布局 | 顶部统计卡片当前为 2×2 纵向堆叠，设计稿为 1×4 横向排列 | `src/renderer/src/components/settings/ModelKpiBar.tsx` |
| 11.7 | P2 | 共享问题 | 同样存在多余顶部设置标题栏、多余侧边栏项 | `SettingsLayout.tsx` |

---

### 12. settings-appearance（外观设置）

**整体匹配度：中低**

| # | 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|---|--------|----------|----------|--------------|
| 12.1 | P1 | 缺失元素 | 当前缺少设计稿中的「界面密度」分组（紧凑 / 标准 / 宽松三选一卡片） | `src/renderer/src/pages/AppearanceSettings.tsx` |
| 12.2 | P1 | 缺失元素 | 当前缺少设计稿中的「代码高亮主题」分组（One Dark / Monokai 等卡片） | `AppearanceSettings.tsx` |
| 12.3 | P2 | 多余元素 | 强调色选择器下方出现「当前：#3B7BFF (Brand Blue)」文案，设计稿无此说明 | `AppearanceSettings.tsx` |
| 12.4 | P2 | 共享问题 | 同样存在多余顶部设置标题栏、多余侧边栏项 | `SettingsLayout.tsx` |
| 12.5 | P2 | 卡片样式 | 主题模式卡片（深色/浅色/跟随系统）的选中态边框、预览图、圆角与设计稿不完全一致 | `AppearanceSettings.tsx` |

---

### 13. settings-about（关于）

**整体匹配度：中**

| # | 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|---|--------|----------|----------|--------------|
| 13.1 | P1 | 缺失返回按钮 | 当前关于页顶部缺少设计稿中的「返回设置」按钮 | `src/renderer/src/pages/AboutSettings.tsx` |
| 13.2 | P1 | 多余元素 | 当前顶部存在「设置」标题栏 + 图标，设计稿无此标题栏 | `SettingsLayout.tsx` |
| 13.3 | P2 | 缺失元素 | 当前底部缺少设计稿中的版权信息、团队信息、隐私/服务条款链接行 | `AboutSettings.tsx` |
| 13.4 | P3 | 版本号 | 当前版本号显示 1.0.0，设计稿显示 2.4.1；需确认产品版本目标 | `AboutSettings.tsx` |

---

## 返回按钮完整性检查

| 页面 | 当前应用 | 设计稿 | 结论 |
|------|----------|--------|------|
| boot | 无 | 无 | 一致 |
| workbench | 无 | 无 | 一致 |
| tutorial | 右上角「返回工作台」 | 右上角「返回工作台」 | 一致 |
| monitor | 右上角「返回」 | 右上角「返回」 | 一致 |
| history | 右上角「返回工作台」 | 右上角「返回工作台」 | 一致 |
| knowledge | 右上角「返回工作台」 | 右上角「返回工作台」 | 一致 |
| logs | 右上角「返回工作台」 | 右上角「返回工作台」 | 一致 |
| settings-general | 顶部「返回工作台」+「返回设置」 | 仅「返回设置」 | 多余「返回工作台」 |
| settings-ssh | 顶部「返回工作台」+「返回设置」 | 仅「返回设置」 | 多余「返回工作台」 |
| settings-terminal | 顶部「返回工作台」+「返回设置」 | 仅「返回设置」 | 多余「返回工作台」 |
| settings-model | 顶部「返回工作台」+「返回设置」 | 顶部左侧「返回设置」 | 多余「返回工作台」、位置需调整 |
| settings-appearance | 顶部「返回工作台」+「返回设置」 | 仅「返回设置」 | 多余「返回工作台」 |
| settings-about | 无 | 顶部左侧「返回设置」 | **缺失返回按钮** |

**建议**：
- 所有设置子页统一移除「返回工作台」，仅保留「返回设置」。
- 关于页补齐「返回设置」按钮。
- 模型配置页按设计稿改为独立页面布局后，将「返回设置」置于顶部左侧。

---

## 交互反馈状态说明

本次审查基于静态截图，无法直接验证以下动态状态：

- **hover / active / focus**：按钮、链接、输入框、卡片的悬停/按下/聚焦态
- **loading**：启动页进度、模型保存、日志加载、SSH 连接中的 loading 状态
- **empty**：服务器列表空态、密钥空态、历史决策空态
- **click**：开关切换、滑块拖动、下拉展开、弹窗出现
- **error / success toast**：操作成功/失败的反馈提示

**建议**：在修复静态差异后，通过 Playwright 或人工走查补充动态交互验收，确保：
1. 所有可点击元素具备清晰的 hover/active 反馈。
2. 空态页面使用统一插画/文案风格，避免与加载态混淆。
3. 设置页保存后给出明确成功提示，模型配置测试 API 给出 loading / success / error 状态。
4. 启动页点击热区与视觉暗示一致（若设计稿意图为点击标题/横线进入）。

---

## 修复清单（按优先级排序）

### P0 — 必须立即修复

| # | 页面 | 问题描述 | 修复建议 | 涉及文件猜测 |
|---|------|----------|----------|--------------|
| P0-01 | boot | 启动页背景完全缺失设计稿流光渐变 | 替换为设计稿对角线蓝橙白流光背景，或实现动态渐变；保留品牌标题居中 | `BootPage.tsx`、`BootPage.css`、素材目录 |
| P0-02 | monitor | 缺少顶部核心指标摘要卡（CPU/内存/磁盘/网络） | 在图表上方增加 4 个横向指标卡，包含数值、进度环、环比变化 | `MonitorPage.tsx`、`MonitorPage.css` |
| P0-03 | monitor | 缺少底部「进程监控 TOP 5 CPU」表格 | 在告警列表下方新增进程监控区块 | `MonitorPage.tsx` |
| P0-04 | settings-general | 「数据与存储」分组内容完全缺失 | 补全数据存储路径、日志文件路径、自动清理开关、保留天数、导出/清除按钮 | `GeneralSettings.tsx` |
| P0-05 | settings-model | 页面仍被包裹在通用 SettingsLayout 中，结构与设计稿严重不符 | 为模型配置创建独立页面布局：顶部左侧返回+右侧保存，居中大标题，无侧边栏 | `ModelSettings.tsx`、`SettingsLayout.tsx`、`router.tsx` |
| P0-06 | settings-model | 缺少温度参数预设按钮组 | 在温度滑块下方增加 保守0.1 / 平衡0.3 / 创新0.7 预设按钮 | `ModelSettings.tsx` |
| P0-07 | settings-model | 缺少 Thinking Effort 滑块 | 新增思考强度滑块及低/中/高刻度 | `ModelSettings.tsx` |
| P0-08 | settings-model | 缺少 Max Tokens / Context Window / Timeout / API Endpoint / API Key 等关键字段 | 补全模型高级参数与 API 接入测试区 | `ModelSettings.tsx` |

### P1 — 影响设计还原

| # | 页面 | 问题描述 | 修复建议 | 涉及文件猜测 |
|---|------|----------|----------|--------------|
| P1-01 | boot | 存在设计稿没有的「进入工作台」按钮 | 移除该按钮；若需保留点击入口，将整张启动页作为点击热区并添加 hover 反馈 | `BootPage.tsx` |
| P1-02 | workbench | 右侧面板存在设计稿没有的 Provider 配置警告条 | 移除或仅在未配置时以空态/占位方式展示，避免常驻黄色警告 | `AIPanelHeader.tsx`、`AIPanel.tsx` |
| P1-03 | workbench | 左侧资源管理器为未连接占位，缺少设计稿的文件树 | 接入 SSH 连接状态，连接后渲染服务器文件树；未连接时使用设计稿一致的空态 | `FileTree.tsx` |
| P1-04 | tutorial | 缺少「推荐学习路径」区域 | 在页面底部新增学习路径步骤条 | `LearningPathRow.tsx`、`TutorialPage.tsx` |
| P1-05 | monitor | 右侧存在设计稿未规划的「关联分析 AI」面板 | 移除该面板；若业务需要，将其内容整合到告警详情弹窗中 | `MonitorPage.tsx`、`AgentWorkflowPanel.tsx` |
| P1-06 | history | 时间轴条目数量与设计稿不一致（4 vs 5） | 检查分页/滚动逻辑，确保默认展示条数或滚动位置与设计稿一致 | `HistoryPage.tsx` |
| P1-07 | knowledge | 知识列表「查看详情」按钮位置偏离设计稿 | 将按钮从卡片右侧移至标题下方 | `KnowledgeCard.tsx` |
| P1-08 | knowledge | 右侧「热门知识」缺少排名序号 | 将圆点改为 1-5 排名序号 | `Sidebar.tsx` |
| P1-09 | knowledge | 底部「AI 知识沉淀」区域被截断，信息不完整 | 调整容器高度/间距，完整展示统计与「贡献知识」按钮 | `ContributionSection.tsx` |
| P1-10 | logs | 存在设计稿没有的「AI 决策树还原」标签 | 移除该标签 | `LogsPage.tsx` |
| P1-11 | logs | 存在设计稿没有的「AI 分析」开关及自动滚动控件 | 移除或收起至高级菜单；右上角仅保留日志级别统计徽章 | `LogsPage.tsx` |
| P1-12 | settings-general | 顶部存在多余的「设置」标题栏和「返回工作台」按钮 | 移除顶部栏，仅保留「返回设置」 | `SettingsLayout.tsx`、`GeneralSettings.tsx` |
| P1-13 | settings-general | 侧边栏包含设计稿没有的「决策控制 / 风险控制 / 告警阈值」 | 从设置导航中移除这三项（或确认是否已下线） | `SettingsLayout.tsx`、`router.tsx` |
| P1-14 | settings-ssh | 缺少连接超时与 Keep Alive 间隔滑块 | 在连接默认设置分组新增两个滑块 | `SshSettings.tsx` |
| P1-15 | settings-terminal | 缺少「登录提示」开关 | 在默认 Shell 配置分组新增该开关 | `TerminalSettings.tsx` |
| P1-16 | settings-terminal | 缺少「复制与粘贴」分组 | 新增选中自动复制、右键粘贴、复制去除换行符三个开关 | `TerminalSettings.tsx` |
| P1-17 | settings-appearance | 缺少「界面密度」分组 | 新增紧凑/标准/宽松三选一卡片 | `AppearanceSettings.tsx` |
| P1-18 | settings-appearance | 缺少「代码高亮主题」分组 | 新增 One Dark / Monokai 等主题卡片 | `AppearanceSettings.tsx` |
| P1-19 | settings-about | 缺少「返回设置」按钮 | 在顶部左侧添加返回按钮 | `AboutSettings.tsx` |
| P1-20 | settings-model | 顶部统计卡片布局为 2×2 纵向堆叠，设计稿为 1×4 横向 | 改为横向排列的 4 个指标卡 | `ModelKpiBar.tsx` |
| P1-21 | 所有设置页 | 设置页标题带图标，设计稿为纯文字 | 移除内容区标题左侧图标 | `SettingsSections.tsx`、各 `*Settings.tsx` |
| P1-22 | settings-ssh | 服务器/密钥空态显示「Electron IPC 不可用」 | 若仅为测试环境限制，提供正常的 mock/空态 UI；若功能未接入则优先修复 IPC | `SshSettings.tsx` |
| P1-23 | workbench | 中央终端区显示占位文案而非真实终端 | 统一空态样式，连接后渲染 xterm 真实输出 | `TerminalView.tsx` |
| P1-24 | logs | 日志级别徽章位置与设计稿不一致 | 将 INFO/WARN/ERROR/DEBUG 统计徽章移至内容区顶部右侧 | `LogsPage.tsx` |
| P1-25 | monitor | 告警条缺少设计稿中的清理建议操作 | 在告警条右侧增加「建议清理 /var/log 旧日志」等操作链接 | `MonitorPage.tsx` |
| P1-26 | settings-model | 当前模型显示为 doubao-seed-1-6-250615，设计稿为 DeepSeek-R1 | 确认默认模型展示逻辑；若设计稿为示意，则保持数据驱动 | `ModelSettings.tsx` |
| P1-27 | monitor | 标题栏时间范围切换控件位置/存在性 | 若设计稿不需要头部时间切换，则移除；若需要，按设计稿位置重构 | `MonitorPage.tsx` |
| P1-28 | settings-about | 顶部存在多余的「设置」标题栏 | 移除关于页的通用设置标题栏，使用独立居中布局 | `SettingsLayout.tsx`、`AboutSettings.tsx` |

### P2 — 细节打磨

| # | 页面 | 问题描述 | 修复建议 | 涉及文件猜测 |
|---|------|----------|----------|--------------|
| P2-01 | boot | 存在设计稿没有的进度条 + 副文案 | 移除副文案，仅保留极简横线；或改为点击提示的淡入动画 | `BootPage.tsx` |
| P2-02 | workbench | 标题栏颜色/状态文案与设计稿不一致 | 标题栏使用白色文字，连接后显示具体服务器名 | `WorkbenchTitlebar.tsx` |
| P2-03 | workbench | 底部状态栏信息与设计稿不一致 | 统一为设计稿中的连接状态、路径、编码等底部信息 | `StatusBar.tsx` |
| P2-04 | tutorial | 分类标签「全部」激活态样式不同 | 改为设计稿线框/轻填充样式 | `TutorialPage.css` |
| P2-05 | tutorial | 精选课程卡片圆角/阴影/按钮位置偏差 | 调整卡片样式以匹配设计稿 | `FeaturedCourseCard.tsx` |
| P2-06 | tutorial | 普通课程卡片标签颜色/位置偏差 | 统一标签样式 | `CourseCard.tsx` |
| P2-07 | monitor | 告警列表级别徽章为圆角标签，设计稿为彩色文字 | 改为文字颜色区分，不使用背景徽章 | `MonitorPage.tsx` |
| P2-08 | history | 时间轴节点/连线位置与设计稿略有偏差 | 调整节点尺寸、连线颜色、时间标签对齐 | `HistoryPage.css` |
| P2-09 | history | 决策卡片信息密度与设计稿不同 | 压缩卡片高度，统一命令块、标签、耗时布局 | `DecisionCard.tsx` |
| P2-10 | knowledge | 搜索按钮文案「AI检索」应改为「AI搜索」 | 修改按钮文案 | `KnowledgePage.tsx` |
| P2-11 | knowledge | 分类标签激活态样式不一致 | 统一为设计稿样式 | `KnowledgePage.css` |
| P2-12 | knowledge | 知识卡片间距略大 | 减小卡片间距以提升一屏信息量 | `KnowledgePage.css` |
| P2-13 | logs | WARN/ERROR 行使用整行背景高亮 | 改为仅文字颜色高亮，保持深色背景 | `LogsPage.css` |
| P2-14 | logs | 左侧服务原始日志子树展开状态与设计稿不同 | 默认收起或调整缩进样式 | `LogsPage.tsx` |
| P2-15 | 所有设置页 | 下拉框、开关、输入框圆角/高度/颜色不一致 | 统一 trae 组件设计 token | `Select.tsx`、`Switch.tsx`、`Input.tsx` |
| P2-16 | 所有设置页 | 分组间距略大 | 按设计稿调整 section 间距 | `Settings.css` |
| P2-17 | settings-ssh | 服务器状态点、操作按钮样式偏差 | 调整颜色与间距 | `SshSettings.tsx` |
| P2-18 | settings-terminal | 滑块轨道高度、thumb 尺寸、数值标签位置偏差 | 统一 Slider 组件样式 | `Slider.tsx`、`TerminalSettings.tsx` |
| P2-19 | settings-appearance | 主题模式卡片选中态、预览图、圆角不一致 | 调整卡片选中样式 | `AppearanceSettings.tsx` |
| P2-20 | settings-about | 缺少底部版权与团队信息 | 补充 footer 版权、团队、链接 | `AboutSettings.tsx` |
| P2-21 | boot | 启动页标题字重/字距与设计稿略有差异 | 调整标题 typography | `BootPage.css` |
| P2-22 | workbench | 终端区占位文案与设计稿空态不一致 | 使用更简洁的占位提示 | `TerminalView.tsx` |

### P3 — 低优先级

| # | 页面 | 问题描述 | 修复建议 | 涉及文件猜测 |
|---|------|----------|----------|--------------|
| P3-01 | boot | 底部存在版本/赛事脚注 | 移除底部脚注，保持启动页极简 | `BootPage.tsx` |
| P3-02 | tutorial | 统计卡片与精选课程间距略大 | 微调垂直间距 | `TutorialPage.css` |
| P3-03 | settings-appearance | 强调色下方出现「当前：#3B7BFF」说明文案 | 移除该文案 | `AppearanceSettings.tsx` |
| P3-04 | settings-about | 版本号 1.0.0 与设计稿 2.4.1 不一致 | 确认产品版本后更新 | `AboutSettings.tsx` |
| P3-05 | boot | 若保留点击入口，需确认 hover 反馈 | 增加标题/横线 hover 光晕或轻微放大 | `BootPage.tsx` |
| P3-06 | monitor | 图表区圆角/阴影轻微不一致 | 统一卡片容器样式 | `MonitorPage.css` |
| P3-07 | history | 时间轴日期分隔样式轻微不一致 | 统一日期标签样式 | `HistoryPage.css` |
| P3-08 | knowledge | 匹配度徽章颜色/形状轻微偏差 | 统一徽章样式 | `KnowledgeCard.tsx` |
| P3-09 | logs | 底部状态栏文案/图标轻微不一致 | 对齐设计稿底部状态栏 | `LogsPage.tsx` |

---

## 附录：截图文件对应关系

| 当前应用截图 | 设计稿截图 | 页面 |
|--------------|------------|------|
| `screenshots-round2/boot.png` | `screenshots/design-boot.png` | 启动页 |
| `screenshots-round2/workbench.png` | `screenshots/design-workbench.png` | 工作台 |
| `screenshots-round2/tutorial.png` | `screenshots/design-tutorial.png` | 运维教程 |
| `screenshots-round2/monitor.png` | `screenshots/design-monitor.png` | 实时监控 |
| `screenshots-round2/history.png` | `screenshots/design-history.png` | 历史决策 |
| `screenshots-round2/knowledge.png` | `screenshots/design-knowledge.png` | 运维知识库 |
| `screenshots-round2/logs.png` | `screenshots/design-logs.png` | 系统日志 |
| `screenshots-round2/settings-general.png` | `screenshots/design-settings-general.png` | 通用设置 |
| `screenshots-round2/settings-ssh.png` | `screenshots/design-settings-ssh.png` | SSH 连接 |
| `screenshots-round2/settings-terminal.png` | `screenshots/design-settings-terminal.png` | 终端设置 |
| `screenshots-round2/settings-model.png` | `screenshots/design-settings-model.png` | 模型配置 |
| `screenshots-round2/settings-appearance.png` | `screenshots/design-settings-appearance.png` | 外观设置 |
| `screenshots-round2/settings-about.png` | `screenshots/design-settings-about.png` | 关于 |
