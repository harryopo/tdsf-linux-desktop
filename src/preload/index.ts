

import type { BackfillCancelResult, BackfillProgress, BackfillStartOptions, BackfillStartResult, BackfillStatusResult, TutorialCategory, TutorialCategorySummary, TutorialEntry } from '@shared/tutorial-types'
import type { ChatMessage, HistorySaveIntent, PreviewHandleInfo, PreviewTarget } from '@shared/models'
import type { CrawlProgress, CrawlResult, CrawlStatus, TutorialSourceSpec } from '@shared/crawler-types'
import type { DeployLogEvent as DeployLogEventModel, DeployPlan as DeployPlanModel, DeployResult as DeployResultModel, DeployStepResult as DeployStepResultModel, DeployTemplate as DeployTemplateModel } from '@shared/deploy-types'
import type { RiskRulesSnapshot } from '@shared/ipc-channels'
import type { ToolApprovalRequest, ToolApprovalResponse, ToolCallProgress } from '@shared/llm-tool-types'
import { AGENT, ALERT, BOOT, BUDGET, CREDIBILITY, DEPLOY, DIAGNOSTICS, HISTORY, KNOWLEDGE, LLM, LOG, LOOP, MEMORY, MODEL_STATS, PREVIEW, PROMPTFOO, RISK, SIDECAR, TUTORIAL, WINDOW } from '@shared/ipc-channels'
import { IpcRendererEvent, contextBridge, ipcRenderer } from 'electron'
import type { HybridSearchResult, RecommendPathOptions, SidecarHealthOneResponse, SidecarListStatusResponse, TutorialBackfillOptions, TutorialBackfillResult, TutorialHybridSearchOptions, TutorialPath, TutorialSearchStatus } from './types'
export type { FileChangeEvent, FileChangedPayload, SftpGrepMatch, SftpGrepParams, SftpSearchFileEntry } from './types'
import { createListener, invokeChecked } from './ipc-util'
import { ssh } from './domains/ssh'
import { fileWatch, sftp, sftpSearch } from './domains/sftp'
import { agentRuntime, subagent } from './domains/agent'
import { attention, credibility, expectation, mode, taskPermission } from './domains/cognition'
import { atCommands, localTty, sandbox, terminalCompletion } from './domains/terminal'
import { claudeSdk, llm, llmInline, provider, providerInfo, token, tokenCostStats } from './domains/llm'
import { appUpdate, config, dbStatus, fsUpload, monitor, profiler, scheduler, server, storage, system } from './domains/system'
import { on } from './domains/events'

// ============================================================================
// 暴露到渲染进程（扁平化 API，与渲染进程调用方式一致）
// ============================================================================

/**
 * 通过 contextBridge 暴露 electronAPI 到 window 对象
 *
 * 渲染进程使用扁平调用方式：
 *   window.electronAPI.sshConnect(config)
 *   window.electronAPI.onTerminalData((sid, data) => {...})
 *
 * 而非嵌套方式：
 *   window.electronAPI.ssh.connect(config)
 *   window.electronAPI.on.terminalData((sid, data) => {...})
 */
