# 前端待接入项清单

> 生成时间：2026-07-25
> 审计范围：`src/renderer/src/**/*.{ts,tsx}` + `src/preload/index.ts` + `docs/handoff/ipc-contract.md`
> 目的：识别前端未接入的后端能力，为接手 AI 提供工作清单
> 审计方式：Grep 扫描 `electronAPI\.` 全量调用 + preload 2291-3682 行 `exposeInMainWorld` 块逐项比对 + ipc-contract.md 36 个域对照

---

## 1. 摘要

| 指标 | 数值 |
|------|------|
| 前端调用 electronAPI 总次数 | 231（含 .d.ts 类型声明 1 处，实际业务调用 230 处） |
| 涉及方法数（去重） | 约 115 |
| 涉及文件数 | 53 |
| preload 暴露的 API 总数 | 约 231（含 push 事件监听器） |
| **孤儿 API（preload 暴露但前端从未调用）** | **约 75** |
| **后端就绪但前端未接入** | **约 50**（其中 P0 级 5 项、P1 级 12 项、P2 级 33 项） |
| 前端占位代码 | 8 处真 mock + 多处 input placeholder（正常） |
| 严重 BUG | **1 处**：`ModelSettings.tsx:396` 调用不存在的 `exportModelStats` |
| 文档与代码不一致 | **2 处**：preload 已暴露校准 6 API + backfill 4 API，但 ipc-contract.md 附录 A/C 标注未暴露 |

---

## 2. 前端调用频次 TOP 20

| 方法名 | 调用次数 | 主要调用位置 |
|--------|---------|------------|
| `agentChat` | 2 | `components/ai/ChatPanel.tsx:498` / `components/workbench/useAgentChat.ts:265` |
| `agentChatCancel` | 2 | `components/ai/ChatPanel.tsx:602` / `components/workbench/useAgentChat.ts:322` |
| `agentConfirm` | 2 | `components/ai/ChatPanel.tsx:626,648` |
| `loopConfirm` | 6 | `pages/DecisionPage.tsx:239,271,292` / `pages/DecisionDetailPage.tsx:198,242,297` |
| `onAgentChunk` | 2 | `components/ai/ChatPanel.tsx:255` / `components/workbench/useAgentChat.ts:165` |
| `onAgentDone` | 2 | `components/ai/ChatPanel.tsx:259` / `components/workbench/useAgentChat.ts:169` |
| `onAgentError` | 2 | `components/ai/ChatPanel.tsx:265` / `components/workbench/useAgentChat.ts:176` |
| `onAgentStep` | 2 | `components/ai/ChatPanel.tsx:283` / `components/workbench/useAgentChat.ts:184` |
| `tokenStats` | 5 | `ChatPanel.tsx:192,262,269` / `useAgentChat.ts:138,171,178` / `ModelKpiBar.tsx:118` |
| `tokenCostStats` | 4 | `useAgentChat.ts:149,173,180` / `ModelKpiBar.tsx:119` |
| `tokenRecords` | 2 | `ModelSettings.tsx:154` / `ModelKpiBar.tsx:120` |
| `providerList` | 3 | `ChatPanel.tsx:175` / `useAgentChat.ts:125` / `ModelSettings.tsx:102` |
| `loopConfirm` (含 DecisionDetailPage) | 6 | 见上 |
| `onLoopStep` / `onLoopDecision` / `onLoopDone` / `onLoopError` / `onLoopBlocked` | 各 2 | `pages/DecisionPage.tsx` + `components/workbench/useLoopEngineering.ts` |
| `sftpList` / `sftpMkdir` / `sftpDelete` / `sftpReadFile` / `sftpWriteFile` | 各 1-2 | `components/workbench/FileTree.tsx` / `EditorArea.tsx` |
| `sshConnect` | 3 | `ServerList.tsx:130` / `ConnectDialog.tsx:102` / `WorkbenchTitlebar.tsx:117` |
| `kbSearch` / `kbView` / `kbHot` / `kbRecentViews` / `kbAdd` / `kbGet` / `kbUpdate` | 各 1-3 | `pages/KnowledgePage.tsx` / `KnowledgeDetailPage.tsx` |
| `tutorialUpdateProgress` | 3 | `TutorialPage.tsx:73` / `TutorialDetailPage.tsx:288,419` |
| `sandboxApprove` | 3 | `TutorialDetailPage.tsx:398` / `SandboxApprovalDialog.tsx:70,88` |
| `sidecarPipeline` | 3 | `SrePipelinePanel.tsx:218,224` / `AiLogAnalysisPanel.tsx:126` |

> 完整 231 行调用清单见附录 A。

---

## 3. 后端能力接入状态矩阵

> 状态说明：✅ 已接入 / ⚠️ 部分接入（API 暴露但仅用了一部分，或后端就绪但前端只调了部分通道） / ❌ 未接入

### 3.1 SSH / SFTP / 文件监听 / 监控

| IPC 通道 | Preload API | 前端接入状态 | 接入位置 | 备注 |
|---------|-------------|------------|---------|------|
| `ssh:connect` / `ssh:disconnect` / `ssh:exec` / `ssh:shell:start` | sshConnect/Disconnect/Exec/ShellStart | ✅ | ServerList / ConnectDialog / ProcessTable / TerminalView | — |
| `ssh:shell:write` / `ssh:shell:resize` | sshShellWrite/ShellResize | ✅ | `components/terminal/TerminalView.tsx:142,173` | — |
| `ssh:host-key-response` | sshRespondHostKey | ✅ | `HostKeyPromptDialog.tsx:52` | — |
| `ssh:delete-keypair` / `ssh:upload-keypair` / `ssh:generate-keypair` / `ssh:list-keypairs` | sshDeleteKeyring/UploadKeypair/GenerateKeypair/ListKeypairs | ✅ | `pages/SshSettings.tsx:115,315,335,359` | — |
| `sftp:list` / `sftp:mkdir` / `sftp:delete` / `sftp:readFile` / `sftp:writeFile` | sftpList/Mkdir/Delete/ReadFile/WriteFile | ✅ | FileTree / EditorArea | — |
| `sftp:upload` / `sftp:download` / `sftp:rename` / `sftp:chmod` / `sftp:stat` | sftpUpload/Download/Rename/Chmod/Stat | ❌ | — | P2：工作台上传/下载/重命名/权限修改未接入 |
| `sftp:search` / `sftp:grep` | sftpSearch/sftpGrep | ❌ | — | P1：`components/workbench/GlobalSearch.tsx` 当前只搜本地，未调远端 grep |
| `file:watch:start` / `file:watch:stop` / `file:changed` | fileWatchStart/Stop/onFileChanged | ✅ | `EditorArea.tsx:337,369,306` | — |
| `monitor:start` / `monitor:stop` / `monitor:getSystemInfo` / `monitor:data` / `monitor:systemInfo` | monitorStart/Stop/GetSystemInfo/onMonitorData/onMonitorSystemInfo | ✅ | ServerList / MonitorPage / MonitorPanel | — |
| `terminal:data` | onTerminalData | ✅ | `TerminalView.tsx:150` | — |
| `ssh:state-changed` | onSshStateChanged | ❌ | — | P1：SSH 心跳/重连/最终断开事件未接入，UI 无法感知掉线 |
| `ssh:host-key-prompt` | onSshHostKeyPrompt | ✅ | `HostKeyPromptDialog.tsx:38` | — |

