/**
 * LLM IPC Handlers
 *
 * 只剩一条通道：
 * - llm:test — 测试连接（设置页「测试连接」按钮的唯一入口）
 *
 * 2026-10-24 整删的平行入口：llm:chat / llm:analyze / llm:validate /
 * llm:chat-with-context 与它们的 4 条推送（token / chunk / done / error）。
 * 渲染层对这几个键零调用，主对话一直是 agent:chat（Supervisor）那一条；
 * 多留一条能绕过会话直接打 LLM 的裸通道只增加攻击面，不增加能力。
 */

import { ipcMain } from 'electron'
import { LLM } from '@shared/ipc-channels'
import { LlmClient } from '../services/llm/client'
import { classifyLlmError } from '../core/agent/providers/llm-error'
import type { LlmConfig, LlmError } from '@shared/models'

/**
 * 错误码映射：单源在 providers/llm-error.ts（#101）
 *
 * 兜底前缀保留本调用点原有的"LLM 调用失败"说法。
 */
function toLlmError(err: unknown): LlmError {
  return classifyLlmError(err, 'LLM 调用失败')
}

/** 注册 llm:test（其余裸 llm 通道已随无人调用的入口一起删） */
export function registerLlmHandlers(): void {
  /**
   * 测试连接结果
   * - ok=true 表示连接成功（收到正常响应）
   * - ok=false 时 error 提供具体失败原因（401/404/网络/超时/Key 缺失等）
   * - latency 永远返回（无论成功失败，便于 UI 展示）
   */
  ipcMain.handle(LLM.TEST, async (_event, config: LlmConfig) => {
    const client = new LlmClient(config)
    if (!client.isAvailable()) {
      return {
        ok: false,
        latency: 0,
        error: 'API Key 未配置（请在设置中填写有效的 API Key）',
        code: 'NO_API_KEY',
      }
    }
    const startTime = Date.now()
    try {
      const result = await client.testConnection()
      const latency = Date.now() - startTime
      if (result) {
        return { ok: true, latency }
      }
      return {
        ok: false,
        latency,
        error: 'LLM 返回失败（请检查 API Key / Endpoint / 模型名是否正确）',
        code: 'TEST_FAILED',
      }
    } catch (err) {
      const latency = Date.now() - startTime
      const llmErr = toLlmError(err)
      return {
        ok: false,
        latency,
        error: llmErr.message,
        code: llmErr.code,
      }
    }
  })
}
