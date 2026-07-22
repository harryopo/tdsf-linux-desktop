/**
 * SFTP 文件搜索 + 内容 grep IPC Handlers（v2.0 Phase C Task C.1 / C.2）
 *
 * 通道列表（与 @shared/ipc-channels SFTP_SEARCH 对应）：
 * - sftp:search  invoke  渲染 → 主：模糊查找远程文件
 *   通过 SSH 执行 `find <path> -type f -name "*<query>*" 2>/dev/null | head -50`
 *   返回 { files: { path, name, size, mtime }[] }
 *   超时：3 秒
 *
 * - sftp:grep    invoke  渲染 → 主：远程内容搜索
 *   通过 SSH 执行 `grep -rn "<pattern>" <path> 2>/dev/null | head -100`
 *   参数：{ sessionId, path, pattern, isRegex, caseSensitive, wholeWord }
 *   返回 { results: { file, line, text, match }[] }
 *
 * 设计要点：
 * - 复用 SshConnectionManager.exec（已有 keepAlive + 30s 默认超时）
 * - search/grep 自行实现 3 秒超时（用 Promise.race），避免长 find 卡死
 * - 命令注入防护：query/pattern 走单引号转义（' 替换为 '\''）
 * - 解析失败行跳过，不抛错（grep 输出可能含二进制噪声）
 *
 * IPC 4 步同步：
 *   1. 定义（@shared/ipc-channels SFTP_SEARCH）
 *   2. 注册（ipc/index.ts registerSftpSearchIpcHandlers）
 *   3. preload 暴露（sftpSearch / sftpGrep）
 *   4. electron.d.ts 类型声明（ElectronAPI 接口）
 */

import { ipcMain } from 'electron'
import { SFTP_SEARCH } from '@shared/ipc-channels'
import { SshConnectionManager } from '../services/ssh/connection-manager'

/** search 通道单条结果 */
export interface SftpSearchFileEntry {
  /** 完整远程路径 */
  path: string
  /** 文件名（path 最后一段） */
  name: string
  /** 文件大小（字节，未能解析时为 0） */
  size: number
  /** 修改时间（ms，未能解析时为 0） */
  mtime: number
}

/** grep 通道单条结果 */
export interface SftpGrepMatch {
  /** 文件路径 */
  file: string
  /** 行号（1-based，未能解析时为 0） */
  line: number
  /** 整行文本 */
  text: string
  /** 匹配到的子串 */
  match: string
}

/** sftp:search / sftp:grep 命令执行超时（毫秒） */
const SFTP_SEARCH_TIMEOUT_MS = 3_000
/** sftp:search 返回结果上限 */
const SFTP_SEARCH_MAX_FILES = 50
/** sftp:grep 返回结果上限 */
const SFTP_GREP_MAX_RESULTS = 100

/**
 * 把字符串用单引号包裹并转义内部单引号（shell-safe）
 *
 * 例如 `it's me` → `'it'\''s me'`
 * 防止命令注入：用户输入永远在单引号内，shell 不会展开。
 */
function shellQuote(input: string): string {
  return `'${String(input).replace(/'/g, `'\\''`)}'`
}

/**
 * Promise.race 实现超时控制
 *
 * SshConnectionManager.exec 默认 30 秒超时，但 find/grep 可能在巨型目录卡死。
 * 这里包一层 3 秒超时，超时返回空结果，不抛错。
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ])
}

/**
 * 注册 SFTP 文件搜索 + grep IPC handlers
 *
 * 在 ipc/index.ts 的 registerAllIpcHandlers 中调用。
 */
export function registerSftpSearchIpcHandlers(): void {
  const sshManager = SshConnectionManager.getInstance()

  // ------------------------------------------------------------------
  // sftp:search — 模糊查找远程文件
  // ------------------------------------------------------------------

  ipcMain.handle(
    SFTP_SEARCH.SEARCH,
    async (_event, sessionId: string, path: string, query: string) => {
      const safeQuery = shellQuote(`*${query}*`)
      const safePath = shellQuote(path)
      const cmd = `find ${safePath} -type f -name ${safeQuery} 2>/dev/null | head -${SFTP_SEARCH_MAX_FILES}`
      try {
        const result = await withTimeout(
          sshManager.exec(sessionId, cmd),
          SFTP_SEARCH_TIMEOUT_MS,
          { exitCode: 0, stdout: '', stderr: 'timeout', duration: SFTP_SEARCH_TIMEOUT_MS }
        )
        const files: SftpSearchFileEntry[] = []
        for (const rawLine of result.stdout.split('\n')) {
          const line = rawLine.trim()
          if (!line) continue
          const name = line.split('/').filter(Boolean).pop() ?? line
          files.push({ path: line, name, size: 0, mtime: 0 })
        }
        return { files }
      } catch (err) {
        // 失败返回空数组，UI 显示"无结果"，不抛错打断用户
        return { files: [], error: (err as Error).message }
      }
    }
  )

  // ------------------------------------------------------------------
  // sftp:grep — 远程内容搜索
  // ------------------------------------------------------------------

  ipcMain.handle(
    SFTP_SEARCH.GREP,
    async (
      _event,
      params: {
        sessionId: string
        path: string
        pattern: string
        isRegex: boolean
        caseSensitive: boolean
        wholeWord: boolean
      }
    ) => {
      const { sessionId, path, pattern, isRegex, caseSensitive, wholeWord } = params
      // 构造 grep 选项：-r 递归 / -n 显示行号
      const opts: string[] = ['-rn']
      if (!caseSensitive) opts.push('-i')
      if (wholeWord) opts.push('-w')
      // 非 regex 模式使用 -F（fixed string）
      if (!isRegex) opts.push('-F')

      const cmd = `grep ${opts.join(' ')} ${shellQuote(pattern)} ${shellQuote(path)} 2>/dev/null | head -${SFTP_GREP_MAX_RESULTS}`
      try {
        const result = await withTimeout(
          sshManager.exec(sessionId, cmd),
          SFTP_SEARCH_TIMEOUT_MS,
          { exitCode: 0, stdout: '', stderr: 'timeout', duration: SFTP_SEARCH_TIMEOUT_MS }
        )
        const results: SftpGrepMatch[] = []
        for (const rawLine of result.stdout.split('\n')) {
          if (!rawLine) continue
          // grep -rn 输出格式：path:line:text
          const firstColon = rawLine.indexOf(':')
          const secondColon = rawLine.indexOf(':', firstColon + 1)
          if (firstColon === -1 || secondColon === -1) continue
          const file = rawLine.slice(0, firstColon)
          const lineNum = parseInt(rawLine.slice(firstColon + 1, secondColon), 10)
          const text = rawLine.slice(secondColon + 1)
          if (!Number.isFinite(lineNum) || lineNum <= 0) continue
          // 提取匹配子串（用于 UI 高亮）
          let matchStr = pattern
          try {
            if (isRegex) {
              const flags = caseSensitive ? 'g' : 'gi'
              const re = new RegExp(pattern, flags)
              const m = re.exec(text)
              if (m) matchStr = m[0]
            } else {
              matchStr = pattern
            }
          } catch {
            matchStr = pattern
          }
          results.push({ file, line: lineNum, text, match: matchStr })
        }
        return { results }
      } catch (err) {
        return { results: [], error: (err as Error).message }
      }
    }
  )
}