### 3.2 LLM / Agent / Claude SDK / Loop

| IPC 通道 | Preload API | 前端接入状态 | 接入位置 | 备注 |
|---------|-------------|------------|---------|------|
| `llm:chat` / `llm:test` / `llm:chat-with-tools` / `llm:tool-approve` | llmChat/llmTest/llmChatWithTools/llmToolApprove | ✅ | ChatPanel / ModelSettings / ToolApprovalModal | — |
| `llm:analyze` / `llm:validate` / `llm:chat-with-context` | llmAnalyze/Validate/ChatWithContext | ❌ | — | P2：3 个 LLM 高级 API 未接入（证据分析 / 配置校验 / 上下文聊天） |
| `llm:inline-completion` | llmInlineCompletion | ✅ | `InlineCompletionProvider.tsx:88` | — |
| `llm:inline-completion:cancel` / `llm:apply-diff` / `llm:diff-preview` | llmInlineCompletionCancel/ApplyDiff/DiffPreview | ❌ | — | P1：内联补全取消 + Diff 应用 + Diff 预览未接入，补全无法取消、不能应用差异 |
| `llm:token` / `llm:chunk` / `llm:done` / `llm:error` | onLlmToken/Chunk/Done/Error | ❌ | — | P2：旧版 LLM 流式事件未接入（前端走 agent:chunk，旧版未用） |
| `llm:tool-progress` / `llm:tool-approval` | onLlmToolProgress/Approval | ✅ | `ChatPanel.tsx:306,310` | — |
| `agent:chat` / `agent:chat:cancel` | agentChat/agentChatCancel | ✅ | ChatPanel / useAgentChat | 主路径 |
| `agent:start` / `agent:confirm` | agentStart/agentConfirm | ✅ | ChatPanel:522,523,626,648 | v0.8 兼容降级路径 |
| `agent:cancel` | agentCancel | ✅ | `useAgentChat.ts:323-324` | 兜底路径 |
| `agent:paor` / `paor:approve` / `paor:approval-request` | agentPaor/paorApprove/onPaorApprovalRequest | ❌ | — | **P0**：PAOR 自动循环 + 审批请求完全未接入，无 UI 入口 |
| `claude-sdk:generate` / `claude-sdk:stream` / `claude-sdk:cancel` | claudeSdkGenerate/Stream/Cancel | ❌ | — | P1：Claude Agent SDK 3 个 invoke 通道未接入 |
| `claude-sdk:chunk` / `claude-sdk:done` / `claude-sdk:error` | onClaudeSdkChunk/Done/Error | ❌ | — | P1：Claude Agent SDK 3 个 push 事件未接入 |
| `loop:start` / `loop:confirm` / `loop:cancel` | loopStart/Confirm/Cancel | ✅ | useLoopEngineering / DecisionPage / DecisionDetailPage | — |
| `loop:llm-start` / `loop:llm-done` | onLoopLlmStart/Done | ✅ | `useLoopEngineering.ts:209-210`（cleanup 引用） | — |
| `loop:step` / `loop:decision` / `loop:done` / `loop:error` / `loop:blocked` | onLoopStep/Decision/Done/Error/Blocked | ✅ | DecisionPage + useLoopEngineering | — |

### 3.3 可信度 / 知识库 / 历史

| IPC 通道 | Preload API | 前端接入状态 | 接入位置 | 备注 |
|---------|-------------|------------|---------|------|
| `credibility:assess` / `credibility:dag` | credibilityAssess/Dag | ✅ | `CredibilityPanel.tsx:344,345` / `DecisionDetailPage.tsx:152` / `DecisionSettings.tsx:217` | — |
| `credibility:export-decision-html` | credibilityExportAudit | ✅ | `DecisionDetailPage.tsx:323` | — |
| `credibility:export-audit-report` / `list-audit-reports` / `load-audit-report` / `format-audit-report` | credibilityExportAuditReport/ListAuditReports/LoadAuditReport/FormatAuditReport | ❌ | — | P1：EU AI Act / NIST AI RMF 合规报告 4 个 API 未接入 |
| `credibility:calibrate` / `get-calibration` / `get-calibration-state` / `reset-calibration` / `compute-ece` / `add-calibration-sample` | credibilityCalibrate/GetCalibration/GetCalibrationState/ResetCalibration/ComputeEce/AddCalibrationSample | ❌ | — | **P0**：6 个校准 API 已在 preload 暴露（2486-2491 行），但 ipc-contract.md 附录 A 标注「`ipcMain.handle` 未注册」→ 调用会运行时报错；且 `CalibrationSettings.tsx` 组件不存在。**矛盾点：文档说 preload 未暴露，实际已暴露**。建议先确认主进程是否真的未注册 handler，再决定前端是否接入 |
| `kb:search` / `kb:add` / `kb:update` / `kb:get` / `kb:view` / `kb:hot` / `kb:recent-views` | kbSearch/Add/Update/Get/View/Hot/RecentViews | ✅ | KnowledgePage / KnowledgeDetailPage | — |
| `kb:delete` / `kb:export` / `kb:import` | kbDelete/Export/Import | ❌ | — | P1：知识库删除 / 导出 / 导入未接入（CRUD 不完整） |
| `history:list` / `history:get` / `history:stats` | historyList/Get/Stats | ✅ | DecisionPage / DecisionDetailPage / HistoryDetailPage / ModelKpiBar | — |
| `history:save` | historySave | ❌ | — | P1：主进程已注册（P-8 修复），前端未调用，决策卡片不主动入库 |

### 3.4 教程 / 部署 / Profiler / AT 命令 / Token

