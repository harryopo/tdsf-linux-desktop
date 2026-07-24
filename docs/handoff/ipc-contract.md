# IPC 通道契约文档

> 生成时间：2026-07-24
> 最后更新：2026-07-24（v2.5 Phase C/D/E 落地）
> 适用版本：v2.5（Phase A/B/C + v2.5 循环工程已落地）
> 来源：`src/shared/ipc-channels.ts` + `src/main/ipc/*` + `src/preload/index.ts`
>
> 铁律（IPC 4 步同步）：
> 1. 在 `src/shared/ipc-channels.ts` 定义常量
> 2. 在 `src/main/ipc/index.ts` 注册 handler
> 3. 在 `src/preload/index.ts` 暴露扁平化 API
> 4. 在 `src/preload/index.d.ts` 声明 `ElectronAPI` 类型

---

## 文档约定

- **方向**
  - `invoke`：渲染 → 主（请求-响应，`ipcRenderer.invoke` ↔ `ipcMain.handle`）
  - `push`：主 → 渲染（单向推送，`webContents.send` ↔ `ipcRenderer.on`）
- **版本标记**
  - 🔥 = v2.4 Phase A/B/C 新增或修改的通道/能力
  - 🚀 = v2.5 循环工程新增或修改的通道/能力
- **错误处理**：除非另行说明，所有 invoke 通道在主进程出错时均 `throw Error`，前端应用 `try/catch` 捕获

---

## 一、SSH 域

### 1.1 invoke 通道

| 通道名 | Preload API | 参数 | 返回值 | 调用时机 | 备注 |
|--------|-------------|------|--------|----------|------|
| `ssh:connect` | `sshConnect` | `(config: SshConfig)` | `Promise<string>`（sessionId） | 用户点击"连接" | 触发主机密钥校验时会推送 `ssh:host-key-prompt` |
| `ssh:disconnect` | `sshDisconnect` | `(sessionId: string)` | `Promise<boolean>` | 用户主动断开 / 切换服务器 | 幂等 |
| `ssh:exec` | `sshExec` | `(sessionId, command)` | `Promise<CommandResult>` | 一次性命令执行 | 🔥 v2.4 Phase A：执行后调用 `recordToolCall('终端命令执行')` |
| `ssh:shell:start` | `sshShellStart` | `(sessionId)` | `Promise<boolean>` | 进入交互式终端 | — |
| `ssh:shell:write` | `sshShellWrite` | `(sessionId, data)` | `Promise<boolean>` | 用户键入字符 | — |
| `ssh:shell:resize` | `sshShellResize` | `(sessionId, cols, rows)` | `Promise<boolean>` | 终端窗口尺寸变化 | — |
| `ssh:host-key-response` | `sshRespondHostKey` | `({ requestId, action })` | `Promise<boolean>` | 用户在主机密钥弹窗中选择 | Phase L |
| `ssh:delete-keypair` | `sshDeleteKeyring` | `(keyName)` | `Promise<{success, error?}>` | 密钥管理删除 | Phase M，幂等 |
| `ssh:upload-keypair` | `sshUploadKeypair` | 无 | `Promise<{success, keyPair?, error?, canceled?}>` | 密钥管理上传 | Phase M，弹出文件选择框 |
| `ssh:generate-keypair` | `sshGenerateKeypair` | `(request: GenerateKeyPairRequest)` | `Promise<GenerateKeyPairResponse>` | 密钥管理生成 | Phase M，调用 ssh-keygen |
| `ssh:list-keypairs` | `sshListKeypairs` | 无 | `Promise<SshKeyPair[]>` | 密钥管理列表展示 | Phase M |

### 1.2 push 通道

| 通道名 | Preload API | 载荷 | 触发时机 |
|--------|-------------|------|----------|
| `terminal:data` | `onTerminalData` | `(sessionId, data: string)` | 交互式 Shell 输出回传 |
| `ssh:state-changed` | `onSshStateChanged` | `SshStateEvent` | 心跳失败 / 重连 / 最终断开 |
| `ssh:host-key-prompt` | `onSshHostKeyPrompt` | `SshHostKeyPromptEvent` | 首次连接或密钥变更 |

---

## 二、SFTP 域

### 2.1 invoke 通道

| 通道名 | Preload API | 参数 | 返回值 | 备注 |
|--------|-------------|------|--------|------|
| `sftp:list` | `sftpList` | `(sessionId, remotePath)` | `Promise<SftpEntry[]>` | — |
| `sftp:upload` | `sftpUpload` | `(sessionId, localPath, remotePath)` | `Promise<boolean>` | — |
| `sftp:download` | `sftpDownload` | `(sessionId, remotePath, localPath)` | `Promise<boolean>` | — |
| `sftp:delete` | `sftpDelete` | `(sessionId, remotePath)` | `Promise<boolean>` | — |
| `sftp:rename` | `sftpRename` | `(sessionId, oldPath, newPath)` | `Promise<boolean>` | — |
| `sftp:chmod` | `sftpChmod` | `(sessionId, remotePath, mode)` | `Promise<boolean>` | — |
| `sftp:readFile` | `sftpReadFile` | `(sessionId, remotePath)` | `Promise<string>` | 10MB 上限 |
| `sftp:writeFile` | `sftpWriteFile` | `(sessionId, remotePath, content)` | `Promise<boolean>` | 覆盖写 |
| `sftp:stat` | `sftpStat` | `(sessionId, remotePath)` | `Promise<SftpEntry \| null>` | — |
| `sftp:mkdir` | `sftpMkdir` | `(sessionId, remotePath)` | `Promise<boolean>` | — |

### 2.2 SFTP 搜索 / 内容 grep（v2.0 Phase C）

| 通道名 | Preload API | 参数 | 返回值 | 备注 |
|--------|-------------|------|--------|------|
| `sftp:search` | `sftpSearch` | `(sessionId, path, query)` | `Promise<{files: SftpSearchFileEntry[], error?}>` | 3 秒超时，最多 50 条 |
| `sftp:grep` | `sftpGrep` | `(params: SftpGrepParams)` | `Promise<{results: SftpGrepMatch[], error?}>` | 3 秒超时，最多 100 条 |

---

## 三、文件监听域（v2.0 Phase C）

| 通道名 | 方向 | Preload API | 参数 / 载荷 | 返回值 / 说明 |
|--------|------|-------------|-------------|---------------|
| `file:watch:start` | invoke | `fileWatchStart` | `(sessionId, path)` | `Promise<{watchId: string}>` |
| `file:watch:stop` | invoke | `fileWatchStop` | `(watchId)` | `Promise<{success: boolean}>` |
| `file:changed` | push | `onFileChanged` | `FileChangedPayload` | inotifywait 优先 + 5s 轮询降级 |

