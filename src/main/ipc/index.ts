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
 * 2026-10-25 #216：system:ping（回 ok/timestamp/protocolVersion 的空声）与 risk:check（重复出口）、
 * subagent:list / subagent:reload（界面上从来没有 Agent 列表）三族连通道一起整删，理由写在 docs/功能实景清单.md C 组。
 */

import { app, ipcMain, BrowserWindow } from 'electron'
import { installIpcErrorBoundary } from './error-boundary'
import * as CHANNELS from '@shared/ipc-channels'
import { registerSshIpcHandlers } from './ssh'
import { registerAppWindowHandlers } from './app-window'
import { registerPreviewHandlers } from './preview'
import { registerShellIntegrationHandlers } from './shell-integration'
import { registerLocalTerminalHandlers } from './local-terminal'
import { registerMonitorIpcHandlers } from './monitor'
import { registerStorageIpcHandlers } from './storage'
import { registerLlmHandlers } from './llm'
import { registerKnowledgeHandlers } from './knowledge'
import { registerHistoryHandlers } from './history'
import { registerChatHistoryHandlers } from './chat-history'
import { registerAgentRuntimeHandlers } from './agent-runtime'
import { registerProfilerIpcHandlers } from './profiler'
import { registerTutorialIpcHandlers } from './tutorial'
import { registerLogIpcHandlers } from './log'
import { registerCredibilityHandlers } from './credibility'
// M3 Task 2 新增：告警确认 IPC（alert:ack，主进程内存 Map 记录 ack 状态）
// 通道：alert:ack（渲染层 AlertDrawer "标记已处理" 按钮调用，ack 后关闭 Drawer）
// risk:check 那把已于 2026-10-25 整删（#216），这里只剩 risk:rules
import { registerRiskHandlers } from './risk'
import { registerAlertHandlers } from './alert'
import { registerSandboxIpcHandlers } from './sandbox'
// v0.9.5 P0 新增：缺失 IPC 通道补齐
// - 组 1：token:cost-stats（成本透明）
// 组 2（mode:* 五模式切换）已于 2026-10-24 整删：模式既不注入 prompt 也不拦工具，
// 渲染层零调用，只有 MCP 资源把它当真实能力对外公布——那是谎报，不是半成品。
// Provider 的能力/定价查询那四条通道同批整删（#210）：能力已经随 provider 列表带出、
// provider:list 带出、成本由主进程按定价表算好后经 token:cost-stats 回一个数，
// 这四条只是同一份知识的第二个出口，渲染层一次都没调过。
// v0.9.5 P0 新增：MCP 5 阶段状态机 IPC（借鉴 claw-code §3.3）
import { registerTokenCostStatsHandlers } from './token-stats'
import { registerMcpStateHandlers } from './mcp'
// v1.0 新增：Sidecar-A IPC 通道（SRE + 日志解析 Python Sidecar）
import { registerSidecarIpcHandlers } from './sidecar'
// v2.8 新增：Agent 长期记忆 IPC（自动沉淀记忆的查看/检索/删除/审计）
import { registerMemoryIpcHandlers } from './memory'
// v1.5 的诊断服务 IPC 已于 2026-10-24 整删（#206）：七个 invoke 键渲染层零调用，
// diagnostics:log-batch 有生产者但没有任何监听者，两块缓冲只写不读。
// v1.5 的循环工程子 Agent IPC（loop:* 十条通道）已于 2026-10-25 整删（#222）：
// 渲染层没有任何一处能启动它，多步编排与在跑的 PAOR 重复，两个决策页挂在它上面的审批出口全是落空的。
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
// 让 UI 展示"预期 vs 实际"对比，命令执行异常时高亮告警
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
// A4 新增：数据库状态 IPC（db:status，降级可见化）
// 通道：db:status（渲染层全局横幅据此显示"数据未持久化"警告）
import { registerDbHandlers } from './db'
// v2.3.2 新增：模型统计 + 预算告警 IPC（model:toolCalls / budget:alerts）
// 补齐 ModelSettings 最后两处静态数据
import { registerModelStatsHandlers } from './model-stats'
// M5 Task 3 新增：启动加载阶段推送 IPC（boot:loading-stage，主进程向渲染层推送加载进度）
// 通道：boot:loading-stage（push: 主 → 渲染，BootPage 据此推进进度条）
import { pushBootLoadingStage, registerBootHandlers } from './boot'
import type { DatabaseManager } from '../services/db/database'