| IPC 通道 | Preload API | 前端接入状态 | 接入位置 | 备注 |
|---------|-------------|------------|---------|------|
| `tutorial:list` / `get` / `categories` / `recommend-path` / `progress` / `updateProgress` / `hybrid-search` / `search` / `search-status` / `backfill-embeddings` | tutorialList/Get/Categories/RecommendPath/Progress/UpdateProgress/HybridSearch/Search/SearchStatus/BackfillEmbeddings | ✅ | TutorialPage / TutorialDetailPage / useHybridSearch | 旧版同步回填已用 |
| `tutorial:backfill-start` / `backfill-cancel` / `backfill-status` / `backfill-progress` | tutorialBackfillStart/Cancel/Status/onTutorialBackfillProgress | ❌ | — | **P0**：v2.5 Phase C 新增的 4 个异步回填通道未接入，2578 条教程首次回填会阻塞 UI 1-3 分钟 |
| `tutorial:list-sources` / `crawl-start` / `crawl-status` / `crawl-cancel` / `crawl-progress` / `crawl-done` / `disk-info` / `cleanup-orphans` / `checkpoints` / `reset-checkpoint` / `seed-version` / `seed-reload` / `stats` | 同名 | ❌ | — | P2：教程爬虫 / 磁盘 / 断点续传 13 个通道未接入（管理员能力，非比赛演示路径） |
| `deploy:list-templates` / `build` / `execute` / `cancel` / `log` / `stepUpdate` / `done` | deployListTemplates/Build/Execute/Cancel/onDeployLog/StepUpdate/Done | ✅ | `DeployDialog.tsx` | — |
| `deploy:get-template` / `validate` / `get-status` | deployGetTemplate/Validate/GetStatus | ❌ | — | P2：单模板查询 / 校验 / 状态查询未接入（功能补全） |
| `profiler:run` / `export-pdf` / `default-file-name` | profilerRun/ExportPdf/DefaultFileName | ✅ | `ProfilerDialog.tsx` | — |
| `profiler:export-md` | profilerExportMd | ❌ | — | P2：Markdown 导出未接入（PDF 已用） |
| `at:list` / `resolve` / `parse` | atList/Resolve/Parse | ✅ | AtCommandPicker / useAtCommandInjection | — |
| `token:stats` / `cost-stats` / `records` | tokenStats/CostStats/Records | ✅ | ChatPanel / useAgentChat / ModelSettings / ModelKpiBar | — |
| `token:reset` | tokenReset | ❌ | — | P2：清空 token 记录未接入（无 UI 入口） |

### 3.5 模型统计 / 预算 / Provider / Mode / Attention / Subagent / Expectation / Task

| IPC 通道 | Preload API | 前端接入状态 | 接入位置 | 备注 |
|---------|-------------|------------|---------|------|
| `model:toolCalls` | modelToolCalls | ✅ | `ModelSettings.tsx:196` | — |
| `budget:alerts` | budgetAlerts | ✅ | `ModelSettings.tsx:197` | — |
| `provider:list` / `save` / `set-default` | providerList/Save/SetDefault | ✅ | ChatPanel / useAgentChat / ModelSettings | — |
| `provider:get` | providerGet | ❌ | — | P2：单 Provider 查询未接入（列表已含全部字段） |
| `provider:capabilities` / `capabilities-all` / `pricing` / `pricing-all` | providerCapabilities/CapabilitiesAll/Pricing/PricingAll | ❌ | — | P1：Provider 能力 + 定价透明 4 个通道未接入，ModelSettings 未展示能力矩阵 |
| `mode:list` / `set-default` / `get-current` | modeList/SetDefault/GetCurrent | ✅ | `ChatPanel.tsx:207,208,232` / `PlanBuildButton.tsx:68` | — |
| `attention:current` | attentionCurrent | ✅ | `AttentionBubble.tsx:114` | — |
| `attention:history` / `track-files` / `track-commands` / `track-errors` / `track-keywords` / `reset` | attentionHistory/TrackFiles/TrackCommands/TrackErrors/TrackKeywords/Reset | ❌ | — | P2：Attention 历史回看 + 5 个主动 track 写入 API 未接入（仅消费 current） |
| `subagent:list` / `reload` | subagentList/Reload | ❌ | — | P1：自定义 Agent 加载器未接入，无法管理 subagent 配置 |
| `expectation:check` | expectationCheck | ✅ | `ExpectedOutput.tsx:169` | — |
| `expectation:format` | expectationFormat | ❌ | — | P2：违规格式化未接入（前端可本地格式化） |
| `task:permission-approve` / `task:permission-approval-request` | taskPermissionApprove/onTaskPermissionApprovalRequest | ✅ | `TaskPermissionApprovalDialog.tsx:90,114` / `ChatPanel.tsx:342` / `TutorialDetailPage.tsx:231` | — |

### 3.6 Sidecar / Sandbox / MCP / Diagnostics / Promptfoo / Scheduler

| IPC 通道 | Preload API | 前端接入状态 | 接入位置 | 备注 |
|---------|-------------|------------|---------|------|
| `sidecar:start` / `status` / `pipeline` / `list-status` / `start-one` / `stop-one` | sidecarStart/Status/Pipeline/ListStatus/StartOne/StopOne | ✅ | SrePipelinePanel / SidecarStatusPanel / AiLogAnalysisPanel | — |
| `sidecar:stop` / `health` / `health-one` / `tool-call` / `parse-logs` | sidecarStop/Health/HealthOne/ToolCall/ParseLogs | ❌ | — | P1：5 个 Sidecar 高级能力未接入（停止 / 健康检查 / 通用工具调用 / 单独 Drain3 解析） |
| `sandbox:create` / `list` / `execute` / `approve` / `approval-request` | sandboxCreate/List/Execute/Approve/onSandboxApprovalRequest | ✅ | TutorialDetailPage / SandboxApprovalDialog / ChatPanel | — |
| `sandbox:detect-docker` / `start` / `stop` / `status` / `delete` | sandboxDetectDocker/Start/Stop/Status/Delete | ❌ | — | P1：Docker 检测 + OpenHands 容器生命周期管理 5 个通道未接入 |
| `mcp:get-state` / `state-changed` | mcpGetState/onMcpStateChanged | ✅ | `McpStatusBar.tsx:79,83` | — |
| `mcp:reset` | mcpReset | ❌ | — | P2：MCP 状态机重置未接入 |
| `mcp:external-status` / `external-tools` / `external-call` / `external-reconnect` | mcpExternalStatus/Tools/Call/Reconnect | ❌ | — | P1：外部 MCP 服务器 4 个通道完全未接入 |
| `diagnostics:get-report` / `get-logs` / `get-findings` / `get-stats` / `clear` / `set-enabled` / `ingest-test` / `log-batch` | diagnosticsGet*/Clear/SetEnabled/IngestTest/onDiagnosticsLogBatch | ❌ | — | P1：诊断服务 8 个通道完全未接入（后端日志检测能力不可达 UI） |
| `promptfoo:run-red-team` / `run-eval` / `list-tests` | promptfooRunRedTeam/RunEval/ListTests | ❌ | — | P2：红队测试 + Prompt 评估 3 个通道未接入（实验性能力） |
| `scheduler:list` / `toggle` / `trigger` / `status` | schedulerList/Toggle/Trigger/onSchedulerStatusChange | ✅ | `components/settings/SchedulerPanel.tsx` | — |