---

## 四、监控域（MONITOR）

### 4.1 invoke 通道

| 通道名 | Preload API | 参数 | 返回值 | 调用时机 |
|--------|-------------|------|--------|----------|
| `monitor:start` | `monitorStart` | `(sessionId, interval: number)` | `Promise<boolean>` | 进入实时监控页 |
| `monitor:stop` | `monitorStop` | `(sessionId)` | `Promise<boolean>` | 离开监控页 / 断开连接 |
| `monitor:getSystemInfo` | `monitorGetSystemInfo` | `(sessionId)` | `Promise<SystemInfo>` | 首次进入监控页 |

### 4.2 push 通道

| 通道名 | Preload API | 载荷 | 触发时机 |
|--------|-------------|------|----------|
| `monitor:data` | `onMonitorData` | `(sessionId, data: MonitorData)` | 每 `interval` 秒采集一次 |
| `monitor:systemInfo` | `onMonitorSystemInfo` | `(sessionId, info: SystemInfo)` | 首次采集时推送一次 |

---

## 五、LLM 域

### 5.1 invoke 通道

| 通道名 | Preload API | 参数 | 返回值 | 备注 |
|--------|-------------|------|--------|------|
| `llm:chat` | `llmChat` | `(messages: ChatMessage[])` | `Promise<string>` | 流式 token 通过 `llm:token` 推送 |
| `llm:test` | `llmTest` | `(config: LlmConfig)` | `Promise<boolean>` | 仅测连通性 |
| `llm:analyze` | `llmAnalyze` | `(problem, evidences)` | `Promise<string>`（JSON 字符串） | 内置降级 |
| `llm:validate` | `llmValidate` | `(config: LlmConfig)` | `Promise<LlmValidationResult>` | 不发网络请求 |
| `llm:chat-with-context` | `llmChatWithContext` | `(messages, envCtx)` | `Promise<string>` | — |
| `llm:chat-with-tools` | `llmChatWithTools` | `(messages)` | `Promise<string>` | v0.5.0 工具调用入口 |
| `llm:tool-approve` | `llmToolApprove` | `(response: ToolApprovalResponse)` | `Promise<boolean>` | 用户审批工具调用 |

### 5.2 内联补全 + Diff（v2.0 Phase B，LLM_INLINE 域）

| 通道名 | Preload API | 参数 | 返回值 | 备注 |
|--------|-------------|------|--------|------|
| `llm:inline-completion` | `llmInlineCompletion` | `(req: InlineCompletionRequest)` | `Promise<InlineCompletionItem[]>` | 空数组 = 无补全/超时/被限流 |
| `llm:inline-completion:cancel` | `llmInlineCompletionCancel` | 无 | `Promise<void>` | 取消进行中的补全 |
| `llm:apply-diff` | `llmApplyDiff` | `({filePath, newContent})` | `Promise<{success, error?}>` | 仅本地文件系统 |
| `llm:diff-preview` | `llmDiffPreview` | `({filePath, originalContent, modifiedContent})` | `Promise<{diff: string}>` | unified diff 格式 |

### 5.3 push 通道

| 通道名 | Preload API | 载荷 | 备注 |
|--------|-------------|------|------|
| `llm:token` | `onLlmToken` | `(token: string)` | 兼容旧版流式 token |
| `llm:chunk` | `onLlmChunk` | `LlmStreamChunk` | 增强版，含 totalTokens |
| `llm:done` | `onLlmDone` | `(fullText: string)` | 流式完成 |
| `llm:error` | `onLlmError` | `LlmError` | 含 errorCode / retryable |
| `llm:tool-progress` | `onLlmToolProgress` | `ToolCallProgress` | 工具调用进度 |
| `llm:tool-approval` | `onLlmToolApproval` | `ToolApprovalRequest` | 工具调用审批请求 |

---

## 六、Agent 域（Supervisor + PAOR + 旧 AgentWorkflow）

### 6.1 invoke 通道

| 通道名 | Preload API | 参数 | 返回值 | 备注 |
|--------|-------------|------|--------|------|
| `agent:chat` | `agentChat` | `(messages, providerId?, strength?, sshSessionId?)` | `Promise<string>`（correlationId） | v0.9 Supervisor 流式 chat |
| `agent:chat:cancel` | `agentChatCancel` | `(sessionIdOrCorrelationId)` | `Promise<boolean>` | v0.9.4 兼容两种 ID |
| `agent:paor` | `agentPaor` | `(task, sshSessionId, maxIterations?)` | `Promise<unknown>` | v0.9.5 PAOR 自动循环 |
| `agent:start` | `agentStart` | `(sessionId, problem)` | `Promise<boolean>` | v0.8 旧 AgentWorkflow 兼容 |
| `agent:confirm` | `agentConfirm` | `(sessionId, approved)` | `Promise<boolean>` | v0.8 旧 AgentWorkflow 兼容 |
| `agent:cancel` | `agentCancel` | `(sessionId)` | `Promise<{agentChat, claudeSdk}>` | v0.9.4 统一取消，同时调 `agent:chat:cancel` + `claude-sdk:cancel` |
| `paor:approve` | `paorApprove` | `(callId, approved)` | `Promise<boolean>` | v0.9.5 PAOR 审批响应 |

### 6.2 push 通道

| 通道名 | Preload API | 载荷 | 备注 |
|--------|-------------|------|------|
| `agent:step` | `onAgentStep` | `AgentWorkflowState` | 旧 AgentWorkflow 步骤变更 |
| `agent:chunk` | `onAgentChunk` | `AgentChunkPayload` | Supervisor 流式 token 块 |
| `agent:done` | `onAgentDone` | `AgentDonePayload` | Supervisor chat 完成 |
| `agent:error` | `onAgentError` | `AgentErrorPayload` | Supervisor chat 错误 |
| `paor:approval-request` | `onPaorApprovalRequest` | `PaorApprovalRequest` | 60 秒未响应自动拒绝 |

---

## 七、Claude Agent SDK 域

