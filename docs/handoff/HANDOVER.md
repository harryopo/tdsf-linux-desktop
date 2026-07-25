# TDSF Linux Desktop — 前后端交接总说明（HANDOVER）

> 生成时间：2026-07-25（v4.0 UI 架构更新）
> 适用版本：v2.5（Phase A/B/C + v2.5 循环工程已落地）+ v4.0 UI 架构
> 主分支：`feat/design-migration`（HEAD: `94b7cf1` + 未提交 v4.0 变更）
> 编译门禁：✅ 四绿全过（typecheck:node / typecheck:web / lint / test）+ `pnpm build` 通过
> 文档作者：Backend Auditor Agent + Frontend Integration Auditor + IPC 4-Step Sync Auditor + Build Gate Verifier + UI v4.0 Architect（多 agent 协同审计）

---

## 0. 一分钟速读（给接手 AI）

1. **后端完成度 95%+**，211 个 `ipcMain.handle` 全部为真实业务逻辑（非占位）
2. **编译门禁四绿全过**（typecheck:node + typecheck:web + lint + test 1282/1282 通过）
3. **前端已由其他 AI 重构优化中**（分支 `feat/design-migration`），但 5 个 P0 项中仅 1 个被顺带修复
4. **接手 AI 工作重点**：补齐前端 P0 项 + 修复 ElectronAPI 类型声明系统性缺失
5. **5 份交接文档 + 3 份验证报告**已就绪，路径见第 1 节

---

## 1. 交接文档索引

### 1.1 核心交接文档（5 份）

| 文档 | 路径 | 用途 |
|------|------|------|
| **HANDOVER.md** | `docs/handoff/HANDOVER.md` | 本文档，统一入口 |
| **ipc-contract.md** | `docs/handoff/ipc-contract.md` | IPC 通道契约（36 域 / 211 handler / 全量参数与返回值） |
| **frontend-backend-boundary.md** | `docs/handoff/frontend-backend-boundary.md` | 前后端职责边界 + 共享层契约 + v2.4/v2.5 新增能力清单 |
| **data-flow.md** | `docs/handoff/data-flow.md` | 7 条核心数据流时序图（含 v2.5 异步回填流） |
| **backend-completion-audit.md** | `docs/handoff/backend-completion-audit.md` | 后端完成度审计（211 handler + 15 services + 30+ core 模块） |
| **frontend-integration-checklist.md** | `docs/handoff/frontend-integration-checklist.md` | 前端待接入清单（231 调用 + 75 孤儿 API + P0-P3 行动项） |

### 1.2 验证报告（3 份，本次生成）

| 报告 | 路径 | 用途 |
|------|------|------|
| **ipc-4step-sync-audit.md** | `docs/handoff/ipc-4step-sync-audit.md` | IPC 4 步同步完整性扫描（含校准 6 通道矛盾点澄清） |
| **frontend-integration-verification.md** | `docs/handoff/frontend-integration-verification.md` | 前端 P0 项实测验证（含 git log 重构进度） |
| **build-gate-verification.md** | `docs/handoff/build-gate-verification.md` | 编译门禁三绿（+ test 四绿）实测报告 |

### 1.3 配套文档

| 文档 | 路径 | 用途 |
|------|------|------|
| v2.5 循环工程方案书 | `docs/v2.5-loop-engineering-plan.md` | v2.5 Phase C/D/E 任务清单 + 完成状态 |
| v2.5 归档 | `docs/archive/v2.5-loop-engineering-archive/` | tasks.md / verify-report.md / learnings.md |
| CHANGELOG | `CHANGELOG.md` | v2.0 / v2.3 / v2.4 / v2.5 变更记录 |
| 项目根 CLAUDE.md | `../../CLAUDE.md` | 工作区入口 + CodeGraph 使用指引 |

---

## 2. 当前项目状态总览

### 2.1 后端状态矩阵