### 3.7 风险 / 告警 / 启动 / 系统 / 应用 / 文件系统 / 存储 / 配置 / 服务器

| IPC 通道 | Preload API | 前端接入状态 | 接入位置 | 备注 |
|---------|-------------|------------|---------|------|
| `risk:check` | riskCheck | ⚠️ | — | 通道已暴露，前端无直接调用（高危命令拦截由主进程自动执行） |
| `alert:ack` | alertAck | ✅ | `AlertDrawer.tsx:142` | — |
| `boot:loading-stage` | onBootLoadingStage | ✅ | `BootPage.tsx:81` | — |
| `system:ping` / `getProtocolVersion` | systemPing/getProtocolVersion | ❌ | — | P2：协议版本 + 心跳保活未接入（调试用） |
| `app:check-update` / `download-update` / `get-info` | appCheckUpdate/DownloadUpdate/GetInfo | ✅ | AboutSettings / GeneralSettings | — |
| `app:export-model-stats` | **(preload 未暴露)** | ❌ | — | **P0 BUG**：`ipc-contract.md:695` 声明 `appExportModelStats`，但 `preload/index.ts:2408-2413` 只暴露 `appCheckUpdate/DownloadUpdate/GetInfo`，未暴露 `appExportModelStats`；而 `ModelSettings.tsx:396` 调用了 `window.electronAPI.exportModelStats(stats)`（拼写错误，应为 `appExportModelStats`）→ 导出统计功能在 Electron 环境下必走 catch 分支，回退到浏览器下载 |
| `fs:upload-image` | fsUploadImage | ❌ | — | P1：AIPanel 图片附件基础版未接入（图片上传能力不可达） |
| `storage:save-api-key` / `get-api-key` | storageSaveApiKey/GetApiKey | ✅ | `stores/settings-store.ts:205,249` | — |
| `storage:delete-api-key` | storageDeleteApiKey | ❌ | — | P2：API Key 删除未接入 |
| `config:get` / `set` | configGet/Set | ✅ | usePersistentState / workbench-store / settings-store | — |
| `server:list` / `save` / `delete-cred` | serverList/Save/DeleteCred | ✅ | server-store / ServerList | — |
| `server:export` / `import` | serverExport/Import | ❌ | — | P2：服务器配置脱敏导出 / 导入未接入 |

### 3.8 日志

| IPC 通道 | Preload API | 前端接入状态 | 接入位置 | 备注 |
|---------|-------------|------------|---------|------|
| `log:read` / `stats` / `clear-buffer` / `renderer` | logRead/Stats/ClearBuffer/Renderer | ✅ | LogsPage / GeneralSettings / utils/logger | — |
| `log:set-min-level` / `flush` | logSetMinLevel/Flush | ❌ | — | P2：日志级别动态设置 + 异步刷新未接入 |

---

## 4. 孤儿 API 清单（preload 暴露但前端从未调用）

> 共约 75 个。下表按域归类，仅列出「后端已就绪且前端应当接入」的部分；纯调试型 API（如 `diagnosticsIngestTest`）放 P3。

| Preload API | 后端通道 | 建议处理 | 优先级 |
|------------|---------|---------|--------|
| `agentPaor` / `paorApprove` / `onPaorApprovalRequest` | agent:paor / paor:approve / paor:approval-request | PAOR 自动循环是 v0.9.5 核心能力，应接入 AIPanel 作为「自动执行」入口 | **P0** |
| `tutorialBackfillStart` / `Cancel` / `Status` / `onTutorialBackfillProgress` | tutorial:backfill-start/cancel/status/progress | 替换 useHybridSearch 中的旧版同步 `tutorialBackfillEmbeddings`，避免首次回填阻塞 UI | **P0** |
| `credibilityCalibrate` / `GetCalibration` / `GetCalibrationState` / `ResetCalibration` / `ComputeEce` / `AddCalibrationSample` | credibility:calibrate 等 6 个 | **先验证主进程是否真的未注册 handler**（ipc-contract.md 附录 A 标注未注册，但 preload 已暴露）。若已注册，新建 `CalibrationSettings.tsx` 接入；若未注册，移除 preload 暴露避免误导 | **P0** |
| `claudeSdkGenerate` / `Stream` / `Cancel` / `onClaudeSdkChunk` / `Done` / `Error` | claude-sdk:generate/stream/cancel/chunk/done/error | Provider 类型为 `claude-sdk` 时应走本通道（当前 ChatPanel 只走 agentChat） | P1 |
| `subagentList` / `Reload` | subagent:list/reload | Subagent 配置管理 UI 未建，应在 ModelSettings 或新页接入 | P1 |
| `mcpExternalStatus` / `Tools` / `Call` / `Reconnect` | mcp:external-* | 外部 MCP 服务器管理面板未建 | P1 |
| `diagnosticsGetReport` / `GetLogs` / `GetFindings` / `GetStats` / `Clear` / `SetEnabled` / `onDiagnosticsLogBatch` | diagnostics:* | 诊断服务面板未建（8 个通道全孤） | P1 |
| `sandboxDetectDocker` / `Start` / `Stop` / `Status` / `Delete` | sandbox:detect-docker/start/stop/status/delete | 沙箱容器生命周期管理未接入（仅用 create/list/execute/approve） | P1 |
| `sidecarStop` / `Health` / `HealthOne` / `ToolCall` / `ParseLogs` | sidecar:stop/health/health-one/tool-call/parse-logs | Sidecar 高级能力未接入（停止 / 健康检查 / 通用工具调用 / 单独 Drain3） | P1 |
| `providerCapabilities` / `CapabilitiesAll` / `Pricing` / `PricingAll` | provider:capabilities/pricing 等 4 个 | ModelSettings 应展示 Provider 能力矩阵 + 定价 | P1 |
| `credibilityExportAuditReport` / `ListAuditReports` / `LoadAuditReport` / `FormatAuditReport` | credibility:export-audit-report 等 4 个 | EU AI Act / NIST AI RMF 合规报告能力未接入 | P1 |
| `kbDelete` / `Export` / `Import` | kb:delete/export/import | 知识库 CRUD 不完整 | P1 |
| `historySave` | history:save | 决策卡片不主动入库（主进程 P-8 已修复，前端未消费） | P1 |
| `fsUploadImage` | fs:upload-image | AIPanel 图片附件基础版未接入 | P1 |
| `llmInlineCompletionCancel` / `ApplyDiff` / `DiffPreview` | llm:inline-completion:cancel/apply-diff/diff-preview | 补全无法取消、Diff 无法应用 | P1 |
| `onSshStateChanged` | ssh:state-changed | SSH 心跳/重连/最终断开事件未接入，UI 无法感知掉线 | P1 |
| `sftpUpload` / `Download` / `Rename` / `Chmod` / `Stat` | sftp:upload/download/rename/chmod/stat | 工作台文件操作不完整 | P2 |
| `sftpSearch` / `Grep` | sftp:search/grep | 远端文件搜索 / 内容 grep 未接入 | P2 |
| `llmAnalyze` / `Validate` / `ChatWithContext` | llm:analyze/validate/chat-with-context | LLM 高级 API 未接入 | P2 |
| `onLlmToken` / `Chunk` / `Done` / `Error` | llm:token/chunk/done/error | 旧版 LLM 流式事件未接入（前端走 agent:chunk） | P2 |
| `tutorialListSources` / `CrawlStart` / `CrawlStatus` / `CrawlCancel` / `onTutorialCrawlProgress` / `onTutorialCrawlDone` / `DiskInfo` / `CleanupOrphans` / `Checkpoints` / `ResetCheckpoint` / `SeedVersion` / `SeedReload` / `Stats` | tutorial:* 13 个 | 教程爬虫 / 磁盘 / 断点续传未接入（管理员能力） | P2 |
| `deployGetTemplate` / `Validate` / `GetStatus` | deploy:get-template/validate/get-status | 部署功能补全 | P2 |
| `profilerExportMd` | profiler:export-md | Markdown 导出未接入（PDF 已用） | P2 |
| `providerGet` | provider:get | 单 Provider 查询未接入（列表已含） | P2 |
| `attentionHistory` / `TrackFiles` / `TrackCommands` / `TrackErrors` / `TrackKeywords` / `Reset` | attention:history/track-*/reset | Attention 仅消费 current，5 个写入 + 历史回看未接入 | P2 |
| `expectationFormat` | expectation:format | 违规格式化未接入（前端可本地格式化） | P2 |
| `mcpReset` | mcp:reset | MCP 状态机重置未接入 | P2 |
| `promptfooRunRedTeam` / `RunEval` / `ListTests` | promptfoo:* 3 个 | 红队 / Prompt 评估未接入（实验性） | P2 |
| `storageDeleteApiKey` | storage:delete-api-key | API Key 删除未接入 | P2 |
| `serverExport` / `Import` | server:export/import | 服务器配置脱敏导出 / 导入未接入 | P2 |
| `tokenReset` | token:reset | 清空 token 记录未接入 | P2 |
| `logSetMinLevel` / `Flush` | log:set-min-level/flush | 日志级别动态设置 + 异步刷新未接入 | P2 |
| `systemPing` / `getProtocolVersion` | system:ping / 协议版本常量 | 调试用 | P3 |
| `diagnosticsIngestTest` | diagnostics:ingest-test | 测试用，仅 dev 模式 | P3 |

