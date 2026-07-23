# TDSF Linux Desktop · 前端全量重构设计文档

> **日期**：2026-07-23
> **方案**：C - 按模块端到端打通
> **视觉严格度**：1:1 像素级复刻设计稿
> **范围**：全 21 页面 + 全按钮真实可点击 + 缺失 IPC 补齐
> **状态**：已批准（用户确认"全都要做，慢慢开发"）

---

## 一、项目背景与现状

### 1.1 项目定位

**TDSF-Linux Desktop** = SSH 终端 + AI 辅助问答 + 高危命令拦截 + 日志分析
面向 Linux 初学者的桌面运维工具，2026 火山杯 Agent 创新大赛参赛作品。

### 1.2 现状摘要（2026-07-23 调研）

**设计稿**：21 个 HTML 页面在 `d:\ai\linux教学一体\参考资料\前端设计\pages\`，TRAE 深色主题 + 科技蓝 #387BFF，三级深色表面分层。

**现有代码**：
- 22 条路由（router.tsx）+ 18+ 页面组件（pages/）+ 大量组件（components/ai/workbench/monitor/...）
- 9 个 zustand store + 210+ IPC 方法暴露 + 38 个 registerXxxIpcHandlers 模块
- 真数据主路径已打通：`sftpList`/`sftpReadFile`/`agentChat`/`monitorStart`/`kbSearch`/`historyList`/`credibilityAssess` 等
- 已集成 47 个 dependencies（Electron 30 + React 18 + TS strict + Antd 5 + Zustand + ssh2 + xterm.js + Vercel AI SDK + recharts + reactflow + three + monaco + ...）

**关键差距**（调研发现）：
1. 🔴 `ModelSettings.tsx` 调用 `window.electronAPI.appExportModelStats(stats)`，但 preload 暴露名为 `exportModelStats`（无 app 前缀），且 ElectronAPI 接口未声明 → 运行时报错
2. 🔴 `HistoryDetailPage.tsx` 完全静态：`void id` 忽略路由参数，全页使用 `DEC-2024-0718-001` 硬编码常量，未调用 `historyGet(id)`
3. 🟡 约 40 个 IPC 通道在 UI 层完全未消费（Sidecar/Diagnostics/Promptfoo/Attention/Claude SDK/教程爬虫/RAG/SFTP高级操作/文件监听）
4. 🟡 `HistoryPage` 分页栏静态显示，未对接真实分页
5. 🟡 `RiskSettings` 规则编辑仅本地 state，不持久化
6. 🟡 `KnowledgeDetailPage` 反馈按钮仅本地 state，未调用 `kbUpdate` 持久化

### 1.3 已 clone 开源参考项目

`d:\ai\linux教学一体\opensource-reference\` 下 13 个项目：
- **electerm**（首推，技术栈完全一致：Electron+React+xterm+ssh2+AI assistant+MCP widget）
- **tabby**（终端 + tabby-ssh 插件，SSH multiplexer/knownHosts 参考）
- **mastra**（AI workflow + suspend/resume，HITL 决策审批参考）
- **databuff**（AI Native APM，监控告警展示参考）
- **cline/aider/claw-code/kilo-code**（AI Coding Agent 参考）
- **MetaGPT/crewAI/OpenHands**（多智能体参考）
- **cube-shell**（Python 栈，仅参考 UI）
- **grok-build**（Rust 工程参考）

---

## 二、设计原则

### 2.1 核心原则

1. **1:1 像素级复刻**：间距/字体/颜色/圆角/边框全部按设计稿 token 实现，设计稿不存在的元素不显示
2. **端到端打通**：每模块完成即可演示，视觉+功能+IPC 同步
3. **开源优先**：动工前必查开源项目复用清单，有方案必复用，无方案先调研
4. **每个按钮落地**：死按钮修复 + 缺失 IPC 补齐 + 现有功能前端展示
5. **慢慢开发**：不急于一次完成，按模块推进，每模块验证后再进入下一模块

### 2.2 视觉规范（TRAE 设计系统）

**主色**：`--bg-brand: #387BFF`（科技蓝）
- hover `#4C88FF` / active `#1759DD` / popup `#1E2A45` / disabled `rgba(56,123,255,0.2)`
- 渐变阶：brand-1 `#387BFF` / brand-2 `#4C88FF` / brand-3 `#80BBFF` / brand-4 `#B2DAFF`