| 通道名 | 方向 | Preload API | 参数 / 载荷 | 返回值 |
|--------|------|-------------|-------------|--------|
| `claude-sdk:generate` | invoke | `claudeSdkGenerate` | `(providerId, params: ClaudeSdkChatParams)` | `Promise<ChatResult>`（同步聚合） |
| `claude-sdk:stream` | invoke | `claudeSdkStream` | `(providerId, params)` | `Promise<string>`（correlationId） |
| `claude-sdk:cancel` | invoke | `claudeSdkCancel` | `(correlationId)` | `Promise<boolean>` |
| `claude-sdk:chunk` | push | `onClaudeSdkChunk` | `AgentChunkPayload` | 流式 token 块 |
| `claude-sdk:done` | push | `onClaudeSdkDone` | `AgentDonePayload` | 含完整 ChatResult |
| `claude-sdk:error` | push | `onClaudeSdkError` | `AgentErrorPayload` | — |

---

## 八、可信度评估域（Credibility）

### 8.1 invoke 通道

| 通道名 | Preload API | 参数 | 返回值 | 备注 |
|--------|-------------|------|--------|------|
| `credibility:assess` | `credibilityAssess` | `(inputs: CredibilityEvidenceInput[])` | `Promise<ConfidenceAssessment>` | 🔥 v2.4 Phase C：底层 `fuseAndAssess` 已支持 `applyCalibration` 选项；当前 IPC handler 尚未透传该选项，校准字段（`calibratedConfidence` / `eceReport`）暂不返回 |
| `credibility:dag` | `credibilityDag` | `(inputs)` | `Promise<DagData>` | React Flow 渲染 |
| `credibility:export-audit-report` | `credibilityExportAuditReport` | `(input: AuditReportInput, options?: ExportOptions)` | `Promise<ExportResult>` | v0.9.6 P2，EU AI Act / NIST AI RMF 合规报告 |
| `credibility:list-audit-reports` | `credibilityListAuditReports` | `(outputDir?)` | `Promise<AuditReportListItem[]>` | 扫描 `{userData}/audit-reports/` |
| `credibility:load-audit-report` | `credibilityLoadAuditReport` | `(filepath)` | `Promise<ComplianceAuditReport>` | 从 JSON 重建报告 |
| `credibility:format-audit-report` | `credibilityFormatAuditReport` | `(input, format: AuditFormat)` | `Promise<string>` | 仅格式化不落盘 |
| `credibility:export-decision-html` | `credibilityExportAudit` | `(decisionId, format)` | `Promise<string>` | v2.3.2 简化导出 |

### 8.2 v2.4 Phase C 恢复的校准模块（**尚未通过 IPC 暴露**）

`src/main/core/agent/credibility/calibration/` 已恢复以下类型与实现，但 `CalibrationChannelMap` 中定义的 6 个 IPC 通道（`credibility:calibrate` / `get-calibration` / `get-calibration-state` / `reset-calibration` / `compute-ece` / `add-calibration-sample`）**尚未在主进程 `ipcMain.handle` 中注册，也未在 preload 中暴露**：

- `types.ts`：`EceResult` / `BucketStats` / `TemperatureScalingResult` / `ProviderCalibration` / `CalibrationState` / `OptimizeTOptions` / `CalibrationSample` / `CalibrationChannelMap`
- `ece.ts`：ECE（Expected Calibration Error）+ MCE 计算
- `temperature-scaling.ts`：T ∈ R+ 优化（NLL 最小化）
- `calibration-tuner.ts`：Provider-aware 校准调优器（`getCalibrationTuner()` 单例）

**FusionEngine 集成状态**：`fuseAndAssess(massFunctions, options?: FuseAssessOptions)` 接受 `applyCalibration?: boolean` + `providerId?: string`；当二者均提供时，会填充 `ConfidenceAssessment.calibratedConfidence` 与 `eceReport`。

---

## 九、知识库域（KNOWLEDGE）

| 通道名 | Preload API | 参数 | 返回值 | 备注 |
|--------|-------------|------|--------|------|
| `kb:search` | `kbSearch` | `(query, type, limit)` | `Promise<unknown[]>` | 🔥 v2.4 Phase A：执行后调用 `recordToolCall('知识库检索')` |
| `kb:add` | `kbAdd` | `(entry)` | `Promise<boolean>` | — |
| `kb:update` | `kbUpdate` | `(id, entry)` | `Promise<boolean>` | — |
| `kb:delete` | `kbDelete` | `(id)` | `Promise<boolean>` | — |
| `kb:export` | `kbExport` | `(type)` | `Promise<string>` | — |
| `kb:get` | `kbGet` | `(id)` | `Promise<unknown>` | 未找到返回 null |
| `kb:import` | `kbImport` | `(data: string)` | `Promise<number>` | — |
| `kb:view` | `kbView` | `(id)` | `Promise<boolean>` | 记录浏览 |
| `kb:hot` | `kbHot` | `(limit?)` | `Promise<unknown[]>` | 热门知识 |
| `kb:recent-views` | `kbRecentViews` | `(limit?)` | `Promise<unknown[]>` | 最近浏览 |

---

## 十、决策历史域（HISTORY）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `history:list` | `historyList` | `(offset, limit)` | `Promise<unknown[]>` |
| `history:get` | `historyGet` | `(id)` | `Promise<unknown>` |
| `history:save` | `historySave` | `(card: DecisionCard)` | `Promise<boolean>` |
| `history:stats` | `historyStats` | 无 | `Promise<unknown>` |

---

## 十一、循环工程域（LOOP）

### 11.1 invoke 通道

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `loop:start` | `loopStart` | `({problem, connId, providerId?, strength?})` | `Promise<{correlationId, status, error?}>` |
| `loop:confirm` | `loopConfirm` | `(correlationId, approved, newCommand?)` | `Promise<boolean>` |
| `loop:cancel` | `loopCancel` | `(correlationId)` | `Promise<boolean>` |

### 11.2 push 通道

| 通道名 | Preload API | 载荷说明 |
|--------|-------------|----------|
| `loop:llm-start` | `onLoopLlmStart` | LLM 推理开始 |
| `loop:llm-done` | `onLoopLlmDone` | LLM 推理完成（含 hypothesis/fixCommand/confidence） |
| `loop:step` | `onLoopStep` | 7 步 HITL 步骤变更（collect→analyze→reason→check→confirm→execute→verify） |
| `loop:decision` | `onLoopDecision` | 决策卡片就绪，等待用户确认 |
| `loop:done` | `onLoopDone` | 工作流完成 |
| `loop:error` | `onLoopError` | 工作流出错 |
| `loop:blocked` | `onLoopBlocked` | 工作流被阻止（如 SSH 未连接） |

---

