# UI 接入接线图 v0.9.5

> 生成时间：2026-07-19
> 范围：v0.9.0~v0.9.4 主进程 IPC ↔ 渲染层 UI 组件映射
> 目的：为 v0.9.5 渲染层 UI 集成提供接线蓝图
> 来源：v0.9.5-pre UI 接入准备 agent 全量盘点

## 概览统计

| 维度 | 数量 |
|---|---|
| 主进程 IPC 文件数 | 16 |
| IPC 通道总数（invoke + on push） | 89 |
| 已就绪 IPC（主进程已注册 + preload 已暴露 + d.ts 已声明） | 78 |
| main 层已实现但未暴露 IPC 的能力 | 11 |
| 渲染层文件消费 IPC 数 | 21 |
| 渲染层组件目录数 | 13 |
| Zustand store 数 | 9 |
| 已消费 IPC 数（去重） | 47 |
| 已就绪但 UI 未消费 IPC 数 | 31 |
| P0 级待补齐 IPC 数 | 5 |
| P1 级待补齐 IPC 数 | 6 |

---

## 一、主进程 IPC 通道全量清单

### 1.1 已就绪且已被 UI 消费的 IPC（绿色 ✅）

| 通道名 | 方向 | 参数 | 返回值 | 版本 | 消费组件 | 主进程文件 |
|---|---|---|---|---|---|---|
| `ssh:connect` | invoke | `(config: SshConfig)` | `Promise<string>` (sessionId) | v0.7 | ServerList, TerminalTabs, ConnectDialog | ipc/ssh.ts |
| `ssh:disconnect` | invoke | `(sessionId: string)` | `Promise<boolean>` | v0.7 | ServerList, TerminalTabs, ConnectDialog | ipc/ssh.ts |
| `ssh:shell:start` | invoke | `(sessionId: string)` | `Promise<boolean>` | v0.7 | ServerList, TerminalTabs | ipc/ssh.ts |
| `ssh:shell:write` | invoke | `(sessionId, data)` | `Promise<boolean>` | v0.7 | TerminalView | ipc/ssh.ts |
| `terminal:data` | on push | `(sessionId, data)` | - | v0.7 | TerminalView | ipc/ssh.ts |
| `monitor:start` | invoke | `(sessionId, interval)` | `Promise<boolean>` | v0.7 | ServerList, TerminalTabs | ipc/monitor.ts |
| `monitor:stop` | invoke | `(sessionId)` | `Promise<boolean>` | v0.7 | ServerList, TerminalTabs | ipc/monitor.ts |
| `monitor:data` | on push | `(sessionId, MonitorData)` | - | v0.7 | MonitorPanel | ipc/monitor.ts |
| `monitor:systemInfo` | on push | `(sessionId, SystemInfo)` | - | v0.7 | MonitorPanel | ipc/monitor.ts |
| `server:list` | invoke | - | `Promise<SshConfig[]>` | v0.7 | server-store | ipc/storage.ts |
| `server:save` | invoke | `(servers: SshConfig[])` | `Promise<boolean>` | v0.7 | server-store | ipc/storage.ts |
| `sftp:list` | invoke | `(sessionId, remotePath)` | `Promise<SftpEntry[]>` | v0.8 | FileTree | ipc/ssh.ts |
| `sftp:readFile` | invoke | `(sessionId, remotePath)` | `Promise<string>` | v0.8 | FileTree | ipc/ssh.ts |
| `sftp:writeFile` | invoke | `(sessionId, remotePath, content)` | `Promise<boolean>` | v0.8 | CodeEditor | ipc/ssh.ts |
| `llm:chat` | invoke | `(messages: ChatMessage[])` | `Promise<string>` | v0.5 | ChatPanel | ipc/llm.ts |
| `llm:test` | invoke | `(config: LlmConfig)` | `Promise<boolean>` | v0.5 | SettingsSections | ipc/llm.ts |
| `llm:chat-with-tools` | invoke | `(messages)` | `Promise<string>` | v0.5 | ChatPanel | ipc/llm-tools.ts |
| `llm:tool-approve` | invoke | `(ToolApprovalResponse)` | `Promise<boolean>` | v0.5 | ToolApprovalModal | ipc/llm-tools.ts |
| `agent:start` | invoke | `(sessionId, problem)` | `Promise<boolean>` | v0.8 | ChatPanel | ipc/agent.ts |
| `agent:confirm` | invoke | `(sessionId, approved)` | `Promise<boolean>` | v0.8 | ChatPanel | ipc/agent.ts |
| `agent:step` | on push | `(AgentWorkflowState)` | - | v0.8 | ChatPanel | ipc/agent.ts |
| `agent:chat` | invoke | `(messages, providerId?, strength?, sessionId?)` | `Promise<string>` (correlationId) | v0.9 | ChatPanel | ipc/agent-runtime.ts |
| `agent:chat:cancel` | invoke | `(sessionIdOrCorrelationId)` | `Promise<boolean>` | v0.9 / v0.9.4 | ChatPanel | ipc/agent-runtime.ts |
| `agent:chunk` | on push | `(AgentChunkPayload)` | - | v0.9 | ChatPanel | ipc/agent-runtime.ts |
| `agent:done` | on push | `(AgentDonePayload)` | - | v0.9 | ChatPanel, TokenMonitorPanel | ipc/agent-runtime.ts |
| `agent:error` | on push | `(AgentErrorPayload)` | - | v0.9 | ChatPanel | ipc/agent-runtime.ts |
| `provider:list` | invoke | `(onlyEnabled?)` | `Promise<PersistedProviderConfig[]>` | v0.9 | ChatPanel | ipc/agent-runtime.ts |
| `token:stats` | invoke | - | `Promise<TokenStats>` | v0.9 | ChatPanel, TokenMonitorPanel | ipc/agent-runtime.ts |
| `token:reset` | invoke | - | `Promise<boolean>` | v0.9 | TokenMonitorPanel | ipc/agent-runtime.ts |
| `at:list` | invoke | - | `Promise<AtCommandInfo[]>` | v0.9 | AtCommandPicker | ipc/at-commands.ts |
| `at:resolve` | invoke | `(type, args, source?, userId?)` | `Promise<AtCommand>` | v0.9 | useAtCommandInjection | ipc/at-commands.ts |
| `at:parse` | invoke | `(text, source?, userId?)` | `Promise<AtCommandParseResult>` | v0.9 | useAtCommandInjection | ipc/at-commands.ts |
| `credibility:assess` | invoke | `(CredibilityEvidenceInput[])` | `Promise<ConfidenceAssessment>` | v0.9 | CredibilityPanel | ipc/credibility.ts |
| `credibility:dag` | invoke | `(CredibilityEvidenceInput[])` | `Promise<DagData>` | v0.9 | CredibilityPanel | ipc/credibility.ts |
| `kb:search` | invoke | `(query, type?, limit?)` | `Promise<KnowledgeEntry[]>` | v0.5 | KnowledgePage | ipc/knowledge.ts |
| `kb:add` | invoke | `(entry)` | `Promise<boolean>` | v0.5 | KnowledgePage | ipc/knowledge.ts |
| `kb:update` | invoke | `(id, partial)` | `Promise<boolean>` | v0.5 | KnowledgePage | ipc/knowledge.ts |
| `kb:delete` | invoke | `(id)` | `Promise<boolean>` | v0.5 | KnowledgePage | ipc/knowledge.ts |
| `kb:import` | invoke | `(entries)` | `Promise<number>` | v0.5 | KnowledgePage | ipc/knowledge.ts |
| `kb:export` | invoke | `(type?)` | `Promise<KnowledgeEntry[]>` | v0.5 | KnowledgePage | ipc/knowledge.ts |
| `history:list` | invoke | `(page?, pageSize?)` | `Promise<DecisionCard[]>` | v0.5 | HistoryPage | ipc/history.ts |
| `history:get` | invoke | `(id)` | `Promise<DecisionCard \| null>` | v0.5 | HistoryPage | ipc/history.ts |
| `profiler:run` | invoke | `(sessionId, host)` | `Promise<ProfilerRunResponse>` | v0.7 | ProfilerDialog | ipc/profiler.ts |
| `profiler:defaultFileName` | invoke | `(host, ext)` | `Promise<string>` | v0.7 | ProfilerDialog | ipc/profiler.ts |
| `profiler:exportPdf` | invoke | `(md, outputPath)` | `Promise<{filePath, size}>` | v0.7 | ProfilerDialog | ipc/profiler.ts |
| `tutorial:list` | invoke | `(category?)` | `Promise<TutorialEntry[]>` | v0.6 | TutorialPage | ipc/tutorial.ts |
| `tutorial:get` | invoke | `(id)` | `Promise<TutorialEntry \| null>` | v0.6 | TutorialPage | ipc/tutorial.ts |
| `tutorial:categories` | invoke | - | `Promise<TutorialCategorySummary[]>` | v0.6 | TutorialPage | ipc/tutorial.ts |
| `tutorial:seedVersion` | invoke | - | `Promise<string>` | v0.6 | TutorialPage | ipc/tutorial.ts |
| `tutorial:seedReload` | invoke | - | `Promise<number>` | v0.6 | TutorialPage | ipc/tutorial.ts |
| `tutorial:listSources` | invoke | - | `Promise<TutorialSourceSpec[]>` | v0.6 | TutorialPage | ipc/tutorial.ts |
| `tutorial:crawlStatus` | invoke | - | `Promise<CrawlStatus>` | v0.6 | TutorialPage | ipc/tutorial.ts |
| `tutorial:crawlCancel` | invoke | - | `Promise<{success}>` | v0.6 | TutorialPage | ipc/tutorial.ts |
| `tutorial:crawlProgress` | on push | `(CrawlProgress)` | - | v0.6 | TutorialPage | ipc/tutorial.ts |
| `tutorial:crawlDone` | on push | `(CrawlResult)` | - | v0.6 | TutorialPage | ipc/tutorial.ts |
| `deploy:listTemplates` | invoke | - | `Promise<DeployTemplate[]>` | v0.7 | DeployDialog | ipc/deploy.ts |
| `deploy:build` | invoke | `(templateId, values, targetHost)` | `Promise<{plan?, errors}>` | v0.7 | DeployDialog | ipc/deploy.ts |
| `deploy:execute` | invoke | `(plan, sessionId)` | `Promise<DeployResult>` | v0.7 | DeployDialog | ipc/deploy.ts |
| `deploy:cancel` | invoke | `(planId)` | `Promise<boolean>` | v0.7 | DeployDialog | ipc/deploy.ts |
| `deploy:log` | on push | `(DeployLogEvent)` | - | v0.7 | DeployDialog | ipc/deploy.ts |
| `deploy:stepUpdate` | on push | `({planId, step})` | - | v0.7 | DeployDialog | ipc/deploy.ts |
| `deploy:done` | on push | `(DeployResult)` | - | v0.7 | DeployDialog | ipc/deploy.ts |
| `log:renderer` | invoke | `(payload)` | `Promise<boolean>` | v0.7 | utils/logger | ipc/log.ts |