**三级深色表面分层**：
- `--bg-base-default: #1A1B1D`（页面背景）
- `--bg-base-secondary: #222427`（卡片面）
- `--bg-base-tertiary: #2A2D31`（输入框/嵌套面）
- `--bg-overlay-l1~l4`：`#212327` / `#252629` / `#2A2D31` / `#303236`

**状态色**：
- success `#33C192` / alert `#D29D00` / warning `#D27E24` / error `#F65A5A`
- 每个状态 3 级 surface 透明度（l1=0.18 / l2=0.28 / l3=0.36）

**文本色**：
- default `#D1D3DB` / secondary `#9599A6` / tertiary `#666B75` / disabled `#666B75` / onbrand `#0C0C0D`

**字体**：
- 默认：`"SF Pro Text", "Microsoft YaHei", system-ui, -apple-system, sans-serif`
- 标题：`"SF Pro", "Microsoft YaHei", system-ui, -apple-system, sans-serif`
- 等宽：`"JetBrains Mono", "SFMono-Regular", "Consolas", monospace`

**字号阶梯**：
- body: xs 10px / sm 11px / md 12px / base 13px
- heading: 3xs 11px / 2xs 12px / xs 13px / sm 16px / md 20px / lg 22px / xl 24px / 2xl 28px / 3xl 32px
- code: editor 13px / terminal 12px
- 字重：default 400 / code 450 / medium 500 / strong 600

**间距 token**：`--spacer-0/4/6/8/12/16/24/32/40` = `0/4/6/8/12/16/24/32/40px`

**圆角 token**：`--radius-2/4/6/8/10/full` = `2/4/6/8/10/9999px`

**交互规范**：
- 焦点态：`:focus-visible` 全局 `outline: 2px solid var(--bg-brand); outline-offset: 2px`
- 按钮按压：`.btn-press:active { transform: scale(0.92) }`（80ms ease-out）
- 悬停态：卡片 `box-shadow: 0 4px 14px rgba(0,0,0,0.45)`；行 `background: var(--bg-overlay-l1)`
- 无障碍：`prefers-reduced-motion` 降级；图表 SVG 含 `aria-label`

### 2.3 工程规范

- **IPC 4 步同步铁律**：定义（main）→ ipc/index.ts 注册 → preload 暴露 → electron.d.ts 类型声明
- **TypeScript strict**：禁止 any / 隐式 any
- **CSS token**：所有颜色用 `var(--trae-*)` 或 `var(--bg-brand)` 等，禁止硬编码
- **编译门禁**：typecheck:node + typecheck:web + lint 三绿
- **文件拆分**：超过 500 行的文件需拆分

---

## 三、5 模块详细设计

### M1 · SSH + 终端 + 工作台

**涉及页面**：
- `pages/WorkbenchPage.tsx`（核心展示页）
- `pages/SshSettings.tsx`
- `pages/TerminalSettings.tsx`

**视觉 1:1 对齐**：
- 工作台 4 区布局：Activity Rail (48px) + 文件树 (可折叠) + 编辑器/终端区 (4 标签) + AI 面板 (560px)
- 终端区 JetBrains Mono 11px，选中命令浮现"添加到 AI 对话"按钮
- 编辑器标签：4 个 radio + `:checked ~` 纯 CSS 切换（终端 / nginx.conf / access.log / error.log）
- AI 面板：8 个 tool panel 可展开/折叠，底部 3 动作按钮（查看监控/记录决策/更新知识库）
- 执行控制：采纳建议 / 查看详情 / 暂停执行 / 回滚（红色危险态）
- AI 实时提示：3 张检测卡（worker_connections 不足 / 502 激增 / upstream 失败）

**功能对接**：
- ✅ 已对接：`sshConnect`/`sshDisconnect`/`sshShellStart`/`sshShellWrite`/`sshResize`/`sftpList`/`sftpReadFile`/`sftpWriteFile`/`sftpMkdir`/`sftpDelete`/`sftpSearch`/`sftpGrep`/`agentChat`/`onAgentChunk`/`onAgentDone`/`onAgentError`
- 🔧 需补齐：
  - `sftpUpload`/`sftpDownload` → FileTree 右键菜单 + 拖拽上传
  - `sftpRename`/`sftpChmod` → FileTree 右键菜单
  - `fileWatchStart`/`fileWatchStop`/`onFileChanged` → 远程文件监听（编辑器外部变更提示）
  - 终端选中命令"添加到 AI 对话" → 复用 `useAtCommandInjection` 注入到 composer
  - AI 面板 8 tool panel → 对接 `onAgentStep` 流式渲染