## 十二、日志域（LOG）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `log:read` | `logRead` | `(filter?)` | `Promise<unknown[]>` |
| `log:stats` | `logStats` | 无 | `Promise<{total, byLevel, byCategory, oldestTs, newestTs}>` |
| `log:clearBuffer` | `logClearBuffer` | 无 | `Promise<boolean>` |
| `log:setMinLevel` | `logSetMinLevel` | `(level)` | `Promise<boolean>` |
| `log:flush` | `logFlush` | 无 | `Promise<boolean>` |
| `log:renderer` | `logRenderer` | `({level, category, message, meta?, correlationId?})` | `Promise<boolean>` |

---

## 十三、诊断域（DIAGNOSTICS）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `diagnostics:get-report` | `diagnosticsGetReport` | 无 | `Promise<{ok, data?, error?}>` |
| `diagnostics:get-logs` | `diagnosticsGetLogs` | `(options?)` | `Promise<{ok, data?, total?, error?}>` |
| `diagnostics:get-findings` | `diagnosticsGetFindings` | `(options?)` | `Promise<{ok, data?, total?, error?}>` |
| `diagnostics:get-stats` | `diagnosticsGetStats` | 无 | `Promise<{ok, data?, error?}>` |
| `diagnostics:clear` | `diagnosticsClear` | 无 | `Promise<{ok, error?}>` |
| `diagnostics:set-enabled` | `diagnosticsSetEnabled` | `(enabled)` | `Promise<{ok, error?}>` |
| `diagnostics:ingest-test` | `diagnosticsIngestTest` | `(event)` | `Promise<{ok, error?}>` |

**push 通道**：`diagnostics:log-batch`（`onDiagnosticsLogBatch`）— 批量推送日志事件数组。

---

## 十四、Sidecar 域

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `sidecar:start` | `sidecarStart` | 无 | `Promise<{ok, status, error?}>` |
| `sidecar:stop` | `sidecarStop` | 无 | `Promise<{ok}>` |
| `sidecar:status` | `sidecarStatus` | 无 | `Promise<{status, lastError, restartCount}>` |
| `sidecar:health` | `sidecarHealth` | 无 | `Promise<{ok, error?, status?, version?, adapters?, uptime_seconds?}>` |
| `sidecar:list-status` | `sidecarListStatus` | 无 | `Promise<SidecarListStatusResponse>` |
| `sidecar:start-one` | `sidecarStartOne` | `(sidecarId)` | `Promise<{ok, status, error?}>` |
| `sidecar:stop-one` | `sidecarStopOne` | `(sidecarId)` | `Promise<{ok}>` |
| `sidecar:health-one` | `sidecarHealthOne` | `(sidecarId)` | `Promise<SidecarHealthOneResponse>` |
| `sidecar:tool-call` | `sidecarToolCall` | `(sidecarId, endpoint, payload)` | `Promise<{ok, data?, error?}>` |
| `sidecar:parse-logs` | `sidecarParseLogs` | `(logLines, maxClusters?)` | `Promise<{ok, data?, error?}>` |
| `sidecar:pipeline` | `sidecarPipeline` | `(logLines, serviceName?, llmConfig?)` | `Promise<{ok, data} \| {ok:false, error}>` |

---

## 十五、沙箱域（SANDBOX）

| 通道名 | Preload API | 参数 | 返回值 | 备注 |
|--------|-------------|------|--------|------|
| `sandbox:detect-docker` | `sandboxDetectDocker` | 无 | `Promise<DockerInfo>` | — |
| `sandbox:start` | `sandboxStart` | 无 | `Promise<{success:true} \| SandboxErrorResponse>` | 启动 OpenHands 容器 |
| `sandbox:stop` | `sandboxStop` | 无 | `Promise<{success:true} \| SandboxErrorResponse>` | — |
| `sandbox:status` | `sandboxStatus` | 无 | `Promise<SandboxHealthStatus>` | — |
| `sandbox:create` | `sandboxCreate` | `(sandboxSpecId?)` | `Promise<SandboxInfo \| SandboxErrorResponse>` | — |
| `sandbox:list` | `sandboxList` | `(limit?)` | `Promise<SandboxPage \| SandboxErrorResponse>` | — |
| `sandbox:execute` | `sandboxExecute` | `(sandboxId, command)` | `Promise<SandboxCommandResult \| SandboxErrorResponse>` | HC-6 强制审批 |
| `sandbox:approve` | `sandboxApprove` | `(callId, approved)` | `Promise<boolean>` | 30 秒未响应自动拒绝 |
| `sandbox:delete` | `sandboxDelete` | `(sandboxId)` | `Promise<{success:true} \| SandboxErrorResponse>` | 不可逆 |

**push 通道**：`sandbox:approval-request`（`onSandboxApprovalRequest`）— 推送 `SandboxApprovalRequest`。

---

## 十六、MCP 域

### 16.1 内部 MCP 状态机

| 通道名 | 方向 | Preload API | 参数 / 载荷 | 返回值 |
|--------|------|-------------|-------------|--------|
| `mcp:get-state` | invoke | `mcpGetState` | 无 | `Promise<McpStateContext>` |
| `mcp:reset` | invoke | `mcpReset` | 无 | `Promise<boolean>` |
| `mcp:state-changed` | push | `mcpStateChanged` | `McpStateContext` | 5 阶段：connected/degraded/recovering/failed/backoff |

### 16.2 外部 MCP 服务器

| 通道名 | 方向 | Preload API | 参数 | 返回值 |
|--------|------|-------------|------|--------|
| `mcp:external-status` | invoke | `mcpExternalStatus` | 无 | `Promise<ExternalMcpServerStatus[]>` |
| `mcp:external-tools` | invoke | `mcpExternalTools` | 无 | `Promise<Array<{name, description, serverId, serverName}>>` |
| `mcp:external-reconnect` | invoke | `mcpExternalReconnect` | `(serverId)` | `Promise<boolean>` |
| `mcp:external-call` | invoke | `mcpExternalCall` | `(serverId, toolName, args)` | `Promise<{success, content, error?}>` |

---

## 十七、教程域（TUTORIAL）