### 1.2 已就绪但 UI 未消费的 IPC（黄色 ⚠️ — v0.9.5 待接入）

| 通道名 | 方向 | 参数 | 返回值 | 版本 | 建议消费组件 | 优先级 |
|---|---|---|---|---|---|---|
| `system:ping` | invoke | - | `Promise<SystemPingResponse>` | v0.9.4 | App.tsx 启动心跳 / 全局健康指示器 | P1 |
| `getProtocolVersion` | sync | - | `string` | v0.9.4 | App.tsx 启动版本校验 | P1 |
| `agentCancel` | invoke | `(sessionId)` | `Promise<{agentChat, claudeSdk}>` | v0.9.4 | ChatPanel 停止按钮（替换旧 agentChatCancel） | P0 |
| `provider:get` | invoke | `(id)` | `Promise<PersistedProviderConfig \| null>` | v0.9 | SettingsSections Provider 编辑 | P0 |
| `provider:save` | invoke | `(ProviderConfig)` | `Promise<boolean>` | v0.9 | SettingsSections Provider 保存 | P0 |
| `provider:set-default` | invoke | `(id)` | `Promise<boolean>` | v0.9 | SettingsSections 默认 Provider | P0 |
| `token:records` | invoke | `(limit?)` | `Promise<TokenUsageRecord[]>` | v0.9.1 | TokenMonitorPanel 明细列表 | P0 |
| `claude-sdk:generate` | invoke | `(providerId, params)` | `Promise<ChatResult>` | v0.9 | ChatPanel（claude-sdk 类型 Provider） | P0 |
| `claude-sdk:stream` | invoke | `(providerId, params)` | `Promise<string>` (correlationId) | v0.9 / v0.9.4 | ChatPanel（claude-sdk 类型 Provider） | P0 |
| `claude-sdk:cancel` | invoke | `(sessionIdOrCorrelationId)` | `Promise<boolean>` | v0.9 / v0.9.4 | ChatPanel 停止按钮 | P0 |
| `claude-sdk:chunk` | on push | `(AgentChunkPayload)` | - | v0.9 | ChatPanel 流式输出 | P0 |
| `claude-sdk:done` | on push | `(AgentDonePayload)` | - | v0.9 | ChatPanel 完成处理 | P0 |
| `claude-sdk:error` | on push | `(AgentErrorPayload)` | - | v0.9 | ChatPanel 错误处理 | P0 |
| `sandbox:detect-docker` | invoke | - | `Promise<DockerInfo>` | v0.9 | SandboxPanel（待新建） | P0 |
| `sandbox:start` | invoke | - | `Promise<{success} \| ErrorResponse>` | v0.9 | SandboxPanel | P0 |
| `sandbox:stop` | invoke | - | `Promise<{success} \| ErrorResponse>` | v0.9 | SandboxPanel | P0 |
| `sandbox:status` | invoke | - | `Promise<SandboxHealthStatus>` | v0.9 | SandboxPanel | P0 |
| `sandbox:create` | invoke | `(sandboxSpecId?)` | `Promise<SandboxInfo \| ErrorResponse>` | v0.9 | SandboxPanel | P0 |
| `sandbox:list` | invoke | `(limit?)` | `Promise<SandboxPage \| ErrorResponse>` | v0.9 | SandboxPanel | P0 |
| `sandbox:execute` | invoke | `(sandboxId, command)` | `Promise<SandboxCommandResult \| ErrorResponse>` | v0.9 / v0.9.4 | SandboxPanel（自动触发审批） | P0 |
| `sandbox:approve` | invoke | `(callId, approved)` | `Promise<boolean>` | v0.9 | SandboxApprovalDialog（待新建） | P0 |
| `sandbox:delete` | invoke | `(sandboxId)` | `Promise<{success} \| ErrorResponse>` | v0.9 | SandboxPanel | P0 |
| `sandbox:approval-request` | on push | `(SandboxApprovalRequest)` | - | v0.9 / v0.9.4 | SandboxApprovalDialog（HC-6 强制审批） | P0 |
| `llm:validate` | invoke | `(config)` | `Promise<LlmValidationResult>` | v0.5 | SettingsSections 表单校验 | P1 |
| `llm:analyze` | invoke | `(problem, evidences)` | `Promise<string>` (JSON) | v0.5 | ChatPanel 降级路径 / AgentWorkflowPanel | P1 |
| `llm:chat-with-context` | invoke | `(messages, envCtx)` | `Promise<string>` | v0.5 | ChatPanel 系统感知对话 | P1 |
| `llm:token` | on push | `(token: string)` | - | v0.5 | ChatPanel（旧版 llm:chat 流式） | P2 |
| `llm:chunk` | on push | `(LlmStreamChunk)` | - | v0.5 | ChatPanel（旧版 llm:chat 流式） | P2 |
| `llm:done` | on push | `(fullText)` | - | v0.5 | ChatPanel（旧版 llm:chat 完成） | P2 |
| `llm:error` | on push | `(LlmError)` | - | v0.5 | ChatPanel（旧版 llm:chat 错误） | P2 |
| `llm:tool-progress` | on push | `(ToolCallProgress)` | - | v0.5 | ToolCallCard（待接入） | P1 |
| `llm:tool-approval` | on push | `(ToolApprovalRequest)` | - | v0.5 | ToolApprovalModal（待接入监听） | P0 |
| `monitor:getSystemInfo` | invoke | `(sessionId)` | `Promise<SystemInfo>` | v0.7 | MonitorPanel 主动查询 | P2 |
| `ssh:exec` | invoke | `(sessionId, command)` | `Promise<CommandResult>` | v0.7 | 任意需要执行命令的组件 | P2 |
| `ssh:shell:resize` | invoke | `(sessionId, cols, rows)` | `Promise<boolean>` | v0.7 | TerminalView resize | P1 |
| `sftp:upload` | invoke | `(sessionId, localPath, remotePath)` | `Promise<boolean>` | v0.7 | FileTree 上传 | P1 |
| `sftp:download` | invoke | `(sessionId, remotePath, localPath)` | `Promise<boolean>` | v0.7 | FileTree 下载 | P1 |
| `sftp:delete` | invoke | `(sessionId, remotePath)` | `Promise<boolean>` | v0.7 | FileTree 删除 | P1 |
| `sftp:rename` | invoke | `(sessionId, oldPath, newPath)` | `Promise<boolean>` | v0.7 | FileTree 重命名 | P1 |
| `sftp:chmod` | invoke | `(sessionId, remotePath, mode)` | `Promise<boolean>` | v0.7 | FileTree 权限 | P2 |
| `sftp:stat` | invoke | `(sessionId, remotePath)` | `Promise<SftpEntry \| null>` | v0.8 | FileTree 元信息 | P2 |
| `sftp:mkdir` | invoke | `(sessionId, remotePath)` | `Promise<boolean>` | v0.8 | FileTree 新建目录 | P1 |
| `storage:saveApiKey` | invoke | `(provider, key)` | `Promise<boolean>` | v0.5 | SettingsSections API Key | P0 |
| `storage:getApiKey` | invoke | `(provider)` | `Promise<string \| null>` | v0.5 | SettingsSections API Key | P0 |
| `storage:deleteApiKey` | invoke | `(provider)` | `Promise<boolean>` | v0.5 | SettingsSections API Key | P0 |
| `config:get` | invoke | `(key)` | `Promise<T>` | v0.5 | 任意配置读取 | P1 |
| `config:set` | invoke | `(key, value)` | `Promise<boolean>` | v0.5 | 任意配置写入 | P1 |
| `server:export` | invoke | - | `Promise<string>` (JSON) | v0.7 | ServerList 导出 | P2 |
| `server:import` | invoke | `(json)` | `Promise<SshConfig[]>` | v0.7 | ServerList 导入 | P2 |
| `server:delete-cred` | invoke | `(serverId)` | `Promise<boolean>` | v0.7 | ServerList 删除凭证 | P1 |
| `history:save` | invoke | `(card)` | `Promise<boolean>` | v0.5 | DecisionCard 手动保存 | P2 |
| `profiler:exportMd` | invoke | `(md, outputPath)` | `Promise<{filePath, size}>` | v0.7 | ProfilerDialog 导出 md | P1 |
| `tutorial:search` | invoke | `(query, limit?)` | `Promise<TutorialEntry[]>` | v0.6 | TutorialPage 搜索 | P1 |
| `tutorial:crawlStart` | invoke | `(args?)` | `Promise<{success, results}>` | v0.6 | TutorialPage 启动爬虫 | P0 |
| `log:read` | invoke | `(filter?)` | `Promise<LogEntry[]>` | v0.7 | LogViewer（待新建） | P1 |
| `log:stats` | invoke | - | `Promise<LogStats>` | v0.7 | LogViewer | P2 |
| `log:clearBuffer` | invoke | - | `Promise<boolean>` | v0.7 | LogViewer | P2 |
| `log:setMinLevel` | invoke | `(level)` | `Promise<boolean>` | v0.7 | LogViewer / SettingsSections | P2 |
| `log:flush` | invoke | - | `Promise<boolean>` | v0.7 | LogViewer | P2 |