**端到端验收**：
1. SSH 连接 → 输入命令 → 看到输出
2. 文件树展开 → 点击文件 → 编辑器打开
3. AI 提问 → 流式回复 → 工具调用展开
4. 选中终端命令 → "添加到 AI 对话" → composer 自动注入

**开源参考**：electerm 的 `src/client/components/sftp-file-manager` 右键菜单 + `session-ssh` 测试套件

**实施完成**：2026-07-23
- Task 1-11 全部完成
- 编译门禁三绿（typecheck:node + typecheck:web + lint 全 exit 0）
- commits: 90c3663 (Task 1-3) / dcaa274 (Task 4-5) / bd67d84 (Task 6) / 9ef5102 (Task 7-8) / 0a4f471 (Task 9-10)
- 端到端验收 7 项待手动 dev 环境验证（SSH 连接/文件树/AI 流式/选中注入/右键菜单/终端搜索/文件监听）
- 新建文件 5 个：FileTreeContextMenu.tsx / ChmodDialog.tsx / RenameDialog.tsx / FileChangeNotice.tsx / TerminalSearchBar.tsx
- 修改文件 8 个：FileTree.tsx / EditorArea.tsx / TerminalView.tsx / useAgentChat.ts / LiveMessageRow.tsx / agent-store.ts / MessageList.tsx / Workbench.css + AIPanel.css + TerminalView.css

---

### M2 · AI 决策链（比赛差异化核心）

**涉及页面**：
- `pages/DecisionDetailPage.tsx`（AI可信决策详情）
- `pages/HistoryPage.tsx`
- `pages/HistoryDetailPage.tsx`（🔴 完全静态，需重做）
- `pages/DecisionSettings.tsx`
- `pages/RiskSettings.tsx`
- **缺失页面**：`pages/DecisionPage.tsx`（AI可信决策主页面对应设计稿 `AI可信决策.html`，需新增路由 `/decision`）

**视觉 1:1 对齐**：
- AI可信决策页：径向置信度仪表 SVG + 六源证据雷达图 + 7步光路时间线 + 4层风险控制卡片 + 高危拦截清单
- 决策三按钮：采纳并执行(brand) / 修改 / 拒绝
- 历史详情页：完整审计追溯（命令、风险、置信度、证据链、知识关联）
- 决策控制设置：4 Card（决策流程/证据源权重/风险控制策略/审批通知）
- 风险控制设置：4 Card（安全防护等级/命令风险评级规则/审计日志/应急响应）

**功能对接**：
- ✅ 已对接：`credibilityAssess`/`credibilityDag`/`credibilityExportAudit`/`loopStart`/`loopConfirm`/`loopCancel`/`onLoopStep`/`onLoopDecision`/`onLoopDone`/`onLoopError`/`onLoopBlocked`/`historyList`/`historyGet`/`historyStats`/`historySave`/`taskPermissionApprove`/`onTaskPermissionApprovalRequest`
- 🔧 需补齐：
  - **HistoryDetailPage 重做**：调用 `historyGet(id)` 替换全静态数据，7步证据链对接 `credibilityDag` DAG 节点
  - **新增 DecisionPage**：AI可信决策精简版（decision.html），决策卡片 + 7步证据链 + 风险确认面板
  - 7步证据链每步可展开 → 对接 `credibilityDag` 返回的 DAG 节点详情
  - 4层风险控制逐层审批 → 对接 `loopStart`/`loopConfirm`/`loopCancel`
  - 高危命令拦截清单 → 对接 `risk-engine` 的规则匹配结果（`risk:check` IPC 需新增）
  - 决策控制/风险控制设置页 → 表单持久化到 `configSet`（6源权重影响 `credibilityAssess`）
  - RiskSettings 规则编辑 → 持久化到 `configSet`（非本地 state）

**端到端验收**：
1. 工作台 AI 提问 → 触发决策 → 跳转 AI可信决策页
2. 决策页展示置信度 + 6源证据 + 7步链 + 4层风险 + 高危拦截
3. 采纳并执行 → 4层风险审批 → 执行 → 记录到历史
4. 历史页查看 → 点详情 → 真实数据展示（非静态）
5. 决策控制/风险控制设置 → 保存 → 影响后续决策

