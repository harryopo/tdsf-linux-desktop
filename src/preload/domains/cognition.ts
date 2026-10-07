/** cognition 域：从 src/preload/index.ts 按域拆出。暴露名以 index.ts 里的 electronApi 为准，快照闸盯着 */
import type { AttentionFocus, CommandExpectation, ConfidenceAssessment, CredibilityEvidenceInput, DagData, ExpectationCheckResult, ExpectationViolation, ModeCurrentResponse, ModeListResponse, ModeSetDefaultRequest, ModeSetDefaultResponse } from '@shared/agent-types'
import type { AuditFormat, AuditReportInput, ComplianceAuditReport } from '../../main/core/agent/credibility/audit/types'
import type { AuditReportListItem, ExportOptions, ExportResult } from '../../main/core/agent/credibility/audit/exporter'
import type { CalibrationSample, CalibrationState, EceResult, OptimizeTOptions, ProviderCalibration, ProviderId, TemperatureScalingResult } from '../../main/core/agent/credibility/calibration/types'
import type { FuseAssessOptions } from '../../main/core/agent/credibility/fusion-engine'
import { ATTENTION, CREDIBILITY, EXPECTATION, MODE, TASK } from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'
import type { TaskPermissionDecision } from '../types'

/**
 * v0.9 可信度算法 invoke 调用（D-S 证据理论 + PCR5 冲突融合 + 6 源证据）
 *
 * 通道与主进程 ipc/credibility.ts 一一对应：
 * - credibility:assess → assess
 * - credibility:dag    → dag
 *
 * v0.9.6 P2 扩展：审计报告 4 个通道：
 * - credibility:export-audit-report → exportAuditReport
 * - credibility:list-audit-reports  → listAuditReports
 * - credibility:load-audit-report   → loadAuditReport
 * - credibility:format-audit-report → formatAuditReport
 *
 * 使用场景：
 * - ChatPanel 决策卡片下方展示可信度评估（belief/plausibility/confidence）
 * - 可信度 DAG 可视化面板展示融合步骤（React Flow 渲染）
 * - 6 源证据：log / kb / ai-param / human / history / best-practice
 * - 校准面板：展示/调整 T 值（Temperature Scaling），避免 LLM 过度自信
 * - 审计面板：导出 EU AI Act / NIST AI RMF / NIST AI 600-1 合规报告
 *
 * 论文支撑：
 * - Guo et al. 2017 (ICML, arXiv:1706.04599) - Temperature Scaling
 * - Shafer 1976, Dempster 1967 - D-S 证据理论
 * - Smarandache & Dezert 2004 - PCR5 冲突融合
 * 法规支撑：
 * - EU AI Act 2026 (Regulation 2024/1689) Art.11/12/13/14/15
 * - NIST AI RMF 1.0
 * - NIST AI 600-1 GenAI Profile
 *
 * 调研文档：idea-to-dev-output/22-可信度算法论文支撑调研.md
 * 方案书依据：v0.9 §可信度算法升级（D-S + PCR5 + 6 源证据融合）
 *           + v0.9.6 P2 §审计报告
 */
