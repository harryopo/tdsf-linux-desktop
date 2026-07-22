/**
 * LLM Inline Completion + Diff IPC Handlers（v2.0 Phase B · Task B.5）
 *
 * // @ai-session: ai-glm-20260722-phaseB-v2.0
 * // @ai-task: phaseB-inline-completion
 *
 * 4 个新 IPC 通道（严格遵循 IPC 4 步同步铁律）：
 * - llm:inline-completion        invoke  渲染 → 主：请求光标位置补全
 * - llm:inline-completion:cancel invoke  渲染 → 主：取消进行中的补全
 * - llm:apply-diff               invoke  渲染 → 主：应用 diff（写入新内容到本地文件）
 * - llm:diff-preview             invoke  渲染 → 主：预览 diff（unified diff 格式）
 *
 * 设计依据：v2.0 Phase B · Task B.5
 * 安全：apply-diff 仅写入本地文件系统；远程文件由渲染层通过 sftp:writeFile 处理
 */
import { ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { LLM_INLINE } from '@shared/ipc-channels'
import { getInlineCompletionService, type InlineCompletionRequest, type InlineCompletionItem } from '../services/llm/inline-completion-service'
import { logger } from '../services/log/logger'
import { redactSecrets } from '../core/agent/providers/redact'

/**
 * 生成 unified diff（行级 LCS 算法）
 *
 * 简化实现：基于最长公共子序列（LCS）逐行比较，
 * 输出标准 unified diff 格式（@@ -l,s +l,s @@ + 行变更）。
 *
 * @param original 原始内容
 * @param modified 修改后内容
 * @returns unified diff 字符串（无变更返回空字符串）
 */
function generateUnifiedDiff(original: string, modified: string): string {
  const aLines = original.split('\n')
  const bLines = modified.split('\n')
  const n = aLines.length
  const m = bLines.length

  // LCS DP 表
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  // 回溯生成 diff 行
  const hunks: string[] = []
  let i = 0
  let j = 0
  let oldStart = 0
  let newStart = 0
  let pending: string[] = []
  let hasChange = false

  const flush = (): void => {
    if (!hasChange) return
    const oldCount = pending.filter((l) => l.startsWith('-') && !l.startsWith('---')).length
    const newCount = pending.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length
    const ctx = pending.filter((l) => l.startsWith(' '))
    hunks.push(`@@ -${oldStart + 1},${oldCount} +${newStart + 1},${newCount} @@`)
    hunks.push(...ctx, ...pending.filter((l) => !l.startsWith(' ')))
    pending = []
    hasChange = false
  }

  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      if (hasChange && pending.length > 0) {
        // 上下文行（最多保留 3 行）
        if (pending.filter((l) => l.startsWith(' ')).length >= 3) {
          flush()
        }
      }
      if (!hasChange) {
        oldStart = i
        newStart = j
      }
      pending.push(` ${aLines[i]}`)
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      if (!hasChange) {
        oldStart = i
        newStart = j
      }
      pending.push(`-${aLines[i]}`)
      hasChange = true
      i++
    } else {
      if (!hasChange) {
        oldStart = i
        newStart = j
      }
      pending.push(`+${bLines[j]}`)
      hasChange = true
      j++
    }
  }
  while (i < n) {
    if (!hasChange) {
      oldStart = i
      newStart = j
    }
    pending.push(`-${aLines[i]}`)
    hasChange = true
    i++
  }
  while (j < m) {
    if (!hasChange) {
      oldStart = i
      newStart = j
    }
    pending.push(`+${bLines[j]}`)
    hasChange = true
    j++
  }
  flush()

  return hunks.length > 0 ? hunks.join('\n') : ''
}

/**
 * 注册 LLM Inline + Diff IPC handlers
 *
 * 在 ipc/index.ts 的 registerAllIpcHandlers 中调用。
 */
export function registerLlmInlineHandlers(): void {
  // ------------------------------------------------------------------
  // llm:inline-completion — 请求光标位置补全
  // ------------------------------------------------------------------
  ipcMain.handle(
    LLM_INLINE.INLINE_COMPLETION,
    async (_event, req: InlineCompletionRequest): Promise<InlineCompletionItem[]> => {
      try {
        const service = getInlineCompletionService()
        return await service.getCompletion(req)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.warn('IPC.LLM_INLINE', 'inline-completion 失败', {
          filePath: req?.filePath,
          error: redactSecrets(msg),
        })
        return []
      }
    },
  )

  // ------------------------------------------------------------------
  // llm:inline-completion:cancel — 取消进行中的补全
  // ------------------------------------------------------------------
  ipcMain.handle(LLM_INLINE.INLINE_COMPLETION_CANCEL, async (): Promise<void> => {
    try {
      getInlineCompletionService().cancel()
    } catch (err) {
      logger.warn('IPC.LLM_INLINE', 'inline-completion:cancel 失败', {
        error: redactSecrets(err instanceof Error ? err.message : String(err)),
      })
    }
  })

  // ------------------------------------------------------------------
  // llm:apply-diff — 应用 diff（写入新内容到本地文件）
  // ------------------------------------------------------------------
  // 安全：仅写入本地文件系统；远程文件由渲染层通过 sftp:writeFile 处理
  ipcMain.handle(
    LLM_INLINE.APPLY_DIFF,
    async (
      _event,
      payload: { filePath: string; newContent: string },
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const { filePath, newContent } = payload
        if (!filePath || !isAbsolute(filePath)) {
          return { success: false, error: 'filePath 必须为绝对路径（远程文件请走 sftp:writeFile）' }
        }
        // 规范化路径，防止相对路径注入
        const safePath = resolve(filePath)
        await writeFile(safePath, newContent, 'utf8')
        logger.info('IPC.LLM_INLINE', 'apply-diff 写入成功', { filePath: safePath, bytes: newContent.length })
        return { success: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error('IPC.LLM_INLINE', 'apply-diff 失败', { error: redactSecrets(msg) })
        return { success: false, error: msg }
      }
    },
  )

  // ------------------------------------------------------------------
  // llm:diff-preview — 预览 diff（unified diff 格式）
  // ------------------------------------------------------------------
  ipcMain.handle(
    LLM_INLINE.DIFF_PREVIEW,
    async (
      _event,
      payload: { filePath: string; originalContent: string; modifiedContent: string },
    ): Promise<{ diff: string }> => {
      try {
        const diff = generateUnifiedDiff(payload.originalContent, payload.modifiedContent)
        return { diff }
      } catch (err) {
        logger.warn('IPC.LLM_INLINE', 'diff-preview 失败', {
          filePath: payload?.filePath,
          error: redactSecrets(err instanceof Error ? err.message : String(err)),
        })
        return { diff: '' }
      }
    },
  )

  logger.info('IPC.LLM_INLINE', 'LLM Inline + Diff IPC handlers 已注册', {
    channels: [
      LLM_INLINE.INLINE_COMPLETION,
      LLM_INLINE.INLINE_COMPLETION_CANCEL,
      LLM_INLINE.APPLY_DIFF,
      LLM_INLINE.DIFF_PREVIEW,
    ],
  })
}