---

## 5. 高价值区域扫描结果

### 5.1 ModelSettings（v2.4 数据消费）

**接入情况：✅ 主路径全部接入**

- `modelToolCalls()` → `ToolCallSection`（`ModelSettings.tsx:196`）
- `budgetAlerts(20)` → `BudgetSection`（`ModelSettings.tsx:197`）
- `tokenStats()` / `tokenCostStats()` / `tokenRecords(1000)` / `historyStats()` → `ModelKpiBar`（`ModelKpiBar.tsx:118-127`）
- `providerList/Save/SetDefault` → 模型配置
- `llmTest` → API 测试连接
- `tokenRecords(100)` → 对话记录行映射

**关键 BUG**：
- `ModelSettings.tsx:396` 调用 `window.electronAPI?.exportModelStats(stats)` —— 该方法**不存在**。preload 暴露的应是 `appExportModelStats`（参见 preload `appUpdate.exportModelStats`），但 preload 第 2408-2413 行只暴露了 `appCheckUpdate/DownloadUpdate/GetInfo` 三个，**`appExportModelStats` 也未暴露**。结果：导出统计功能在 Electron 环境下必走 catch 分支，回退到浏览器下载 JSON 文件。

**未接入**：
- `providerCapabilities` / `providerPricing` 4 个通道 → ModelSettings 未展示 Provider 能力矩阵 + 定价（P1）

### 5.2 TutorialPage（v2.5 backfill 进度条）

**接入情况：❌ v2.5 新通道完全未接入**

- TutorialPage 当前只调用 `tutorialList` / `tutorialCategories` / `tutorialRecommendPath` / `tutorialProgress` / `tutorialUpdateProgress` / `tutorialHybridSearch` / `tutorialSearch`
- `useHybridSearch.ts:335` 调用的是**旧版同步阻塞通道** `tutorialBackfillEmbeddings`，会导致首次回填（2578 条）阻塞 UI 1-3 分钟
- **未接入**：`tutorialBackfillStart` / `Cancel` / `Status` / `onTutorialBackfillProgress` 4 个 v2.5 Phase C 异步通道（preload 已暴露 3387-3394 行）

**建议**：
1. 在 `useHybridSearch.ts` 的 `backfill` 回调中，用 `tutorialBackfillStart()` 替换 `tutorialBackfillEmbeddings()`
2. 订阅 `onTutorialBackfillProgress`，将 `p.pct` / `p.eta` 写入 `progress` state（替换当前的 indeterminate 进度）
3. 任务结束时（status = completed/cancelled/failed）调用 unsubscribe + 重新拉取 `tutorialSearchStatus`
4. 提供「取消回填」按钮调用 `tutorialBackfillCancel`

### 5.3 CalibrationSettings

**接入情况：❌ 组件不存在**

- `Glob: pages/CalibrationSettings*.tsx` → 无结果
- `Glob: **/{Calibration,calibration}*.tsx` → 无结果
- `SettingsLayout.tsx` 6 项导航（通用 / SSH / AI 引擎 / 告警阈值 / 外观 / 关于）**无「校准」项**
- preload 已暴露 6 个校准 API（`credibilityCalibrate` / `GetCalibration` / `GetCalibrationState` / `ResetCalibration` / `ComputeEce` / `AddCalibrationSample`），但 **ipc-contract.md 附录 A 第 740-741 行标注「`ipcMain.handle` 未注册」** → 调用会运行时报错

**矛盾点**：ipc-contract.md 第 741 行写「preload 未暴露 `credibilityCalibrate` 等方法」，但 preload 第 2486-2491 行**已暴露**。文档与代码不一致，需先核对主进程 handler 注册状态。

**建议**：
1. 先在 `src/main/ipc/credibility.ts` 确认是否注册了 6 个校准 handler
2. 若已注册 → 新建 `pages/CalibrationSettings.tsx` + 在 `SettingsLayout` 添加导航项 + 接入 6 个 API
3. 若未注册 → 移除 preload 第 2486-2491 行的暴露，避免误导

