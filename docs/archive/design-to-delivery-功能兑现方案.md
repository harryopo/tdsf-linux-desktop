# TDSF-Linux Desktop 设计稿交付治理方案（功能兑现）

> 方法论：design-to-delivery 六阶段循环（还原 → 识别 → 裁剪 → 补齐 → 验证 → 沉淀）
> 日期：2026-07-21
> 状态：**视觉还原已完成**，本方案聚焦"功能 gap"治理（按钮真实化）
> 协调对象：自主循环工程（已跑 18 轮，见 `.learnings/loop-progress.md`）

---

## 一、背景与现状评估

### 1.1 用户诉求

"还原前端设计稿，后端也开发功能，UI 要与功能接上去，搭建完整可运行项目。"

### 1.2 核查结论（事实）

**视觉层已高度还原设计稿**，逐项验证如下：

| 验证项 | 方法 | 结论 |
|--------|------|------|
| 通用设置页 | 浏览器截图 vs 设计稿 `通用设置.html` 逐元素对比 | ✅ 一致（卡片/开关/下拉/section 标题/40×40 图标盒） |
| 启动加载页 | 真实 Electron 窗口截图 | ✅ 一致 |
| 工作台布局 | 真实 Electron 窗口截图 | ✅ 一致（rail+tree+terminal+AI面板+状态栏） |
| 实时监控页 | 代码结构 vs 设计规格 | ✅ 一致（1H/6H/24H + 四环 KPI + 2×2 图表 + 告警横幅） |
| 全局组件 | grep 所有页面 antd 导入 | ✅ 仅 SshSettings 导入 `message`（toast），无任何 antd 布局组件 |
| 编译门禁 | typecheck(web+node) + build | ✅ 0 错误，build 10.22s |

**结论**：用户感知的"丑/字体小/不像设计稿"与当前代码状态不符。最可能原因是用户运行的是**设计迁移（R1-R9 提交）之前的旧构建**。设计稿本身使用 10-13px 紧凑字号（Trae 设计库风格），实现严格遵循，"字体小"是设计特征而非偏差。

### 1.3 真正的剩余 gap：功能层

视觉 gap 已关闭，剩余的是**功能 gap**——部分按钮是占位死代码（alert/toast"开发中"），部分页面恒渲染写死 mock。这正是"UI 要与功能接上去"的落点。

---

## 二、死代码识别清单（第二阶段产出）

> 来源：Explore agent 全量勘察（只读，基于实际代码行号）。IPC 能力以 `src/preload/index.ts` 为权威。

### 2.1 砍（不可兑现 / 纯死代码，零风险删除）

| 位置 | 内容 | 依据 |
|------|------|------|
| `components/ai/ChatPanel.tsx` + 12 个 ai/ 组件 | AgentWorkflowPanel/ToolCallCard/ToolApprovalModal/CredibilityPanel/PlanBuildButton/SrePipelinePanel/SidecarStatusPanel/McpStatusBar/DecisionCard/EvidenceChain/RiskConfirm/ConfidenceBreakdown | 全项目无活路径 import（仅 CalibrationPanel 例外，被 CalibrationSettings 引用，**保留**） |
| `components/history/HistoryPage.tsx`(+css) | 整文件 | 路由用的是 `pages/HistoryPage.tsx`，此组件无引用 |
| `pages/HistoryPage.tsx:43` + FilterBar | timeRange/server/status 三个死过滤器 + `serverOptions` mock 名 | 从未参与过滤（仅 keyword 生效 :204-215） |
| `components/workbench/EditorArea.tsx:251-264` | 分屏按钮 + "更多"按钮 | 完全没有 onClick |
| `components/workbench/WorkbenchTitlebar.tsx:252,258` | 搜索按钮 + 布局按钮 | 纯占位 toast |

⚠️ **注意**：ai/ 组件当前正被自主循环修改（M 状态），删除须等循环该轮结束并确认无接线计划后执行。

### 2.2 补（后端 IPC 已就绪，仅差前端接线 —— 本方案核心）

| 位置 | 按钮 | 可接 IPC | 优先级 |
|------|------|---------|--------|
| `pages/LogsPage.tsx:199-227` | AI 分析（现为假计数 + `window.alert`） | `llmAnalyze` / `sidecarPipeline` | **P0**（旗舰 AI，评委必点） |
| `pages/LogsPage.tsx:230-244` | 导出（现 `window.alert` 占位） | 本地 Blob 导出（参考 CSV 注入防御） | P1 |
| `pages/TutorialDetailPage.tsx:361-376` | 打开沙箱（现 alert 占位） | `sandboxDetectDocker/Start/Execute/Approve`（已全） | **P0**（沙箱是亮点） |
| `pages/KnowledgePage.tsx:297-299` | 贡献知识（现 alert 占位） | `kbAdd` | P1 |
| `components/workbench/AIPanel.tsx:1046` | 工具动作（在终端运行/执行/沙箱预演/回滚，现 `message.info('功能开发中')`） | `sshExec` / `sandboxExecute` / `loopConfirm` | P1 |
| `components/workbench/AIPanel.tsx:1482` | 压缩上下文（现占位） | Context compaction L4/L5（主进程已实现） | P2 |