| 通道名 | Preload API | 参数 | 返回值 | 备注 |
|--------|-------------|------|--------|------|
| `tutorial:list` | `tutorialList` | `(category?)` | `Promise<TutorialEntry[]>` | — |
| `tutorial:get` | `tutorialGet` | `(id)` | `Promise<TutorialEntry \| null>` | — |
| `tutorial:search` | `tutorialSearch` | `(query, limit?)` | `Promise<TutorialEntry[]>` | Jaccard 关键词搜索 |
| `tutorial:hybrid-search` | `tutorialHybridSearch` | `(query, options?)` | `Promise<HybridSearchResult[]>` | v0.9.6 FTS5 + vec0 + RRF |
| `tutorial:categories` | `tutorialCategories` | 无 | `Promise<TutorialCategorySummary[]>` | — |
| `tutorial:seedVersion` | `tutorialSeedVersion` | 无 | `Promise<string>` | — |
| `tutorial:seedReload` | `tutorialSeedReload` | 无 | `Promise<number>` | — |
| `tutorial:listSources` | `tutorialListSources` | 无 | `Promise<TutorialSourceSpec[]>` | — |
| `tutorial:crawlStart` | `tutorialCrawlStart` | `(args?)` | `Promise<{success, error?, results}>` | — |
| `tutorial:crawlStatus` | `tutorialCrawlStatus` | 无 | `Promise<CrawlStatus>` | — |
| `tutorial:crawlCancel` | `tutorialCrawlCancel` | 无 | `Promise<{success}>` | — |
| `tutorial:diskInfo` | `tutorialDiskInfo` | 无 | `Promise<{...}>` | — |
| `tutorial:cleanupOrphans` | `tutorialCleanupOrphans` | 无 | `Promise<{success, cleanedBytes}>` | — |
| `tutorial:checkpoints` | `tutorialCheckpoints` | 无 | `Promise<Array<...>>` | — |
| `tutorial:resetCheckpoint` | `tutorialResetCheckpoint` | `(sourceId)` | `Promise<{success}>` | — |
| `tutorial:search-status` | `tutorialSearchStatus` | 无 | `Promise<TutorialSearchStatus>` | — |
| `tutorial:backfill-embeddings` | `tutorialBackfillEmbeddings` | `(options?)` | `Promise<TutorialBackfillResult>` | 同步阻塞版（旧，保留向后兼容，内部委托给 `EmbeddingBackfillService.start()` 同步等待） |
| `tutorial:backfill-start` | `tutorialBackfillStart` | `(options?: BackfillStartOptions)` | `Promise<BackfillStartResult>` | 🚀 v2.5 Phase C：异步启动回填，立即返回 taskId，不阻塞 UI |
| `tutorial:backfill-cancel` | `tutorialBackfillCancel` | 无 | `Promise<BackfillCancelResult>` | 🚀 v2.5 Phase C：取消正在运行的回填（标记 cancelled，下页检查退出） |
| `tutorial:backfill-status` | `tutorialBackfillStatus` | 无 | `Promise<BackfillStatusResult>` | 🚀 v2.5 Phase C：查询当前回填状态（running + taskId） |
| `tutorial:recommend-path` | `tutorialRecommendPath` | `(options?)` | `Promise<TutorialPath[]>` | 4 层融合推荐 |
| `tutorial:stats` | `tutorialStats` | 无 | `Promise<unknown>` | — |
| `tutorial:progress` | `tutorialProgress` | 无 | `Promise<unknown[]>` | v2.3.2 跨设备同步 |
| `tutorial:updateProgress` | `tutorialUpdateProgress` | `(tutorialId, status, progress)` | `Promise<boolean>` | v2.3.2 |

**push 通道**：
- `tutorial:crawlProgress`（`onTutorialCrawlProgress`）
- `tutorial:crawlDone`（`onTutorialCrawlDone`）
- 🚀 `tutorial:backfill-progress`（`onTutorialBackfillProgress`）：v2.5 Phase C 新增，回填进度推送（主 → 渲染），每页（pageSize=100）完成后触发一次，任务结束时推送最终状态。

### 17.1 🚀 v2.5 异步回填通道详解（Phase C）

**背景**：2578 条教程首次回填需 1-3 分钟，旧版同步通道 `tutorial:backfill-embeddings` 会阻塞 UI。新通道启动后立即返回 taskId，渲染层通过 `onTutorialBackfillProgress` 订阅进度推送，实现非阻塞 UI + 进度条 + 取消能力。

**类型定义**（`src/shared/tutorial-types.ts`）：

```typescript
/** 回填任务状态 */
export type BackfillStatus = 'running' | 'completed' | 'cancelled' | 'failed'

/** tutorial:backfill-progress 通道的载荷（主 → 渲染 push） */
export interface BackfillProgress {
  taskId: string
  processed: number
  total: number
  failed: number
  pct: number          // 0-1
  currentBatch: number
  eta: number          // 剩余 ms（估算）
  status: BackfillStatus
  error?: string
}

/** tutorial:backfill-start 通道的参数 */
export interface BackfillStartOptions {
  pageSize?: number       // 默认 100，每次查询 100 条进行推理
  inferenceBatch?: number // 默认 8，ONNX 内部 batching
}

/** tutorial:backfill-start 通道的返回值 */
export interface BackfillStartResult {
  ok: boolean
  taskId: string          // ok=true 时非空
  error?: string
}

/** tutorial:backfill-cancel 通道的返回值 */
export interface BackfillCancelResult {
  ok: boolean
}

/** tutorial:backfill-status 通道的返回值 */
export interface BackfillStatusResult {
  running: boolean
  taskId: string | null   // running=true 时非空
}
```

**UI 调用示例**：

```typescript
// 启动异步回填
const { ok, taskId } = await window.electronAPI.tutorialBackfillStart()
if (ok) {
  // 订阅进度推送
  const unsub = window.electronAPI.onTutorialBackfillProgress((p) => {
    setProgress(p.pct)  // 0-1
    setEta(p.eta)       // 剩余 ms
    if (p.status === 'completed' || p.status === 'cancelled' || p.status === 'failed') {
      unsub()  // 任务结束时取消订阅
    }
  })
}

// 取消回填（可选）
await window.electronAPI.tutorialBackfillCancel()

// 查询状态（可选，用于页面刷新后恢复 UI）
const { running, taskId } = await window.electronAPI.tutorialBackfillStatus()
```

**进度推送频率**：2578 条 / 100 页 ≈ 26 次推送，避免过细推送导致渲染卡顿。

**断点续传**：分页查询 `WHERE embedding IS NULL` 自动跳过已处理记录，任务中断后重启不会重复处理。

**单例守卫**：`EmbeddingBackfillService.getInstance().isRunning()` 防止并发启动，已在运行的回填会返回 `{ ok: false, error: '已有回填任务在运行' }`。

---