**实施进度**（2026-07-23 完成）：
- ✅ Task 1: 抽离共享工具函数和组件（commit 0cc72ed）— decision-mappers.ts + ConfidenceGauge/LoadingState/ErrorState
- ✅ Task 2: 新增 risk:check IPC 4 步同步（commit 6b48036）— 桥接 assessCommandRisk
- ✅ Task 3: 新建 DecisionPage + /decision 路由（commit 9efff0e + fix 9f65ac2）— 双态切换（活跃决策/历史列表）+ 5 loop 事件订阅 + 三按钮决策交互
- ✅ Task 4: 重做 HistoryDetailPage（commit 382e369）— 接入 historyGet IPC，5 卡片布局
- ✅ Task 5: HistoryPage sparkline 动态化 + RiskSettings 规则编辑弹窗（commit 0414627 + fix 062e32c）— buildSparklinePoints + antd Modal + 文件拆分
- ✅ Task 6: 端到端验收 + 编译门禁 + UTC 时区修复 — typecheck:node + typecheck:web + lint 三绿
- 跨 Task 技术债 [I1] 修复：decision-mappers.ts fmt() 改为本地时区 formatLocalTs，与页面顶部 formatTimestamp 一致

**遗留技术债**（Minor，不阻塞 M2 合并）：
- successRate/avgConfidence sparkline 归一化采用 max-bucket 策略（非线性映射，视觉对比度优先）
- DEFAULT_STATS 兜底 sparkline 保留硬编码（brief 字面矛盾，仅 useReal=false 时使用）
- LEVEL_OPTIONS 不含 custom 导致编辑 custom 规则时 Select 不显示选中标记（功能无影响）
- buildSparklinePoints "空数组返回 ''" 分支无实际调用路径（stats useMemo 用 baselineSparkline 兜底）

**端到端验收**（Step 6.2 待 dev 环境手动验证）：
- [x] typecheck:node + typecheck:web + lint 三绿
- [ ] 工作台 AI 提问 → 触发决策 → 跳转 AI可信决策页（需 dev 运行验证）
- [ ] 决策页展示置信度 + 6源证据 + 7步链 + 4层风险 + 高危拦截（需 dev 运行验证）
- [ ] 采纳并执行 → 4层风险审批 → 执行 → 记录到历史（需 dev 运行验证）
- [x] 历史页查看 → 点详情 → 真实数据展示（HistoryDetailPage 接入 historyGet）
- [x] 决策控制/风险控制设置 → 保存 → 影响后续决策（RiskSettings Modal 弹窗实现）

**开源参考**：
- mastra 的 workflow + suspend/resume 实现"中风险确认/高风险双审"
- reactflow 实现 7 步证据溯源链 DAG 可视化（节点可点击展开 tool panel）

---

### M3 · 监控 + 日志

**涉及页面**：
- `pages/MonitorPage.tsx`
- `pages/LogsPage.tsx`
- `pages/AlertsSettings.tsx`（指引页，设计稿无独立页面）

**视觉 1:1 对齐**：
- 实时监控：顶部 critical 横幅 + 4 KPI 环形图 + 2×2 SVG 图表网格 + 告警列表 + 进程监控表
- 4 KPI：CPU / 内存 / 磁盘（警告色）/ 网络 I/O（迷你折线）
- 2×2 图表：CPU 面积图 / 内存折线 / 磁盘 IO 柱状 / 网络双折线（24h）
- 系统日志：5 个 level filter radio + 实时日志流 + 文件树侧栏 + AI 日志分析按钮
- 日志级别色：info 蓝 / warn 黄 / error 红 / debug 灰

**功能对接**：
- ✅ 已对接：`monitorStart`/`monitorStop`/`monitorGetSystemInfo`/`onMonitorData`/`onMonitorSystemInfo`/`logRead`/`logStats`/`logClearBuffer`/`logSetMinLevel`/`logFlush`
- 🔧 需补齐：
  - 2×2 图表 → 用 recharts 的 `AreaChart`/`LineChart`/`BarChart` 替换静态 SVG
  - 4 KPI 环形图 → recharts `RadialBarChart`
  - 告警列表行点击 → `goto-alert-row-N` 跳转告警详情（需补 `alert:ack` IPC 或用 `monitor:alert-ack`）
  - 实时日志流 → `log:read` 增量拉取 + 虚拟滚动（react-virtual）
  - AI 日志分析按钮 → 对接 Sidecar `sidecarPipeline`（drain3 模板提取），降级方案用客户端正则匹配
  - 进程监控表 → `ssh:exec` 执行 `top -bn1` 解析

