/**
 * 全局实时事件订阅（P0 修复：组件条件挂载丢事件）
 *
 * 问题背景（同一类病灶，多处复现）：
 * - Agent 流式：agent:chunk/done/error/step 订阅曾写在 useAgentChat useEffect，
 *   随 AIPanel 挂载/卸载绑定解绑 → 面板收起时流式事件永久丢失。
 * - 监控数据：monitor:data/systemInfo 订阅曾写在 MonitorPage useEffect，
 *   用户在工作台连接服务器后数据已开始推送，但未进监控页前无人接收，
 *   切到监控页时历史推送已丢，表现为"已连接但监控页暂无数据"。
 *
 * 修复方案：
 * - 所有实时事件订阅提升到应用入口（main.tsx）调用一次，模块级幂等守卫。
 * - 事件回调直接写 store，与组件生命周期完全解耦；页面/面板无论是否挂载，
 *   数据都完整落入 store，进页即可看到全量内容。
 */
import { useAgentStore } from './agent-store'
import { useMonitorStore } from './monitor-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type { AgentWorkflowState } from '@shared/models'

/** 幂等守卫：整个渲染进程生命周期只绑定一次 */
let subscribed = false

/**
 * 初始化全局实时事件订阅（Agent 流式 + 监控数据）。
 * 在 main.tsx 应用入口调用；非 Electron 环境（浏览器 dev）静默跳过。
 */
export function initAgentStreamSubscription(): void {
  if (subscribed) return
  if (!isElectronAPIAvailable()) return
  subscribed = true

  /** done/error 后刷新 Token / 成本统计（原 useAgentChat 内逻辑迁移至此） */
  const refreshStats = (): void => {
    void window.electronAPI.tokenStats?.()
      .then((stats) => useAgentStore.getState().setTokenStats(stats))
      .catch(() => {})
    void window.electronAPI.tokenCostStats?.()
      .then((stats) => useAgentStore.getState().setCostStats(stats))
      .catch(() => {})
  }

  window.electronAPI.onAgentChunk((payload) => {
    useAgentStore.getState().appendToken(payload)
  })

  window.electronAPI.onAgentDone((payload) => {
    useAgentStore.getState().finalizeMessage(payload)
    refreshStats()
  })

  window.electronAPI.onAgentError((payload) => {
    useAgentStore.getState().markError(payload)
    refreshStats()
  })

  // M1 Task 7：工作流状态推送写入当前流式消息
  window.electronAPI.onAgentStep?.((state: AgentWorkflowState) => {
    useAgentStore.getState().updateStepState(state)
  })

  // v2.4：Agent 工具调用事件（真实执行可视化）—— 写入当前流式消息的 toolEvents
  window.electronAPI.onAgentToolEvent?.((payload) => {
    useAgentStore.getState().appendToolEvent({
      toolCallId: payload.toolCallId,
      phase: payload.phase,
      toolName: payload.toolName,
      input: payload.input,
      ok: payload.ok,
      output: payload.output,
    })
  })

  // 监控数据全局订阅（P0 修复：监控页未挂载时也不丢推送）
  // 用户在工作台连接服务器后 monitor:data 即开始推送，无论是否已切到监控页，
  // 数据都直接落入 monitor-store，监控页挂载时直接读取历史。
  window.electronAPI.onMonitorData?.((sessionId, data) => {
    useMonitorStore.getState().addMonitorData(sessionId, data)
  })
  window.electronAPI.onMonitorSystemInfo?.((sessionId, info) => {
    useMonitorStore.getState().setSystemInfo(sessionId, info)
  })
}
