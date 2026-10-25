

import type { TutorialCategory, TutorialCategorySummary, TutorialEntry } from '@shared/tutorial-types'
import type { DecisionAuditView, ExternalMcpServer, ExternalMcpServerDraft, HistorySaveIntent, PreviewHandleInfo, PreviewTarget } from '@shared/models'
import type { BlockedCommandRecord } from '@shared/audit-types'
import type { ChatMessageRecord } from '@shared/chat-types'
// #79 第二批：这些返回类型以 shared/models 为单源写在实现侧，渲染层不再手写第二份。
import type {
  BudgetAlert,
  DecisionCard,
  HistoryStats,
  KbViewHistoryEntry,
  KnowledgeDeleteResult,
  KnowledgeEntry,
  KnowledgeType,
  ToolCallStat,
  TutorialProgress,
} from '@shared/models'
import type { RiskRulesSnapshot } from '@shared/ipc-channels'
import type { BootLoadingStage } from '@shared/boot-types'
import { ALERT, BOOT, BUDGET, CHAT, CREDIBILITY, HISTORY, KNOWLEDGE, LOG, LOOP, MEMORY, MCP, MODEL_STATS, PREVIEW, RISK, SIDECAR, TUTORIAL, WINDOW } from '@shared/ipc-channels'
import { IpcRendererEvent, contextBridge, ipcRenderer } from 'electron'
import type { HybridSearchResult, RecommendPathOptions, TutorialHybridSearchOptions, TutorialPath } from './types'
export type { FileChangeEvent, FileChangedPayload, SftpGrepMatch, SftpGrepParams, SftpSearchFileEntry } from './types'
import { invokeChecked, installIpcErrorUnwrap } from './ipc-util'
import { ssh } from './domains/ssh'
import { fileWatch, sftp, sftpSearch } from './domains/sftp'
import { agentRuntime } from './domains/agent'
import { credibility } from './domains/cognition'
import { localTty, sandbox, terminalCompletion } from './domains/terminal'
import { llm, provider, token, tokenCostStats } from './domains/llm'
import { appUpdate, config, dbStatus, fsUpload, monitor, profiler, scheduler, server, storage, system } from './domains/system'
import { on } from './domains/events'