| 维度 | 数值 | 状态 |
|------|------|------|
| IPC handler 文件数 | 42 | ✅ |
| `ipcMain.handle` 注册总数 | 211 | ✅ 全部真实业务逻辑 |
| services 子模块数 | 15（14 完整 + 1 部分） | ⚠️ scheduler 部分占位 |
| core 模块数 | 30+（27 完整 + 3 部分） | ⚠️ edit-formats patch / context L5 / 注释性占位 |
| 测试文件数 | 60+ / 1282 用例 | ✅ 100% 通过 |
| 已知 TODO/FIXME | 5 处 | 1 处真未完成 + 4 处说明性 |
| 占位实现 | 3 处 | 不阻塞前端接入 |
| 整体后端完成度 | **95%+** | ✅ 主线全通 |

### 2.2 前端状态矩阵

| 维度 | 数值 | 状态 |
|------|------|------|
| 前端调用 electronAPI 总次数 | 231 | — |
| 涉及方法数（去重） | ~115 | — |
| preload 暴露 API 总数 | ~231 | — |
| **孤儿 API（preload 暴露但前端未调用）** | **~75** | ⚠️ |
| **后端就绪但前端未接入** | **~50** | ⚠️ |
| 前端占位代码 | 8 处 | 多为 mock-data fallback，可保留 |
| 严重 BUG | 0（P0-1 已被前端 AI 修复） | ✅ |
| 文档与代码不一致 | 2 处 | 校准 6 通道文档过时 + backfill 4 通道文档已修正 |

### 2.3 编译门禁状态

| 门禁 | Exit Code | 结果 |
|------|-----------|------|
| `pnpm typecheck:node` | 0 | 🟢 通过（0 错误 / 0 警告） |
| `pnpm typecheck:web` | 0 | 🟢 通过（0 错误 / 0 警告） |
| `pnpm lint` | 0 | 🟢 通过（0 错误 / 1 警告非阻塞：`ds-ui.tsx:1276` 使用 `any`） |
| `pnpm test --run` | 0 | 🟢 通过（1282/1282 用例，10.96s） |
| `pnpm build:win` | — | ⏳ 未执行（出包前最后一步） |

---

## 3. TOP 5 关键发现

### 🎯 发现 1：校准 6 通道矛盾点真相大白

**之前两份文档说法不一致**：
- `backend-completion-audit.md` 说校准 6 通道已全部注册
- `frontend-integration-checklist.md` 引用 `ipc-contract.md` 附录 A 说未注册

**实测真相**（见 `ipc-4step-sync-audit.md`）：
- ✅ **Step 1**：`src/shared/ipc-channels.ts` 已定义 6 个常量
- ✅ **Step 2**：`src/main/ipc/credibility.ts:296/326/345/364/388/411` 已注册 6 个 `ipcMain.handle`
- ✅ **Step 3**：`src/preload/index.ts:2486-2491` 已暴露 6 个扁平化方法
- 🔴 **Step 4**：`src/preload/index.d.ts` 的 `ElectronAPI` 接口**完全缺失** 6 个方法类型声明

**接手 AI 行动**：
- 不需要改主进程或 preload（已就绪）
- 仅需在 `ElectronAPI` 接口补 6 个方法类型声明（P1 修复清单见 `ipc-4step-sync-audit.md` 第 6 节）
- 然后新建 `pages/CalibrationSettings.tsx` 组件接入 6 个 API

### 🎯 发现 2：app:export-model-stats BUG 已被前端 AI 顺带修复

**之前 checklist 描述**：`ModelSettings.tsx:396` 调用 `window.electronAPI.exportModelStats`（拼写错误，应为 `appExportModelStats`），但 preload 未暴露。

**实测真相**（见 `frontend-integration-verification.md`）：
- ✅ 主进程 `app-update.ts:291` 已注册 handler
- ✅ preload 第 1009 行已暴露 `exportModelStats`（**注意：不是 `appExportModelStats`，命名不符合规范但调用一致**）
- ✅ 前端调用 `window.electronAPI.exportModelStats` 与 preload 暴露名一致
- 🔴 Step 4 类型声明仍缺失

**接手 AI 行动**：仅需在 `ElectronAPI` 接口补 `exportModelStats` 类型声明，无需改业务代码。