const credibility = {
  /**
   * 评估给定证据集的可信度
   *
   * @param inputs 证据源输入列表（至少 1 个，最多 6 个）
   * @param options 融合评估选项（v2.4 Phase C 新增：applyCalibration + providerId）
   * @returns ConfidenceAssessment（含 Bel/Pl/confidence/conflictLevel/fusionSteps）
   */
  assess: (
    inputs: CredibilityEvidenceInput[],
    options?: FuseAssessOptions
  ): Promise<ConfidenceAssessment> =>
    ipcRenderer.invoke(CREDIBILITY.ASSESS, inputs, options),

  /**
   * 获取 DAG 可视化数据
   *
   * @param inputs 证据源输入列表
   * @returns DagData（含 nodes + edges，用于 React Flow 渲染）
   */
  dag: (inputs: CredibilityEvidenceInput[]): Promise<DagData> =>
    ipcRenderer.invoke(CREDIBILITY.DAG, inputs),

  // ========================================================================
  // v0.9.6 P2：EU AI Act 合规审计报告方法
  // ========================================================================

  /**
   * 导出 EU AI Act 合规审计报告
   *
   * 从决策卡 + 校准状态 + 6 源证据构造完整合规审计报告，
   * 支持 JSON / Markdown / HTML 三种格式，可一次导出全部。
   *
   * 法规依据：
   * - EU AI Act 2026 Art.11（技术文档 machine-readable）
   * - EU AI Act Art.12（自动日志 6 个月保留期）
   * - EU AI Act Art.13/14/15（透明度 + 人工监督 + 准确性）
   * - NIST AI RMF 1.0（GOVERN/MAP/MEASURE/MANAGE）
   * - NIST AI 600-1 GenAI Profile（12 类风险）
   *
   * @param input 报告构建输入（决策上下文 + 6 源证据 + 校准状态 + 人工监督 + 决策动作）
   * @param options 导出选项（format / outputDir / force / writeAllFormats）
   * @returns ExportResult（reportId / fingerprint / 文件路径 / 字节数）
   */
  exportAuditReport: (input: AuditReportInput, options?: ExportOptions): Promise<ExportResult> =>
    ipcRenderer.invoke(CREDIBILITY.EXPORT_AUDIT_REPORT, input, options),

  /**
   * 列出已落盘的审计报告
   *
   * 扫描 {userData}/audit-reports/ 目录，按决策时间倒序返回。
   *
   * @param outputDir 可选自定义目录（默认 userData/audit-reports/）
   * @returns AuditReportListItem[]（decisionId / fingerprint / complianceScore / filepath）
   */
  listAuditReports: (outputDir?: string): Promise<AuditReportListItem[]> =>
    ipcRenderer.invoke(CREDIBILITY.LIST_AUDIT_REPORTS, outputDir),

  /**
   * 从已落盘的 JSON 报告重建 ComplianceAuditReport 对象
   *
   * 用途：UI 展示已生成的报告、对比不同决策的报告
   *
   * @param filepath 报告 JSON 文件绝对路径
   * @returns ComplianceAuditReport（完整结构）
   */
  loadAuditReport: (filepath: string): Promise<ComplianceAuditReport> =>
    ipcRenderer.invoke(CREDIBILITY.LOAD_AUDIT_REPORT, filepath),

  /**
   * 仅格式化（不落盘），用于预览
   *
   * @param input 报告构建输入
   * @param format 输出格式（json / markdown / html）
   * @returns string（序列化后的报告内容）
   */
  formatAuditReport: (input: AuditReportInput, format: AuditFormat): Promise<string> =>
    ipcRenderer.invoke(CREDIBILITY.FORMAT_AUDIT_REPORT, input, format),

  // ========================================================================
  // v2.4 Phase C 收尾：校准方法（6 个）
  // ------------------------------------------------------------------------
  // 论文支撑：Guo et al. 2017 (ICML, arXiv:1706.04599) §3.2 Temperature Scaling
  // 通道与主进程 ipc/credibility.ts 的 6 个校准 handler 一一对应
  // ========================================================================

  /**
   * 校准指定 Provider（基于历史样本计算最优 T）
   *
   * @param providerId Provider ID（如 'deepseek' / 'claude' / 'openai'）
   * @param options 优化选项（tMin / tMax / tSteps / numBuckets / minSamples）
   * @returns TemperatureScalingResult（含 optimalT / eceBefore / eceAfter / searchTrace）
   */
  calibrate: (
    providerId: ProviderId,
    options?: OptimizeTOptions
  ): Promise<TemperatureScalingResult> =>
    ipcRenderer.invoke(CREDIBILITY.CALIBRATE, providerId, options),

  /**
   * 获取指定 Provider 的当前校准状态
   *
   * @param providerId Provider ID
   * @returns ProviderCalibration（未校准时返回 defaultT=1.0 的默认状态）
   */
  getCalibration: (providerId: ProviderId): Promise<ProviderCalibration> =>
    ipcRenderer.invoke(CREDIBILITY.GET_CALIBRATION, providerId),

  /**
   * 获取全局校准状态（所有 Provider）
   *
   * @returns CalibrationState（含 providers 表 + defaultT + updatedAt）
   */
  getCalibrationState: (): Promise<CalibrationState> =>
    ipcRenderer.invoke(CREDIBILITY.GET_CALIBRATION_STATE),

  /**
   * 重置指定 Provider 的校准（T 回到 defaultT）
   *
   * @param providerId Provider ID
   * @returns boolean（true 表示已重置，false 表示该 Provider 未校准过）
   */
  resetCalibration: (providerId: ProviderId): Promise<boolean> =>
    ipcRenderer.invoke(CREDIBILITY.RESET_CALIBRATION, providerId),

  /**
   * 计算指定 Provider 的当前 ECE（不修改 T）
   *
   * @param providerId Provider ID
   * @param numBuckets 分桶数（默认 10）
   * @returns EceResult（含 ece / mce / bucketStats / totalSamples）
   */
  computeEce: (providerId: ProviderId, numBuckets?: number): Promise<EceResult> =>
    ipcRenderer.invoke(CREDIBILITY.COMPUTE_ECE, providerId, numBuckets),

  /**
   * 记录新的校准样本（内存操作，不持久化）
   *
   * @param sample 校准样本（decisionId / reportedConfidence / wasCorrect / providerId / timestamp）
   * @returns boolean（始终 true，失败抛错）
   */
  addCalibrationSample: (sample: CalibrationSample): Promise<boolean> =>
    ipcRenderer.invoke(CREDIBILITY.ADD_CALIBRATION_SAMPLE, sample),
}