## 十八、部署域（DEPLOY）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `deploy:listTemplates` | `deployListTemplates` | 无 | `Promise<DeployTemplate[]>` |
| `deploy:getTemplate` | `deployGetTemplate` | `(id)` | `Promise<DeployTemplate \| null>` |
| `deploy:validate` | `deployValidate` | `(templateId, values)` | `Promise<string[]>`（错误列表） |
| `deploy:build` | `deployBuild` | `(templateId, values, targetHost)` | `Promise<{plan?, errors}>` |
| `deploy:execute` | `deployExecute` | `(plan, sessionId)` | `Promise<DeployResult>` |
| `deploy:cancel` | `deployCancel` | `(planId)` | `Promise<boolean>` |
| `deploy:getStatus` | `deployGetStatus` | `(planId)` | `Promise<{status, currentIndex, total} \| null>` |

**push 通道**：`deploy:log`、`deploy:stepUpdate`、`deploy:done`。

---

## 十九、Profiler 域

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `profiler:run` | `profilerRun` | `(sessionId, host)` | `Promise<ProfilerRunResponse>` |
| `profiler:exportMd` | `profilerExportMd` | `(md, outputPath)` | `Promise<{filePath, size}>` |
| `profiler:exportPdf` | `profilerExportPdf` | `(md, outputPath)` | `Promise<{filePath, size}>` |
| `profiler:defaultFileName` | `profilerDefaultFileName` | `(host, ext)` | `Promise<string>` |

---

## 二十、AT 命令域（AT_COMMANDS）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `at:list` | `atList` | 无 | `Promise<AtCommandInfo[]>` |
| `at:resolve` | `atResolve` | `(type, args, source?, userId?)` | `Promise<AtCommand>` |
| `at:parse` | `atParse` | `(text, source?, userId?)` | `Promise<AtCommandParseResult>` |

---

## 二十一、Token 统计域（TOKEN）

| 通道名 | Preload API | 参数 | 返回值 | 备注 |
|--------|-------------|------|--------|------|
| `token:stats` | `tokenStats` | 无 | `Promise<TokenStats>` | 当日/当周/当月/总 + 按子 Agent / Provider 分布 |
| `token:reset` | `tokenReset` | 无 | `Promise<boolean>` | 清空所有记录 |
| `token:records` | `tokenRecords` | `(limit?)` | `Promise<TokenUsageRecord[]>` | 默认 100，上限 1000 |
| `token:cost-stats` | `tokenCostStats` | 无 | `Promise<CostStats>` | v0.9.5 P0，USD 成本聚合 |

---

## 二十二、模型统计域（MODEL_STATS）🔥 v2.4 Phase A 重点

| 通道名 | Preload API | 参数 | 返回值 | 数据源 | 备注 |
|--------|-------------|------|--------|--------|------|
| `model:toolCalls` | `modelToolCalls` | 无 | `Promise<ToolCallStat[]>` | `tool_call_log` 表 | 🔥 v2.4 Phase A：表已有真实写入，按工具名聚合 count + percent（count 降序） |

**返回结构**：
```typescript
interface ToolCallStat {
  name: string       // 工具名称（如「终端命令执行」/「知识库检索」）
  count: number      // 调用次数
  percent: number    // 占比 [0, 100]，所有行 percent 之和 = 100
}
```

**降级**：数据库不可用时返回空数组（前端显示"暂无数据"）。

---

## 二十三、预算告警域（BUDGET）🔥 v2.4 Phase B 重点

| 通道名 | Preload API | 参数 | 返回值 | 数据源 | 备注 |
|--------|-------------|------|--------|--------|------|
| `budget:alerts` | `budgetAlerts` | `(limit?)` | `Promise<BudgetAlert[]>` | `budget_alerts` 表 | 🔥 v2.4 Phase B：表已有真实写入，按 timestamp 降序，limit 默认 20，上限 100 |

**返回结构**：
```typescript
interface BudgetAlert {
  level: 'alert' | 'error'  // 告警级别
  text: string              // 告警文本
  timestamp: number         // 告警时间（ms 时间戳）
}
```

**当前写入点**（`src/main/services/llm/budget-alerter.ts`）：

| 触发函数 | 触发条件 | level |
|----------|----------|-------|
| `alertLlmSlowResponse(method, durationMs)` | LLM 响应 > 5000ms | `alert` |
| `alertLlmFailure(method, error)` | LLM 连续失败 ≥ 3 次 | `error` |
| `alertTokenBudgetExceeded(currentCost, threshold, dimension)` | Token 成本超阈值（当日去重） | `alert` |

---

## 二十四、Provider 域（PROVIDER + Provider Info）

### 24.1 Provider 配置 CRUD

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `provider:list` | `providerList` | `(onlyEnabled?)` | `Promise<PersistedProviderConfig[]>` |
| `provider:get` | `providerGet` | `(id)` | `Promise<PersistedProviderConfig \| null>` |
| `provider:save` | `providerSave` | `(config: ProviderConfig)` | `Promise<boolean>` |
| `provider:set-default` | `providerSetDefault` | `(id)` | `Promise<boolean>` |

### 24.2 Provider 能力 + 定价（v0.9.5 P0 组 5）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `provider:capabilities` | `providerCapabilities` | `({providerId})` | `Promise<ProviderCapabilitiesResponse>` |
| `provider:capabilities-all` | `providerCapabilitiesAll` | 无 | `Promise<ProviderCapabilitiesAllResponse>` |
| `provider:pricing` | `providerPricing` | `({providerId})` | `Promise<ProviderPricingResponse>` |
| `provider:pricing-all` | `providerPricingAll` | 无 | `Promise<ProviderPricingAllResponse>` |

---

## 二十五、Mode 域（v0.9.5 P0 组 2）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `mode:list` | `modeList` | 无 | `Promise<ModeListResponse>`（5 个 mode：chat/ask/plan/code/debug，不含 systemPrompt） |
| `mode:set-default` | `modeSetDefault` | `(request: ModeSetDefaultRequest)` | `Promise<ModeSetDefaultResponse>` |
| `mode:get-current` | `modeGetCurrent` | 无 | `Promise<ModeCurrentResponse>` |

---

## 二十六、Attention 注意力域（v0.9.5 P0 组 3）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `attention:current` | `attentionCurrent` | 无 | `Promise<AttentionFocus>` |
| `attention:history` | `attentionHistory` | 无 | `Promise<AttentionFocus[]>` |
| `attention:track-files` | `attentionTrackFiles` | `(files: string[])` | `Promise<boolean>` |
| `attention:track-commands` | `attentionTrackCommands` | `(commands: string[])` | `Promise<boolean>` |
| `attention:track-errors` | `attentionTrackErrors` | `(errors: string[])` | `Promise<boolean>` |
| `attention:track-keywords` | `attentionTrackKeywords` | `(keywords: string[])` | `Promise<boolean>` |
| `attention:reset` | `attentionReset` | 无 | `Promise<boolean>` |

