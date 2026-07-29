/**
 * IPC 注册入口
 *
 * 统一注册所有 IPC handlers，由主进程入口 main/index.ts 调用。
 *
 * 注册顺序：SSH → 监控 → 存储 → LLM → 知识库 → 决策历史 → Agent → Profiler
 * （顺序无强依赖，仅保持一致性）
 *
 * 注意：重复注册同名 handler 会抛错，所以本函数在应用生命周期内只应调用一次。
 *
 * v0.9.4 新增：
 * - system:ping handler（心跳保活，返回 { ok, timestamp, protocolVersion }）
 *   渲染进程可定期调用 systemPing() 检测主进程是否响应
 */

import { ipcMain, BrowserWindow } from 'electron'
import { IPC_PROTOCOL_VERSION, type SystemPingResponse } from '@shared/agent-types'
import { registerSshIpcHandlers } from './ssh'
import { registerMonitorIpcHandlers } from './monitor'
import { registerStorageIpcHandlers } from './storage'
import { registerLlmHandlers } from './llm'
// v2.0 Phase B 新增：内联补全 + Diff 应用 IPC（llm:inline-completion / cancel / apply-diff / diff-preview）
import { registerLlmInlineHandlers } from './llm-inline'
import { registerKnowledgeHandlers } from './knowledge'
import { registerHistoryHandlers } from './history'
import { registerAgentHandlers } from './agent'
import { registerAgentRuntimeHandlers } from './agent-runtime'
import { registerProfilerIpcHandlers } from './profiler'
import { registerTutorialIpcHandlers } from './tutorial'
import { registerDeployIpcHandlers } from './deploy'
import { registerLlmToolHandlers } from './llm-tools'
import { registerLogIpcHandlers } from './log'
import { registerCredibilityHandlers } from './credibility'
// M2 Task 2 新增：命令风险评估 IPC（risk:check，桥接 assessCommandRisk）
// 通道：risk:check（渲染层主动查询命令风险等级，供 DecisionPage 高危拦截清单使用）
import { registerRiskHandlers } from './risk'
// M3 Task 2 新增：告警确认 IPC（alert:ack，主进程内存 Map 记录 ack 状态）
// 通道：alert:ack（渲染层 AlertDrawer "标记已处理" 按钮调用，ack 后关闭 Drawer）
import { registerAlertHandlers } from './alert'
import { registerSandboxIpcHandlers } from './sandbox'
import { registerAtCommandHandlers } from './at-commands'
import { registerClaudeSdkHandlers } from './claude-sdk'
// v0.9.5 P0 新增：5 组缺失 IPC 通道（17 个新方法）
// - 组 1：token:cost-stats（成本透明）
// - 组 2：mode:list / mode:set-default / mode:get-current（五模式切换）
// - 组 3：attention:* 7 通道（注意力跟踪）
// - 组 4：subagent:list / subagent:reload（自定义 Agent 加载器）
// - 组 5：provider:capabilities* / provider:pricing* 4 通道（Provider 能力 + 定价透明）
import { registerTokenCostStatsHandlers } from './token-stats'
import { registerModeHandlers } from './mode'
import { registerAttentionHandlers } from './attention'
import { registerSubagentHandlers } from './subagent'
import { registerProviderInfoHandlers } from './provider-info'
// v0.9.5 P0 新增：MCP 5 阶段状态机 IPC（借鉴 claw-code §3.3）
import { registerMcpStateHandlers } from './mcp'
// v1.0 新增：Sidecar-A IPC 通道（SRE + 日志解析 Python Sidecar）
import { registerSidecarIpcHandlers, cleanupSidecar } from './sidecar'
// v2.8 新增：Agent 长期记忆 IPC（自动沉淀记忆的查看/检索/删除/审计）
import { registerMemoryIpcHandlers } from './memory'
// v1.5 新增：Promptfoo 红队 / Prompt 评估 IPC
import { registerPromptfooHandlers } from './promptfoo'
// v1.5 新增：诊断服务 IPC（后端日志检测，循环工程启动时分析）
import { registerDiagnosticsHandlers } from './diagnostics'
// v1.5 新增：循环工程子 Agent IPC（编排 Supervisor.chat + AgentWorkflow 7 步 HITL）
// 通道：loop:start / loop:confirm / loop:cancel + 推送 loop:step/decision/done/error
import { registerLoopEngineeringHandlers, cleanupLoopEngineering } from './loop-engineering'
// Phase 6 Task 6.5 新增：调度器 IPC（定时任务自动化）
// 通道：scheduler:list / toggle / trigger + 推送 scheduler:status
import { registerSchedulerIpcHandlers } from './scheduler'
// v2.0 Phase C 新增：SFTP 文件搜索 + grep（QuickFileSearch / GlobalSearch UI）
// 通道：sftp:search / sftp:grep
import { registerSftpSearchIpcHandlers } from './sftp-search'
// v2.0 Phase C 新增：远程文件监听（inotifywait 长连接 + 5s 轮询降级）
// 通道：file:watch:start / file:watch:stop + 推送 file:changed
import { registerFileWatcherIpcHandlers } from './file-watcher'
// v0.9.4 批次 4 - 任务 5 P2-E 新增：预期回显监控 IPC
// 通道：expectation:check / expectation:format
// 让 UI 展示"预期 vs 实际"对比，命令执行异常时高亮告警
import { registerExpectationHandlers } from './expectation'
// v0.9.3 §11 遗留项 2 P2-H 新增：Task Protocol step 2 check-permission 审批 IPC
// 通道：task:permission-approve（渲染进程响应审批请求）
// 让 Subagent 调度支持用户审批，从"默认允许"升级为"理解后批准"
import { registerTaskPermissionHandlers } from './task-permission-approval'
// v2.2 P1 修复 #24：应用更新 IPC（app:check-update / app:download-update）
// 简化方案：HTTP GET GitHub Releases API 比对版本号 + shell.openExternal 打开下载页面
// 不引入 electron-updater（避免 publisher 配置 + GitHub Token 管理复杂度）
import { registerAppUpdateHandlers } from './app-update'
// v2.2 P1 修复 #22：文件系统 IPC（fs:upload-image）
// AIPanel 图片附件基础版：dialog.showOpenDialog + 读取文件转 base64 data URL
// 简化方案：不引入图片压缩库，限制 4MB，支持 png/jpg/jpeg/gif/webp/bmp
import { registerFsIpcHandlers } from './fs-upload'
// v0.9.7 P3 M1 新增：终端智能补全 IPC（terminal-completion:complete/accept/import）
// 通道：3 个 invoke，从渲染层发起补全请求 / 接受建议 / 批量导入历史命令
import { registerTerminalCompletionIpcHandlers } from './terminal-completion'
// v2.3.2 新增：模型统计 + 预算告警 IPC（model:toolCalls / budget:alerts）
// 补齐 ModelSettings 最后两处静态数据
import { registerModelStatsHandlers } from './model-stats'
// M5 Task 3 新增：启动加载阶段推送 IPC（boot:loading-stage，主进程向渲染层推送加载进度）
// 通道：boot:loading-stage（push: 主 → 渲染，BootPage 据此推进进度条）
import { pushBootLoadingStage } from './boot'
import type { DatabaseManager } from '../services/db/database'