### 2.3 留 / 治理（恒渲染写死 mock，损害"证据溯源"叙事）

| 位置 | 问题 | 处理 |
|------|------|------|
| `pages/KnowledgeDetailPage.tsx:463-534` + `knowledge-detail/v1/detail-data.ts` | 正文诊断步骤/修复前后/验证命令**恒渲染写死 mock**（非 fallback） | **P0**：改为真实数据（tutorialGet/kbExport）或诚实空态。与"AI 让运维可解释"核心叙事冲突最大 |
| `tutorial/v1/detail-data.ts` + 子组件 | QUIZ/章节/练习以写死常量为 `??` fallback；INSTRUCTOR 恒 mock | P1：真实数据优先，fallback 须标注"示例" |
| `components/knowledge/v1/types.ts` HOT/RECENT_ITEMS + ContributionSection | 侧栏热榜/最近/统计写死 | P1：接 kbSearch 或标注示例 |
| `pages/RiskSettings.tsx:128-151` | 风控规则 CRUD 仅本地 state 不持久化 | P1：接 configSet 持久化 |
| `pages/GeneralSettings.tsx:178-190` | 导出数据/清缓存为假反馈（setTimeout+提示） | P1：真实导出或砍掉 |
| `pages/AboutSettings.tsx:130-138` | 检查更新为假反馈 | P2：真实检查或砍掉 |

### 2.4 已确认真实（勿动）

MonitorPage / HistoryDetailPage / TutorialPage / DecisionDetailPage / WorkbenchPage(FileTree+Editor) / Settings 全部 9 页（Model/Ssh/Calibration/General/Appearance/Terminal/Decision 持久化真实）——均有真实 IPC 数据主干。

---

## 三、与自主循环的分工（协调关键）

自主循环（`.learnings/loop-progress.md`，已 18 轮）方向是 **"Agent 纵深优先"**：

- **循环在做**：系统性死文件清理（R15-18）+ Agent 框架纵深（R9-14：MCP Client/Mastra/PAOR/risk-engine/日志模式）。其剩余 backlog 是 E2E 演示路径验证（需 Linux 服务器）+ AIPanel mock 评估（中优先级）。
- **循环不做**：页面按钮接线（功能补齐）——**这是本方案的独占价值区**。

**分工约定**：
1. 本方案负责 §2.2（补）与 §2.3（留治理）的页面级接线。
2. §2.1（砍）中的 ai/ 组件删除**让渡给循环**（循环正在改这些文件，且可能是在接线而非废弃）；本方案只删循环不碰的 `components/history/HistoryPage.tsx`、HistoryPage 死过滤器、EditorArea/Titlebar 死按钮。
3. 任何文件修改前必须 `pnpm ai:claim`，修改后 `pnpm ai:release` + commit（AGENTS.md 强制）。
4. 写文件前先 `pnpm ai:check`，若目标文件在循环活跃修改清单中，**让渡或换任务**，不强行覆盖。

---

## 四、功能补齐全链路 checklist（第四阶段）

每个"补"的任务必须全链路打通，缺一环即死代码：

```
UI onClick → preload 暴露（已有则跳过）→ IPC handler（已有则跳过）
→ 后端 service（已有则跳过）→ 返回数据 → UI 更新 + 空态/错误兜底
```

本清单所有任务的 IPC 均已就绪（§2.2），故只需：**UI 接入 + 降级兜底 + 安全项**。

安全 checklist（每个任务过一遍）：
- [ ] 导出类：CSV 公式注入防御（`= + - @` 前置单引号）+ UTF-8 BOM
- [ ] 危险操作：多次确认
- [ ] Modal：`role="dialog"` + `aria-modal` + ESC + 焦点管理
- [ ] 外部命令拼接：用户输入 `encodeURIComponent` / 走 risk-engine 闸门
- [ ] 降级：IPC 失败不抛给用户，给空态 + 可重试

---

## 五、验证门禁（第五阶段）

每个任务完成后 + 归档前必须三绿：

```bash
pnpm lint        # 0 errors
pnpm typecheck   # exit 0（web + node）
pnpm build       # exit 0
```

当前基线：typecheck 0 错误 / vitest 1215/1215 PASS / build ~10s（循环 R18 确认）。

---

## 六、执行顺序建议

1. **P0-1** LogsPage AI 分析接线（llmAnalyze）——旗舰，评委必点
2. **P0-2** KnowledgeDetail 恒 mock → 真实数据/诚实空态——叙事核心
3. **P0-3** TutorialDetail 沙箱接线（sandbox*）——亮点功能
4. P1：LogsPage 导出 / KnowledgePage 贡献 / AIPanel 工具动作 / Risk 规则持久化 / General 导出真实化
5. P1：HistoryPage 死过滤器 + EditorArea/Titlebar 死按钮删除（零风险，随时可做）
6. P2：AIPanel 压缩上下文 / About 检查更新

---

## 七、归档（第六阶段）

每轮补齐完成后更新：`.learnings/LEARNINGS.md`（LRN 条目）、`.learnings/loop-progress.md`（进度，注意与循环错峰写入）、`AGENTS.md`（IPC 通道清单）、本文件状态标记。commit 遵循 `feat(<scope>): <subject>` + Session ID，不 squash。