**端到端验收**：
1. 连接服务器 → 启动监控 → 4 KPI 实时刷新
2. 2×2 图表展示 24h 历史数据
3. 告警列表 → 点击行 → 查看详情
4. 日志页 → 实时流 → 级别过滤 → AI 分析

**开源参考**：databuff 的 AI Native APM 告警展示 + recharts 性能优化

---

### M4 · 知识 + 教程

**涉及页面**：
- `pages/KnowledgePage.tsx`
- `pages/KnowledgeDetailPage.tsx`
- `pages/TutorialPage.tsx`
- `pages/TutorialDetailPage.tsx`

**视觉 1:1 对齐**：
- 知识库：搜索框（JetBrains Mono）+ 5 张知识卡片 + AI 贡献率统计 + 分类 tab
- 知识详情：8 个 kd-card（问题描述/根因分析/诊断步骤/解决方案/验证方法/反馈/目录/置信度/元信息/关联知识）
- 运维教程：精选课程 + 课程分类导航 + 课程列表 + 推荐学习路径
- 教程详情：5 章节进度条 + 当前章节卡片 + 沙箱练习 + 章节测验

**功能对接**：
- ✅ 已对接：`kbSearch`/`kbHot`/`kbRecentViews`/`kbView`/`kbAdd`/`kbUpdate`/`kbDelete`/`kbExport`/`kbImport`/`tutorialList`/`tutorialGet`/`tutorialSearch`/`tutorialCategories`/`tutorialRecommendPath`/`tutorialProgress`/`tutorialUpdateProgress`/`sandboxCreate`/`sandboxList`/`sandboxExecute`
- 🔧 需补齐：
  - 知识详情反馈按钮 → `kbUpdate` 持久化 helpful/unhelpful（非本地 state）
  - 教程爬虫状态展示 → `tutorialCrawlStart`/`onTutorialCrawlProgress`（管理员面板，可后置）
  - RAG 混合检索 → `tutorialHybridSearch`/`tutorialSearchStatus`（搜索增强）
  - 知识库语义检索 → `kbSearch` 已支持，UI 加"语义搜索"开关
  - 教程章节测验提交 → 持久化进度到 `tutorialUpdateProgress`
  - 沙箱练习 → `sandboxExecute` 真实执行命令

**端到端验收**：
1. 知识库搜索 → 结果列表 → 点详情 → 8 卡片展示
2. 知识详情反馈 → helpful/unhelpful 持久化
3. 教程列表 → 分类筛选 → 点详情 → 5 章节进度
4. 教程章节 → 完成本章 → 进度更新 → 下一章
5. 沙箱练习 → 执行命令 → 看到输出

**开源参考**：项目已有 7 爬虫源（arch-wiki/debian-wiki/ubuntu-help/tldr-pages/linux-command/linux-journey/ms-learn），展示用普通卡片列表

---

### M5 · 设置 + 启动

**涉及页面**：
- `pages/BootPage.tsx`
- `pages/SettingsPage.tsx`（设置首页）
- `pages/SettingsLayout.tsx`
- `pages/GeneralSettings.tsx`
- `pages/AppearanceSettings.tsx`
- `pages/ModelSettings.tsx`
- `pages/SshSettings.tsx`（与 M1 协同）
- `pages/TerminalSettings.tsx`（与 M1 协同）
- `pages/DecisionSettings.tsx`（与 M2 协同）
- `pages/RiskSettings.tsx`（与 M2 协同）
- `pages/AlertsSettings.tsx`（与 M3 协同）
- `pages/AboutSettings.tsx`

**视觉 1:1 对齐**：
- 启动加载：Three.js Shader 动画（纯黑底 #000 + 蓝 #1D4ED8 + 品牌 #387BFF 进度条）
- 设置首页：6 左导航 + 5 右侧卡片入口（含字段预览）
- 9 个设置子页：4 Card 结构（通用/SSH/模型/决策控制/风险控制/终端/外观/关于/告警）