### 🎯 发现 3：v2.5 异步 backfill 4 通道前端仍未接入

**实测真相**：
- ✅ 后端 4 步同步完整（v2.5 Phase C 已落地）
- ✅ preload 已暴露 4 个方法（`tutorialBackfillStart` / `Cancel` / `Status` / `onTutorialBackfillProgress`）
- 🔴 前端 `useHybridSearch.ts:335` 仍用旧版同步 `tutorialBackfillEmbeddings`

**影响**：2578 条教程首次回填会阻塞 UI 1-3 分钟。

**接手 AI 行动**（P0，比赛演示核心场景）：
1. 在 `useHybridSearch.ts` 的 `backfill` 回调中，用 `tutorialBackfillStart()` 替换 `tutorialBackfillEmbeddings()`
2. 订阅 `onTutorialBackfillProgress`，将 `p.pct` / `p.eta` 写入 progress state
3. 提供"取消回填"按钮调用 `tutorialBackfillCancel`
4. 页面刷新后用 `tutorialBackfillStatus` 恢复 UI

### 🎯 发现 4：ElectronAPI 类型声明系统性缺失（约 25 个方法）

**问题**：`src/preload/index.ts` line 3212-3682 的 `ElectronAPI` 类型声明块存在系统性缺失，跨 8 个域约 25 个方法未声明类型。

**影响**：
- 渲染进程调用这些方法时 TypeScript 会报错（但 `typecheck:web` 通过，说明前端用 `?.` 链式调用或类型断言绕过）
- 类型不安全，重构时易出错

**涉及域**：APP / PAOR / MODEL_STATS / BUDGET / CREDIBILITY / RISK / ALERT / BOOT / AGENT / TUTORIAL

**接手 AI 行动**（P1，发布前必修）：参照 `ipc-4step-sync-audit.md` 第 6 节的修复清单，逐域补齐类型声明。

### 🎯 发现 5：PAOR 自动循环审批链部分修复

**实测真相**：
- ✅ 审批响应链已通（AIPanel + PaorApprovalCard + MessageList）
- 🔴 `agentPaor` 启动入口缺失（无按钮触发 PAOR 自动循环）

**接手 AI 行动**（P0，~1h 工作量）：
- 在 AIPanel 增加"PAOR 自动循环"按钮
- 调用 `agentPaor(task, sshSessionId, maxIterations?)` 启动
- 订阅 `onPaorApprovalRequest` 弹出现有的 `PaorApprovalCard`

---

## 4. 接手 AI 优先级行动清单

### P0（必须先做，阻塞核心功能或比赛演示）

| # | 任务 | 工作量 | 依赖 | 验证 |
|---|------|--------|------|------|
| 1 | **接入 v2.5 异步 backfill 4 通道** | ~2h | 后端已就绪 | 2578 条教程首次回填时 UI 不阻塞，进度条 0-100% 平滑推进 |
| 2 | **接入 PAOR 启动入口** | ~1h | 审批链已通 | 触发 PAOR 后遇到高危命令时弹窗，用户批准后继续 |
| 3 | **新建 CalibrationSettings 组件** | ~3h | 主进程 + preload 已就绪 | 调用 `credibilityComputeEce('deepseek', 10)` 返回 ECE 值 |
| 4 | **补齐 ElectronAPI 类型声明（P0 部分）** | ~1h | 见 `ipc-4step-sync-audit.md` 第 6 节 | `typecheck:web` 仍 exit 0，但调用不再需要 `?.` 绕过 |

### P1（建议接入，提升功能完整度）