const electronApi = {
  // ===== SSH 扁平化 =====
  sshConnect: ssh.connect,
  sshConnectById: ssh.connectById,
  sshDisconnect: ssh.disconnect,
  sshExec: ssh.exec,
  windowOpenSecondary: (): Promise<number> =>
    invokeChecked('windowOpenSecondary', WINDOW.OPEN_SECONDARY),
  // ===== 预览（W5）=====
  // 只有"铸/废/读入口文本"三个动作。子资源不走这里：iframe 带着 token 直接找
  // tdsf-preview: 协议，笼子在主进程判，渲染层拼不出笼子外的路径与端口。
  previewOpen: (target: PreviewTarget): Promise<PreviewHandleInfo> =>
    invokeChecked('previewOpen', PREVIEW.OPEN, target),
  previewClose: (token: string): Promise<boolean> =>
    invokeChecked('previewClose', PREVIEW.CLOSE, token),
  previewReadText: (token: string): Promise<string> =>
    invokeChecked('previewReadText', PREVIEW.READ_TEXT, token),
  sshShellStart: ssh.shell.start,
  sshShellClose: ssh.shell.close,
  sshShellList: ssh.shell.list,
  sshShellWrite: ssh.shell.write,
  // ===== 远端 Shell 集成（#61）=====
  // 逐台确认：界面先看 status 带回来的两份原文，用户点头才调 install。
  // 这里只交 sessionId，写入路径与内容由主进程定死。
  sshShellIntegrationStatus: ssh.shellIntegration.status,
  sshShellIntegrationInstall: ssh.shellIntegration.install,
  sshShellIntegrationUninstall: ssh.shellIntegration.uninstall,
  /** 执行整条代写命令（AI/决策页），主进程过风险闸 */
  sshRunAuthored: ssh.shell.runAuthored,
  sshShellResize: ssh.shell.resize,
  /** 响应主机密钥确认弹窗（Phase L） */
  sshRespondHostKey: ssh.respondHostKey,
  // Phase M：SSH 密钥管理扁平化（删除 / 上传 / 生成 / 列表）
  /** 删除 SSH 密钥对（幂等） */
  sshDeleteKeyring: ssh.deleteKeyring,
  /** 上传 SSH 私钥（文件对话框 + 复制 + chmod 600 + derive 公钥） */
  sshUploadKeypair: ssh.uploadKeypair,
  /** 生成 SSH 密钥对（ssh-keygen ed25519/rsa） */
  sshGenerateKeypair: ssh.generateKeypair,
  /** 列出 ~/.ssh/ 目录下所有密钥对 */
  sshListKeypairs: ssh.listKeypairs,

  // ===== SFTP 扁平化 =====
  sftpList: sftp.list,
  sftpUpload: sftp.upload,
  sftpDownload: sftp.download,
  sftpDelete: sftp.delete,
  sftpRename: sftp.rename,
  sftpChmod: sftp.chmod,
  // v0.8 IDE 工作台新增
  sftpReadFile: sftp.readFile,
  sftpWriteFile: sftp.writeFile,
  sftpStat: sftp.stat,
  sftpMkdir: sftp.mkdir,

  // ===== 终端智能补全扁平化（v0.9.7 P3 M1） =====
  localTtyStatus: localTty.status,
  localTtyStart: localTty.start,
  localTtyList: localTty.list,
  localTtyWrite: localTty.write,
  localTtyResize: localTty.resize,
  localTtyClose: localTty.close,
  localTtyRunAuthored: localTty.runAuthored,
  terminalCompletionComplete: terminalCompletion.complete,
  terminalCompletionAccept: terminalCompletion.accept,
  terminalCompletionImport: terminalCompletion.import,

  // ===== 监控扁平化 =====
  monitorStart: monitor.start,
  monitorStop: monitor.stop,
  monitorGetSystemInfo: monitor.getSystemInfo,

  // ===== 安全存储扁平化 =====
  storageSaveApiKey: storage.saveApiKey,
  storageHasApiKey: storage.hasApiKey,
  storageDeleteApiKey: storage.deleteApiKey,

  // ===== 配置存储扁平化 =====
  configGet: config.get,
  configSet: config.set,
  configSaveLlm: config.saveLlm,

  // ===== LLM 扁平化 =====
  llmChat: llm.chat,
  llmTest: llm.test,
  llmAnalyze: llm.analyze,
  llmValidate: llm.validate,
  llmChatWithContext: llm.chatWithContext,

  // ===== 服务器管理扁平化 =====
  serverList: server.list,
  serverSave: server.save,
  serverExport: server.export,
  serverImport: server.import,
  serverDeleteCred: server.deleteCred,

  // ===== 事件监听扁平化 =====
  onTerminalData: on.terminalData,
  onLocalTtyExit: on.localTtyExit,
  /** 监听 SSH 心跳保活状态变更（K.2） */
  onSshStateChanged: on.sshStateChanged,
  /** 监听主机密钥确认弹窗推送（Phase L） */
  onSshHostKeyPrompt: on.sshHostKeyPrompt,
  onMonitorData: on.monitorData,
  onMonitorSystemInfo: on.monitorSystemInfo,
  /** 监听 SFTP 上传/下载进度推送（v0.9.7 SFTP 文件浏览增强） */
  onSftpProgress: on.sftpProgress,
  onLlmToken: on.llmToken,
  onLlmChunk: on.llmChunk,
  onLlmDone: on.llmDone,
  onLlmError: on.llmError,
  onAgentStep: on.agentStep,
  // v0.9 Supervisor chat 流式事件
  onAgentChunk: on.agentChunk,
  onAgentDone: on.agentDone,
  onAgentError: on.agentError,
  /** v2.4：Agent 工具调用事件（真实工具执行可视化） */
  onAgentToolEvent: on.agentToolEvent,

  // v0.9 Claude Agent SDK 流式事件（独立于 Supervisor，避免通道混用）
  onClaudeSdkChunk: on.claudeSdkChunk,
  onClaudeSdkDone: on.claudeSdkDone,
  onClaudeSdkError: on.claudeSdkError,

  // v0.9 沙箱命令审批请求事件（P-2：HC-6 强制审批，主进程推送审批请求）
  onSandboxApprovalRequest: on.sandboxApprovalRequest,

  // v0.9.5 PAOR 审批请求事件（PAOR 循环遇到高危命令时推送审批请求）
  onPaorApprovalRequest: on.paorApprovalRequest,
  // v0.9.5 PAOR 迭代进度事件（每轮 Plan→Act→Observe→Reflect 完成后推送）
  onAgentPaorIteration: on.agentPaorIteration,

  // v0.9.3 §11 遗留项 2 P2-H：Task Protocol step 2 check-permission 审批请求事件
  // （Subagent 调度时主进程推送审批请求，用户响应后 step 2 继续/中止）
  onTaskPermissionApprovalRequest: on.taskPermissionApprovalRequest,

  // ===== MCP 扁平化（P1 修复：此前仅在 on 对象内定义、未暴露，前端永远调不到，
  // 而 electron.d.ts 却声明了这些方法 —— 类型与运行时不一致的结构性断链） =====
  // v0.9.5 P0：MCP 5 阶段生命周期状态机
  mcpGetState: on.mcpGetState,
  mcpReset: on.mcpReset,
  onMcpStateChanged: on.mcpStateChanged,
  // v0.9.6：外部 MCP Server（Client 侧）
  mcpExternalStatus: on.mcpExternalStatus,
  mcpExternalTools: on.mcpExternalTools,
  mcpExternalCall: on.mcpExternalCall,
  mcpExternalReconnect: on.mcpExternalReconnect,

  // ===== Agent 扁平化（旧 AgentWorkflow，v0.8 及之前） =====
  // 注意：v0.8 旧 agentCancel 已被 v0.9.4 新签名覆盖（通过 sessionId 统一取消多类会话）。
  // v0.8 旧 agent:cancel IPC 通道仍保留在主进程 ipc/agent.ts 中（向后兼容 IPC 层），
  // 但 preload 不再暴露 v0.8 旧 agentCancel 方法（v0.8 AgentWorkflow 已被 v0.9 Supervisor 取代）。
  agentStart: (sessionId: string, problem: string): Promise<boolean> =>
    ipcRenderer.invoke(AGENT.START, sessionId, problem),
  agentConfirm: (sessionId: string, approved: boolean): Promise<boolean> =>
    ipcRenderer.invoke(AGENT.CONFIRM, sessionId, approved),

  // ===== v0.9 Agent Runtime 扁平化（Supervisor chat + Provider + Token） =====
  agentChat: agentRuntime.chat,
  agentChatCancel: agentRuntime.cancel,
  // PAOR 自动循环（Plan→Act→Observe→Reflect 多步自主编排，方案书 §3.2）
  agentPaor: agentRuntime.paor,
  // v0.9.5 新增：响应 PAOR 审批请求（与 onPaorApprovalRequest 配合使用）
  paorApprove: agentRuntime.approve,
  // v0.9.4 新增：通过 sessionId 统一取消 agent:chat / claude-sdk 两类会话
  // 与 agentChatCancel 并存（向后兼容）：旧调用方继续用 agentChatCancel(correlationId)，
  // 新调用方推荐用 agentCancel(sessionId) 同时取消多类会话
  agentCancel: system.cancel,
  // v0.9.4 新增：系统级 IPC（协议版本 + 心跳保活）
  getProtocolVersion: system.getProtocolVersion,
  systemPing: system.ping,
  // A4 新增：数据库状态（渲染层降级横幅数据源，db:status）
  dbGetStatus: dbStatus.get,
  // v2.2 P1 修复 #24：应用更新 IPC（app:check-update / app:download-update）
  // 简化方案：HTTP GET GitHub Releases API + shell.openExternal，不引入 electron-updater
  appCheckUpdate: appUpdate.checkUpdate,
  appDownloadUpdate: appUpdate.downloadUpdate,
  // T.8：应用信息 IPC（app:get-info）
  appGetInfo: appUpdate.getInfo,
  // v2.3 活功能转换：导出模型统计 IPC（app:export-model-stats）
  // P0-1 修复：暴露到渲染层供 ModelSettings "导出统计" 按钮调用
  appExportModelStats: appUpdate.exportModelStats,
  // v2.2 P1 修复 #22：文件系统 IPC（fs:upload-image）
  // AIPanel 图片附件基础版：dialog + base64 data URL，不引入图片压缩库
  fsUploadImage: fsUpload.uploadImage,
  providerList: provider.list,
  providerGet: provider.get,
  providerSave: provider.save,
  providerSetDefault: provider.setDefault,
  providerGetDefault: provider.getDefault,
  tokenStats: token.stats,
  tokenReset: token.reset,
  // P-5 新增：token 使用明细记录（Token 监控面板展示明细列表 + 分布图表）
  tokenRecords: token.records,

  // ===== v0.9 Claude Agent SDK 扁平化（generate / stream / cancel） =====
  // 使用场景：Provider 选择器中选 claude-sdk 类型时走本通道，其他类型走 agentChat
  claudeSdkGenerate: claudeSdk.generate,
  claudeSdkStream: claudeSdk.stream,
  claudeSdkCancel: claudeSdk.cancel,

  // ===== v2.0 Phase B 扁平化：内联补全 + Diff 应用 =====
  // 通道与主进程 ipc/llm-inline.ts 一一对应；UI 调用方式：
  //   const items = await window.electronAPI.llmInlineCompletion(req)
  //   await window.electronAPI.llmInlineCompletionCancel()
  //   const r = await window.electronAPI.llmApplyDiff({ filePath, newContent })
  //   const { diff } = await window.electronAPI.llmDiffPreview({ filePath, originalContent, modifiedContent })
  llmInlineCompletion: llmInline.inlineCompletion,
  llmInlineCompletionCancel: llmInline.inlineCompletionCancel,
  llmApplyDiff: llmInline.applyDiff,
  llmDiffPreview: llmInline.diffPreview,

  // ===== v0.9 OpenHands 沙箱集成扁平化 =====
  // 通道与主进程 ipc/sandbox.ts 一一对应；UI 调用方式：
  //   const info = await window.electronAPI.sandboxCreate()
  //   const result = await window.electronAPI.sandboxExecute(info.id, 'ls', info.session_api_key!)
  sandboxDetectDocker: sandbox.detectDocker,
  sandboxStart: sandbox.start,
  sandboxStop: sandbox.stop,
  sandboxStatus: sandbox.status,
  sandboxCreate: sandbox.create,
  sandboxList: sandbox.list,
  sandboxExecute: sandbox.execute,
  // P-2：HC-6 强制审批响应通道（用户通过本函数响应主进程推送的 sandbox:approval-request）
  sandboxApprove: sandbox.approve,
  sandboxDelete: sandbox.delete,

  // ===== v0.9 @命令 8 类扁平化 =====
  // 通道与主进程 ipc/at-commands.ts 一一对应；UI 调用方式：
  //   const infos = await window.electronAPI.atList()
  //   const cmd = await window.electronAPI.atResolve('log', { rawText: '...' }, 'chat-input')
  //   const result = await window.electronAPI.atParse('请分析 @log[error]', 'chat-input')
  atList: atCommands.list,
  atResolve: atCommands.resolve,
  atParse: atCommands.parse,

  // ===== v0.9 可信度算法扁平化（D-S + PCR5 + 6 源证据 + DAG） =====
  // 通道与主进程 ipc/credibility.ts 一一对应；UI 调用方式：
  //   const assessment = await window.electronAPI.credibilityAssess(inputs)
  //   const dag = await window.electronAPI.credibilityDag(inputs)
  credibilityAssess: credibility.assess,
  credibilityDag: credibility.dag,
  // v0.9.6 P2：审计报告扁平化 API
  credibilityExportAuditReport: credibility.exportAuditReport,
  credibilityListAuditReports: credibility.listAuditReports,
  credibilityLoadAuditReport: credibility.loadAuditReport,
  credibilityFormatAuditReport: credibility.formatAuditReport,
  // v2.3.2 新增：按 decisionId 简化导出 HTML 报告
  credibilityExportAudit: (decisionId: string, format: string): Promise<string> =>
    ipcRenderer.invoke(CREDIBILITY.EXPORT_DECISION_HTML, decisionId, format),
  // v2.4 Phase C 收尾：校准扁平化 API（6 个，与 credibility 对象的校准方法一一对应）
  // UI 调用方式：
  //   const result = await window.electronAPI.credibilityCalibrate('deepseek', { tMin: 0.1 })
  //   const state = await window.electronAPI.credibilityGetCalibrationState()
  //   const ok = await window.electronAPI.credibilityAddCalibrationSample(sample)
  credibilityCalibrate: credibility.calibrate,
  credibilityGetCalibration: credibility.getCalibration,
  credibilityGetCalibrationState: credibility.getCalibrationState,
  credibilityResetCalibration: credibility.resetCalibration,
  credibilityComputeEce: credibility.computeEce,
  credibilityAddCalibrationSample: credibility.addCalibrationSample,

  // ===== M2 Task 2 新增：命令风险评估扁平化（risk:check） =====
  // 通道与主进程 ipc/risk.ts 一一对应；UI 调用方式：
  //   const { risk, reasons } = await window.electronAPI.riskCheck('rm -rf /')
  // 桥接 assessCommandRisk（AST 优先 + 正则降级），空命令返回 low（不抛错）
  riskCheck: (command: string): Promise<{ risk: 'low' | 'medium' | 'high'; reasons: string[] }> =>
    ipcRenderer.invoke(RISK.CHECK, command),

  // ===== 拦截规则表只读快照（risk:rules）=====
  // 设置页「命令风险评级规则」显示的就是主进程真正在用的那份数据，
  // 不再是页面自己维护、没人读的 risk.rules
  riskGetRules: (): Promise<RiskRulesSnapshot> => ipcRenderer.invoke(RISK.RULES),

  // ===== M3 Task 2 新增：告警确认扁平化（alert:ack） =====
  // 通道与主进程 ipc/alert.ts 一一对应；UI 调用方式：
  //   const ok = await window.electronAPI.alertAck('alert-id-xxx')
  // 主进程内存 Map 记录 ack 状态（不持久化），ack 成功返回 true，空 alertId 返回 false
  alertAck: (alertId: string): Promise<boolean> =>
    ipcRenderer.invoke(ALERT.ACK, alertId),

  // ===== M5 Task 3 新增：BootPage 加载阶段推送（boot:loading-stage） =====
  // 通道与主进程 ipc/boot.ts 一一对应；UI 调用方式：
  //   const unsubscribe = window.electronAPI.onBootLoadingStage((payload) => { ... })
  // payload: { stage: 'ipc-ready'|'sqlite-init'|'kb-indexed'|'done', progress: 0-100, message: string }
  // 返回 unsubscribe 函数，组件卸载时调用以避免内存泄漏
  onBootLoadingStage: (
    callback: (stage: { stage: string; progress: number; message: string }) => void,
  ) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) =>
      callback(payload as { stage: string; progress: number; message: string })
    ipcRenderer.on(BOOT.LOADING_STAGE, handler)
    return () => ipcRenderer.off(BOOT.LOADING_STAGE, handler)
  },
  // R0：拉取最近一次加载阶段。主进程 init 可能早于本页挂载，纯靠上面那条推送会错过 done
  bootGetState: (): Promise<{ stage: string; progress: number; message: string } | null> =>
    ipcRenderer.invoke(BOOT.GET_STATE),

  // ===== 知识库扁平化 =====
  kbSearch: (query: string, type: string, limit: number): Promise<unknown[]> =>
    ipcRenderer.invoke(KNOWLEDGE.SEARCH, query, type, limit),
  kbAdd: (entry: unknown): Promise<boolean> =>
    ipcRenderer.invoke(KNOWLEDGE.ADD, entry),
  kbUpdate: (id: string, entry: unknown): Promise<boolean> =>
    ipcRenderer.invoke(KNOWLEDGE.UPDATE, id, entry),
  kbDelete: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(KNOWLEDGE.DELETE, id),
  kbExport: (type: string): Promise<string> =>
    ipcRenderer.invoke(KNOWLEDGE.EXPORT, type),
  kbGet: (id: string): Promise<unknown> =>
    ipcRenderer.invoke(KNOWLEDGE.GET, id),
  kbImport: (data: string): Promise<number> =>
    ipcRenderer.invoke(KNOWLEDGE.IMPORT, data),
  kbView: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(KNOWLEDGE.VIEW, id),
  kbHot: (limit?: number): Promise<unknown[]> =>
    ipcRenderer.invoke(KNOWLEDGE.HOT, limit),
  kbRecentViews: (limit?: number): Promise<unknown[]> =>
    ipcRenderer.invoke(KNOWLEDGE.RECENT_VIEWS, limit),

  // ===== v2.8 Agent 长期记忆扁平化 =====
  // 自动沉淀记忆的查看/检索/删除/审计（写入由主进程 supervisor 自动完成，不走 IPC）
  memoryList: (type?: string): Promise<unknown[]> =>
    ipcRenderer.invoke(MEMORY.LIST, type),
  memorySearch: (query: string, limit?: number): Promise<unknown[]> =>
    ipcRenderer.invoke(MEMORY.SEARCH, query, limit),
  memoryDelete: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(MEMORY.DELETE, id),
  memoryAudit: (limit?: number): Promise<unknown[]> =>
    ipcRenderer.invoke(MEMORY.AUDIT, limit),

  // ===== 历史决策扁平化 =====
  historyList: (offset: number, limit: number): Promise<unknown[]> =>
    ipcRenderer.invoke(HISTORY.LIST, offset, limit),
  historyGet: (id: string): Promise<unknown> =>
    ipcRenderer.invoke(HISTORY.GET, id),
  // P-8 修复：补充暴露 history:save 通道（主进程已注册，但 preload 此前未暴露）
  // P0-5：入参从完整 DecisionCard 改成 HistorySaveIntent —— 风险/置信度/状态由主进程判定，
  // 渲染层只描述"发生了什么"。
  historySave: (intent: HistorySaveIntent): Promise<boolean> =>
    ipcRenderer.invoke(HISTORY.SAVE, intent),
  historyStats: (): Promise<unknown> =>
    ipcRenderer.invoke(HISTORY.STATS),

  // ===== 系统架构感知扁平化 =====
  // 走 profiler 域对象（原来这里把四条通道又内联抄了一遍，而 const profiler 只有被删掉的手写类型在用）
  profilerRun: profiler.run,
  profilerExportMd: profiler.exportMd,
  profilerExportPdf: profiler.exportPdf,
  profilerDefaultFileName: profiler.defaultFileName,

  // ===== 知识库教程扁平化 =====
  tutorialList: (category?: TutorialCategory): Promise<TutorialEntry[]> =>
    ipcRenderer.invoke(TUTORIAL.LIST, category),
  tutorialGet: (id: string): Promise<TutorialEntry | null> =>
    ipcRenderer.invoke(TUTORIAL.GET, id),
  tutorialSearch: (query: string, limit?: number): Promise<TutorialEntry[]> =>
    ipcRenderer.invoke(TUTORIAL.SEARCH, query, limit),
  tutorialCategories: (): Promise<TutorialCategorySummary[]> =>
    ipcRenderer.invoke(TUTORIAL.CATEGORIES),
  tutorialSeedVersion: (): Promise<string> =>
    ipcRenderer.invoke(TUTORIAL.SEED_VERSION),
  tutorialSeedReload: (): Promise<number> =>
    ipcRenderer.invoke(TUTORIAL.SEED_RELOAD),

  // ===== 教程爬虫扁平化（v0.6.0）=====
  tutorialListSources: (): Promise<TutorialSourceSpec[]> =>
    ipcRenderer.invoke(TUTORIAL.LIST_SOURCES),
  tutorialCrawlStart: (args?: { sourceIds?: string[]; force?: boolean }): Promise<{
    success: boolean
    error?: string
    results: CrawlResult[]
  }> => ipcRenderer.invoke(TUTORIAL.CRAWL_START, args),
  tutorialCrawlStatus: (): Promise<CrawlStatus> =>
    ipcRenderer.invoke(TUTORIAL.CRAWL_STATUS),
  tutorialCrawlCancel: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(TUTORIAL.CRAWL_CANCEL),

  // 教程爬虫事件监听
  onTutorialCrawlProgress: (callback: (progress: CrawlProgress) => void): (() => void) => {
    return createListener(TUTORIAL.CRAWL_PROGRESS, callback)
  },
  onTutorialCrawlDone: (callback: (result: CrawlResult) => void): (() => void) => {
    return createListener(TUTORIAL.CRAWL_DONE, callback)
  },

  // v2.5 Phase C：异步回填进度推送监听（主 → 渲染，每页完成后触发）
  // 通道：tutorial:backfill-progress（TUTORIAL.BACKFILL_PROGRESS 常量）
  // 主进程推送位置：src/main/services/tutorial/backfill-service.ts:449
  //   win.webContents.send(TUTORIAL.BACKFILL_PROGRESS, p)
  // UI 调用示例：
  //   useEffect(() => {
  //     const off = window.electronAPI.onTutorialBackfillProgress(p => setPct(p.pct))
  //     return off  // 组件卸载时自动取消监听
  //   }, [])
  onTutorialBackfillProgress: (callback: (progress: BackfillProgress) => void): (() => void) => {
    return createListener(TUTORIAL.BACKFILL_PROGRESS, callback)
  },

  // ===== 教程磁盘 + 断点续传（v0.7.0）=====
  tutorialDiskInfo: (): Promise<{
    tempBytes: number
    knowledgeBytes: number
    quotaBytes: number
    usageRatio: number
    bySource: Array<{ sourceId: string; bytes: number; files: number }>
    orphanFiles: number
  }> => ipcRenderer.invoke(TUTORIAL.DISK_INFO),
  tutorialCleanupOrphans: (): Promise<{ success: boolean; cleanedBytes: number }> =>
    ipcRenderer.invoke(TUTORIAL.CLEANUP_ORPHANS),
  tutorialCheckpoints: (): Promise<
    Array<{
      sourceId: string
      lastCrawledAt: number
      completedUrls: string[]
      totalBytes: number
      etag: string | null
      status: 'running' | 'paused' | 'done' | 'failed'
      errorMessage: string | null
      updatedAt: number
    }>
  > => ipcRenderer.invoke(TUTORIAL.CHECKPOINTS),
  tutorialResetCheckpoint: (sourceId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(TUTORIAL.RESET_CHECKPOINT, sourceId),

  // ===== 教程混合检索 + embedding 回填 + 检索状态（v0.9.6 Sprint 7 任务 E）=====
  // 通道与主进程 ipc/tutorial.ts 一一对应：
  // - tutorial:hybrid-search      → tutorialHybridSearch（FTS5 BM25 + vec0 KNN + RRF 融合）
  // - tutorial:backfill-embeddings → tutorialBackfillEmbeddings（回填缺失 embedding）
  // - tutorial:search-status      → tutorialSearchStatus（检索能力快照）
  //
  // 通道名说明：
  //   原任务描述为 `tutorial:search`，但该通道已被现有 Jaccard 关键词搜索占用
  //   （返回 TutorialEntry[]）。为遵守"不破坏现有 API"约束，改用 `tutorial:hybrid-search`。
  //   现有 tutorialSearch（Jaccard 关键词搜索）保持不变。
  /**
   * 混合检索（FTS5 BM25 + vec0 KNN + RRF 融合）
   *
   * @param query 用户查询字符串
   * @param options.type 知识类型过滤（默认 'tutorial'）
   * @param options.limit 返回数量上限（默认 10）
   * @param options.useVector 是否启用向量检索（默认 true）
   * @returns HybridSearchResult[]（按 rrfScore 降序）
   */
  tutorialHybridSearch: (
    query: string,
    options?: TutorialHybridSearchOptions
  ): Promise<HybridSearchResult[]> =>
    ipcRenderer.invoke(TUTORIAL.HYBRID_SEARCH, query, options),
  /**
   * 回填缺失的 embedding 字段（长任务，2578 条需 1-3 分钟）
   *
   * @param options.batchSize 每批大小（默认 8）
   * @returns { total, success, failed, error? } 统计信息
   */
  tutorialBackfillEmbeddings: (
    options?: TutorialBackfillOptions
  ): Promise<TutorialBackfillResult> =>
    ipcRenderer.invoke(TUTORIAL.BACKFILL_EMBEDDINGS, options),
  /**
   * 获取检索状态（向量是否可用 + 模型是否加载 + 总条目数）
   *
   * @returns TutorialSearchStatus（vectorEnabled / embeddingModelLoaded / embeddingDim / totalEntries）
   */
  tutorialSearchStatus: (): Promise<TutorialSearchStatus> =>
    ipcRenderer.invoke(TUTORIAL.SEARCH_STATUS),

  // ===== v2.5 Phase C：异步分批回填（推荐用法，替代 tutorialBackfillEmbeddings 同步阻塞）=====
  // 通道与主进程 ipc/tutorial.ts 一一对应：
  // - tutorial:backfill-start    → tutorialBackfillStart（启动异步任务，立即返回 taskId）
  // - tutorial:backfill-cancel   → tutorialBackfillCancel（标记取消，下一页检查时生效）
  // - tutorial:backfill-status   → tutorialBackfillStatus（查询是否有任务在运行）
  // - tutorial:backfill-progress → onTutorialBackfillProgress（订阅进度推送，见 on 对象）
  //
  // 类型来源：@shared/tutorial-types.ts
  // UI 调用示例：
  //   const { ok, taskId } = await window.electronAPI.tutorialBackfillStart({ pageSize: 100 })
  //   const unsubscribe = window.electronAPI.onTutorialBackfillProgress(p => setPct(p.pct))
  //   await window.electronAPI.tutorialBackfillCancel()
  /**
   * 启动异步分批回填任务（非阻塞，立即返回 taskId）
   *
   * @param options.pageSize 分页大小（默认 100，每次查询 100 条进行推理）
   * @param options.inferenceBatch 推理批次大小（默认 8，ONNX 内部 batching）
   * @returns { ok, taskId, error? } 启动结果（ok=false 时 error 描述原因，如"已有任务在运行"）
   */
  tutorialBackfillStart: (
    options?: BackfillStartOptions
  ): Promise<BackfillStartResult> =>
    ipcRenderer.invoke(TUTORIAL.BACKFILL_START, options),
  /**
   * 取消正在运行的回填任务（标记 cancelled，下一页检查时生效）
   *
   * @returns { ok } 是否成功标记取消（任务未运行时也返回 ok=true）
   */
  tutorialBackfillCancel: (): Promise<BackfillCancelResult> =>
    ipcRenderer.invoke(TUTORIAL.BACKFILL_CANCEL),
  /**
   * 查询回填任务状态（是否有任务在运行）
   *
   * @returns { running, taskId } 运行状态（taskId 为 null 表示无任务）
   */
  tutorialBackfillStatus: (): Promise<BackfillStatusResult> =>
    ipcRenderer.invoke(TUTORIAL.BACKFILL_STATUS),

  // ===== 学习路径推荐（v0.9.6 Sprint 9）=====
  // 通道与主进程 ipc/tutorial.ts 一一对应：
  // - tutorial:recommend-path → tutorialRecommendPath（4 层融合路径推荐）
  //
  // 使用场景：
  // - 新手入门：从 linux-basics 开始，按依赖图逐步深入
  // - 定向提升：指定目标分类（如 networking），推荐前置 + 同级 + 进阶
  // - 命令驱动：学完某个命令后，推荐关联命令教程
  /**
   * 推荐学习路径（4 层融合：分类依赖 + 难度递进 + 命令关联 + 混合检索）
   *
   * @param options.goal 学习目标（自然语言，如"想学 Docker"）
   * @param options.currentLevel 当前水平（如 beginner / intermediate / advanced）
   * @param options.preferredCategory 偏好分类（如 networking）
   * @param options.maxSteps 最大步骤数（默认 8）
   * @returns TutorialPath[]（按融合分数排序的学习路径）
   */
  tutorialRecommendPath: (options?: RecommendPathOptions): Promise<TutorialPath[]> =>
    ipcRenderer.invoke(TUTORIAL.RECOMMEND_PATH, options),
  tutorialStats: (): Promise<unknown> =>
    ipcRenderer.invoke(TUTORIAL.STATS),
  // v2.3.2 新增：教程学习进度跨设备同步（替代 localStorage 过渡方案）
  //   const progress = await window.electronAPI.tutorialProgress()
  //   await window.electronAPI.tutorialUpdateProgress('nginx-tuning', 'visited', 50)
  tutorialProgress: (): Promise<unknown[]> =>
    ipcRenderer.invoke(TUTORIAL.PROGRESS),
  tutorialUpdateProgress: (
    tutorialId: string,
    status: 'visited' | 'completed',
    progress: number,
  ): Promise<boolean> =>
    ipcRenderer.invoke(TUTORIAL.UPDATE_PROGRESS, tutorialId, status, progress),

  // ===== v2.3.2 模型统计 + 预算告警扁平化 =====
  // 通道与主进程 ipc/model-stats.ts 一一对应；UI 调用方式：
  //   const stats = await window.electronAPI.modelToolCalls()
  //   const alerts = await window.electronAPI.budgetAlerts(20)
  modelToolCalls: (): Promise<unknown[]> =>
    ipcRenderer.invoke(MODEL_STATS.TOOL_CALLS),
  budgetAlerts: (limit?: number): Promise<unknown[]> =>
    ipcRenderer.invoke(BUDGET.ALERTS, limit),

  // ===== Web 部署助手扁平化 =====
  deployListTemplates: (): Promise<DeployTemplateModel[]> =>
    ipcRenderer.invoke(DEPLOY.LIST_TEMPLATES),
  deployGetTemplate: (id: string): Promise<DeployTemplateModel | null> =>
    ipcRenderer.invoke(DEPLOY.GET_TEMPLATE, id),
  deployValidate: (
    templateId: string,
    values: Record<string, string>
  ): Promise<string[]> => ipcRenderer.invoke(DEPLOY.VALIDATE, templateId, values),
  deployBuild: (
    templateId: string,
    values: Record<string, string>,
    targetHost: string
  ): Promise<{ plan?: DeployPlanModel; errors: string[] }> =>
    ipcRenderer.invoke(DEPLOY.BUILD, templateId, values, targetHost),
  deployExecute: (
    plan: DeployPlanModel,
    sessionId: string
  ): Promise<DeployResultModel> => ipcRenderer.invoke(DEPLOY.EXECUTE, plan, sessionId),
  deployCancel: (planId: string): Promise<boolean> =>
    ipcRenderer.invoke(DEPLOY.CANCEL, planId),
  deployGetStatus: (planId: string): Promise<{ status: string; currentIndex: number; total: number } | null> =>
    ipcRenderer.invoke(DEPLOY.GET_STATUS, planId),

  // 部署事件监听
  onDeployLog: (callback: (event: DeployLogEventModel) => void): (() => void) => {
    return createListener(DEPLOY.LOG, callback)
  },
  onDeployStepUpdate: (
    callback: (payload: { planId: string; step: DeployStepResultModel }) => void
  ): (() => void) => {
    return createListener(DEPLOY.STEP_UPDATE, callback)
  },
  onDeployDone: (callback: (result: DeployResultModel) => void): (() => void) => {
    return createListener(DEPLOY.DONE, callback)
  },

  // ===== LLM Tool Calling 扁平化（v0.5.0）=====
  llmChatWithTools: (messages: ChatMessage[]): Promise<string> =>
    ipcRenderer.invoke(LLM.CHAT_WITH_TOOLS, messages),
  llmToolApprove: (response: ToolApprovalResponse): Promise<boolean> =>
    ipcRenderer.invoke(LLM.TOOL_APPROVE, response),

  // 工具调用事件监听
  onLlmToolProgress: (callback: (progress: ToolCallProgress) => void): (() => void) => {
    return createListener(LLM.TOOL_PROGRESS, callback)
  },
  onLlmToolApproval: (callback: (request: ToolApprovalRequest) => void): (() => void) => {
    return createListener(LLM.TOOL_APPROVAL, callback)
  },

  // ===== 日志系统（v0.7.0）=====
  /** 读取日志条目（按条件过滤） */
  logRead: (filter?: { level?: string; category?: string; categoryPrefix?: string; keyword?: string; since?: string; limit?: number }): Promise<unknown[]> =>
    ipcRenderer.invoke(LOG.READ, filter),
  /** 获取日志统计 */
  logStats: (): Promise<{ total: number; byLevel: Record<string, number>; byCategory: Record<string, number>; oldestTs: string | null; newestTs: string | null }> =>
    ipcRenderer.invoke(LOG.STATS),
  /** 清空内存 buffer */
  logClearBuffer: (): Promise<boolean> =>
    ipcRenderer.invoke(LOG.CLEAR_BUFFER),
  /** 设置最低日志级别 */
  logSetMinLevel: (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'): Promise<boolean> =>
    ipcRenderer.invoke(LOG.SET_MIN_LEVEL, level),
  /** 异步刷新待写入日志 */
  logFlush: (): Promise<boolean> =>
    ipcRenderer.invoke(LOG.FLUSH),
  /** 渲染进程日志上报（转发到主进程 logger） */
  logRenderer: (payload: { level: string; category: string; message: string; meta?: Record<string, unknown>; correlationId?: string }): Promise<boolean> =>
    ipcRenderer.invoke(LOG.RENDERER, payload),

  // ===== v0.9.5 P0 新增：5 组缺失 IPC 通道扁平化（17 个方法） =====
  // 通道与主进程 ipc/{token-stats,mode,attention,subagent,provider-info}.ts 一一对应
  // UI 调用方式：
  //   const cost = await window.electronAPI.tokenCostStats()
  //   const modes = await window.electronAPI.modeList()
  //   const current = await window.electronAPI.attentionCurrent()
  //   const agents = await window.electronAPI.subagentList()
  //   const caps = await window.electronAPI.providerCapabilities({ providerId: 'xxx' })

  // 组 1：Token 成本透明（1 个）
  tokenCostStats: tokenCostStats.costStats,

  // 组 2：Mode 五模式切换（3 个）
  modeList: mode.list,
  modeSetDefault: mode.setDefault,
  modeGetCurrent: mode.getCurrent,

  // 组 3：Attention 注意力跟踪（7 个）
  attentionCurrent: attention.current,
  attentionHistory: attention.history,
  attentionTrackFiles: attention.trackFiles,
  attentionTrackCommands: attention.trackCommands,
  attentionTrackErrors: attention.trackErrors,
  attentionTrackKeywords: attention.trackKeywords,
  attentionReset: attention.reset,

  // v0.9.4 批次 4 - 任务 5 P2-E：预期回显监控（2 个）
  expectationCheck: expectation.check,
  expectationFormat: expectation.format,

  // v0.9.3 §11 遗留项 2 P2-H：Task Protocol step 2 check-permission 审批（1 个）
  // 用户通过本函数响应主进程推送的 task:permission-approval-request
  taskPermissionApprove: taskPermission.approve,

  // 组 4：Subagent 自定义 Agent 加载器（2 个）
  subagentList: subagent.list,
  subagentReload: subagent.reload,

  // 组 5：Provider Info 能力 + 定价透明（4 个）
  providerCapabilities: providerInfo.capabilities,
  providerCapabilitiesAll: providerInfo.capabilitiesAll,
  providerPricing: providerInfo.pricing,
  providerPricingAll: providerInfo.pricingAll,

  // ===== v1.0 新增：Sidecar-A 进程管理 + 端到端 Pipeline =====
  // 通道与主进程 ipc/sidecar.ts 一一对应：
  // - sidecar:start    → sidecarStart（启动 Sidecar-A 进程）
  // - sidecar:stop     → sidecarStop（停止 Sidecar-A 进程）
  // - sidecar:status   → sidecarStatus（获取 Sidecar 状态）
  // - sidecar:health   → sidecarHealth（主动健康检查）
  // - sidecar:pipeline → sidecarPipeline（端到端 pipeline：日志 → Drain3 → OpenDerisk）
  /**
   * 启动 Sidecar-A 进程（SRE + 日志解析）
   * 通道：sidecar:start
   */
  sidecarStart: (): Promise<{ ok: boolean; status: string; error?: string }> =>
    ipcRenderer.invoke(SIDECAR.START),
  /**
   * 停止 Sidecar-A 进程
   * 通道：sidecar:stop
   */
  sidecarStop: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(SIDECAR.STOP),
  /**
   * 获取 Sidecar 当前状态（stopped/starting/ready/degraded/crashed）
   * 通道：sidecar:status
   */
  sidecarStatus: (): Promise<{ status: string; lastError: string | null; restartCount: number }> =>
    ipcRenderer.invoke(SIDECAR.STATUS),
  /**
   * 主动健康检查（调用 Sidecar-A /health 端点）
   * 通道：sidecar:health
   */
  sidecarHealth: (): Promise<{ ok: boolean; error?: string; status?: string; version?: string; adapters?: { drain3: { ready: boolean; total_clusters: number }; open_derisk: { ready: boolean; mode: string; rules_count: number } }; uptime_seconds?: number }> =>
    ipcRenderer.invoke(SIDECAR.HEALTH),
  /**
   * 端到端 Pipeline（v1.0 核心，v1.5 增强）：日志输入 → Drain3 解析 → OpenDerisk 诊断
   * 通道：sidecar:pipeline
   * @param logLines 原始日志行列表
   * @param serviceName 服务名（可选，辅助诊断）
   * @param llmConfig v1.5 新增：LLM 配置（启用 LLM 增强诊断，API Key 为空时降级到规则）
   */
  sidecarPipeline: (
    logLines: string[],
    serviceName?: string,
    llmConfig?: { apiKey: string; baseUrl: string; model: string },
  ): Promise<
    | {
        ok: true
        data: {
          parse: {
            templates: Array<{
              template_id: string
              template: string
              count: number
              examples: string[]
            }>
            total_lines: number
            unique_templates: number
          }
          diagnose: {
            root_cause: string
            confidence: number
            severity: string
            recommendations: string[]
            reasoning: string[]
            source: string
            // v1.5 新增字段
            related_risks?: string[]
            rule_confidence?: number | null
            llm_confidence?: number | null
          }
        }
      }
    | { ok: false; error: string }
  > => ipcRenderer.invoke(SIDECAR.PIPELINE, logLines, serviceName, llmConfig),

  // ===== v1.5 新增：多 Sidecar 状态查询（v1.5 多 Sidecar 架构）=====
  // 通道：sidecar:list-status → 返回 sidecar 状态
  // 使用场景：UI 状态条 / SidecarStatusPanel 展示
  sidecarListStatus: (): Promise<SidecarListStatusResponse> =>
    ipcRenderer.invoke(SIDECAR.LIST_STATUS),

  // 通道：sidecar:start-one → 启动指定 sidecar
  sidecarStartOne: (
    sidecarId: string,
  ): Promise<{ ok: boolean; status: string; error?: string }> =>
    ipcRenderer.invoke(SIDECAR.START_ONE, sidecarId),

  // 通道：sidecar:stop-one → 停止指定 sidecar
  sidecarStopOne: (sidecarId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(SIDECAR.STOP_ONE, sidecarId),

  // 通道：sidecar:health-one → 单个 sidecar 的健康检查
  sidecarHealthOne: (
    sidecarId: string,
  ): Promise<SidecarHealthOneResponse> =>
    ipcRenderer.invoke(SIDECAR.HEALTH_ONE, sidecarId),

  // 通道：sidecar:tool-call → 通用 Sidecar 工具调用
  sidecarToolCall: (
    sidecarId: string,
    endpoint: string,
    payload: unknown,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke(SIDECAR.TOOL_CALL, sidecarId, endpoint, payload),

  // 通道：sidecar:parse-logs → 单独调用 Drain3 解析（不调 OpenDerisk）
  sidecarParseLogs: (
    logLines: string[],
    maxClusters?: number,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke(SIDECAR.PARSE_LOGS, logLines, maxClusters),

  // ===== v1.5 新增：Promptfoo 红队 / Prompt 评估 =====
  // 通道：promptfoo:run-red-team → 运行红队测试（注入攻击场景，验证模型安全性）
  promptfooRunRedTeam: (
    modelProvider?: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke(PROMPTFOO.RUN_RED_TEAM, modelProvider),

  // 通道：promptfoo:run-eval → 运行 Prompt 评估（基于断言的 prompt 质量评估）
  promptfooRunEval: (
    modelProvider?: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke(PROMPTFOO.RUN_EVAL, modelProvider),

  // 通道：promptfoo:list-tests → 列出所有可用测试用例
  promptfooListTests: (): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke(PROMPTFOO.LIST_TESTS),

  // ===== v1.5 新增：诊断服务（后端日志检测）=====
  // 通道：diagnostics:get-report → 获取完整诊断报告（含统计 + 检测结果）
  diagnosticsGetReport: (): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke(DIAGNOSTICS.GET_REPORT),

  // 通道：diagnostics:get-logs → 获取缓冲区日志（可按来源/级别过滤）
  diagnosticsGetLogs: (
    options?: { source?: 'sre' | 'main' | 'renderer'; level?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'; limit?: number },
  ): Promise<{ ok: boolean; data?: unknown; total?: number; error?: string }> =>
    ipcRenderer.invoke(DIAGNOSTICS.GET_LOGS, options),

  // 通道：diagnostics:get-findings → 获取检测结果（可按严重性过滤）
  diagnosticsGetFindings: (
    options?: { severity?: 'info' | 'warning' | 'error' | 'critical'; limit?: number },
  ): Promise<{ ok: boolean; data?: unknown; total?: number; error?: string }> =>
    ipcRenderer.invoke(DIAGNOSTICS.GET_FINDINGS, options),

  // 通道：diagnostics:get-stats → 获取累计统计
  diagnosticsGetStats: (): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke(DIAGNOSTICS.GET_STATS),

  // 通道：diagnostics:clear → 清空缓冲区（保留累计统计）
  diagnosticsClear: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(DIAGNOSTICS.CLEAR),

  // 通道：diagnostics:set-enabled → 启用/禁用实时推送
  diagnosticsSetEnabled: (enabled: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(DIAGNOSTICS.SET_ENABLED, enabled),

  // 通道：diagnostics:ingest-test → 测试用：注入测试日志（仅 dev 模式）
  diagnosticsIngestTest: (
    event: { source: 'sre' | 'main' | 'renderer'; level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'; raw: string },
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(DIAGNOSTICS.INGEST_TEST, event),

  /**
   * 监听诊断服务实时日志批次推送
   *
   * 主进程通过 diagnostics:log-batch 通道批量推送 LogPushEvent[]，
   * 包含 Sidecar 的 stdout/stderr 日志和检测结果。
   *
   * @param callback 回调函数，接收 LogPushEvent[]
   * @returns 取消监听函数
   */
  onDiagnosticsLogBatch: (
    callback: (events: Array<{
      event: { timestamp: string; source: string; level: string; raw: string; pid?: number }
      hasFinding: boolean
      finding?: unknown
    }>) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, events: unknown) => callback(events as never)
    ipcRenderer.on(DIAGNOSTICS.LOG_BATCH, handler)
    return () => { ipcRenderer.off('diagnostics:log-batch', handler) }
  },

  // ===== v1.5 新增：循环工程子 Agent（假设计 → 可演示真 IDE）=====
  //
  // 通道与主进程 ipc/loop-engineering.ts 一一对应。
  // 设计目标：让 Workbench AIPanel 的"演示模式"调用真实 LLM 推理 + 7 步 HITL 工作流。
  //
  // 使用场景：
  //   1. 用户在 AIPanel 输入问题（如"磁盘空间不足"）
  //   2. 调用 loopStart({ problem, connId, providerId?, strength? }) 启动循环工程
  //   3. 监听 onLoopLlmStart → onLoopLlmDone（LLM 推理阶段）
  //   4. 监听 onLoopStep（7 步 HITL 步骤变化：collect→analyze→reason→check→confirm→execute→verify）
  //   5. 监听 onLoopDecision（决策卡片就绪，显示批准/拒绝按钮）
  //   6. 用户点击批准 → 调用 loopConfirm(correlationId, true)
  //   7. 监听 onLoopDone（工作流完成，含最终 DecisionCard）
  //   8. 用户点击拒绝 → 调用 loopConfirm(correlationId, false) 或 loopCancel(correlationId)

  // 通道：loop:start → 启动循环工程
  loopStart: (
    input: {
      problem: string
      connId: string
      providerId?: string
      strength?: 'fast' | 'standard' | 'deep'
    },
  ): Promise<{ correlationId: string; status: string; error?: string }> =>
    ipcRenderer.invoke(LOOP.START, input),

  // 通道：loop:confirm → 人工确认（批准/拒绝/修改后批准）
  // T.6: 新增可选 newCommand 参数，支持 DecisionDetailPage 修改修复命令后批准执行
  loopConfirm: (correlationId: string, approved: boolean, newCommand?: string): Promise<boolean> =>
    ipcRenderer.invoke(LOOP.CONFIRM, correlationId, approved, newCommand),

  // 通道：loop:cancel → 取消工作流
  loopCancel: (correlationId: string): Promise<boolean> =>
    ipcRenderer.invoke(LOOP.CANCEL, correlationId),

  // 事件：loop:llm-start — LLM 推理开始
  onLoopLlmStart: (
    callback: (payload: { type: 'loop:llm-start'; correlationId: string; problem: string }) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload as never)
    ipcRenderer.on(LOOP.LLM_START, handler)
    return () => { ipcRenderer.off('loop:llm-start', handler) }
  },

  // 事件：loop:llm-done — LLM 推理完成（含 hypothesis + fixCommand + confidence）
  onLoopLlmDone: (
    callback: (payload: {
      type: 'loop:llm-done'
      correlationId: string
      hypothesis: { hypothesis: string; fixCommand: string; confidence: number }
    }) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload as never)
    ipcRenderer.on(LOOP.LLM_DONE, handler)
    return () => { ipcRenderer.off('loop:llm-done', handler) }
  },

  // 事件：loop:step — 工作流步骤变化（含完整 AgentWorkflowState）
  onLoopStep: (
    callback: (payload: {
      type: 'loop:step'
      correlationId: string
      state: {
        currentStep: 'collect' | 'analyze' | 'reason' | 'check' | 'confirm' | 'execute' | 'verify'
        completedSteps: string[]
        stepDetails: Record<string, string>
        waitingForConfirmation: boolean
        decisionCard: unknown | null
        error: string | null
        timestamp: number
      }
    }) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload as never)
    ipcRenderer.on(LOOP.STEP, handler)
    return () => { ipcRenderer.off('loop:step', handler) }
  },

  // 事件：loop:decision — 决策卡片就绪（等待用户确认）
  onLoopDecision: (
    callback: (payload: {
      type: 'loop:decision'
      correlationId: string
      state: unknown
      decisionCard: {
        id: string
        problem: string
        hypothesis: string
        evidences: unknown[]
        confidence: number
        risk: { level: string; score: number; description: string; requireConfirmation: boolean; blocked: boolean }
        fixCommand: string
        fixDescription: string
        rollbackCommand?: string
        status: string
        timestamp: number
      }
    }) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload as never)
    ipcRenderer.on(LOOP.DECISION, handler)
    return () => { ipcRenderer.off('loop:decision', handler) }
  },

  // 事件：loop:done — 工作流完成（含最终 DecisionCard）
  onLoopDone: (
    callback: (payload: {
      type: 'loop:done'
      correlationId: string
      state: unknown
      decisionCard: unknown | null
    }) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload as never)
    ipcRenderer.on(LOOP.DONE, handler)
    return () => { ipcRenderer.off('loop:done', handler) }
  },

  // 事件：loop:error — 工作流出错
  onLoopError: (
    callback: (payload: { type: 'loop:error'; correlationId: string; error: string; state?: unknown }) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload as never)
    ipcRenderer.on(LOOP.ERROR, handler)
    return () => { ipcRenderer.off('loop:error', handler) }
  },

  // 事件：loop:blocked — 工作流被阻止（如 SSH 未连接）
  onLoopBlocked: (
    callback: (payload: {
      type: 'loop:blocked'
      correlationId: string
      step: string
      reason: string
      message: string
    }) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload as never)
    ipcRenderer.on(LOOP.BLOCKED, handler)
    return () => { ipcRenderer.off('loop:blocked', handler) }
  },

  // ===== Phase 6 Task 6.5：调度器扁平化（定时任务自动化）=====
  // 通道与主进程 ipc/scheduler.ts 一一对应；UI 调用方式：
  //   const tasks = await window.electronAPI.schedulerList()
  //   await window.electronAPI.schedulerToggle('daily-health-check', false)
  //   const result = await window.electronAPI.schedulerTrigger('daily-health-check')
  //   const off = window.electronAPI.onSchedulerStatusChange((status) => { ... })
  schedulerList: scheduler.list,
  schedulerToggle: scheduler.toggle,
  schedulerTrigger: scheduler.trigger,
  // 事件监听：scheduler:status — 任务状态变更推送
  onSchedulerStatusChange: on.schedulerStatus,

  // ===== v2.0 Phase C 扁平化：SFTP 文件搜索 + grep + 文件监听 =====
  // 通道与主进程 ipc/sftp-search.ts / ipc/file-watcher.ts 一一对应；UI 调用方式：
  //   const { files } = await window.electronAPI.sftpSearch(sessionId, '/etc', 'nginx')
  //   const { results } = await window.electronAPI.sftpGrep({ sessionId, path, pattern, ... })
  //   const { watchId } = await window.electronAPI.fileWatchStart(sessionId, '/var/log')
  //   const off = window.electronAPI.onFileChanged((payload) => { ... })
  //   await window.electronAPI.fileWatchStop(watchId)
  sftpSearch: sftpSearch.search,
  sftpGrep: sftpSearch.grep,
  fileWatchStart: fileWatch.start,
  fileWatchStop: fileWatch.stop,
  // 事件监听：file:changed — 文件变更推送
  onFileChanged: on.fileChanged,
}

// 类型由实现派生（见文件下方 export type ElectronAPI = typeof electronApi）。
contextBridge.exposeInMainWorld('electronAPI', electronApi)

// electronAPI 的类型就是上面那份对象的类型。
// 以前这里另写了一份手写表，而暴露对象末尾用 as unknown as ElectronAPI 强转过去——
// 那条 cast 让 TS 不再检查实现与类型是否一致，名字表可以悄悄漂移（2026-10-07 实测漂到 39 条）。
// 现在类型由实现派生：少挂一个方法就少一个方法，不存在第二份事实。
export type ElectronAPI = typeof electronApi