/**
 * 挂在长生命周期事件源上的订阅的卸载函数
 *
 * ipcMain.handle 重复注册会抛错，所以本函数原先靠"先 removeHandler 再重注册"来实现
 * macOS dock 恢复路径。但还有一类东西 removeHandler 管不到：直接 on() 到
 * SshConnectionManager / SystemMonitor / McpGateway / 子 agent EventEmitter 上的回调。
 * 它们会在每一次重注册时再多挂一份，于是同一份数据被推 N 次
 * （终端里就是字符翻倍、监控页就是曲线重影）。
 * 所以：重注册前先把上一轮的订阅摘干净。
 */
let ipcDisposers: Array<() => void> = []

/**
 * 注册所有 IPC handlers
 *
 * 在 app.whenReady() 后、创建主窗口后调用。
 *
 * @param mainWindow 主窗口实例，用于向渲染进程推送事件（Shell 数据、监控数据等）
 * @param db 数据库管理器（教程 IPC 依赖）
 */
export function registerAllIpcHandlers(mainWindow: BrowserWindow, db?: DatabaseManager): void {
  // P1-2：错误边界必须早于任何 handler 注册，否则先注册的那批不受覆盖。
  // 详情只在未打包态外送 —— 装好的包不给渲染层看内部原文。
  installIpcErrorBoundary({ exposeDetail: !app.isPackaged })

  // 幂等前置：重复 ipcMain.handle 同一通道会抛错（macOS dock 恢复路径会二次调用本函数）。
  // 先按共享通道表摘掉旧 handler，再照常注册——保留"新窗口拿到新引用"的原有语义。
  for (const group of Object.values(CHANNELS)) {
    if (!group || typeof group !== 'object') continue
    for (const channel of Object.values(group as Record<string, unknown>)) {
      if (typeof channel !== 'string') continue
      try {
        ipcMain.removeHandler(channel)
      } catch {
        /* 该通道本就没有 handler */
      }
    }
  }
  // 事件源订阅的卸载（理由见 ipcDisposers 的注释）：逆序摘，与注册顺序对称
  for (const dispose of ipcDisposers.reverse()) {
    try {
      dispose()
    } catch {
      // 一个订阅摘不掉不能把后面的邻居一起带走
    }
  }
  ipcDisposers = []


  // 这几个模块会在长生命周期事件源上挂转发回调，返回卸载函数交给 ipcDisposers
  ipcDisposers.push(registerSshIpcHandlers(mainWindow))
  // 本机终端同样在 PTY 事件源上挂转发（输出 + 退出），必须可撤销
  ipcDisposers.push(registerLocalTerminalHandlers())
  ipcDisposers.push(registerMonitorIpcHandlers(mainWindow))
  registerStorageIpcHandlers()
  // llm:test 是唯一还在界面上的裸 llm 通道（设置页「测试连接」），其余随 #195 删除
  registerLlmHandlers()
  registerKnowledgeHandlers(mainWindow)
  registerHistoryHandlers(mainWindow)
  // #177 / #178：对话历史落盘（chat:append / chat:list / chat:clear）
  registerChatHistoryHandlers()
  // v0.9 新增：Supervisor + Provider + Token IPC handlers
  registerAgentRuntimeHandlers(mainWindow)
  registerProfilerIpcHandlers()
  // 教程 IPC 需要 db 参数，独立处理（不阻塞主流程）
  // 爬虫进度推送那一族已于 #211 整删，这里不再需要窗口引用
  if (db) {
    registerTutorialIpcHandlers(db)
    // v2.3.2 新增：模型统计 + 预算告警 IPC（model:toolCalls / budget:alerts）
    registerModelStatsHandlers(db)
    // A4 新增：数据库状态 IPC（db:status）——渲染层降级横幅的唯一数据源
    registerDbHandlers(db)
  }
  // 日志 IPC（暴露给渲染进程与测试使用）
  registerLogIpcHandlers()
  // v0.9 新增：可信度算法 IPC（D-S 证据理论 + PCR5 冲突融合 + 6 源证据）
  // v2.3.2：传递 db 用于 credibility:export-decision-html 简化导出
  registerCredibilityHandlers(db)
  // M3 Task 2 新增：告警确认 IPC（alert:ack，主进程内存 Map 记录 ack 状态）
  // 通道：alert:ack（渲染层 AlertDrawer "标记已处理" 按钮调用，ack 后关闭 Drawer）
  // 命令风险：只留规则表只读出口（risk:rules，设置页风险控制区在读）
  registerRiskHandlers()
  registerAlertHandlers()
  // v0.9 新增：OpenHands 沙箱集成 IPC（Docker 检测 + 沙箱生命周期 + 命令执行）
  // P-2 + P-4 修复：传递 mainWindow 用于 IPC 层强制审批 + session_api_key 句柄模式
  registerSandboxIpcHandlers(mainWindow)

  // ====================================================================
  // v0.9.5 P0 新增：缺失 IPC 通道补齐
  //
  // 这些通道让 v0.9.4 主进程已实现的能力暴露给渲染层 UI 使用。
  // 组 2（五模式切换）已整删，原因写在文件头。
  // ====================================================================

  // 组 1：token:cost-stats（成本透明）
  // 让 Token 监控面板展示累计成本（USD），让用户对消费有直观感知
  registerTokenCostStatsHandlers()


  // v0.9.5 P0 新增：MCP 5 阶段生命周期状态机（借鉴 claw-code §3.3）
  // 暴露 mcp:get-state / mcp:reset / mcp:state-changed
  ipcDisposers.push(registerMcpStateHandlers(mainWindow))

  // v1.0 新增：Sidecar-A IPC 通道（SRE + 日志解析 Python Sidecar）
  // 暴露 sidecar:start / stop / status / health / pipeline
  registerSidecarIpcHandlers()

  // v2.8 新增：Agent 长期记忆 IPC（memory:list/search/delete/audit）
  registerMemoryIpcHandlers()

  // v1.5 的循环工程子 Agent IPC 已随 #222 整删，这里不再注册，退出表里也不再挂它的清理步骤。

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

  // v0.9.7 P3 M1 新增：终端智能补全 IPC（terminal-completion:complete / accept）
  // 通道：terminal-completion:complete（请求补全建议）
  //       terminal-completion:accept（接受建议，提升 Frecency）
  // 消费方：终端 UI（Phase 2 待集成）
  // 引擎：Trie + SQLite 历史索引 + 静态 Linux 命令兜底
  registerTerminalCompletionIpcHandlers()

  // 暴露 cleanupSidecar 供 main/index.ts 在 before-quit 时调用
  // A4/D3：以前挂到 global 上却没人调用，Python sidecar 因此被留成孤儿进程；
  // 现在由 main/index.ts 直接从各自模块 import，global 这层中转删掉。

  // M5 Task 3: 推送 IPC ready 阶段给 BootPage
  // R0 更正：注释说"后续 sqlite-init / kb-indexed / done 由各模块推送"，实际此前
  // 只有这一条被推过，done 从来没人发——渲染层的就绪只能靠动画猜。
  // 现在这三条由 main/index.ts 的启动序列真实推送，并额外提供 boot:get-state 供拉取
  // （主进程跑得快于渲染层挂载时，推送会丢，拉取补得上）。
  registerBootHandlers()
  // W4：再开一个应用窗口（只有这一个动作，不给关别人、枚举的能力）
  registerAppWindowHandlers()
  // W5：预览句柄（铸/废/读文本）。子资源走 tdsf-preview: 协议，不在 IPC 上
  registerPreviewHandlers()
  // #61：远端 shell 集成（状态/装/卸），逐台确认在界面上，路径由主进程定死
  registerShellIntegrationHandlers()
  pushBootLoadingStage('ipc-ready', BrowserWindow.getAllWindows())
}