### 1.3 main 层已实现但未暴露 IPC 的能力（红色 🔴 — v0.9.5-pre 需补齐）

| main 层能力 | 函数/类 | 文件 | 建议 IPC 通道名 | 建议消费 UI | 优先级 |
|---|---|---|---|---|---|
| `getCostStats` | function | `src/main/core/agent/providers/token-stats.ts` | `token:cost-stats` | TokenMonitorPanel 成本累计 | P0 |
| `AttentionTracker` | singleton class | `src/main/core/agent/attention-tracker.ts` | `attention:current` / `attention:track` / `attention:reset` | 编辑器高亮 + 调度可视化 | P1 |
| `expectation-monitor`（`checkExpectation`） | function | `src/main/core/agent/expectation-monitor.ts` | `expectation:check` | 命令执行结果告警 UI | P2 |
| `ExploreSubagent` | class | `src/main/core/agent/subagents/explore-subagent.ts` | `subagent:explore` | 调度可视化 / 文件浏览增强 | P2 |
| `.tdsf/agent/*.md` 加载器 | `loadCustomAgents` / `CustomAgentConfig` | `src/main/core/agent/subagents/agent-loader.ts` | `custom-agent:list` / `custom-agent:reload` | SettingsSections 自定义 Agent 管理 | P1 |
| `dispatcher` 8 步调度器 | class / `dispatch` 函数 | `src/main/core/agent/subagents/dispatcher.ts` | `dispatcher:run` / `dispatcher:status` | 调度可视化面板 | P1 |
| `AgentMode` 五模式（chat/ask/plan/code/debug） | `MODE_CONFIGS` / `isValidMode` | `src/main/core/agent/modes/mode-registry.ts` | `mode:list` / `mode:set-default` / `mode:get-current` | ModeSwitcher（待新建） | P0 |
| `editblock` edit format（4 级匹配） | `matchEditBlock` 等纯函数 | `src/main/core/agent/edit-formats/editblock.ts` | `edit:apply` / `edit:preview` | DiffViewer（待新建） | P2 |
| `ProviderCapabilities` | `PROVIDER_CAPABILITIES` / `getProviderCapabilities` | `src/main/core/agent/providers/provider-capabilities.ts` | `provider:capabilities` | SettingsSections Provider 能力展示 | P1 |
| `ModelPricing` | `PROVIDER_PRICING` / `getProviderPricing` / `calculateCost` | `src/main/core/agent/providers/provider-pricing.ts` | `provider:pricing` / `provider:calculate-cost` | TokenMonitorPanel 成本展示 + SettingsSections | P1 |
| `Ollama AUTODETECT` | `autodetectOllamaModels` | `src/main/core/agent/providers/ollama-autodetect.ts` | `ollama:autodetect` | SettingsSections Ollama 模型下拉 | P1 |