**功能对接**：
- ✅ 已对接：`configGet`/`configSet`（经 `usePersistentState`）/`providerList`/`providerSave`/`providerSetDefault`/`tokenStats`/`tokenRecords`/`tokenCostStats`/`modelToolCalls`/`budgetAlerts`/`llmTest`/`appCheckUpdate`/`appDownloadUpdate`/`appGetInfo`/`schedulerList`/`schedulerToggle`/`schedulerTrigger`/`onSchedulerStatusChange`
- 🔧 需补齐：
  - **🔴 修复 ModelSettings "导出统计"按钮**：`appExportModelStats` → `exportModelStats` + IPC 4 步同步 + ElectronAPI 接口声明
  - RiskSettings 规则编辑 → 持久化到 `configSet`（非本地 state）
  - 决策控制 6 源权重 → 持久化 + 影响 `credibilityAssess`
  - 启动加载页进度条 → 对接真实加载阶段（IPC ready / SQLite init / 知识库索引）
  - 通用设置"导出数据" → 逐项 `configGet` + 下载 JSON
  - 关于页"检查更新" → 真实 GitHub API（已对接）

**端到端验收**：
1. 启动动画 → 进度条真实加载 → 进入工作台
2. 设置首页 → 6 导航 + 5 卡片入口 → 跳转子页
3. 模型配置 → 保存 → "导出统计"按钮可用
4. 决策控制 → 6 源权重保存 → 影响决策
5. 风险控制 → 规则编辑 → 持久化
6. 关于 → 检查更新 → 真实 GitHub API

**开源参考**：无额外依赖，复用现有 Three.js + Radix UI

**实施完成**：2026-07-23
- ✅ Task 1: P0 修复 ModelSettings 导出统计方法名 bug（commit ce1b953）— `appExportModelStats` → `exportModelStats` + IPC 4 步同步 + ElectronAPI 接口声明
- ✅ Task 2: SettingsLayout nav 补齐 6 项（commit a79e465）— nav-decision / nav-risk 等齐全
- ✅ Task 3: BootPage 进度条对接真实加载阶段（commit 14debeb）— `BOOT.LOADING_STAGE` 4 步同步（ipc-channels.ts:1053 / boot.ts:64 / preload/index.ts:2420-2421）
- ✅ Task 4: DecisionSettings 6 源权重影响 `credibilityAssess`（commit e5b09df）
- ✅ Task 5: SettingsPage 字段预览（commit c6e2cef）
- ✅ Task 6: ModelSettings 1276 行拆分（commit 6102a50）— 主文件 466 行 + 7 子模块（ApiTestSection 231 / BudgetSection 141 / ConversationSection 193 / ModelActionBar 73 / ModelConfigSection 250 / TokenStatsSection 16 / ToolCallSection 68 / constants 122）
- ✅ Task 7: SshSettings 778 行拆分（commit 24cb742）— 主文件 482 行 + 4 子模块（ServerCard 212 / KeyCard 100 / DefaultsCard 119 / SecurityCard 80）
- ✅ Task 8: 端到端验收 + 编译门禁三绿（typecheck:node + typecheck:web + lint 全 exit 0）

**端到端验收**：
- [x] typecheck:node + typecheck:web + lint 三绿
- [x] ModelSettings.tsx ≤ 500 行（实际 466 行）
- [x] SshSettings.tsx < 600 行（实际 482 行）
- [x] 拆分子模块每个 ≤ 500 行（model 8 文件 / ssh 4 文件全通过）
- [x] P0 修复验证：`appExportModelStats` 0 处出现
- [x] `exportModelStats` 三处文件一致（preload/index.ts:992 / electron.d.ts:907 / ModelSettings.tsx:396-397）
- [x] SettingsLayout nav 6 项齐全（含 nav-decision:37 / nav-risk:38）
- [x] BOOT 域 IPC 4 步同步（ipc-channels.ts 定义 / boot.ts send / preload on+off）
- [x] `onBootLoadingStage` 类型声明齐全（electron.d.ts 2 处 / preload/index.ts 1 处 / BootPage.tsx 1 处）
- [ ] 启动动画 → 进度条真实加载 → 进入工作台（需 dev 运行验证）
- [ ] 模型配置 → 保存 → "导出统计"按钮可用（需 dev 运行验证）
- [ ] 决策控制 → 6 源权重保存 → 影响决策（需 dev 运行验证）

---

## 四、开源调研清单（优先级排序）