### 5.4 AI Panel（agent / loop / paor）

**接入情况：⚠️ agent/loop 已接入，paor 完全未接入**

- `agentChat` / `agentChatCancel` / `agentConfirm` / `agentStart` / `agentCancel` ✅（ChatPanel + useAgentChat）
- `loopStart` / `loopConfirm` / `loopCancel` / 7 个 push 事件 ✅（useLoopEngineering + DecisionPage）
- `agentPaor` / `paorApprove` / `onPaorApprovalRequest` ❌ **完全未接入**
- `claudeSdkGenerate` / `Stream` / `Cancel` / 3 个 push 事件 ❌ **完全未接入**

**降级链**（`ChatPanel.tsx:494-558`）：
1. agentChat（v0.9 Supervisor 主路径）✅
2. agentStart（v0.8 兼容）✅
3. llmChatWithTools（v0.5.0）✅
4. llmChat（v0.4 兜底）✅
5. claudeSdk* / agentPaor —— **未在降级链中**

**建议**：
- 在 ChatPanel send 中，根据 Provider 类型（`provider.type === 'claude-sdk'`）分流到 `claudeSdkStream` 路径
- 在 AIPanel 增加「PAOR 自动循环」按钮，调用 `loopStart`（已存在）或 `agentPaor`（未接入），订阅 `onPaorApprovalRequest` 弹出审批弹窗

### 5.5 决策卡片（credibility）

**接入情况：✅ 主路径已接入，审计报告能力未接入**

- `credibilityAssess` / `credibilityDag` ✅（`CredibilityPanel.tsx:344,345` / `DecisionDetailPage.tsx:152` / `DecisionSettings.tsx:217`）
- `credibilityExportAudit`（按 decisionId 导出 HTML）✅（`DecisionDetailPage.tsx:323`）
- `credibilityExportAuditReport` / `ListAuditReports` / `LoadAuditReport` / `FormatAuditReport` ❌ **完全未接入**

**建议**：在 `DecisionDetailPage` 增加「导出合规报告」按钮，调用 `credibilityExportAuditReport`（支持 JSON / Markdown / HTML 多格式）+ 「历史报告」入口调用 `credibilityListAuditReports`。

---

## 6. 前端占位代码清单

| 位置 | 性质 | 建议处理 | 优先级 |
|------|------|---------|--------|
| `components/workbench/mock-data.ts` | 全文件本地 mock（5 条 AI 对话 + 4 个 Composer chips + 3 条 MessageRow） | 文件头注释「所有数据均为本地 mock，不接 IPC」。`MessageList.tsx:5` / `Composer.tsx:9` / `BlockRenderer.tsx:4` / `MessageRow.tsx:3` / `LiveMessageRow.tsx:22` 均引用。建议保留作为「演示模式」fallback，但需在 AIPanel 入口标注「演示数据」 | P2 |
| `components/workbench/MessageList.tsx:102` | 注释「下方为设计稿示例（mock）。发送消息后走真实 agent:chat」 | 现状正确：未发送时显示 mock，发送后走真实 IPC。无需处理 | — |
| `components/workbench/AIPanel.tsx:23,27` | 注释「工具面板按钮仍多为 mock（Wire-2+ 再接 HITL / 终端）」「可选示例：mock-data.ts MOCK_CHAT_MESSAGES（showDemo）」 | Wire-2 已落地，建议清理 mock 注释 + 移除 showDemo 路径 | P2 |
| `components/history/mock-data.ts` | 文件头注释「R16 清理：11 → 8 导出，HistoryPage 已使用本地状态计算替代 mock 数据」 | 文件仍存在但已被 R16 清理为类型定义 + 筛选选项，无真实 mock 数据。无需处理 | — |
| `components/monitor/mock-data.ts` + `ProcessTable.tsx:21` | `import { sampleProcesses } from './mock-data'` | ProcessTable 用 sampleProcesses 作为空数据 fallback。建议保留 | P3 |
| `pages/about-settings.constants.ts:14,16,64,75` | 注释「APP_BUILD_TIME / APP_INSTALL_PATH：暂用设计稿示例值占位（设计稿示例数据豁免 mock 数据禁令）」 | AboutSettings 已接入 `appGetInfo()`，应移除占位值改用真实 IPC 数据 | P2 |
| `components/decision/EvidenceList.tsx:8,275` | 注释「底部规则说明 + 清空按钮（mock）」「清空后占位」 | mock 仅指清空后的视觉占位，非数据 mock。无需处理 | — |
| `components/decision/ExecutionResult.tsx:11,12` | 注释「采纳执行 / 修改 / 拒绝 按钮回调（mock）」「复制命令按钮（mock 切换"已复制"）」 | 实际回调由 DecisionDetailPage 注入，注释过时。建议清理注释 | P3 |
| `hooks/useHybridSearch.ts:284-312` | 「占位值构造 SearchResultItem」（rrfScore: 0.02 / ftsScore: -1） | Jaccard 关键词搜索无原始分，用占位值让 UI 显示低分数。设计合理，无需处理 | — |
| `pages/DecisionPage.tsx:130` / `DecisionDetailPage.tsx:119,135,160` | 注释「IPC 不可用时不订阅（spec：禁止 mock fallback）」 | 现状正确：禁止 mock 是规格要求。无需处理 | — |

---

## 7. 接手 AI 优先级行动清单

### P0（必须接入，阻塞核心功能或存在 BUG）

1. **修复 ModelSettings 导出统计 BUG**（`ModelSettings.tsx:396`）
   - 问题：调用 `window.electronAPI.exportModelStats`（拼写错误 + preload 未暴露）
   - 修复：在 `preload/index.ts:2413` 后添加 `appExportModelStats: appUpdate.exportModelStats,` + 修改 `ModelSettings.tsx:396` 为 `window.electronAPI.appExportModelStats(stats)`
   - 验证：在 Electron 环境下点击「导出统计」按钮，确认生成文件而非走浏览器下载 fallback

2. **接入 v2.5 异步 backfill 4 通道**（`useHybridSearch.ts`）
   - 用 `tutorialBackfillStart()` 替换 `tutorialBackfillEmbeddings()`
   - 订阅 `onTutorialBackfillProgress`，将 `p.pct` / `p.eta` 写入 progress state
   - 提供「取消回填」按钮调用 `tutorialBackfillCancel`
   - 页面刷新后用 `tutorialBackfillStatus` 恢复 UI
   - 验证：2578 条教程首次回填时 UI 不阻塞，进度条 0-100% 平滑推进