---

## 二、渲染层 UI 组件全量清单

### 2.1 已存在的 UI 组件

| 组件名 | 文件路径 | 主要功能 | 已消费 IPC | v0.9.5 待接入 IPC |
|---|---|---|---|---|
| ChatPanel | `src/renderer/src/components/ai/ChatPanel.tsx` | AI 对话面板（v0.9 重构版） | `provider:list`, `token:stats`, `agent:chat`, `agent:chat:cancel`, `agent:start`, `agent:confirm`, `llm:chat`, `llm:chat-with-tools`, `onAgentChunk/Done/Error/Step` | `claude-sdk:*`, `agentCancel`, `mode:list/set-default`, `dispatcher:run/status`, `attention:current` |
| TokenMonitorPanel | `src/renderer/src/components/ai/TokenMonitorPanel.tsx` | Token 监控面板（CCSwitch 风格） | `token:stats`, `token:reset`, `onAgentDone` | `token:records`, `token:cost-stats`, `provider:pricing` |
| CredibilityPanel | `src/renderer/src/components/ai/CredibilityPanel.tsx` | 可信度算法可视化（D-S + PCR5 + DAG） | `credibility:assess`, `credibility:dag` | - |
| DecisionCard | `src/renderer/src/components/ai/DecisionCard.tsx` | 决策卡片展示 | -（通过 store 接收） | `history:save` |
| EvidenceChain | `src/renderer/src/components/ai/EvidenceChain.tsx` | 证据链展示 | - | - |
| RiskConfirm | `src/renderer/src/components/ai/RiskConfirm.tsx` | 风险确认弹窗 | - | `sandbox:approval-request` 监听 / `llm:tool-approval` 监听 |
| AgentWorkflowPanel | `src/renderer/src/components/ai/AgentWorkflowPanel.tsx` | v0.8 Agent 工作流面板 | -（通过 store） | `dispatcher:status` |
| ToolCallCard | `src/renderer/src/components/ai/ToolCallCard.tsx` | 工具调用卡片 | - | `llm:tool-progress` 监听 |
| ToolApprovalModal | `src/renderer/src/components/ai/ToolApprovalModal.tsx` | v0.5 工具审批弹窗 | `llm:tool-approve` | `llm:tool-approval` 监听 |
| AtCommandPicker | `src/renderer/src/components/ai/at-commands/AtCommandPicker.tsx` | @命令选择器 | `at:list` | - |
| AtCommandChip | `src/renderer/src/components/ai/at-commands/AtCommandChip.tsx` | @命令 Chip | - | - |
| AtCommandBadge | `src/renderer/src/components/ai/at-commands/AtCommandBadge.tsx` | @命令 Badge | - | - |
| useAtCommandInjection | `src/renderer/src/components/ai/at-commands/useAtCommandInjection.ts` | @命令注入 hook | `at:parse`, `at:resolve` | - |
| ConnectDialog | `src/renderer/src/components/layout/ConnectDialog.tsx` | SSH 连接对话框 | `ssh:connect`, `ssh:disconnect` | - |
| ServerList | `src/renderer/src/components/layout/ServerList.tsx` | 服务器列表 | `ssh:connect`, `ssh:disconnect`, `ssh:shell:start`, `monitor:start/stop` | `server:export/import`, `server:delete-cred` |
| MainLayout | `src/renderer/src/components/layout/MainLayout.tsx` | 主布局 | - | - |
| MonitorPanel | `src/renderer/src/components/monitor/MonitorPanel.tsx` | 监控面板 | `onMonitorData`, `onMonitorSystemInfo` | `monitor:getSystemInfo` |
| CpuChart | `src/renderer/src/components/monitor/CpuChart.tsx` | CPU 图表 | -（接收 props） | - |
| MemoryChart | `src/renderer/src/components/monitor/MemoryChart.tsx` | 内存图表 | -（接收 props） | - |
| TerminalTabs | `src/renderer/src/components/terminal/TerminalTabs.tsx` | 终端标签页 | `ssh:connect`, `ssh:disconnect`, `ssh:shell:start`, `monitor:start/stop` | - |
| TerminalView | `src/renderer/src/components/terminal/TerminalView.tsx` | 终端视图 | `ssh:shell:write`, `onTerminalData` | `ssh:shell:resize` |
| SelectionPopover | `src/renderer/src/components/terminal/SelectionPopover.tsx` | 选词弹窗 | - | - |
| CodeEditor | `src/renderer/src/components/ide/CodeEditor.tsx` | 代码编辑器 | `sftp:writeFile` | `edit:apply/preview`（editblock 集成） |
| FileTree | `src/renderer/src/components/ide/FileTree.tsx` | 文件树 | `sftp:list`, `sftp:readFile` | `sftp:upload/download/delete/rename/mkdir`, `attention:current` 高亮 |
| EditorTabs | `src/renderer/src/components/ide/EditorTabs.tsx` | 编辑器标签页 | - | - |
| IDEPage | `src/renderer/src/components/ide/IDEPage.tsx` | IDE 工作台页面 | - | - |
| HistoryPage | `src/renderer/src/components/history/HistoryPage.tsx` | 决策历史 | `history:list`, `history:get` | `history:save` |
| KnowledgePage | `src/renderer/src/components/knowledge/KnowledgePage.tsx` | 知识库 | `kb:search/add/update/delete/import/export` | - |
| TutorialPage | `src/renderer/src/components/tutorial/TutorialPage.tsx` | 教程 | `tutorial:list/get/categories/seedVersion/seedReload/listSources/crawlStatus/crawlCancel`, `onTutorialCrawlProgress/Done` | `tutorial:search`, `tutorial:crawlStart` |
| HomePage | `src/renderer/src/components/home/HomePage.tsx` | 首页 | - | - |
| SettingsPage | `src/renderer/src/components/settings/SettingsPage.tsx` | 设置页 | - | - |
| SettingsSections | `src/renderer/src/components/settings/SettingsSections.tsx` | 设置分段 | `llm:test` | `provider:get/save/set-default`, `storage:*`, `ollama:autodetect`, `provider:capabilities`, `custom-agent:list/reload` |
| DeployDialog | `src/renderer/src/components/deploy/DeployDialog.tsx` | 部署对话框 | `deploy:listTemplates/build/execute/cancel`, `onDeployLog/stepUpdate/done` | - |
| ProfilerDialog | `src/renderer/src/components/profiler/ProfilerDialog.tsx` | 系统架构感知对话框 | `profiler:run`, `profiler:defaultFileName`, `profiler:exportPdf` | `profiler:exportMd` |
| ErrorBoundary | `src/renderer/src/components/ErrorBoundary.tsx` | 错误边界 | - | - |
| EmptyState | `src/renderer/src/components/common/EmptyState.tsx` | 空状态 | - | - |
| ErrorState | `src/renderer/src/components/common/ErrorState.tsx` | 错误状态 | - | - |
| RiskTag | `src/renderer/src/components/common/RiskTag.tsx` | 风险标签 | - | - |
| ToolTag | `src/renderer/src/components/common/ToolTag.tsx` | 工具标签 | - | - |
| SectionTitle | `src/renderer/src/components/common/SectionTitle.tsx` | 区段标题 | - | - |
| StaggerList | `src/renderer/src/components/common/StaggerList.tsx` | 交错列表动画 | - | - |
| FadeInUp | `src/renderer/src/components/common/FadeInUp.tsx` | 进入动画 | - | - |