---

## 二十七、Subagent 域（v0.9.5 P0 组 4）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `subagent:list` | `subagentList` | 无 | `Promise<CustomAgentConfig[]>` |
| `subagent:reload` | `subagentReload` | `(request?: SubagentReloadRequest)` | `Promise<SubagentReloadResponse>` |

---

## 二十八、Expectation 域（v0.9.4 批次 4 P2-E）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `expectation:check` | `expectationCheck` | `(expectation, actualOutput, actualExitCode)` | `Promise<ExpectationCheckResult>` |
| `expectation:format` | `expectationFormat` | `(violations: ExpectationViolation[])` | `Promise<string>` |

---

## 二十九、Task Protocol 审批域（TASK）

| 通道名 | 方向 | Preload API | 参数 / 载荷 | 备注 |
|--------|------|-------------|-------------|------|
| `task:permission-approve` | invoke | `taskPermissionApprove` | `(callId, decision: TaskPermissionDecision)` | 30 秒未响应自动拒绝 |
| `task:permission-approval-request` | push | `onTaskPermissionApprovalRequest` | `TaskPermissionApprovalRequest` | task-protocol step 2 check-permission 推送 |

---

## 三十、Promptfoo 域

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `promptfoo:run-red-team` | `promptfooRunRedTeam` | `(modelProvider?)` | `Promise<{ok, data?, error?}>` |
| `promptfoo:run-eval` | `promptfooRunEval` | `(modelProvider?)` | `Promise<{ok, data?, error?}>` |
| `promptfoo:list-tests` | `promptfooListTests` | 无 | `Promise<{ok, data?, error?}>` |

---

## 三十一、调度器域（SCHEDULER，Phase 6 Task 6.5）

| 通道名 | 方向 | Preload API | 参数 / 载荷 | 返回值 |
|--------|------|-------------|-------------|--------|
| `scheduler:list` | invoke | `schedulerList` | 无 | `Promise<SchedulerTaskStatus[]>`（3 个任务：daily-health-check / daily-decision-archive / weekly-ops-report） |
| `scheduler:toggle` | invoke | `schedulerToggle` | `(taskId, enabled)` | `Promise<SchedulerTaskStatus \| null>` |
| `scheduler:trigger` | invoke | `schedulerTrigger` | `(taskId)` | `Promise<TaskResult>` |
| `scheduler:status` | push | `onSchedulerStatusChange` | `SchedulerTaskStatus` | 任务执行后主动推送 |

---

## 三十二、安全存储 + 配置 + 服务器域

### 32.1 安全存储（STORAGE）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `storage:saveApiKey` | `storageSaveApiKey` | `(provider, key)` | `Promise<boolean>` |
| `storage:getApiKey` | `storageGetApiKey` | `(provider)` | `Promise<string \| null>` |
| `storage:deleteApiKey` | `storageDeleteApiKey` | `(provider)` | `Promise<boolean>` |

### 32.2 配置存储（CONFIG）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `config:get` | `configGet` | `(key)` | `Promise<unknown>` |
| `config:set` | `configSet` | `(key, value)` | `Promise<boolean>` |

### 32.3 服务器配置（SERVER）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `server:list` | `serverList` | 无 | `Promise<SshConfig[]>` |
| `server:save` | `serverSave` | `(servers: SshConfig[])` | `Promise<boolean>` |
| `server:export` | `serverExport` | 无 | `Promise<string>`（脱敏 JSON） |
| `server:import` | `serverImport` | `(json: string)` | `Promise<SshConfig[]>` |
| `server:delete-cred` | `serverDeleteCred` | `(serverId)` | `Promise<boolean>` |

---

## 三十三、系统 / 应用更新 / 文件系统域

### 33.1 系统（SYSTEM）

| 通道名 | Preload API | 参数 | 返回值 | 备注 |
|--------|-------------|------|--------|------|
| `system:ping` | `systemPing` | 无 | `Promise<{ok, timestamp, protocolVersion}>` | 协议版本：`0.9.4` |
| — | `getProtocolVersion` | 无 | `string`（同步常量） | 直接 import `IPC_PROTOCOL_VERSION` |

### 33.2 应用更新（APP，v2.2 P1 #24）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `app:check-update` | `appCheckUpdate` | 无 | `Promise<AppUpdateInfo \| {hasUpdate:false, error}>` |
| `app:download-update` | `appDownloadUpdate` | `(releaseUrl?)` | `Promise<boolean>`（打开浏览器） |
| `app:get-info` | `appGetInfo` | 无 | `Promise<{version, installPath, buildTime, buildBadge}>` |
| `app:export-model-stats` | `appExportModelStats` | `(stats)` | `Promise<{filePath, size}>` |

### 33.3 文件系统（FS，v2.2 P1 #22）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `fs:upload-image` | `fsUploadImage` | 无 | `Promise<{success, dataUrl, fileName, fileSize, mimeType} \| {success:false, error}>` |

---

## 三十四、风险 + 告警 + 启动域

### 34.1 风险评估（RISK，M2 Task 2）

| 通道名 | Preload API | 参数 | 返回值 |
|--------|-------------|------|--------|
| `risk:check` | `riskCheck` | `(command: string)` | `Promise<{risk: 'low'\|'medium'\|'high', reasons: string[]}>`（桥接 `assessCommandRisk`，AST 优先 + 正则降级） |

### 34.2 告警确认（ALERT，M3 Task 2）

| 通道名 | Preload API | 参数 | 返回值 | 备注 |
|--------|-------------|------|--------|------|
| `alert:ack` | `alertAck` | `(alertId: string)` | `Promise<boolean>` | 主进程内存 Map 记录 ack 状态，重启后重置（不持久化） |

### 34.3 启动加载（BOOT，M5 Task 3）

| 通道名 | 方向 | Preload API | 载荷 | 阶段值 |
|--------|------|-------------|------|--------|
| `boot:loading-stage` | push | `onBootLoadingStage` | `{stage, progress, message}` | `ipc-ready` / `sqlite-init` / `kb-indexed` / `done` |

---

## 附录 A：v2.4 Phase A/B/C 完成度速查