3. **接入 PAOR 自动循环**（`AIPanel.tsx` / 新建 `PaorApprovalDialog.tsx`）
   - 在 AIPanel 增加「PAOR 自动循环」按钮，调用 `agentPaor(task, sshSessionId, maxIterations?)`
   - 订阅 `onPaorApprovalRequest`，弹出 `PaorApprovalDialog`，用户响应后调用 `paorApprove(callId, approved)`
   - 60 秒未响应自动拒绝（主进程已实现）
   - 验证：触发 PAOR 后遇到高危命令时弹窗，用户批准后继续，拒绝后中止

4. **校准 6 API 状态确认 + CalibrationSettings 组件**（新建 `pages/CalibrationSettings.tsx`）
   - **先验证**：`src/main/ipc/credibility.ts` 是否注册了 6 个校准 handler
   - 若已注册 → 新建 `CalibrationSettings.tsx` 接入 6 个 API + 在 `SettingsLayout.tsx` 添加「校准」导航项
   - 若未注册 → 移除 `preload/index.ts:2486-2491` 的暴露 + 同步更新 `ipc-contract.md` 附录 A
   - 验证：调用 `credibilityComputeEce('deepseek', 10)` 返回 ECE 值，不抛「No handler registered」

5. **文档与代码一致性核对**（`ipc-contract.md` 附录 A/C）
   - 附录 A 第 740-741 行标注「校准 IPC 通道在 preload 暴露 ❌」—— 实际 preload 第 2486-2491 行已暴露
   - 附录 C 第 801 行标注「preload 暴露 4 个 backfill 方法 ✅」—— 与代码一致
   - 修正附录 A 的描述，避免接手 AI 误判

### P1（建议接入，提升功能完整度）

1. **接入 Claude Agent SDK 6 通道**（`ChatPanel.tsx` send 分流）
   - 根据 Provider 类型分流：`provider.type === 'claude-sdk'` → 走 `claudeSdkStream` + 订阅 `onClaudeSdkChunk/Done/Error`
   - 提供 `claudeSdkCancel` 取消按钮
2. **接入 Subagent 管理**（`subagentList` / `Reload`）
   - 在 ModelSettings 或新建 SubagentSettings 接入
3. **接入外部 MCP 服务器**（`mcpExternalStatus/Tools/Call/Reconnect` 4 个）
   - 新建 McpExternalPanel
4. **接入诊断服务**（`diagnosticsGet*/Clear/SetEnabled/onDiagnosticsLogBatch` 8 个）
   - 新建 DiagnosticsPanel
5. **接入沙箱容器生命周期**（`sandboxDetectDocker/Start/Stop/Status/Delete` 5 个）
   - 在 TutorialDetailPage 或新建 SandboxPanel 接入
6. **接入 Sidecar 高级能力**（`sidecarStop/Health/HealthOne/ToolCall/ParseLogs` 5 个）
   - 在 SidecarStatusPanel 扩展
7. **接入 Provider 能力 + 定价**（`providerCapabilities/CapabilitiesAll/Pricing/PricingAll` 4 个）
   - 在 ModelSettings 新增「Provider 能力矩阵」Section
8. **接入合规审计报告**（`credibilityExportAuditReport/ListAuditReports/LoadAuditReport/FormatAuditReport` 4 个）
   - 在 DecisionDetailPage 增加「导出合规报告」按钮
9. **接入知识库 CRUD 完整链**（`kbDelete/Export/Import` 3 个）
   - 在 KnowledgePage 增加删除 / 导出 / 导入按钮
10. **接入 historySave**（决策卡片入库）
    - 在 DecisionPage / DecisionDetailPage 完成 / 修改时调用 `historySave(card)`
11. **接入 fsUploadImage**（AIPanel 图片附件）
12. **接入内联补全取消 + Diff 应用**（`llmInlineCompletionCancel/ApplyDiff/DiffPreview` 3 个）
13. **接入 SSH 心跳事件**（`onSshStateChanged`）
    - ServerList / TerminalView 显示连接状态徽章

### P2（可选，提升体验或补全非核心能力）

- SFTP 文件操作补全（upload/download/rename/chmod/stat）
- SFTP 远端搜索（search/grep）→ GlobalSearch 扩展
- LLM 高级 API（analyze/validate/chat-with-context）
- 旧版 LLM 流式事件（onLlmToken/Chunk/Done/Error）—— 仅在回退到 llm:chat 时需要
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
- `risk:check`（前端无直接调用，由主进程自动执行，可考虑在 CommandTerminal 显示风险等级时调用）
- 清理 `ExecutionResult.tsx` / `EvidenceList.tsx` 过时 mock 注释

---

## 附录 A：完整调用清单（231 行）

> 因篇幅限制，本附录仅列出每文件首次调用行号。完整清单见 git history 中的扫描结果。