### 2.2 已存在的 Zustand Store

| Store 名 | 文件路径 | 主要功能 | 已消费 IPC |
|---|---|---|---|
| `useAgentStore` | `src/renderer/src/stores/agent-store.ts` | v0.9 Supervisor Agent 状态（消息/流式/correlationId/strength/provider/tokenStats） | -（IPC 调用在组件层） |
| `useAIStore` | `src/renderer/src/stores/ai-store.ts` | v0.8 旧 AgentWorkflow 状态（decisionCard/workflowState/toolCalls/pendingApproval） | - |
| `useServerStore` | `src/renderer/src/stores/server-store.ts` | 服务器列表 | `server:list`, `server:save` |
| `useIdeStore` | `src/renderer/src/stores/ide-store.ts` | IDE 状态（打开文件/标签） | - |
| `useMonitorStore` | `src/renderer/src/stores/monitor-store.ts` | 监控数据 | - |
| `useSettingsStore` | `src/renderer/src/stores/settings-store.ts` | 设置 | - |
| `useTerminalStore` | `src/renderer/src/stores/terminal-store.ts` | 终端 | - |
| `useThemeStore` | `src/renderer/src/stores/theme-store.ts` | 主题 | - |
| `useTranslateStore` | `src/renderer/src/stores/translate-store.ts` | 翻译 | - |

### 2.3 v0.9.5 需要新建的 UI 组件

