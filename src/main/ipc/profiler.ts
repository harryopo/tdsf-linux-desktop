/**
 * 系统架构感知 IPC Handlers
 *
 * 注册 profiler:* 三个 invoke 通道，桥接渲染进程与 SystemProfiler 模块。
 *
 * 通道列表：
 * - profiler:run       — 执行 27 项系统探查 + 风险检测 + md 渲染，返回完整结果
 * - profiler:exportMd  — 把报告写进 userData/reports，回文件路径与字节数
 * - profiler:exportPdf — 同上，渲染成 PDF
 *
 * 设计原则：
 * - 探查过程可能耗时 3-8 秒，handler 直接返回 ProfilerRunResponse（含 result / md / risks / summary）
 * - **导出路径由主进程定**：渲染层在沙箱里拿不到 userData、也没有保存对话框（全仓只有
 *   showOpenDialog），原来那对"渲染层传绝对路径"的通道谁都喂不动，还多一条能写任意路径的口；
 *   生成默认文件名那条通道因此整删（`defaultPdfFileName` 仍在主进程内部用）。
 *   界面要告诉用户文件在哪，就把主进程回的那个路径原样显示出来。
 * - 错误统一捕获后抛 Error，渲染进程可在 UI 上展示
 */

import { ipcMain, app } from 'electron'
import * as path from 'node:path'
import { runProfiler } from '../services/profiler/system-profiler'
import { detectRisks, summarizeRisks } from '../services/profiler/risk-detector'
import { renderProfilerMarkdown } from '../services/profiler/markdown-renderer'
import {
  exportMarkdownToPdf,
  writeMdFile,
  defaultPdfFileName
} from '../services/profiler/pdf-exporter'
import { assertWithinConfinement } from '../services/security/path-confinement'
import { redactSecrets } from '../core/agent/providers/redact'
import type { ProfilerRunResponse } from '../services/profiler/types'

/**
 * 报告落点：userData 下的 reports 目录，文件名带主机与秒级时间戳（不覆盖上一份）。
 *
 * 走 assertWithinConfinement 是因为受管根由主进程启动时登记，这里换的是"路径由谁定"，
 * 不是把那道校验省掉。
 */
function reportPath(host: string, ext: 'md' | 'pdf'): string {
  // 主机名会进文件名：只留文件名安全的字符，其余换成 _（远端给的 hostname 可能是一整行 uname 输出）
  const safeHost = host.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)
  const base = defaultPdfFileName(safeHost).replace(/\.pdf$/, '')
  return path.join(app.getPath('userData'), 'reports', `${base}.${ext}`)
}

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
   * profiler:exportMd — 把 md 报告写成文件
   *
   * @param md Markdown 文本（渲染层把 profiler:run 回来的那份原样递回）
   * @param host 主机标识 —— **落点由主进程定**：渲染层在沙箱里既拿不到 userData、
   *             也没有保存对话框可用（全仓只有 showOpenDialog），让它传绝对路径
   *             等于一条谁也用不了、却能写任意路径的口。
   * @returns 写入结果（filePath / size），filePath 原样回给界面显示
   */
  ipcMain.handle(
    'profiler:exportMd',
    async (_event, md: string, host: string): Promise<{ filePath: string; size: number }> => {
      try {
        if (!md || typeof md !== 'string') {
          throw new Error('md 内容无效')
        }
        const safePath = assertWithinConfinement(reportPath(host, 'md'), 'write')
        // 报告会带着远端命令输出（cat ~/.my.cnf、env、日志），导出前后都可能被分享；
        // 在落盘这一道统一脱敏，而不是指望调用方自己记得先涂一遍。
        return await writeMdFile(redactSecrets(md, { returnStats: false }) as string, safePath)
      } catch (err) {
        throw new Error(`导出 md 失败: ${(err as Error).message}`)
      }
    }
  )

  /**
   * profiler:exportPdf — 把 md 渲染成 PDF 并写进报告目录
   *
   * 落点规则与 exportMd 同源（渲染层不碰路径），#208 之后两条路都先过一遍脱敏。
   */
  ipcMain.handle(
    'profiler:exportPdf',
    async (_event, md: string, host: string): Promise<{ filePath: string; size: number }> => {
      try {
        const safePath = assertWithinConfinement(reportPath(host, 'pdf'), 'write')
        return await exportMarkdownToPdf(
          redactSecrets(md, { returnStats: false }) as string,
          safePath
        )
      } catch (err) {
        throw new Error(`导出 PDF 失败: ${(err as Error).message}`)
      }
    }
  )
}