| 文件 | 调用次数 | 主要 API |
|------|---------|---------|
| `hooks/usePersistentState.ts` | 2 | configGet / configSet |
| `pages/AboutSettings.tsx` | 2 | appCheckUpdate / appDownloadUpdate / appGetInfo |
| `pages/BootPage.tsx` | 1 | onBootLoadingStage |
| `pages/DecisionPage.tsx` | 18 | historyList / onLoop* / loopConfirm / loopCancel |
| `pages/DecisionDetailPage.tsx` | 9 | historyGet / credibilityAssess / loopConfirm / credibilityExportAudit |
| `pages/GeneralSettings.tsx` | 1 | logClearBuffer / appGetInfo |
| `pages/HistoryDetailPage.tsx` | 2 | historyGet |
| `pages/KnowledgeDetailPage.tsx` | 3 | kbGet / kbUpdate |
| `pages/KnowledgePage.tsx` | 5 | kbSearch / kbView / kbHot / kbRecentViews / kbAdd |
| `pages/LogsPage.tsx` | 5 | logRead / logStats |
| `pages/ModelSettings.tsx` | 8 | providerList / providerSave / providerSetDefault / llmTest / tokenRecords / modelToolCalls / budgetAlerts / **exportModelStats（BUG）** |
| `pages/MonitorPage.tsx` | 7 | monitorStart / monitorStop / monitorGetSystemInfo / onMonitorData / onMonitorSystemInfo |
| `pages/SshSettings.tsx` | 7 | sshListKeypairs / sshDeleteKeyring / sshUploadKeypair / sshGenerateKeypair |
| `pages/TutorialDetailPage.tsx` | 9 | tutorialGet / tutorialProgress / onSandboxApprovalRequest / tutorialUpdateProgress / sandboxList / sandboxCreate / sandboxExecute / sandboxApprove |
| `pages/TutorialPage.tsx` | 1 | tutorialUpdateProgress |
| `pages/DecisionSettings.tsx` | 1 | credibilityAssess |
| `stores/server-store.ts` | 3 | serverSave / serverDeleteCred / serverList |
| `stores/workbench-store.ts` | 3 | configGet / configSet |
| `stores/settings-store.ts` | 4 | configGet / storageGetApiKey / configSet / storageSaveApiKey |
| `utils/logger.ts` | 1 | logRenderer |
| `components/ai/ChatPanel.tsx` | 26 | providerList / tokenStats / modeList / modeGetCurrent / modeSetDefault / onAgentChunk / onAgentDone / onAgentError / onAgentStep / onLlmToolProgress / onLlmToolApproval / onSandboxApprovalRequest / onTaskPermissionApprovalRequest / agentChat / agentStart / llmChatWithTools / llmChat / agentChatCancel / agentConfirm |
| `components/ai/CredibilityPanel.tsx` | 2 | credibilityAssess / credibilityDag |
| `components/ai/ExpectedOutput.tsx` | 1 | expectationCheck |
| `components/ai/McpStatusBar.tsx` | 2 | mcpGetState / onMcpStateChanged |
| `components/ai/PlanBuildButton.tsx` | 1 | modeSetDefault |
| `components/ai/SandboxApprovalDialog.tsx` | 2 | sandboxApprove |
| `components/ai/SidecarStatusPanel.tsx` | 3 | sidecarListStatus / sidecarStartOne / sidecarStopOne |
| `components/ai/SrePipelinePanel.tsx` | 5 | sidecarStatus / sidecarStart / sidecarPipeline |
| `components/ai/TaskPermissionApprovalDialog.tsx` | 2 | taskPermissionApprove |
| `components/ai/ToolApprovalModal.tsx` | 2 | llmToolApprove |
| `components/ai/AttentionBubble.tsx` | 1 | attentionCurrent |
| `components/ai/at-commands/AtCommandPicker.tsx` | 2 | atList |
| `components/ai/at-commands/useAtCommandInjection.ts` | 4 | atParse / atResolve |
| `components/deploy/DeployDialog.tsx` | 7 | deployListTemplates / onDeployLog / onDeployStepUpdate / onDeployDone / deployBuild / deployExecute / deployCancel |
| `components/layout/ConnectDialog.tsx` | 2 | sshConnect / sshDisconnect |
| `components/layout/ServerList.tsx` | 6 | sshConnect / sshShellStart / monitorStart / monitorStop / sshDisconnect / serverDeleteCred |
| `components/logs/AiLogAnalysisPanel.tsx` | 2 | sidecarPipeline |
| `components/monitor/AlertDrawer.tsx` | 1 | alertAck |
| `components/monitor/MonitorPanel.tsx` | 2 | onMonitorData / onMonitorSystemInfo |
| `components/monitor/ProcessTable.tsx` | 1 | sshExec |
| `components/profiler/ProfilerDialog.tsx` | 4 | profilerRun / profilerDefaultFileName / profilerExportPdf |
| `components/settings/ModelKpiBar.tsx` | 4 | tokenStats / tokenCostStats / tokenRecords / historyStats |
| `components/settings/SettingsSections.tsx` | 1 | （类型引用，非业务调用） |
| `components/settings/TokenUsageChart.tsx` | 3 | tokenStats / tokenCostStats / tokenRecords |
| `components/ssh/HostKeyPromptDialog.tsx` | 2 | onSshHostKeyPrompt / sshRespondHostKey |
| `components/terminal/TerminalView.tsx` | 3 | sshShellWrite / sshShellResize / onTerminalData |
| `components/terminal/TerminalTabs.tsx` | 5 | sshShellStart / sshShellWrite / sshShellResize / onTerminalData |
| `components/workbench/EditorArea.tsx` | 9 | sftpReadFile / sftpWriteFile / onFileChanged / fileWatchStop / fileWatchStart |
| `components/workbench/FileTree.tsx` | 7 | sftpList / sftpMkdir / sftpDelete |
| `components/workbench/InlineCompletionProvider.tsx` | 1 | llmInlineCompletion |
| `components/workbench/WorkbenchTitlebar.tsx` | 3 | sshConnect / sshShellStart |
| `components/workbench/useAgentChat.ts` | 20 | providerList / tokenStats / tokenCostStats / onAgentChunk / onAgentDone / onAgentError / onAgentStep / agentChat / agentChatCancel / agentCancel |
| `components/workbench/useLoopEngineering.ts` | 6 | loopStart / loopConfirm / loopCancel / onLoopLlmStart / onLoopLlmDone / onLoopStep / onLoopDecision / onLoopDone / onLoopError / onLoopBlocked |
| `types/electron.d.ts` | 1 | （类型声明文档，非业务调用） |

---

## 附录 B：审计方法与局限

### 审计方法
1. **前端调用扫描**：`Grep pattern="electronAPI\.[a-zA-Z][a-zA-Z0-9]*" path="src/renderer/src"` → 231 行匹配（含 1 行 .d.ts 类型声明）
2. **preload 暴露扫描**：`Grep pattern="^  [a-zA-Z][a-zA-Z0-9]*:\s*(async\s*)?\(?" path="src/preload/index.ts"` + 手动读取 2291-3682 行 `exposeInMainWorld` 块
3. **IPC 契约对照**：完整读取 `docs/handoff/ipc-contract.md`（812 行，36 个域）
4. **高价值区域深扫**：ModelSettings / TutorialPage / SettingsLayout / components/ai/ / components/decision/ / useAgentChat / useLoopEngineering / useHybridSearch / AttentionBubble / SchedulerPanel
5. **占位代码扫描**：`Grep pattern="(TODO|FIXME|mock|placeholder|占位|暂未接入|待接入|未接入|未实现|尚未接入|stub|hardcode)"`

### 已知局限
1. **未运行时验证**：审计基于静态代码扫描，未实际运行 Electron 应用验证每个 API 调用是否成功
2. **校准 handler 注册状态未确认**：ipc-contract.md 附录 A 标注「校准 6 通道 `ipcMain.handle` 未注册」，但 preload 已暴露 → 需接手 AI 在 `src/main/ipc/credibility.ts` 中确认
3. **前端可能正在被其他 AI 重构**：本次扫描快照为 2026-07-25，后续可能变化
4. **electronAPI 通过 `?.` 链式调用未单独统计**：如 `window.electronAPI?.tutorialUpdateProgress` 计为 1 次
5. **`.d.ts` 类型声明中的 API 名引用未计入业务调用**：仅统计实际 `window.electronAPI.xxx()` 调用

---

> **接手 AI 起步建议**：
> 1. 先做 P0 第 1 项（修复 exportModelStats BUG）—— 5 分钟可完成，立刻可用
> 2. 再做 P0 第 5 项（核对校准 handler 注册状态）—— 决定后续校准工作方向
> 3. P0 第 2 项（v2.5 backfill）是比赛演示核心场景，优先级最高
> 4. P0 第 3 项（PAOR）和第 4 项（CalibrationSettings）视比赛演示路径决定
