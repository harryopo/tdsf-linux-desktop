/**
 * 系统架构感知 IPC Handlers
 *
 * 注册 profiler:* 三个 invoke 通道，桥接渲染进程与 SystemProfiler 模块。
 *
 * 通道列表：
 * - profiler:run         — 执行 27 项系统探查 + 风险检测 + md 渲染，返回完整结果
 * - profiler:exportMd    — 将 md 文本写入文件
 * - profiler:exportPdf   — 将 md 文本渲染为 PDF 并写入文件
 *
 * 设计原则：
 * - 探查过程可能耗时 3-8 秒，handler 直接返回 ProfilerRunResponse（含 result / md / risks / summary）
 * - 渲染进程拿到结果后可立即弹窗预览，并异步导出文件
 * - 错误统一捕获后抛 Error，渲染进程可在 UI 上展示
 */

import { ipcMain } from 'electron'
import { runProfiler } from '../services/profiler/system-profiler'
import { detectRisks, summarizeRisks } from '../services/profiler/risk-detector'
import { renderProfilerMarkdown } from '../services/profiler/markdown-renderer'
import {
  exportMarkdownToPdf,
  writeMdFile,
  defaultPdfFileName
} from '../services/profiler/pdf-exporter'
import type { ProfilerRunResponse } from '../services/profiler/types'

/**
 * 注册系统架构感知相关 IPC handlers
 */
export function registerProfilerIpcHandlers(): void {
  /**
   * profiler:run — 执行完整系统架构探查
   *
   * @param sessionId SSH 会话 ID（必须已连接）
   * @param host 主机标识（用于展示）
   * @returns ProfilerRunResponse（result + md + risks + summary）
   */
  ipcMain.handle(
    'profiler:run',
    async (_event, sessionId: string, host: string): Promise<ProfilerRunResponse> => {
      try {
        if (!sessionId || typeof sessionId !== 'string') {
          throw new Error('sessionId 无效')
        }
        if (!host || typeof host !== 'string') {
          throw new Error('host 无效')
        }

        // 1. 执行 27 项并发探查
        const result = await runProfiler(sessionId, host)

        // 2. 风险检测
        const risks = detectRisks(result)
        result.risks = risks

        // 3. 渲染 md
        const md = renderProfilerMarkdown(result, risks)

        // 4. 风险摘要
        const summary = summarizeRisks(risks)

        return { result, md, risks, summary }
      } catch (err) {
        throw new Error(`系统架构感知失败: ${(err as Error).message}`)
      }
    }
  )

  /**
   * profiler:exportMd — 将 md 文本写入文件
   *
   * @param md Markdown 文本
   * @param outputPath 目标文件绝对路径
   * @returns 写入结果（filePath / size）
   */
  ipcMain.handle(
    'profiler:exportMd',
    async (_event, md: string, outputPath: string): Promise<{ filePath: string; size: number }> => {
      try {
        if (!md || typeof md !== 'string') {
          throw new Error('md 内容无效')
        }
        if (!outputPath || typeof outputPath !== 'string') {
          throw new Error('输出路径无效')
        }
        return await writeMdFile(md, outputPath)
      } catch (err) {
        throw new Error(`导出 md 失败: ${(err as Error).message}`)
      }
    }
  )

  /**
   * profiler:exportPdf — 将 md 文本渲染为 PDF 并写入文件
   *
   * @param md Markdown 文本
   * @param outputPath 目标文件绝对路径
   * @returns 写入结果（filePath / size）
   */
  ipcMain.handle(
    'profiler:exportPdf',
    async (_event, md: string, outputPath: string): Promise<{ filePath: string; size: number }> => {
      try {
        return await exportMarkdownToPdf(md, outputPath)
      } catch (err) {
        throw new Error(`导出 PDF 失败: ${(err as Error).message}`)
      }
    }
  )

  /**
   * profiler:defaultFileName — 生成默认的导出文件名
   *
   * @param host 主机名
   * @returns 文件名（不含路径）
   */
  ipcMain.handle(
    'profiler:defaultFileName',
    async (_event, host: string, ext: 'md' | 'pdf'): Promise<string> => {
      const base = defaultPdfFileName(host).replace(/\.pdf$/, '')
      return `${base}.${ext}`
    }
  )
}