| # | 任务 | 涉及 API |
|---|------|---------|
| 1 | 接入 Claude Agent SDK 6 通道 | `claudeSdkGenerate/Stream/Cancel` + 3 push |
| 2 | 接入 Subagent 管理 | `subagentList/Reload` |
| 3 | 接入外部 MCP 服务器 | `mcpExternalStatus/Tools/Call/Reconnect` |
| 4 | 接入诊断服务 | `diagnosticsGet*/Clear/SetEnabled/onDiagnosticsLogBatch` |
| 5 | 接入沙箱容器生命周期 | `sandboxDetectDocker/Start/Stop/Status/Delete` |
| 6 | 接入 Sidecar 高级能力 | `sidecarStop/Health/HealthOne/ToolCall/ParseLogs` |
| 7 | 接入 Provider 能力 + 定价 | `providerCapabilities/CapabilitiesAll/Pricing/PricingAll` |
| 8 | 接入合规审计报告 | `credibilityExportAuditReport/ListAuditReports/LoadAuditReport/FormatAuditReport` |
| 9 | 接入知识库 CRUD 完整链 | `kbDelete/Export/Import` |
| 10 | 接入 historySave | 决策卡片入库 |
| 11 | 接入 fsUploadImage | AIPanel 图片附件 |
| 12 | 接入内联补全取消 + Diff 应用 | `llmInlineCompletionCancel/ApplyDiff/DiffPreview` |
| 13 | 接入 SSH 心跳事件 | `onSshStateChanged` |
| 14 | **补齐剩余 ElectronAPI 类型声明** | 见 `ipc-4step-sync-audit.md` |

### P2（可选，提升体验或补全非核心能力）

- SFTP 文件操作补全（upload/download/rename/chmod/stat）
- SFTP 远端搜索（search/grep）→ GlobalSearch 扩展
- LLM 高级 API（analyze/validate/chat-with-context）
- 旧版 LLM 流式事件（onLlmToken/Chunk/Done/Error）
- 教程爬虫 / 磁盘 / 断点续传 13 个通道（管理员能力）
- 部署功能补全（get-template/validate/get-status）
- Profiler Markdown 导出
- Attention 历史 + 5 个 track 写入
- MCP 重置（mcpReset）
- Promptfoo 红队 / 评估（实验性）
- Storage API Key 删除
- Server 配置导出 / 导入
- Token 重置
- 日志级别动态设置 + flush
- 清理 workbench mock-data / AIPanel mock 注释
- AboutSettings 移除设计稿占位值，改用真实 appGetInfo 数据

### P3（调试 / 实验性，可延后）

- `systemPing` / `getProtocolVersion`（调试用）
- `diagnosticsIngestTest`（仅 dev 模式）
- `risk:check`（前端无直接调用，由主进程自动执行）
- 清理 `ExecutionResult.tsx` / `EvidenceList.tsx` 过时 mock 注释
- 修复 `ds-ui.tsx:1276` 的 `any` 警告

---

## 5. 后端已知问题清单（不阻塞前端接入）

### 5.1 P1（重要，需补齐）

| # | 位置 | 性质 | 描述 |
|---|------|------|------|
| 1 | `services/scheduler/daily-decision-archive.ts:457-484` | 占位 handler | 调度器每日 18:00 触发归档任务时不执行真实归档 |
| 2 | `services/scheduler/weekly-ops-report.ts:415-431` | 占位仓储 | 周报任务生成空数据报告 |
| 3 | `core/agent/context.ts:37-38` | 占位常量 | L5 跨会话长期记忆未实现 |

### 5.2 P2（次要，已知降级）

| # | 位置 | 描述 |
|---|------|------|
| 4 | `core/agent/edit-formats/strategy-selector.ts:38` | patch 格式（V4A）暂未实现 |
| 5 | `services/storage/secure-store.ts:75-76` | safeStorage 不可用时降级为明文 base64 |
| 6 | `services/llm/vercel-ai-service.ts:8` | API Key 为空时返回 mock |
| 7 | `services/db/database.ts:176-212` | DB 不可用时返回 mock Statement |

---

## 6. 前端重构进度（v4.0 UI 架构 — 2026-07-25）

**当前分支**：`feat/design-migration`（HEAD: `94b7cf1` + 未提交 v4.0 变更）

### 6.1 已提交历史（3 次）

1. UI 视觉优化（MainLayout.css/ts、AIPanel.tsx、WorkbenchPage.tsx）
2. v2.4 后端完善（顺带修复 P0-1 exportModelStats + P0-3 PAOR 审批响应链）
3. ui-v3.0 phase 1 死代码清理（3850+ 行）