/**
 * v0.9.5 P0 - 组 2：Mode 五模式切换 invoke 调用
 *
 * 通道与主进程 ipc/mode.ts 一一对应：
 * - mode:list        → list（列出所有可用 mode 配置，不含 systemPrompt）
 * - mode:set-default → setDefault（设置当前默认 mode）
 * - mode:get-current → getCurrent（返回当前默认 mode）
 *
 * 使用场景：
 * - ChatPanel 顶部模式选择器（chat / ask / plan / code / debug）
 * - UI 启动时调用 getCurrent 初始化选中状态
 * - 用户切换 mode 时调用 setDefault
 *
 * 安全设计：
 * - mode:list 返回 ModeInfo[] 不含 systemPrompt（避免泄露内部 prompt 模板）
 * - mode:set-default 入参用 isValidMode 类型守卫防御非法字符串
 */
const mode = {
  /**
   * 列出所有可用 mode 配置（不含 systemPrompt）
   *
   * @returns ModeInfo[]（5 个 mode：chat / ask / plan / code / debug）
   */
  list: (): Promise<ModeListResponse> =>
    ipcRenderer.invoke(MODE.LIST),

  /**
   * 设置当前默认 mode
   *
   * @param request { mode: AgentMode }
   * @returns { success, previousMode, currentMode }（非法 mode 返回 success=false）
   */
  setDefault: (request: ModeSetDefaultRequest): Promise<ModeSetDefaultResponse> =>
    ipcRenderer.invoke(MODE.SET_DEFAULT, request),

  /**
   * 返回当前默认 mode
   *
   * @returns { mode, displayName }（便于 UI 直接渲染）
   */
  getCurrent: (): Promise<ModeCurrentResponse> =>
    ipcRenderer.invoke(MODE.GET_CURRENT),
}

/**
 * v0.9.5 P0 - 组 3：Attention 注意力跟踪 invoke 调用
 *
 * 通道与主进程 ipc/attention.ts 一一对应：
 * - attention:current        → current（返回当前 AttentionFocus）
 * - attention:history        → history（返回历史 AttentionFocus 列表）
 * - attention:track-files    → trackFiles（跟踪关注的文件）
 * - attention:track-commands → trackCommands（跟踪关注的命令）
 * - attention:track-errors   → trackErrors（跟踪关注的错误）
 * - attention:track-keywords → trackKeywords（跟踪关注的搜索关键词）
 * - attention:reset          → reset（重置当前 attention，归档到 history）
 *
 * 使用场景：
 * - UI 高亮显示当前关注的文件 / 命令 / 错误 / 关键词
 * - 历史时间轴展示 attention 快照
 * - 新会话开始时调用 reset 归档当前 attention
 *
 * 设计要点：
 * - AttentionTracker 是单例，全局唯一，跨 Subagent 共享
 * - track-* 通道接收 string[] 参数
 * - reset 通道将当前 attention 归档到 history（最多 100 条）
 */