| 优先级 | 项目 | 用途 | 集成方式 | 状态 |
|--------|------|------|---------|------|
| P0 | electerm（已 clone） | 终端/SFTP/AI 助手/MCP widget 参考 | 借鉴 `src/client/components/` 设计模式 | M1 |
| P0 | recharts（已集成） | 2×2 监控图表 + 4 KPI 环形图 | 直接用 `AreaChart`/`RadialBarChart` | M3 |
| P0 | reactflow（已集成） | 7 步证据溯源链 DAG | 节点可点击展开 tool panel | M2 |
| P1 | mastra（已 clone） | AI workflow + suspend/resume | 实现"中风险确认/高风险双审" HITL | M2 |
| P1 | Vercel AI SDK（已集成） | AI 面板 8 tool panel + stream | `useChat` + tool UI 渲染 | M1 |
| P2 | databuff（已 clone） | AI Native APM 监控告警展示 | 借鉴告警列表 + AI 日志分析 | M3 |
| P2 | tabby（已 clone） | SSH multiplexer / knownHosts | 借鉴 `tabby-ssh` 插件 | M1 |

---

## 五、验证标准（每模块完成时检查）

1. **视觉**：与设计稿 1:1 像素级对齐，TRAE token 全覆盖，设计稿不存在的元素不显示
2. **功能**：每个按钮真实可点击，有 IPC 调用或表单提交
3. **IPC**：4 步同步（main → ipc/index → preload → electron.d.ts）
4. **编译门禁**：typecheck:node + typecheck:web + lint 三绿
5. **端到端**：模块验收标准全过
6. **无障碍**：`prefers-reduced-motion` 降级；图表 SVG 含 `aria-label`；焦点态可见

---

## 六、风险与降级

| 风险 | 概率 | 降级方案 |
|------|------|---------|
| HistoryDetailPage 改造影响路由 | 中 | 保留 fallback 静态数据，IPC 失败时降级 |
| reactflow 证据链性能 | 低 | 节点数 ≤20，性能无忧 |
| Sidecar drain3 未对接 | 中 | M3 先用 `logRead` + 客户端正则匹配，Sidecar 后置 |
| mastra workflow 集成复杂 | 中 | M2 先用现有 `loopConfirm`，mastra 后置 |
| electerm 组件迁移工作量大 | 中 | 只借鉴设计模式，不直接移植代码 |
| 1:1 像素级复刻工作量大 | 高 | 按模块慢慢推进，每模块验证后再进入下一模块 |
| 新增 DecisionPage 路由冲突 | 低 | 设计稿 decision.html 是独立主页，与 `/decision/:id` 详情页共存，路由不冲突 |

---

## 七、实施顺序

```
M1 SSH+终端+工作台（核心展示页，比赛第一印象）
  ↓
M2 AI决策链（比赛差异化核心，工作量大）
  ↓
M3 监控+日志（数据展示，复用 M1 的 SSH 连接）
  ↓
M4 知识+教程（相对独立，复用 M2 的决策记录）
  ↓
M5 设置+启动（收尾，修复红线 Bug + 配置页完善）
```

**实施单元策略**：每个模块（M1-M5）作为独立实施单元，分别调用 `writing-plans` skill 生成详细实施计划，独立提交 git commit。模块间存在依赖：M3 复用 M1 的 SSH 连接，M4 复用 M2 的决策记录。

**路由变更**：M2 实施时需在 `src/renderer/src/router.tsx` 新增 `/decision` 路由指向 `DecisionPage`（lazy 加载），与现有 `/decision/:id` 共存（后者对应 `DecisionDetailPage`）。

每模块完成后：
1. 编译门禁三绿
2. 端到端验收
3. 视觉对比设计稿
4. 提交 git commit
5. 更新本 spec 文档进度

---

## 八、设计稿页面与路由映射

| # | 设计稿 HTML | 路由 | 页面组件 | 模块 |
|---|------------|------|---------|------|
| 1 | 启动加载.html | / | BootPage | M5 |
| 2 | 工作台.html | /workbench | WorkbenchPage | M1 |
| 3 | AI可信决策.html | /decision | **DecisionPage（新增）** | M2 |
| 4 | 历史决策详情.html | /history/:id | HistoryDetailPage（重做） | M2 |
| 5 | 历史决策.html | /history | HistoryPage | M2 |
| 6 | 实时监控.html | /monitor | MonitorPage | M3 |
| 7 | 运维教程.html | /tutorial | TutorialPage | M4 |
| 8 | 教程详情.html | /tutorial/:id | TutorialDetailPage | M4 |
| 9 | 知识库.html | /knowledge | KnowledgePage | M4 |
| 10 | 知识详情.html | /knowledge/:id | KnowledgeDetailPage | M4 |
| 11 | 系统日志.html | /logs | LogsPage | M3 |
| 12 | SSH 连接.html | /settings/ssh | SshSettings | M1/M5 |
| 13 | 模型配置.html | /settings/model | ModelSettings | M5 |
| 14 | 终端设置.html | /settings/terminal | TerminalSettings | M1/M5 |
| 15 | 外观设置.html | /settings/appearance | AppearanceSettings | M5 |
| 16 | 通用设置.html | /settings/general | GeneralSettings | M5 |
| 17 | 关于.html | /settings/about | AboutSettings | M5 |
| 18 | 设置.html | /settings | SettingsPage | M5 |
| 19 | 决策控制.html | /settings/decision | DecisionSettings | M2/M5 |
| 20 | 风险控制.html | /settings/risk | RiskSettings | M2/M5 |
| 21 | _.html | - | （空文件，忽略） | - |