### 6.2 未提交 v4.0 架构变更（本次核心工作）

**架构级修复 — ActivityRail 持久化（MainLayout v4.0）**：

| 文件 | 变更 | 影响 |
|------|------|------|
| `MainLayout.tsx` | 从纯 Outlet 容器重写为 ActivityRail + Outlet 水平布局 | 侧边栏全局持久，切换任何页面不再消失 |
| `MainLayout.css` | 添加 `display: flex` 水平布局 | 48px Rail + flex:1 内容区 |
| `WorkbenchPage.tsx` | 移除内部 ActivityRail 实例 + NAV_ROUTE_MAP + activeNav 状态 | 消除重复渲染，页面仅关注自身内容 |
| `ActivityRail.tsx` | 修复 decision 路由 `/history` → `/decision` | 可信度决策页面可从侧边栏直达 |

**AI Panel 精细化打磨**：

| 文件 | 变更 | 对齐设计稿 |
|------|------|-----------|
| `AIPanel.tsx` | `showDemo` 默认值 true → false | 首次进入显示欢迎态（能力卡片+快捷chips） |
| `AIPanelHeader.tsx` | 高度 h-10(40px) → h-8(32px)，padding px-4 → px-3 | 对齐设计稿 32px titlebar |
| `MessageList.tsx` | 新增"查看诊断示例"按钮 + `onShowDemo` prop | 一键切换 rich panel 演示 |

**CSS 视觉对齐（Workbench.css）**：

| 属性 | 修复前 | 修复后 | 设计稿值 |
|------|--------|--------|----------|
| ActivityRail 背景 | bg-base-default | bg-base-secondary | #222427 |
| ActivityRail gap | 4px | 8px | spacer-8 |
| ActivityRail 按钮圆角 | 4px | 8px | radius-8 |
| FileTree header 高度 | 28px | 32px | 32px |
| FileTree letter-spacing | 0.05em | 0.08em | 0.08em |
| Titlebar padding | 12px | 8px | 8px |
| Composer focus shadow | 2px inset | 3px inset | 3px |

### 6.3 视觉对比验证

完整逐模块对比报告：`docs/FRONTEND-VISUAL-COMPARISON.md`

已验证对齐的模块：ActivityRail、Titlebar、FileTree、AI Panel Header、Composer、StatusBar、决策页、监控页。

### 6.4 已知前端架构缺口（中期）

| 缺口 | 影响 | 建议 |
|------|------|------|
| LiveMessageRow 仅渲染纯文本 | 实时 agent 回复无法展示 rich panel（thought/skill/command 等） | 扩展 AgentMessage 类型，增加 tool_use 块解析 |
| ToolPanel 组件仅接入 mock 数据 | 丰富面板只在演示模式可见 | 需 agent:chat 返回结构化 tool_use 后对接 |
| 快捷 chips 无 onClick 发送 | 点击 chip 不触发真实对话 | 绑定 `send(chip)` 回调 |

### 6.5 重构方向总结

v4.0 核心目标：**设计稿 1:1 视觉还原 + 架构合理性**。已完成结构性修复（侧边栏持久化、路由修正）和视觉对齐（CSS 属性逐项校准）。P0 功能接入（backfill/PAOR/Calibration）仍待推进。

---

## 7. 接手 AI 工作流建议

### 7.1 起步流程（5 分钟）

```bash
# 1. 拉最新代码
cd d:/ai/linux教学一体/tdsf-linux-desktop
git fetch origin
git checkout feat/design-migration
git pull

# 2. 确认编译门禁三绿
pnpm typecheck:node && pnpm typecheck:web && pnpm lint

# 3. 读交接文档（按顺序）
cat docs/handoff/HANDOVER.md         # 本文档，5 分钟速读
cat docs/handoff/frontend-integration-verification.md  # P0 项实测状态
cat docs/handoff/ipc-4step-sync-audit.md  # IPC 4 步同步缺失项
```

### 7.2 开发流程