const attention = {
  /** 获取当前 attention（始终非 null，since 字段必有） */
  current: (): Promise<AttentionFocus> =>
    ipcRenderer.invoke(ATTENTION.CURRENT),

  /** 获取历史 attention 列表（按时间顺序，最早在前） */
  history: (): Promise<AttentionFocus[]> =>
    ipcRenderer.invoke(ATTENTION.HISTORY),

  /**
   * 跟踪关注的文件
   *
   * @param files 文件路径列表
   * @returns true 表示跟踪成功
   */
  trackFiles: (files: string[]): Promise<boolean> =>
    ipcRenderer.invoke(ATTENTION.TRACK_FILES, files),

  /**
   * 跟踪关注的命令
   *
   * @param commands 命令列表
   * @returns true 表示跟踪成功
   */
  trackCommands: (commands: string[]): Promise<boolean> =>
    ipcRenderer.invoke(ATTENTION.TRACK_COMMANDS, commands),

  /**
   * 跟踪关注的错误
   *
   * @param errors 错误信息列表
   * @returns true 表示跟踪成功
   */
  trackErrors: (errors: string[]): Promise<boolean> =>
    ipcRenderer.invoke(ATTENTION.TRACK_ERRORS, errors),

  /**
   * 跟踪关注的搜索关键词
   *
   * @param keywords 关键词列表
   * @returns true 表示跟踪成功
   */
  trackKeywords: (keywords: string[]): Promise<boolean> =>
    ipcRenderer.invoke(ATTENTION.TRACK_KEYWORDS, keywords),

  /**
   * 重置当前 attention（归档到 history）
   *
   * @returns true 表示重置成功
   */
  reset: (): Promise<boolean> =>
    ipcRenderer.invoke(ATTENTION.RESET),
}

/**
 * v0.9.4 批次 4 - 任务 5 P2-E：预期回显监控 invoke 调用
 *
 * 通道与主进程 ipc/expectation.ts 一一对应：
 * - expectation:check  → check（对比预期与实际输出，返回 ExpectationCheckResult）
 * - expectation:format → format（格式化违规列表为人类可读字符串）
 *
 * 使用场景：
 * - UI 展示"预期 vs 实际"对比，命令执行异常时高亮告警
 * - 在 Tooltip / 详情面板中展示完整违规描述
 *
 * 设计要点：
 * - check 接收 3 参数（expectation + actualOutput + actualExitCode）
 * - format 接收违规列表，返回字符串
 * - 类型已迁移到 @shared/agent-types.ts（SSOT）
 */
const expectation = {
  /**
   * 对比预期与实际输出
   *
   * @param expectation 命令预期配置（command + mustContain + mustNotContain + expectedExitCode + timeoutMs）
   * @param actualOutput 实际输出（字符串）
   * @param actualExitCode 实际退出码
   * @returns ExpectationCheckResult（含 met / violations / expectation / actualExitCode / timestamp）
   */
  check: (
    expectation: CommandExpectation,
    actualOutput: string,
    actualExitCode: number
  ): Promise<ExpectationCheckResult> =>
    ipcRenderer.invoke(EXPECTATION.CHECK, expectation, actualOutput, actualExitCode),

  /**
   * 格式化违规列表为人类可读字符串
   *
   * @param violations 违规列表（空数组返回"符合预期（无违规）"）
   * @returns 格式化后的字符串
   */
  format: (violations: ExpectationViolation[]): Promise<string> =>
    ipcRenderer.invoke(EXPECTATION.FORMAT, violations),
}

/**
 * v0.9.3 §11 遗留项 2 P2-H：Task Protocol step 2 check-permission 审批 IPC
 *
 * 通道与主进程 ipc/task-permission-approval.ts 一一对应：
 * - task:permission-approval-request（主 → 渲染推送，单向，通过 createListener 监听）
 * - task:permission-approve（渲染 → 主 invoke，响应审批请求）
 *
 * 使用场景：
 * - Subagent 调度时（task-protocol step 2），主进程推送审批请求到 UI
 * - UI 弹窗显示 taskId / subagentName / inputSummary，用户批准/拒绝
 * - 用户响应后，主进程通过 Promise resolve 返回决策，step 2 继续/中止
 *
 * 三态权限审批（R12）：
 * - mode='always'：每次都询问用户（默认，触发推送）
 * - mode='auto'：自动允许（不推送，step 2 直接通过）
 * - mode='never'：自动拒绝（不推送，step 2 直接失败）
 *
 * 设计要点：
 * - 30 秒未响应主进程自动拒绝（与 sandbox-approval 保持一致）
 * - remember=true 时主进程记录日志（持久化规则表留待 v1.6 实现）
 */
const taskPermission = {
  /**
   * 响应审批请求
   *
   * @param callId 审批调用 ID（与推送的 TaskPermissionApprovalRequest.callId 对应）
   * @param decision 审批决策（approved + rejectReason + remember）
   * @returns void（主进程通过 Promise resolve 通知 waitForTaskPermissionApproval）
   */
  approve: (
    callId: string,
    decision: TaskPermissionDecision
  ): Promise<void> =>
    ipcRenderer.invoke(TASK.PERMISSION_APPROVE, callId, decision),
}

export { credibility, mode, attention, expectation, taskPermission }