| 组件名 | 文件路径 | 主要功能 | 消费 IPC | 优先级 |
|---|---|---|---|---|
| SandboxPanel | `src/renderer/src/components/sandbox/SandboxPanel.tsx` | 沙箱管理面板（Docker 检测/启停/沙箱列表/创建/删除） | `sandbox:detect-docker`, `sandbox:start/stop/status/create/list/delete` | P0 |
| SandboxApprovalDialog | `src/renderer/src/components/sandbox/SandboxApprovalDialog.tsx` | 沙箱命令审批弹窗（HC-6 强制审批，30 秒超时） | `sandbox:approval-request` (on) + `sandbox:approve` (invoke) | P0 |
| SandboxExecuteConsole | `src/renderer/src/components/sandbox/SandboxExecuteConsole.tsx` | 沙箱内命令执行控制台（结果展示） | `sandbox:execute` | P0 |
| ModeSwitcher | `src/renderer/src/components/agent/ModeSwitcher.tsx` | 五模式切换器（chat/ask/plan/code/debug） | `mode:list`, `mode:set-default`, `mode:get-current`（待补齐） | P0 |
| ClaudeSdkStreamIndicator | `src/renderer/src/components/ai/ClaudeSdkStreamIndicator.tsx` | Claude SDK 流式状态指示器（区分于 Supervisor） | `claude-sdk:chunk/done/error` (on) | P0 |
| DispatcherVisualizer | `src/renderer/src/components/agent/DispatcherVisualizer.tsx` | 8 步调度器可视化（analyze/plan/dispatch/execute/approve/collect/reflect/summarize） | `dispatcher:run`, `dispatcher:status`（待补齐） | P1 |
| AttentionHighlight | `src/renderer/src/components/agent/AttentionHighlight.tsx` | 注意力高亮（文件/命令/错误三类） | `attention:current` (on, 待补齐) | P1 |
| CustomAgentManager | `src/renderer/src/components/settings/CustomAgentManager.tsx` | 自定义 Agent 管理器（.tdsf/agent/*.md 加载/重载） | `custom-agent:list`, `custom-agent:reload`（待补齐） | P1 |
| ProviderEditor | `src/renderer/src/components/settings/ProviderEditor.tsx` | Provider 配置编辑器（含 capabilities/pricing 展示 + Ollama 自动检测） | `provider:get/save/set-default`, `provider:capabilities/pricing`, `ollama:autodetect`, `storage:saveApiKey/getApiKey/deleteApiKey`（部分待补齐） | P0 |
| TokenCostPanel | `src/renderer/src/components/ai/TokenCostPanel.tsx` | Token 成本累计展示（按 Provider/时间维度，USD） | `token:cost-stats`（待补齐）, `provider:pricing`（待补齐）, `token:records` | P0 |
| TokenRecordsTable | `src/renderer/src/components/ai/TokenRecordsTable.tsx` | Token 明细记录表 | `token:records` | P1 |
| ExpectationAlert | `src/renderer/src/components/agent/ExpectationAlert.tsx` | 预期回显告警 UI | `expectation:check`（待补齐） | P2 |
| DiffViewer | `src/renderer/src/components/ide/DiffViewer.tsx` | editblock 差异可视化 | `edit:apply`, `edit:preview`（待补齐） | P2 |
| SystemHealthIndicator | `src/renderer/src/components/layout/SystemHealthIndicator.tsx` | 主进程健康指示器（心跳 + 协议版本） | `system:ping`, `getProtocolVersion` | P1 |
| LogViewer | `src/renderer/src/components/dev/LogViewer.tsx` | 日志查看器（开发调试用） | `log:read/stats/clearBuffer/setMinLevel/flush` | P1 |
| FileOperationsMenu | `src/renderer/src/components/ide/FileOperationsMenu.tsx` | 文件操作菜单（上传/下载/删除/重命名/权限/新建目录） | `sftp:upload/download/delete/rename/chmod/mkdir/stat` | P1 |

---

## 三、v0.9.5 UI 集成优先级建议

### P0 — 必须接入（核心安全 + 透明性 + 主流程闭环）

- **P0-1 沙箱审批弹窗（HC-6 强制审批闸门）**
  - 文件：`SandboxPanel.tsx` + `SandboxApprovalDialog.tsx` + `SandboxExecuteConsole.tsx`
  - 原因：sandbox:execute 在 IPC 层强制审批，UI 不接入则用户无法响应 → 沙箱能力完全不可用
  - 依赖 IPC：`sandbox:approval-request` (on) + `sandbox:approve` (invoke) + `sandbox:*` 全套
  - 关联 HC：HC-6 沙箱命令始终审批

- **P0-2 Provider 配置 UI（HC-1 网络 + HC-6 安全）**
  - 文件：`ProviderEditor.tsx`
  - 原因：v0.9 已有 provider:list 但 UI 只读，用户无法新增/编辑/删除 Provider
  - 依赖 IPC：`provider:get/save/set-default` + `storage:saveApiKey/getApiKey/deleteApiKey`
  - 影响：无法配置 API Key → ChatPanel 无法发起 agent:chat

- **P0-3 Token 成本面板（HC-6 Token 消耗透明）**
  - 文件：`TokenCostPanel.tsx` + `TokenRecordsTable.tsx`
  - 原因：v0.9.4 已实现 `getCostStats` 但未暴露 IPC，UI 无法展示成本
  - 依赖 main 层补齐：`token:cost-stats` + `provider:pricing`
  - 依赖已就绪 IPC：`token:records`

- **P0-4 Mode 五模式切换**
  - 文件：`ModeSwitcher.tsx`
  - 原因：v0.9.4 已实现 5 模式但未暴露 IPC，UI 无法切换
  - 依赖 main 层补齐：`mode:list` + `mode:set-default` + `mode:get-current`

- **P0-5 Claude SDK 流式接入**
  - 文件：`ClaudeSdkStreamIndicator.tsx`（或集成到 ChatPanel）
  - 原因：claude-sdk 类型 Provider 已有完整 IPC 通道，但 ChatPanel 完全未接入 → 选 claude-sdk Provider 时无法对话
  - 依赖 IPC：`claude-sdk:stream` + `onClaudeSdkChunk/Done/Error` + `claude-sdk:cancel`

- **P0-6 v0.9.4 agentCancel 统一取消接入**
  - 文件：ChatPanel 停止按钮替换
  - 原因：v0.9.4 新签名 `agentCancel(sessionId)` 可同时取消 agent:chat / claude-sdk 两类会话，旧 `agentChatCancel(correlationId)` 已过时
  - 依赖 IPC：`agentCancel`（已就绪未消费）

- **P0-7 ToolApprovalModal 接入 llm:tool-approval 监听**
  - 原因：当前只调用了 `llm:tool-approve`（响应审批），未监听 `llm:tool-approval`（接收审批请求）→ 审批流闭环缺失
  - 依赖 IPC：`llm:tool-approval` (on)

- **P0-8 教程爬虫启动接入**
  - 原因：TutorialPage 已用 crawlStatus/crawlCancel/onProgress/onDone，但 `tutorial:crawlStart` 未调用 → 爬虫无法启动
  - 依赖 IPC：`tutorial:crawlStart`

### P1 — 应该接入（核心可用性 + 增强体验）

- **P1-1 Mode 五模式相关补齐 IPC**
  - main 层补齐：`mode:list` / `mode:set-default` / `mode:get-current`

- **P1-2 Attention 高亮**
  - main 层补齐：`attention:current` (on push)
  - 文件：`AttentionHighlight.tsx` + FileTree 集成

- **P1-3 调度可视化**
  - main 层补齐：`dispatcher:run` / `dispatcher:status`
  - 文件：`DispatcherVisualizer.tsx`

- **P1-4 自定义 Agent 管理**
  - main 层补齐：`custom-agent:list` / `custom-agent:reload`
  - 文件：`CustomAgentManager.tsx`

- **P1-5 Ollama 自动检测**
  - main 层补齐：`ollama:autodetect`
  - 集成到：`ProviderEditor.tsx`（Provider 类型为 ollama 时自动拉取模型列表）

- **P1-6 Provider 能力展示**
  - main 层补齐：`provider:capabilities`
  - 集成到：`ProviderEditor.tsx`（展示 streaming/toolCall/vision/contextWindow）

- **P1-7 主进程健康指示器**
  - 文件：`SystemHealthIndicator.tsx`
  - 依赖 IPC：`system:ping` + `getProtocolVersion`

- **P1-8 文件操作菜单**
  - 文件：`FileOperationsMenu.tsx`
  - 依赖 IPC：`sftp:upload/download/delete/rename/mkdir`

- **P1-9 终端 resize**
  - 集成到：TerminalView
  - 依赖 IPC：`ssh:shell:resize`

- **P1-10 日志查看器**
  - 文件：`LogViewer.tsx`
  - 依赖 IPC：`log:read/stats/clearBuffer/setMinLevel/flush`

- **P1-11 教程搜索 + Profiler md 导出**
  - 依赖 IPC：`tutorial:search` + `profiler:exportMd`

- **P1-12 工具调用进度展示**
  - 集成到：ToolCallCard
  - 依赖 IPC：`llm:tool-progress` (on)

### P2 — 可以接入（增强体验 + 完整性）

- **P2-1 预期回显告警 UI**
  - main 层补齐：`expectation:check`
  - 文件：`ExpectationAlert.tsx`

- **P2-2 editblock 差异可视化**
  - main 层补齐：`edit:apply` / `edit:preview`
  - 文件：`DiffViewer.tsx`

- **P2-3 ExploreSubagent 调用**
  - main 层补齐：`subagent:explore`
  - 集成到：FileTree 增强或调度可视化

- **P2-4 旧版 llm:chat 流式事件监听**
  - 依赖 IPC：`llm:token/chunk/done/error` (on)
  - 集成到：ChatPanel 旧版降级路径

- **P2-5 文件元信息 + 权限修改**
  - 依赖 IPC：`sftp:stat` + `sftp:chmod`

- **P2-6 服务器导入导出 + 决策卡片手动保存**
  - 依赖 IPC：`server:export/import` + `history:save`

- **P2-7 日志统计 + 级别调整**
  - 依赖 IPC：`log:stats/clearBuffer/setMinLevel/flush`

- **P2-8 主动查询系统信息**
  - 依赖 IPC：`monitor:getSystemInfo`

---

## 四、v0.9.5-pre 需要补齐的 IPC 通道

### 4.1 必须补齐（P0）

| main 层能力 | 建议 IPC 通道名 | 方向 | 参数 | 返回值 | 实现文件 |
|---|---|---|---|---|---|
| `getCostStats` | `token:cost-stats` | invoke | `(无)` | `Promise<CostStats>` | `src/main/ipc/agent-runtime.ts`（追加）或 `src/main/ipc/token.ts`（新增） |
| `AgentMode` 五模式 | `mode:list` | invoke | `(无)` | `Promise<ModeConfig[]>` | `src/main/ipc/mode.ts`（新增） |
| `AgentMode` 五模式 | `mode:set-default` | invoke | `(mode: AgentMode)` | `Promise<boolean>` | `src/main/ipc/mode.ts` |
| `AgentMode` 五模式 | `mode:get-current` | invoke | `(无)` | `Promise<AgentMode>` | `src/main/ipc/mode.ts` |
| `AttentionTracker` 当前注意力 | `attention:current` | on push | `(AttentionFocus)` | - | `src/main/ipc/attention.ts`（新增，需在 tracker 内部加 emit 钩子） |

### 4.2 建议补齐（P1）

| main 层能力 | 建议 IPC 通道名 | 方向 | 参数 | 返回值 | 实现文件 |
|---|---|---|---|---|---|
| `AttentionTracker` 主动查询 | `attention:get` | invoke | `(无)` | `Promise<AttentionFocus \| null>` | `src/main/ipc/attention.ts` |
| `AttentionTracker` 重置 | `attention:reset` | invoke | `(无)` | `Promise<boolean>` | `src/main/ipc/attention.ts` |
| `dispatcher` 8 步调度 | `dispatcher:run` | invoke | `(userRequest, mode, strength)` | `Promise<string>` (dispatchId) | `src/main/ipc/dispatcher.ts`（新增） |
| `dispatcher` 状态查询 | `dispatcher:status` | invoke | `(dispatchId)` | `Promise<DispatchContext>` | `src/main/ipc/dispatcher.ts` |
| `dispatcher` 步骤推送 | `dispatcher:step` | on push | `(DispatchStep, dispatchId)` | - | `src/main/ipc/dispatcher.ts` |
| `.tdsf/agent/*.md` 加载器 | `custom-agent:list` | invoke | `(无)` | `Promise<CustomAgentConfig[]>` | `src/main/ipc/custom-agent.ts`（新增） |
| `.tdsf/agent/*.md` 加载器 | `custom-agent:reload` | invoke | `(无)` | `Promise<number>` | `src/main/ipc/custom-agent.ts` |
| `ProviderCapabilities` | `provider:capabilities` | invoke | `(id)` | `Promise<ProviderCapabilities>` | `src/main/ipc/agent-runtime.ts`（追加） |
| `ModelPricing` | `provider:pricing` | invoke | `(id)` | `Promise<ModelPricing>` | `src/main/ipc/agent-runtime.ts`（追加） |
| `Ollama AUTODETECT` | `ollama:autodetect` | invoke | `(baseURL?)` | `Promise<string[]>` (model names) | `src/main/ipc/agent-runtime.ts`（追加） |

### 4.3 可选补齐（P2）

| main 层能力 | 建议 IPC 通道名 | 方向 | 参数 | 返回值 |
|---|---|---|---|---|
| `expectation-monitor` | `expectation:check` | invoke | `(CommandExpectation, actualOutput)` | `Promise<ExpectationViolation[]>` |
| `ExploreSubagent` | `subagent:explore` | invoke | `(ExploreTaskInput)` | `Promise<ExploreResultOutput>` |
| `editblock` 4 级匹配 | `edit:apply` | invoke | `(fileContent, editBlocks)` | `Promise<{result, appliedCount, failures}>` |
| `editblock` 4 级匹配 | `edit:preview` | invoke | `(fileContent, editBlocks)` | `Promise<Array<EditMatchResult>>` |

### 4.4 IPC 4 步同步铁律（任务 5 实施约束）

每个新 IPC 通道必须遵守：

1. **main 层定义 handler**：在对应 `src/main/ipc/*.ts` 文件中实现 `ipcMain.handle(channel, handler)`
2. **ipc/index.ts 注册**：在 `registerAllIpcHandlers` 中调用对应的 register 函数
3. **preload 暴露**：在 `src/preload/index.ts` 中通过 `ipcRenderer.invoke(channel, ...args)` 封装并 `contextBridge.exposeInMainWorld`
4. **electron.d.ts 类型声明**：在 `src/renderer/src/types/electron.d.ts` 的 `ElectronAPI` interface 中追加方法签名

约束：
- 不修改现有 IPC 通道签名（向后兼容）
- 不修改 main 层现有函数签名（仅在 IPC 层包装）
- 所有新 IPC 通道必须有 JSDoc 注释
- 单文件 ≤ 500 行（超出则新建独立文件如 `ipc/mode.ts` / `ipc/attention.ts`）
- 推送通道（on push）需要在 main 层注入 mainWindow 引用（参考 agent-runtime.ts 的 safeSend 模式）

---

## 五、UI 集成风险评估

| 风险 | 影响 | 缓解 |
|---|---|---|
| IPC 通道数量爆炸（v0.9.4 已 78 个，v0.9.5 补齐后 89+ 个） | 接线混乱、命名冲突、维护困难 | 先做接线图再实施 + 建立 IPC 通道命名规范（kebab-case + 命名空间前缀）+ 定期 review |
| 渲染层 Zustand store 缺失（无 sandboxStore / modeStore / dispatcherStore / attentionStore / claudeSdkStore） | 状态管理混乱、组件间无法共享状态 | v0.9.5 先建 store 骨架：`sandbox-store.ts` / `mode-store.ts` / `dispatcher-store.ts` / `attention-store.ts` / `claude-sdk-store.ts` |
| 沙箱审批 UI 完全缺失 | sandbox:execute 调用后 30 秒超时自动拒绝，沙箱能力完全不可用 | P0-1 优先实施 SandboxApprovalDialog，监听 `sandbox:approval-request` |
| Provider 配置 UI 只读 | 用户无法新增/编辑 Provider → 无法配置 API Key → ChatPanel 无法发起对话 | P0-2 优先实施 ProviderEditor |
| Claude SDK IPC 完全未消费 | claude-sdk 类型 Provider 选了之后无响应 | P0-5 优先接入 ChatPanel 的 claude-sdk 分支 |
| main 层补齐 IPC 工作量大（11 个能力） | 阻塞 v0.9.5 UI 集成 | 优先 P0（5 个），P1 可与 UI 并行开发 |
| Token 成本数据来源分散（token-stats / provider-pricing 两个模块） | UI 拼装复杂 | 在 main 层 `getCostStats` 中聚合，UI 一次 invoke 拿到完整数据 |
| AttentionTracker 是单例 + 无 emit 钩子 | 无法通过 IPC 推送实时变化 | 改造 AttentionTracker 增加 `onChange` 回调，或 UI 轮询 `attention:get` |
| dispatcher 8 步是同步函数 + 步骤事件未推送 | UI 无法实时可视化调度过程 | 改造 dispatcher 在每步前推送 `dispatcher:step` 事件 |
| AgentMode 当前未持久化（每次启动默认 chat） | 用户切换后重启丢失 | mode:set-default 写入 ConfigStore（key='agentMode'） |
| 旧版 llm:chat 流式事件（llm:token/chunk/done/error）已被 v0.9 agent:chunk/done/error 取代，但 llm:chat 仍可用 | UI 监听混乱 | ChatPanel 优先用 v0.9 通道，旧版作为降级路径 |
| 编辑器（CodeEditor）未集成 editblock | LLM 编辑建议无法直接应用 | P2 实施 DiffViewer + edit:apply/preview |

---

## 六、v0.9.5 UI 集成实施建议

### 6.1 实施顺序建议

1. **第一阶段：补齐缺失 IPC（api agent 任务，1-2 天）**
   - P0 必补：`token:cost-stats` / `mode:list+set-default+get-current` / `attention:current`
   - P1 建议补：`custom-agent:list+reload` / `provider:capabilities+pricing` / `ollama:autodetect` / `dispatcher:run+status+step`
   - 严格遵守 IPC 4 步同步铁律
   - 三重验证：main handler 注册 / preload 暴露 / d.ts 类型声明

2. **第二阶段：建立 Zustand store 骨架（0.5 天）**
   - 新建：`sandbox-store.ts` / `mode-store.ts` / `dispatcher-store.ts` / `attention-store.ts` / `claude-sdk-store.ts` / `provider-store.ts` / `token-cost-store.ts`
   - 每个 store 持有：状态字段 + actions + IPC 调用 + 事件监听注册函数
   - 参考 `agent-store.ts` 风格（zustand + create + set）

3. **第三阶段：实施 P0 组件（3-5 天）**
   - P0-1 SandboxPanel + SandboxApprovalDialog + SandboxExecuteConsole（沙箱闭环）
   - P0-2 ProviderEditor（Provider 配置闭环，含 API Key + Ollama 自动检测）
   - P0-3 TokenCostPanel + TokenRecordsTable（成本透明）
   - P0-4 ModeSwitcher（五模式切换）
   - P0-5 ChatPanel 集成 claude-sdk 流式分支
   - P0-6 ChatPanel 停止按钮替换为 `agentCancel`
   - P0-7 ToolApprovalModal 监听 `llm:tool-approval`
   - P0-8 TutorialPage 接入 `tutorial:crawlStart`

4. **第四阶段：实施 P1 组件（3-5 天）**
   - P1-1 ~ P1-4：DispatcherVisualizer + AttentionHighlight + CustomAgentManager
   - P1-5 ~ P1-6：ProviderEditor 集成 capabilities/pricing 展示
   - P1-7：SystemHealthIndicator（心跳 + 协议版本）
   - P1-8 ~ P1-12：FileOperationsMenu + TerminalView resize + LogViewer + ToolCallCard progress + 教程搜索 + Profiler md 导出

5. **第五阶段：实施 P2 组件（2-3 天，可选）**
   - P2-1 ~ P2-3：ExpectationAlert + DiffViewer + ExploreSubagent 集成
   - P2-4 ~ P2-8：旧版 llm:chat 流式 / 文件元信息 / 服务器导入导出 / 决策卡片手动保存 / 日志统计 / 主动查询系统信息

### 6.2 等待用户提供视觉设计稿

v0.9.5 UI 集成前需用户提供以下视觉设计决策：

- **整体配色**（已知用户偏好：低饱和靛蓝 `#4f46e5` 亮 / `#818cf8` 暗）
- **卡片样式**（已知：hover 仅阴影变化，避免 transform/scale）
- **字体**（已知：非衬线字体优先，等宽字体用于 Token 数显示）
- **具体布局**（待用户决定）：
  - SandboxPanel 放在哪个 Tab/页面？
  - ModeSwitcher 放在 ChatPanel 顶部还是侧边？
  - TokenCostPanel 是独立 Tab 还是 ChatPanel 侧边栏？
  - DispatcherVisualizer 是模态弹窗还是常驻面板？
  - CustomAgentManager 放在 Settings 页面的哪个区段？
- **暗色模式适配策略**（已知项目有 `useThemeStore`，需确认所有新组件都支持双主题）
- **响应式断点**（已知项目支持桌面端，需确认最小窗口尺寸）

### 6.3 验收标准

每个 P0 组件需满足：
1. IPC 4 步同步铁律全部完成（main + index + preload + d.ts）
2. 三重验证：`window.electronAPI.<method>` 在渲染进程可调用 + 类型推导正确 + 返回值结构匹配
3. 错误路径覆盖（IPC 失败 / 主进程异常 / 窗口销毁）
4. 事件监听器在组件卸载时正确 cleanup（参考 `agent-store.ts` 的 useEffect return 模式）
5. 暗色/亮色双主题适配
6. JSDoc 注释完整（包含参数/返回值/使用场景/方案书依据）

---

## 附录 A：IPC 通道命名规范（v0.9.5 建议）

| 命名空间 | 用途 | 示例 |
|---|---|---|
| `system:*` | 系统级（协议版本/心跳/通用取消） | `system:ping` |
| `ssh:*` / `sftp:*` | SSH/SFTP 操作 | `ssh:connect` / `sftp:list` |
| `monitor:*` | 服务器监控 | `monitor:start` |
| `llm:*` | LLM 直接调用（非 Agent） | `llm:chat` / `llm:tool-approve` |
| `agent:*` | v0.9 Supervisor Agent | `agent:chat` / `agent:chunk` |
| `claude-sdk:*` | Claude Agent SDK（独立于 Supervisor） | `claude-sdk:stream` |
| `provider:*` | Provider 管理 | `provider:list` / `provider:capabilities` |
| `token:*` | Token 统计 + 成本 | `token:stats` / `token:cost-stats` |
| `mode:*` | AgentMode 五模式 | `mode:list` / `mode:set-default` |
| `attention:*` | 注意力跟踪 | `attention:current` / `attention:get` |
| `dispatcher:*` | 8 步调度器 | `dispatcher:run` / `dispatcher:step` |
| `custom-agent:*` | 自定义 Agent 加载器 | `custom-agent:list` |
| `subagent:*` | 单个 Subagent 调用 | `subagent:explore` |
| `sandbox:*` | OpenHands 沙箱 | `sandbox:execute` / `sandbox:approve` |
| `at:*` | @命令 | `at:list` / `at:parse` |
| `credibility:*` | 可信度算法 | `credibility:assess` |
| `expectation:*` | 预期回显监控 | `expectation:check` |
| `edit:*` | editblock 编辑 | `edit:apply` / `edit:preview` |
| `ollama:*` | Ollama 模型自动检测 | `ollama:autodetect` |
| `kb:*` / `history:*` / `tutorial:*` / `profiler:*` / `deploy:*` | 业务模块 | `kb:search` |
| `storage:*` / `config:*` / `server:*` | 存储/配置/服务器列表 | `storage:saveApiKey` |
| `log:*` | 日志系统 | `log:read` |

规范：
- 全部使用 kebab-case
- 命名空间前缀用 `:` 分隔（不用 `.` / `-` / `/`）
- 推送通道（on push）与 invoke 通道共用命名空间，不额外加 `:push` 后缀
- 取消类通道统一用 `:cancel` 后缀（如 `agent:chat:cancel` / `claude-sdk:cancel`）
- 审批类通道统一用 `:approve` 后缀（如 `sandbox:approve` / `llm:tool-approve`）

---

## 附录 B：参考文档

- 方案书：`docs/方案书-v0.9.3-Agent架构设计最终整合版.md`
- v0.9.4 批次 4 任务清单：见 `src/main/core/agent/attention-tracker.ts` / `expectation-monitor.ts` / `subagents/agent-loader.ts` / `subagents/dispatcher.ts` 文件头注释
- 源码分析：`idea-to-dev-output/29-源码分析-KiloCode-多模式Subagent.md`
- 源码分析：`idea-to-dev-output/30-源码分析-ContinueDev-多模型调度与代码库索引.md`
- IPC 命名规范：方案书 §11.2
- Hard Constraints：方案书 §HC-1（网络日志）/ §HC-2（脱敏）/ §HC-6（审批 + Token 透明）

---

**文档版本**：v1.0
**生成 agent**：v0.9.5-pre UI 接入准备 agent
**下一步**：交付给 api agent 补齐 P0 级 IPC 通道 + 交付给 ui agent 实施 P0 级 UI 组件