1. **每个 P0 项独立分支**：`feat/p0-backfill` / `feat/p0-paor` / `feat/p0-calibration` / `feat/p0-type-declarations`
2. **每个 PR 跑编译门禁三绿**：`pnpm typecheck:node && pnpm typecheck:web && pnpm lint && pnpm test`
3. **遵循 IPC 4 步同步铁律**：通道常量 → handler 注册 → preload 暴露 → 类型声明
4. **不碰 `src/main/`**：后端已就绪，本阶段仅改前端 + preload 类型声明
5. **commit message 规范**：`feat(frontend): P0-x xxx` / `fix(preload): 补齐 ElectronAPI 类型声明`

### 7.3 验证清单

每个 P0 项完成后验证：
- [ ] `pnpm typecheck:web` exit 0（无新类型错误）
- [ ] `pnpm lint` exit 0（无新 lint 错误）
- [ ] `pnpm test` 全绿（无回归）
- [ ] 手动验证：在 Electron 环境下实际触发功能，确认无运行时错误
- [ ] 更新 `frontend-integration-verification.md` 中对应 P0 项状态为 ✅

### 7.4 协作约束

- **不碰 `src/main/`**：后端已冻结，如需修改请先与后端负责人确认
- **共享层修改需同步**：`src/shared/` 和 `src/preload/index.d.ts` 的类型变更需在 PR 描述中登记
- **IPC 4 步同步铁律**：通道常量 → handler 注册 → preload 暴露 → 类型声明，缺一不可
- **编译门禁五绿**：typecheck:node + typecheck:web + lint + test + build:win（里程碑时跑）

---

## 8. 文档间交叉引用关系

```
HANDOVER.md（本文档，统一入口）
  │
  ├── 1. 文档索引 → 5 份核心交接文档 + 3 份验证报告
  │
  ├── 2. 当前状态总览
  │     ├── 后端 → backend-completion-audit.md
  │     ├── 前端 → frontend-integration-checklist.md
  │     └── 门禁 → build-gate-verification.md
  │
  ├── 3. TOP 5 关键发现
  │     ├── 校准 6 通道 → ipc-4step-sync-audit.md § 3
  │     ├── exportModelStats → frontend-integration-verification.md § P0-1
  │     ├── v2.5 backfill → frontend-integration-verification.md § P0-2
  │     ├── 类型声明缺失 → ipc-4step-sync-audit.md § 6
  │     └── PAOR 部分修复 → frontend-integration-verification.md § P0-3
  │
  ├── 4. 优先级行动清单
  │     ├── P0 → frontend-integration-checklist.md § 7
  │     ├── P1 → frontend-integration-checklist.md § 7
  │     └── P2/P3 → frontend-integration-checklist.md § 7
  │
  ├── 5. 后端已知问题 → backend-completion-audit.md § 5
  │
  ├── 6. 前端重构进度 → frontend-integration-verification.md § 3
  │
  └── 7. 工作流建议 → frontend-backend-boundary.md § 9
```

---

## 9. 联系与归档

- **本次交接文档归档位置**：`docs/handoff/`
- **v2.5 循环工程归档**：`docs/archive/v2.5-loop-engineering-archive/`
- **项目根 CLAUDE.md**：`../../CLAUDE.md`（工作区入口 + CodeGraph 使用指引）
- **CodeGraph 图谱**：542 files / 7,193 nodes / 20,567 edges（动工前先 `codegraph query <SymbolName>` 查图谱）

**接手 AI 起步建议**：
1. 先做 P0 第 1 项（v2.5 backfill 接入）—— 比赛演示核心场景，~2h 可完成
2. 再做 P0 第 4 项（补齐 ElectronAPI 类型声明）—— 解锁后续 P0-2/P0-3 的类型安全开发
3. P0 第 2 项（PAOR 启动入口）和 P0 第 3 项（CalibrationSettings）视比赛演示路径决定

---

**文档结束**。如有疑问，请对照 `ipc-contract.md` 核对通道细节，或对照 `data-flow.md` 核对数据流转，或对照 `ipc-4step-sync-audit.md` 核对 4 步同步状态。