// P1-2：解包必须装在第一次 invoke 之前。放在 import 之后的第一条语句 —— 上面那些
// import 只定义闭包、不发 IPC，所以这里装完再没有任何调用点能绕过它。
installIpcErrorUnwrap()

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
  sshListConfigHosts: ssh.listConfigHosts,

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

  // ===== 监控扁平化 =====
  monitorStart: monitor.start,
  monitorGetSystemInfo: monitor.getSystemInfo,

  // ===== 安全存储扁平化 =====
  storageSaveApiKey: storage.saveApiKey,
  storageHasApiKey: storage.hasApiKey,
  storageDeleteApiKey: storage.deleteApiKey,

  // ===== 配置存储扁平化 =====
  configGet: config.get,
  configSet: config.set,
  configSaveLlm: config.saveLlm,

  // ===== LLM 扁平化（只留"测试连接"，其余裸 llm 通道随 ipc/llm.ts 一起删） =====
  llmTest: llm.test,

  // ===== 服务器管理扁平化 =====
  serverList: server.list,
  serverSave: server.save,
  // serverExport / serverImport 已整删：界面只用要过原生对话框的 *File 两把键
  serverExportFile: server.exportFile,
  serverImportFile: server.importFile,
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
  // v0.9 Supervisor chat 流式事件
  onAgentChunk: on.agentChunk,
  onAgentDone: on.agentDone,
  onAgentError: on.agentError,
  /** v2.4：Agent 工具调用事件（真实工具执行可视化） */
  onAgentToolEvent: on.agentToolEvent,

  // v0.9 Claude Agent SDK 流式事件（独立于 Supervisor，避免通道混用）

  // v0.9 沙箱命令审批请求事件（P-2：HC-6 强制审批，主进程推送审批请求）
  onSandboxApprovalRequest: on.sandboxApprovalRequest,

  // v0.9.5 PAOR 审批请求事件（PAOR 循环遇到高危命令时推送审批请求）
  onPaorApprovalRequest: on.paorApprovalRequest,
  // v0.9.5 PAOR 迭代进度事件（每轮 Plan→Act→Observe→Reflect 完成后推送）
  onAgentPaorIteration: on.agentPaorIteration,


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
  // #173：外部服务器的登记面。读回来的形状里没有环境变量值，只有键名。
  mcpExternalList: (): Promise<ExternalMcpServer[]> =>
    invokeChecked<ExternalMcpServer[]>('mcpExternalList', MCP.EXTERNAL_LIST),
  mcpExternalAdd: (draft: ExternalMcpServerDraft): Promise<ExternalMcpServer> =>
    invokeChecked<ExternalMcpServer>('mcpExternalAdd', MCP.EXTERNAL_ADD, draft),
  mcpExternalRemove: (serverId: string): Promise<boolean> =>
    invokeChecked<boolean>('mcpExternalRemove', MCP.EXTERNAL_REMOVE, serverId),

  // ===== v0.9 Agent Runtime 扁平化（Supervisor chat + Provider + Token） =====
  agentChat: agentRuntime.chat,
  agentChatCancel: agentRuntime.cancel,
  // PAOR 自动循环（Plan→Act→Observe→Reflect 多步自主编排，方案书 §3.2）
  agentPaor: agentRuntime.paor,
  // v0.9.5 新增：响应 PAOR 审批请求（与 onPaorApprovalRequest 配合使用）
  paorApprove: agentRuntime.approve,
  // v0.9.4 新增：通过 sessionId 统一取消 agent:chat 会话
  // 与 agentChatCancel 并存（向后兼容）：旧调用方继续用 agentChatCancel(correlationId)，
  // 新调用方推荐用 agentCancel(sessionId) 同时取消多类会话
  agentCancel: system.cancel,
  // v0.9.4 新增：系统级 IPC（协议版本 + 心跳保活）
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
  providerSave: provider.save,
  providerSetDefault: provider.setDefault,
  providerGetDefault: provider.getDefault,
  tokenStats: token.stats,
  // P-5 新增：token 使用明细记录（Token 监控面板展示明细列表 + 分布图表）
  tokenRecords: token.records,

  // ===== v0.9 OpenHands 沙箱集成扁平化 =====
  // 通道与主进程 ipc/sandbox.ts 一一对应；UI 调用方式：
  //   const info = await window.electronAPI.sandboxCreate()
  //   const result = await window.electronAPI.sandboxExecute(info.id, 'ls', info.session_api_key!)
  // sandboxStop / sandboxDetectDocker 已于 2026-10-24 整删：
  // 容器由退出收尾（quit-cleanup 的 stopOpenHands）负责收，Docker 检测已含在 sandboxStatus 里。
  sandboxStart: sandbox.start,
  sandboxStatus: sandbox.status,
  sandboxCreate: sandbox.create,
  sandboxList: sandbox.list,
  sandboxExecute: sandbox.execute,
  // P-2：HC-6 强制审批响应通道（用户通过本函数响应主进程推送的 sandbox:approval-request）
  sandboxApprove: sandbox.approve,
  sandboxDelete: sandbox.delete,

  // ===== v0.9 可信度算法扁平化（D-S + PCR5 + 6 源证据 + DAG） =====
  // 通道与主进程 ipc/credibility.ts 一一对应；UI 调用方式：
  //   const assessment = await window.electronAPI.credibilityAssess(inputs)
  //   const dag = await window.electronAPI.credibilityDag(inputs)
  credibilityAssess: credibility.assess,
  // v2.3.2 新增：按 decisionId 简化导出 HTML 报告
  // 2026-10-25 整删四把（#214）：credibilityExportAuditReport / ListAuditReports /
  // LoadAuditReport / FormatAuditReport——它们要渲染层整批递 AuditReportInput 再由主进程落盘盖指纹，
  // 而"从库里那一行拼出报告"只有下面这条活出口做了（主进程取数，界面只给 decisionId）。
  credibilityExportAudit: (decisionId: string, format: string): Promise<string> =>
    ipcRenderer.invoke(CREDIBILITY.EXPORT_DECISION_HTML, decisionId, format),
  // v2.4 Phase C 收尾：校准扁平化 API（4 个，与 credibility 对象的校准方法一一对应）
  // UI 调用方式：
  //   const result = await window.electronAPI.credibilityCalibrate('deepseek', { tMin: 0.1 })
  //   const state = await window.electronAPI.credibilityGetCalibrationState()
  credibilityCalibrate: credibility.calibrate,
  // credibilityGetCalibration(providerId) 已于 2026-10-24 整删：
  // 校准页要一次看 8 个 Provider，用的就是下面那份全量 state，单条读取从来没有调用点。
  credibilityGetCalibrationState: credibility.getCalibrationState,
  credibilityResetCalibration: credibility.resetCalibration,
  credibilityComputeEce: credibility.computeEce,
  // credibilityAddCalibrationSample 已于 2026-10-25 整删（#214）：handler 只写进程内存、不落库，
  // 校准样本真正的生产者在主进程的读者反馈链（calibration/decision-samples.ts）。

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
  // 通道与主进程 ipc/boot.ts 一一对应；载荷形状以 @shared/boot-types 为准。
  // UI 调用方式：const unsubscribe = window.electronAPI.onBootLoadingStage((p) => { ... })
  // 返回 unsubscribe 函数，组件卸载时调用以避免内存泄漏
  onBootLoadingStage: (callback: (stage: BootLoadingStage) => void) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) =>
      callback(payload as BootLoadingStage)
    ipcRenderer.on(BOOT.LOADING_STAGE, handler)
    // 必须显式返回 void：ipcRenderer.off() 自己回 IpcRenderer，直接箭头返回会让这个
    // "退订函数"带返回值，React 拿它当 effect cleanup 用时类型不合法（BootPage 就是这么用的）
    return () => {
      ipcRenderer.off(BOOT.LOADING_STAGE, handler)
    }
  },
  // R0：拉取最近一次加载阶段。主进程 init 可能早于本页挂载，纯靠上面那条推送会错过 done
  bootGetState: (): Promise<BootLoadingStage | null> => invokeChecked('bootGetState', BOOT.GET_STATE),

  // ===== 知识库扁平化 =====
  kbSearch: (query: string, type?: KnowledgeType, limit?: number): Promise<KnowledgeEntry[]> =>
    ipcRenderer.invoke(KNOWLEDGE.SEARCH, query, type, limit),
  kbAdd: (entry: KnowledgeEntry): Promise<boolean> =>
    ipcRenderer.invoke(KNOWLEDGE.ADD, entry),
  kbUpdate: (id: string, entry: Partial<KnowledgeEntry>): Promise<boolean> =>
    ipcRenderer.invoke(KNOWLEDGE.UPDATE, id, entry),
  kbDelete: (id: string): Promise<KnowledgeDeleteResult> =>
    ipcRenderer.invoke(KNOWLEDGE.DELETE, id),
  // kbExport 已于 2026-10-24 整删：列表页走 kbSearch、详情页走 kbGet，
  // "一次把全库读进渲染层"这条路从来没有调用点（详情页注释里记着它当年被 kbGet 取代）。
  kbGet: (id: string): Promise<KnowledgeEntry | null> =>
    ipcRenderer.invoke(KNOWLEDGE.GET, id),
  // kbImport（整批条目直接进库）已整删：导入只走下面这把选文件的键，
  // 形状与来源都在主进程侧校验，渲染层递数组写库那条路不再存在。
  // 弹打开框导入 Markdown/文本/JSON 知识文件（#180）：选文件与解析都在主进程
  kbImportFile: (): Promise<{
    ok: boolean
    canceled?: boolean
    files?: number
    inserted?: number
    updated?: number
    unchanged?: number
    embedded?: number
    rejected?: { file: string; source: string; reason: string }[]
    note?: string
    error?: string
  }> => invokeChecked('kbImportFile', KNOWLEDGE.IMPORT_FILE),
  // 给还没有向量的条目补齐语义索引（#180）
  kbReindexEmbeddings: (allowDownload: boolean): Promise<{
    ok: boolean
    needsDownload?: boolean
    embedded?: number
    failed?: number
    remaining?: number
    note?: string
    error?: string
  }> => invokeChecked('kbReindexEmbeddings', KNOWLEDGE.REINDEX_EMBEDDINGS, allowDownload),
  kbView: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(KNOWLEDGE.VIEW, id),
  kbHot: (limit?: number): Promise<KnowledgeEntry[]> =>
    ipcRenderer.invoke(KNOWLEDGE.HOT, limit),
  kbRecentViews: (limit?: number): Promise<KbViewHistoryEntry[]> =>
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
  historyList: (offset?: number, limit?: number): Promise<DecisionCard[]> =>
    ipcRenderer.invoke(HISTORY.LIST, offset, limit),
  historyGet: (id: string): Promise<DecisionCard | null> =>
    ipcRenderer.invoke(HISTORY.GET, id),
  // P-8 修复：补充暴露 history:save 通道（主进程已注册，但 preload 此前未暴露）
  // P0-5：入参从完整 DecisionCard 改成 HistorySaveIntent —— 风险/置信度/状态由主进程判定，
  // 渲染层只描述"发生了什么"。
  historySave: (intent: HistorySaveIntent): Promise<boolean> =>
    ipcRenderer.invoke(HISTORY.SAVE, intent),
  historyStats: (): Promise<HistoryStats> =>
    ipcRenderer.invoke(HISTORY.STATS),
  historyBlocks: (limit?: number): Promise<BlockedCommandRecord[]> =>
    invokeChecked<BlockedCommandRecord[]>('historyBlocks', HISTORY.BLOCKS, limit),
  // 任务 #174：审计链读的是库里那一份（含主进程重算的校验结论），渲染层不再自己算哈希
  historyAudit: (decisionId: string): Promise<DecisionAuditView> =>
    invokeChecked<DecisionAuditView>('historyAudit', HISTORY.AUDIT, decisionId),

  // ===== 对话历史落盘（#177）=====
  // 写的是"界面看到什么"那一份正本，取的是按会话过滤后的回看；两头的形状都由契约判
  chatAppend: (message: ChatMessageRecord): Promise<boolean> =>
    invokeChecked<boolean>('chatAppend', CHAT.APPEND, message),
  chatHistory: (sshSessionId: string | null, limit?: number): Promise<ChatMessageRecord[]> =>
    invokeChecked<ChatMessageRecord[]>('chatHistory', CHAT.LIST, sshSessionId, limit),
  chatClear: (sshSessionId: string | null): Promise<number> =>
    invokeChecked<number>('chatClear', CHAT.CLEAR, sshSessionId),

  // ===== 系统架构感知扁平化 =====
  // 走 profiler 域对象（原来这里把通道又内联抄了一遍，而 const profiler 只有被删掉的手写类型在用）
  // 默认文件名那把已于 #212 整删：导出落点改由主进程定，渲染层不再碰路径
  profilerRun: profiler.run,
  profilerExportMd: profiler.exportMd,
  profilerExportPdf: profiler.exportPdf,

  // ===== 知识库教程扁平化 =====
  // 「内容从哪来」那一侧的十九把管理键（抓取 / 磁盘 / 断点 / 回填 / 种子 / 检索状态 / 统计）
  // 已于 2026-10-24 整删（#211）：渲染层零调用，教程内容来自随包种子与知识库导入。
  tutorialList: (category?: TutorialCategory): Promise<TutorialEntry[]> =>
    ipcRenderer.invoke(TUTORIAL.LIST, category),
  tutorialGet: (id: string): Promise<TutorialEntry | null> =>
    ipcRenderer.invoke(TUTORIAL.GET, id),
  tutorialSearch: (query: string, limit?: number): Promise<TutorialEntry[]> =>
    ipcRenderer.invoke(TUTORIAL.SEARCH, query, limit),
  tutorialCategories: (): Promise<TutorialCategorySummary[]> =>
    ipcRenderer.invoke(TUTORIAL.CATEGORIES),

  // ===== 教程混合检索 =====
  // 通道与主进程 ipc/tutorial.ts 一一对应：
  // - tutorial:hybrid-search → tutorialHybridSearch（FTS5 BM25 + vec0 KNN + RRF 融合）
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
  // v2.3.2 新增：教程学习进度跨设备同步（替代 localStorage 过渡方案）
  //   const progress = await window.electronAPI.tutorialProgress()
  //   await window.electronAPI.tutorialUpdateProgress('nginx-tuning', 'visited', 50)
  tutorialProgress: (): Promise<TutorialProgress[]> =>
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
  modelToolCalls: (): Promise<ToolCallStat[]> =>
    ipcRenderer.invoke(MODEL_STATS.TOOL_CALLS),
  budgetAlerts: (limit?: number): Promise<BudgetAlert[]> =>
    ipcRenderer.invoke(BUDGET.ALERTS, limit),

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
  /** 异步刷新待写入日志 */
  /** 渲染进程日志上报（转发到主进程 logger） */
  logRenderer: (payload: { level: string; category: string; message: string; meta?: Record<string, unknown>; correlationId?: string }): Promise<boolean> =>
    ipcRenderer.invoke(LOG.RENDERER, payload),

  // ===== v0.9.5 P0 新增：缺失 IPC 通道扁平化 =====
  // 通道与主进程 ipc/{token-stats,subagent}.ts 一一对应
  // UI 调用方式：
  //   const cost = await window.electronAPI.tokenCostStats()
  //   const agents = await window.electronAPI.subagentList()
  // mode:* 三键已于 2026-10-24 整删（五模式既不注入 prompt 也不拦工具，渲染层零调用）；
  // providerCapabilities* / providerPricing* 四键同批删（能力随 provider:list 带出、
  // 成本由主进程按定价表算好后经 token:cost-stats 回一个数，这四把是同一份知识的第二个出口）。

  tokenCostStats: tokenCostStats.costStats,


  // ===== v1.0 新增：Sidecar-A 端到端 Pipeline =====
  // 通道与主进程 ipc/sidecar.ts 一一对应：
  // - sidecar:status   → sidecarStatus（获取 Sidecar 状态）
  // - sidecar:pipeline → sidecarPipeline（端到端 pipeline：日志 → Drain3 → OpenDerisk）
  // start / stop / health / list-status / -one 那一族 / tool-call / parse-logs 九把键
  // 已于 2026-10-24 整删（#207）：引擎由 pipeline 懒启动，健康读数走 app:get-info 那张实测表，
  // 多 Sidecar 管理面与任意 endpoint 通用调用口在界面上从来没有使用者。
  /**
   * 获取 Sidecar 当前状态（stopped/starting/ready/degraded/crashed）
   * 通道：sidecar:status
   */
  sidecarStatus: (): Promise<{ status: string; lastError: string | null; restartCount: number }> =>
    ipcRenderer.invoke(SIDECAR.STATUS),
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

  // ===== 诊断服务（v1.5）的界面出口已于 2026-10-24 整删（#206）=====
  //
  // 判据：diagnostics:get-report / get-logs / get-findings / get-stats / clear /
  // set-enabled / ingest-test 七个键在渲染层零调用，onDiagnosticsLogBatch 这个监听面
  // 也没有任何订阅者——主进程每秒往窗口推一批，界面一次都没接。两块生产者（Sidecar、
  // 循环工程）于是只往一块没人读的内存里写。日志内容改回落进应用日志；
  // 真正的"分析日志"能力走 MCP 的 log_analyze（它直接吃 LogAnalyzer，不经过这块缓冲）。

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