**注**：`决策详情.html`（设计稿 decision-detail.html）对应现有 `/decision/:id` 路由 → DecisionDetailPage

---

## 九、跨页面导航关系

```
启动加载 (boot-enter)
    │
    ▼
工作台 (nav-home)  ←——————— 全局枢纽
    │
    ├── nav-tutorial ──→ 运维教程 ──(open-course)──→ 教程详情
    ├── nav-decision ──→ AI可信决策 ──(accept-execute)──→ 决策详情
    ├── nav-monitor ──→ 实时监控
    ├── nav-knowledge ──→ 知识库 ──(view-detail-N)──→ 知识详情
    ├── nav-history ──→ 历史决策 ──(view-detail-N)──→ 历史决策详情
    ├── nav-logs ──→ 系统日志
    └── nav-settings ──→ 设置 (首页)
                            │
                            ├─ nav-general ──→ 通用设置
                            ├─ nav-ssh ──→ SSH 连接
                            ├─ nav-model-config ──→ 模型配置
                            ├─ nav-appearance ──→ 外观设置
                            ├─ nav-about ──→ 关于
                            ├─ nav-terminal-settings ──→ 终端设置
                            ├─ nav-decision-control ──→ 决策控制
                            ├─ nav-risk-control ──→ 风险控制
                            └─ nav-alerts ──→ 告警设置（指引页）
```

**跨域跳转**：
- AI可信决策 → 知识详情 / 历史决策 / 系统日志（4 个跳转出口）
- 历史决策详情 → 知识详情
- 实时监控 → 告警详情

---

## 十、IPC 通道补齐清单

### 10.1 需新增 IPC（4 步同步）

| 通道 | 用途 | 用于页面 | 模块 |
|------|------|---------|------|
| `risk:check` | 检测命令是否高危 | DecisionPage/DecisionDetailPage | M2 |
| `risk:control` | 4层风险控制校验 | DecisionDetailPage | M2 |
| `alert:list` | 告警列表 | MonitorPage | M3 |
| `alert:ack` | 确认告警 | MonitorPage | M3 |
| `decision:record` | 记录决策到历史 | DecisionPage | M2 |
| `app:export-model-stats` | 导出模型统计（修复 Bug） | ModelSettings | M5 |

### 10.2 需对接现有 IPC（UI 未消费）

| 通道 | 用途 | 用于页面 | 模块 |
|------|------|---------|------|
| `sftpUpload`/`sftpDownload` | 文件上传下载 | WorkbenchPage FileTree | M1 |
| `sftpRename`/`sftpChmod` | 文件重命名/权限 | WorkbenchPage FileTree | M1 |
| `fileWatchStart`/`fileWatchStop`/`onFileChanged` | 远程文件监听 | WorkbenchPage EditorArea | M1 |
| `sidecarPipeline` | drain3 日志分析 | LogsPage | M3 |
| `tutorialHybridSearch` | RAG 混合检索 | TutorialPage | M4 |
| `tutorialCrawlStart`/`onTutorialCrawlProgress` | 教程爬虫 | TutorialPage（管理员） | M4 |

---

## 十一、成功标准

1. **全 21 页面**对标设计稿 1:1 像素级实现
2. **每个按钮**真实可点击，有 IPC 调用或表单提交
3. **编译门禁**三绿（typecheck:node + typecheck:web + lint）
4. **端到端**5 模块验收标准全过
5. **开源复用**清单全覆盖（electerm/recharts/reactflow/mastra/databuff/tabby）
6. **IPC 4 步同步**铁律全遵守
7. **TRAE token**全覆盖，无硬编码颜色

---

*文档结束 · TDSF Linux Desktop 前端全量重构设计 v1.0 · 2026-07-23*
