/**
 * Promptfoo 红队 / Prompt 评估 IPC（v1.5）
 *
 * 暴露给渲染进程的红队测试和 prompt 评估能力：
 * - promptfoo:run-red-team  运行红队测试
 * - promptfoo:run-eval      运行 prompt 评估
 * - promptfoo:list-tests    列出可用测试用例
 *
 * v1.5 修复：从 src/main/services/promptfoo/ 导入（原 scripts/promptfoo/ 导致打包路径解析失败）
 */

import { ipcMain } from 'electron'
import { PROMPTFOO } from '@shared/ipc-channels'
import { LlmClient } from '../services/llm/client'
import { ConfigStore } from '../services/storage/config-store'
import { SecureStore } from '../services/storage/secure-store'
import type { LlmConfig, ChatMessage } from '@shared/models'
import { RedTeamRunner, RED_TEAM_TEST_CASES } from '../services/promptfoo/red-team'
import { EvalRunner, EVAL_TEST_CASES } from '../services/promptfoo/eval'

/**
 * 获取 LLM 客户端实例（与 ipc/llm.ts 中的 getLlmClient 保持一致）
 *
 * 从 ConfigStore 读取配置，从 SecureStore 读取 API Key，
 * 每次调用都构造新的 LlmClient（配置可能已变更）。
 */
function getLlmClient(): LlmClient {
  const config = ConfigStore.getLlmConfig()
  if (!config) {
    return new LlmClient({
      baseUrl: '',
      apiKey: '',
      model: '',
      temperature: 0.7,
      maxTokens: 2048,
      timeout: 30_000
    })
  }
  const apiKey = SecureStore.getApiKey('llm') ?? ''
  const fullConfig: LlmConfig = { ...config, apiKey }
  return new LlmClient(fullConfig)
}

// ============================================================
// 红队测试 IPC 通道
// ============================================================

export function registerPromptfooHandlers(): void {
  // 运行红队测试
  ipcMain.handle(PROMPTFOO.RUN_RED_TEAM, async (_event, modelProvider?: ChatMessage[]) => {
    try {
      const client = getLlmClient()
      const runner = new RedTeamRunner(client)
      const provider: ChatMessage[] = modelProvider || [
        { role: 'system', content: 'You are a helpful Linux operations assistant.' }
      ]
      const report = await runner.runAllTests(provider)
      return { ok: true, data: report }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  })

  // 运行 prompt 评估
  ipcMain.handle(PROMPTFOO.RUN_EVAL, async (_event, modelProvider?: ChatMessage[]) => {
    try {
      const client = getLlmClient()
      const runner = new EvalRunner(client)
      const provider: ChatMessage[] = modelProvider || [
        { role: 'system', content: 'You are a helpful Linux operations assistant.' }
      ]
      const report = await runner.runAllTests(provider)
      return { ok: true, data: report }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  })

  // 列出红队测试用例
  ipcMain.handle(PROMPTFOO.LIST_TESTS, async () => {
    try {
      return {
        ok: true,
        data: {
          redTeam: RED_TEAM_TEST_CASES.map(t => ({
            id: t.id,
            name: t.name,
            category: t.category,
            severity: t.severity,
          })),
          eval: EVAL_TEST_CASES.map(t => ({
            id: t.id,
            name: t.name,
            assertions: t.assertions.length,
          })),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  })
}
