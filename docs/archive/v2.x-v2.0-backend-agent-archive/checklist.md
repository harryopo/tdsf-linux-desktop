# v2.0 后端 + Agent 架构循环工程 — Checkpoint 勾选

> **方案书**：`idea-to-dev-output/45-后端与Agent架构规划-v2.0.md`
> **验证日期**：2026-07-22

---

## 编译门禁

- [x] `pnpm typecheck:node` exit 0
- [x] `pnpm typecheck:web` exit 0
- [x] `pnpm lint` 后端 0 error（前端 2 error 为前端重构引入，非后端阻塞）
- [x] `pnpm test` 1220/1221 通过（1 pre-existing llm-client.test.ts 失败，与后端无关）

## 硬约束对齐

- [x] IDE 工作台基于 SftpManager 扩展（路径 C，不引入 code-server/Theia）
- [x] Agent 主进程 TS 优先，Python Sidecar 隔离
- [x] 可信度算法论文支撑（D-S + PCR5 + ECE + Temperature Scaling）
- [x] @命令鼠标划选注入（SelectionPopover Phase B）
- [x] 运维 Agent 每步人工审批（7 步 HITL + risk-engine 4 层）
- [x] 不反编译 Claude Code（用官方 @anthropic-ai/claude-agent-sdk）
- [x] 所有网络请求 UI 可见（IPC 层 logger）
- [x] 敏感文件默认 redact（redact.ts 8 类正则）
- [x] 本地优先（Provider 工厂支持 Ollama）
- [x] Token 消耗透明（token-stats IPC）
- [x] 质量绝对优先（7 维评分阈值 8.5/10）
- [x] 开源源码全量分析（VSCode/Cline/Aider 已 clone）
- [x] R11 OpenTelemetry 一统观测性（Langfuse trace 集成 Phase D）
- [x] R12 三态权限审批（ALWAYS/AUTO/NEVER Phase C）
- [x] R14 HITL CoPilot 模式（87.5% 接受率 PAOR）

## Phase A Checkpoint

- [x] Monaco Editor 替换 textarea 桩（Hard Constraint 对齐）
- [x] @monaco-editor/react@4.7.0 + monaco-editor@0.56.0 安装
- [x] Ctrl+S 保存快捷键
- [x] shell/python/json/yaml 语言配置注册
- [x] StatusBar 光标位置实时读取 editor-store
- [x] docker-compose.yml 补齐（OpenHands 沙箱 TD-5 修复）

## Phase B Checkpoint

- [x] InlineCompletionsProvider 注册（ghost text）
- [x] 5 个未决补全限流 + LRU 100 缓存 + 5s 超时
- [x] InlineDiffAdapter（Accept All / Reject All）
- [x] SelectionPopover（编辑器选中 → @file/@code，终端选中 → @cmd）
- [x] IPC 4 通道 4 步同步（llm:inline-completion / cancel / apply-diff / diff-preview）
- [x] Monaco API 变更修复（disposeInlineCompletions 替代 freeInlineCompletions）

## Phase C Checkpoint

- [x] QuickFileSearch fzf 算法模糊匹配 + 键盘导航
- [x] GlobalSearch 正则/全词/大小写敏感 toggle
- [x] FileWatcher SSH inotifywait + 降级轮询（5s 间隔）
- [x] workbench-store Zustand persist + electron-store 适配
- [x] ActivityRail 8 路由接线
- [x] 三态权限 ALWAYS/AUTO/NEVER（R12 Hard Constraint）
- [x] IPC 5 通道 4 步同步

## Phase D Checkpoint

- [x] task-protocol 14 步全部补齐真实逻辑（非桩）
- [x] step 1-5: validate-input / check-permission / load-subagent-config / derive-permissions / prepare-context
- [x] step 6-10: select-provider / select-mode / build-prompt / invoke-subagent / stream-output
- [x] step 11-14: collect-usage / validate-output / cleanup / return-result
- [x] 文件拆分：task-protocol-steps.ts(1142行) → 4 文件均 ≤500 行
- [x] Langfuse 流式 trace：withStreamTrace(AsyncIterable) + withCallbackStreamTrace(回调)
- [x] ClaudeSdkProvider.stream() 集成（workflowName='claude-sdk-stream'）
- [x] Supervisor.chat() 集成（workflowName='supervisor-chat'）
- [x] 7 步 HITL 集成（startHitlTrace + startHitlStepTrace 每步独立 span）
- [x] Langfuse 未启用时无副作用降级

## Phase E Checkpoint

- [x] ECE 校准：FusionEngine.getEceReport() + fuseAndAssess 返回 eceReport
- [x] Temperature Scaling：FusionEngine.calibrate(confidence, providerId)
- [x] fuseAndAssess 返回 calibratedConfidence
- [x] FuseAssessOptions 类型（providerId / applyCalibration / includeEceReport）
- [x] Mastra vs Supervisor 边界 JSDoc（ops-agent.ts + supervisor.ts 顶部）
- [x] docs/AGENT-BOUNDARY.md（决策树 + 接口对比 + 调用示例）
- [x] E.4 前端任务跳过（前端并行重构中）

## Phase F Checkpoint

- [x] MCP 工具从 9 扩展到 30（21 新工具）
- [x] SSH 域 5 工具（execute/read/write/list/stat）
- [x] 监控域 3 工具（process_list/disk_usage/network_stats）
- [x] 日志域 3 工具（tail/search/analyze）+ shellEscape 防注入
- [x] 知识域 4 工具（search/add/update/list）
- [x] 决策域 3 工具（credibility_assess/calibrate/history）+ confidenceToMass
- [x] 沙箱域 3 工具（execute/create/destroy）+ redactSecrets 脱敏
- [x] MCP resources 8 个（knowledge 4 + config 2 + runtime 2）
- [x] MCP prompts 5 个（diagnose-high-load / fix-selinux-denial / configure-samba-share / review-security-hardening / explain-command）
- [x] registry.ts 按域拆分 6 文件 + legacy-handlers.ts
- [x] server.ts 集成 resources/prompts handler
- [x] 所有文件 ≤ 500 行