/**
 * 注册所有 IPC handlers
 *
 * 在 app.whenReady() 后、创建主窗口后调用。
 *
 * @param mainWindow 主窗口实例，用于向渲染进程推送事件（Shell 数据、监控数据等）
 * @param db 数据库管理器（教程 IPC 依赖）
 */
export function registerAllIpcHandlers(mainWindow: BrowserWindow, db?: DatabaseManager): void {
  // v0.9.4 新增：system:ping 心跳保活通道
  //
  // 设计说明：
  // - 主进程启动后立即注册（在所有业务 IPC 之前），用于早期响应渲染进程的心跳请求
  // - 不依赖 mainWindow（即使窗口未创建完成也能响应）
  // - 返回 { ok: true, timestamp: Date.now(), protocolVersion: '0.9.4' }
  // - 渲染进程通过 window.electronAPI.systemPing() 调用（preload 已暴露）
  // - 使用场景：渲染进程启动后定期（如每 30 秒）调用 systemPing() 检测主进程是否响应
  ipcMain.handle('system:ping', (): SystemPingResponse => {
    return {
      ok: true,
      timestamp: Date.now(),
      protocolVersion: IPC_PROTOCOL_VERSION,
    }
  })

  registerSshIpcHandlers(mainWindow)
  registerMonitorIpcHandlers(mainWindow)
  registerStorageIpcHandlers()
  registerLlmHandlers(mainWindow)
  // v2.0 Phase B：内联补全 + Diff 应用 IPC（llm:inline-completion / cancel / apply-diff / diff-preview）
  registerLlmInlineHandlers()
  registerKnowledgeHandlers(mainWindow)
  registerHistoryHandlers(mainWindow)
  registerAgentHandlers(mainWindow)
  // v0.9 新增：Supervisor + Provider + Token IPC handlers
  registerAgentRuntimeHandlers(mainWindow)
  registerProfilerIpcHandlers()
  // 教程 IPC 需要 db 参数，独立处理（不阻塞主流程）
  // v0.6.0 起需要 mainWindow 用于爬虫进度推送
  if (db) {
    registerTutorialIpcHandlers(db, mainWindow)
    // v2.3.2 新增：模型统计 + 预算告警 IPC（model:toolCalls / budget:alerts）
    registerModelStatsHandlers(db)
  }
  // Web 部署助手 IPC（需要 mainWindow 用于日志推送）
  registerDeployIpcHandlers(mainWindow)
  // LLM Tool Calling IPC（5 工具 + 审批流）
  if (db) {
    registerLlmToolHandlers(mainWindow, db)
  } else {
    registerLlmToolHandlers(mainWindow, null)
  }
  // 日志 IPC（暴露给渲染进程与测试使用）
  registerLogIpcHandlers()
  // v0.9 新增：可信度算法 IPC（D-S 证据理论 + PCR5 冲突融合 + 6 源证据）
  // v2.3.2：传递 db 用于 credibility:export-decision-html 简化导出
  registerCredibilityHandlers(db)
  // M2 Task 2 新增：命令风险评估 IPC（risk:check，桥接 assessCommandRisk）
  // 通道：risk:check（渲染层主动查询命令风险等级，供 DecisionPage 高危拦截清单使用）
  registerRiskHandlers()
  // M3 Task 2 新增：告警确认 IPC（alert:ack，主进程内存 Map 记录 ack 状态）
  // 通道：alert:ack（渲染层 AlertDrawer "标记已处理" 按钮调用，ack 后关闭 Drawer）
  registerAlertHandlers()
  // v0.9 新增：OpenHands 沙箱集成 IPC（Docker 检测 + 沙箱生命周期 + 命令执行）
  // P-2 + P-4 修复：传递 mainWindow 用于 IPC 层强制审批 + session_api_key 句柄模式
  registerSandboxIpcHandlers(mainWindow)
  // v0.9 新增：@命令 8 类完整实现 IPC（log/cmd/file/metric/decision/kb/skill/server）
  // 通道：at:list / at:resolve / at:parse
  registerAtCommandHandlers()
  // v0.9 新增：Claude Agent SDK IPC（claude-sdk:generate / stream / cancel）
  // 修复 P-1 阻塞问题：ClaudeSdkProvider 此前未通过 IPC 暴露，渲染进程无法调用
  registerClaudeSdkHandlers(mainWindow)

  // ====================================================================
  // v0.9.5 P0 新增：5 组缺失 IPC 通道（17 个新方法）
  //
  // 详见 docs/UI接入接线图-v0.9.5.md（已生成）。
  // 这些通道让 v0.9.4 主进程已实现的能力暴露给渲染层 UI 使用：
  // ====================================================================

  // 组 1：token:cost-stats（成本透明）
  // 让 Token 监控面板展示累计成本（USD），让用户对消费有直观感知
  registerTokenCostStatsHandlers()

  // 组 2：mode:list / mode:set-default / mode:get-current（五模式切换）
  // 让 UI 模式选择器渲染 5 个 mode（chat/ask/plan/code/debug）+ 切换默认 mode
  registerModeHandlers()

  // 组 3：attention:* 7 通道（注意力跟踪）
  // 让 UI 高亮显示当前关注的文件 / 命令 / 错误 / 关键词，跨 Subagent 传递上下文
  registerAttentionHandlers()

  // 组 4：subagent:list / subagent:reload（自定义 Agent 加载器）
  // 让 UI 列出 / 热重载项目根 .tdsf/agent/*.md 中的自定义 agent 配置
  registerSubagentHandlers()

  // 组 5：provider:capabilities* / provider:pricing* 4 通道（Provider 能力 + 定价透明）
  // 让 UI 显示 Provider 能力图标（streaming/toolCall/vision/contextWindow）+ 定价表
  registerProviderInfoHandlers()

  // v0.9.5 P0 新增：MCP 5 阶段生命周期状态机（借鉴 claw-code §3.3）
  // 暴露 mcp:get-state / mcp:reset / mcp:state-changed
  registerMcpStateHandlers(mainWindow)

  // v1.0 新增：Sidecar-A IPC 通道（SRE + 日志解析 Python Sidecar）
  // 暴露 sidecar:start / stop / status / health / pipeline
  registerSidecarIpcHandlers()

  // v2.8 新增：Agent 长期记忆 IPC（memory:list/search/delete/audit）
  registerMemoryIpcHandlers()

  // v1.5 新增：Promptfoo 红队 / Prompt 评估 IPC
  // 暴露 promptfoo:run-red-team / run-eval / list-tests
  registerPromptfooHandlers()

  // v1.5 新增：诊断服务 IPC（后端日志检测，循环工程启动时分析）
  // 暴露 diagnostics:get-report / get-logs / get-findings / get-stats / clear / set-enabled
  // 推送通道：diagnostics:log-batch（实时批量推送日志事件到渲染进程）
  registerDiagnosticsHandlers(mainWindow)

  // v1.5 新增：循环工程子 Agent IPC（编排 Supervisor.chat + AgentWorkflow 7 步 HITL）
  // 暴露 loop:start / loop:confirm / loop:cancel
  // 推送通道：loop:llm-start / loop:llm-done / loop:step / loop:decision / loop:done / loop:error
  // 实现"假设计 → 可演示真 IDE"完整一轮：LLM 推理 → 7 步 HITL → 决策卡片 → SSH 执行 → 验证
  registerLoopEngineeringHandlers(mainWindow)

  // Phase 6 Task 6.5 新增：调度器 IPC（定时任务自动化）
  // 通道：scheduler:list / toggle / trigger + 推送 scheduler:status
  // 注意：调度器单例初始化（register 3 个定时任务 + start）在 main/index.ts 的
  // app.whenReady() 中调用 initScheduler()，确保 BrowserWindow 已创建后再启动推送
  registerSchedulerIpcHandlers()

  // v2.0 Phase C 新增：SFTP 文件搜索 + grep（QuickFileSearch / GlobalSearch UI）
  // 通道：sftp:search（find -name 模糊匹配）/ sftp:grep（grep -rn 内容正则）
  // 不需要 mainWindow：所有操作都是请求-响应模式
  registerSftpSearchIpcHandlers()

  // v2.0 Phase C 新增：远程文件监听（inotifywait 长连接 + 5s 轮询降级）
  // 通道：file:watch:start / file:watch:stop + 推送 file:changed
  // 不需要 mainWindow：FileWatcherAdapter 内部通过 BrowserWindow.getAllWindows() 广播
  registerFileWatcherIpcHandlers()

  // v0.9.4 批次 4 - 任务 5 P2-E 新增：预期回显监控 IPC
  // 通道：expectation:check / expectation:format
  // 让 UI 展示"预期 vs 实际"对比，命令执行异常时高亮告警（ExpectedOutput 组件消费）
  registerExpectationHandlers()

  // v0.9.3 §11 遗留项 2 P2-H 新增：Task Protocol step 2 check-permission 审批 IPC
  // 通道：task:permission-approve（渲染进程响应审批请求）
  // 让 Subagent 调度支持用户审批，从"默认允许"升级为"理解后批准"
  // 消费方：TaskPermissionApprovalDialog.tsx
  registerTaskPermissionHandlers()

  // v2.2 P1 修复 #24：应用更新 IPC（app:check-update / app:download-update）
  // 通道：app:check-update（HTTP GET GitHub Releases API 比对版本号）
  //       app:download-update（shell.openExternal 打开浏览器到 Release 页面）
  // 消费方：AboutSettings.tsx handleCheckUpdate
  // 简化方案：不引入 electron-updater（A7 质量优先 + A8 避免重复造轮子）
  registerAppUpdateHandlers()

  // v2.2 P1 修复 #22：文件系统 IPC（fs:upload-image）
  // 通道：fs:upload-image（dialog.showOpenDialog + 读取文件转 base64 data URL）
  // 消费方：AIPanel.tsx 图片附件按钮
  // 简化方案：不引入图片压缩库，限制 4MB，支持 png/jpg/jpeg/gif/webp/bmp
  registerFsIpcHandlers()

  // v0.9.7 P3 M1 新增：终端智能补全 IPC（terminal-completion:complete/accept/import）
  // 通道：terminal-completion:complete（请求补全建议）
  //       terminal-completion:accept（接受建议，提升 Frecency）
  //       terminal-completion:import（批量导入历史命令）
  // 消费方：终端 UI（Phase 2 待集成）
  // 引擎：Trie + SQLite 历史索引 + 静态 Linux 命令兜底
  registerTerminalCompletionIpcHandlers()

  // 暴露 cleanupSidecar 供 main/index.ts 在 before-quit 时调用
  ;(global as { __cleanupSidecar?: typeof cleanupSidecar }).__cleanupSidecar = cleanupSidecar
  // 暴露 cleanupLoopEngineering 供 main/index.ts 在 before-quit 时调用
  ;(global as { __cleanupLoopEngineering?: typeof cleanupLoopEngineering }).__cleanupLoopEngineering = cleanupLoopEngineering

  // M5 Task 3: 推送 IPC ready 阶段给 BootPage
  // 注意：这里仅推送 'ipc-ready'，后续 sqlite-init / kb-indexed / done 由各模块 init 完成后推送
  // 单 AI 模式下使用 BrowserWindow.getAllWindows() 获取所有窗口
  pushBootLoadingStage('ipc-ready', BrowserWindow.getAllWindows())
}