| Phase | 任务 | 状态 | 证据 |
|-------|------|------|------|
| **A** | `tool_call_log` 表已建 | ✅ | `model-stats.ts` 查询正常 |
| **A** | `recordToolCall` 在 `ssh:exec` 写入 | ✅ | `src/main/ipc/ssh.ts:277` |
| **A** | `recordToolCall` 在 `kb:search` 写入 | ✅ | `src/main/ipc/knowledge.ts:61` |
| **A** | `recordToolCall` 在 LLM 工具注册表写入 | ✅ | `src/main/services/llm/tools/registry.ts:93` |
| **B** | `budget_alerts` 表已建 | ✅ | `model-stats.ts` 查询正常 |
| **B** | `recordBudgetAlert` 通过 `budget-alerter.ts` 写入 | ✅ | 3 个触发器：`alertLlmSlowResponse` / `alertLlmFailure` / `alertTokenBudgetExceeded` |
| **C** | `calibration/` 目录已恢复 | ✅ | `types.ts` / `ece.ts` / `temperature-scaling.ts` / `calibration-tuner.ts` |
| **C** | `fusion-engine.ts` 集成 `applyCalibration` 选项 | ✅ | `FuseAssessOptions.applyCalibration` / `result.calibratedConfidence` / `result.eceReport` |
| **C** | `credibility:assess` IPC 透传 `applyCalibration` | ❌ | handler 当前未读取 options 参数透传给 `fuseAndAssess` |
| **C** | 校准 IPC 通道（`credibility:calibrate` 等 6 个）注册 | ❌ | `CalibrationChannelMap` 已定义但 `ipcMain.handle` 未注册 |
| **C** | 校准 IPC 通道在 preload 暴露 | ❌ | preload 未暴露 `credibilityCalibrate` 等方法 |

---

## 附录 B：通道总数统计

| 域 | invoke | push | 合计 |
|----|--------|------|------|
| SSH | 11 | 3 | 14 |
| SFTP | 10 | 0 | 10 |
| SFTP_SEARCH | 2 | 0 | 2 |
| FILE_WATCH | 2 | 1 | 3 |
| MONITOR | 3 | 2 | 5 |
| LLM | 7 | 6 | 13 |
| LLM_INLINE | 4 | 0 | 4 |
| AGENT | 7 | 4 | 11 |
| CLAUDE_SDK | 3 | 3 | 6 |
| CREDIBILITY | 7 | 0 | 7 |
| KNOWLEDGE | 10 | 0 | 10 |
| HISTORY | 4 | 0 | 4 |
| LOOP | 3 | 7 | 10 |
| LOG | 6 | 0 | 6 |
| DIAGNOSTICS | 7 | 1 | 8 |
| SIDECAR | 11 | 0 | 11 |
| SANDBOX | 9 | 1 | 10 |
| MCP（含 external） | 6 | 1 | 7 |
| TUTORIAL | 24 | 3 | 27 |
| DEPLOY | 7 | 3 | 10 |
| PROFILER | 4 | 0 | 4 |
| AT_COMMANDS | 3 | 0 | 3 |
| TOKEN | 4 | 0 | 4 |
| MODEL_STATS | 1 | 0 | 1 |
| BUDGET | 1 | 0 | 1 |
| PROVIDER | 8 | 0 | 8 |
| MODE | 3 | 0 | 3 |
| ATTENTION | 7 | 0 | 7 |
| SUBAGENT | 2 | 0 | 2 |
| EXPECTATION | 2 | 0 | 2 |
| TASK | 1 | 1 | 2 |
| PROMPTFOO | 3 | 0 | 3 |
| SCHEDULER | 3 | 1 | 4 |
| STORAGE / CONFIG / SERVER | 10 | 0 | 10 |
| SYSTEM / APP / FS | 6 | 0 | 6 |
| RISK / ALERT / BOOT | 2 | 1 | 3 |
| **合计** | **≈ 197** | **≈ 38** | **≈ 235** |

> 说明：部分 push 通道（如 `mcp:state-changed`、`paor:approval-request`）使用字面量字符串未集中到 `ipc-channels.ts`，本表按实际注册统计。
> v2.5 变更：TUTORIAL 域新增 3 个 invoke（backfill-start/cancel/status）+ 1 个 push（backfill-progress），合计 +4 通道。

---

## 附录 C：v2.5 循环工程完成度速查 🚀

| Phase | 任务 | 状态 | 证据 |
|-------|------|------|------|
| **P1-8** | `rollback-generator.ts` 18 条规则 + 5 不可逆黑名单 | ✅ | `src/main/services/security/rollback-generator.ts` 存在，38 测试全绿 |
| **P1-8** | `sandbox-approval.ts` 集成 `generateRollbackCommand` | ✅ | `src/main/ipc/sandbox-approval.ts` import 并委托 |
| **C** | `EmbeddingBackfillService` 单例 + 分页 + 取消 | ✅ | `src/main/services/tutorial/backfill-service.ts` 存在，22 测试全绿 |
| **C** | `BACKFILL_START` / `BACKFILL_CANCEL` / `BACKFILL_STATUS` / `BACKFILL_PROGRESS` 常量 | ✅ | `src/shared/ipc-channels.ts:645-651` |
| **C** | 3 个 `ipcMain.handle` 注册 + push 推送 | ✅ | `src/main/ipc/tutorial.ts` |
| **C** | preload 暴露 4 个方法 | ✅ | `src/preload/index.ts:3387-3392` |
| **C** | `BackfillProgress` / `BackfillStartOptions` / 等类型 | ✅ | `src/shared/tutorial-types.ts` |
| **D1** | hybrid-search 注释测试迁移到 vitest | ✅ | `tests/services/tutorial/hybrid-search.test.ts` 18 用例 |
| **D2** | path-recommender 注释逻辑清理 | ✅ | `src/main/services/tutorial/path-recommender.ts` |
| **D3** | 8 个文件 xxx 占位替换为具体示例 | ✅ | logger / registry / redact / dispatcher / openhands-runner / ask-prompt / mode-registry / plan-prompt |
| **E** | v2.5 归档 + 交接文档 + CHANGELOG + 记忆 | ✅ | `docs/archive/v2.5-loop-engineering-archive/` + 本文档更新 |

**完成度**：11 项全部 ✅（v2.5 循环工程后端任务全部交付）

**前端待接入**：
- `TutorialPage` 接入 `tutorial:backfill-start` + `onTutorialBackfillProgress`（P3）
- 其他 v2.4 遗留前端待办详见 `frontend-backend-boundary.md` 第 8.3 节
