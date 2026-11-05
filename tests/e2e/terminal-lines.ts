/**
 * terminal-lines.ts —— 终端输出的"按行判据"纯函数 + 双击选词
 *
 * 为什么不再用"整行精确等于 token"：PowerShell 5.1 的 PSReadLine 在写历史文件
 * 失败时，会往 stdout 打一段很长的红色错误（`Error reading or writing history file ...`）。
 * ConPTY 对这段超长中文折行时会漏出几个残字，粘在**下一条输出行**的行首
 * （2026-11-05 受控复现：`ưmBASE_x`、`u BASE_x`、`un journalctl`）。
 * 于是 `l.trim() === 'BASE_x'` 这类判据必然为 0，而终端其实已经把命令和输出都画出来了
 * ——失败信息会写成"输出还没画出来"，把环境噪声误报成产品回归。
 *
 * 判据改成按"输出行"的语义：
 *   · 该行以 token 结尾（残字只接在行首，不会吃掉 token）；
 *   · 且它不是命令回显行（回显里 token 前面紧跟着 `echo`）。
 * 两条一起才成立，所以"命令没执行、只有回显"依然判不出来（量具没被放水）。
 *
 * 纯函数部分可在 vitest 里单测（tests/unit/terminal-lines.test.ts）；
 * selectWordOnOutputLine 依赖 Playwright 的 Page，只在 e2e 里用。
 */
import type { Page } from '@playwright/test'

/** 去掉主进程推送的 ANSI 控制序列，方便按行判断 */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

/** 按行切开并去掉首尾空白（含 \r 与 xterm 的空列 NBSP） */
export function terminalLines(raw: string): string[] {
  return stripAnsi(raw)
    .split(/[\r\n]+/)
    .map((l) => l.trim())
}

/**
 * 这一行是不是"命令回显"而不是命令输出。
 * 回显形如 `PS C:\Users\Administrator> echo systemctl`：token 前面紧跟着命令词。
 */
function isEchoLine(line: string, token: string): boolean {
  return line.includes(`echo ${token}`) || line.includes(`echo${token}`)
}

/**
 * 终端里是否出现了 token 的**输出行**（不是输入回显，也不是粘在别的命令尾巴上）。
 *
 * 例：`ưmBASE_x` → true（残字在行首，token 仍独占行尾）；
 *     `PS C:\...> echo BASE_x` → false（这是回显）；
 *     `rm -rf /echo AFTER_x` → false（token 被拼进上一条命令）。
 */
export function hasOutputLine(raw: string, token: string): boolean {
  return countOutputLines(raw, token) > 0
}

/** 同 hasOutputLine，但返回条数（用于"整批不该被转发"要断言 0 的场景） */
export function countOutputLines(raw: string, token: string): number {
  return terminalLines(raw).filter((l) => l.endsWith(token) && !isEchoLine(l, token)).length
}

/**
 * 选中终端输出行里的那个词。
 *
 * 选行规则同 hasOutputLine；选中范围不用"行首往右 6 像素"猜，而是在页面里用 Range
 * 量 token 自己那几格的真实矩形，再从第一格拖到最后一格。
 *
 * 为什么不是双击（xterm 自己的选词手势）：双击的词边界是空白，而残字 `ưmsystemctl`
 * 里残字与 token 之间**没有空格**，双击会把整段选中——2026-11-05 在受控噪声下实测
 * `SELECTED=ưmsystemctl`，词典当然查不到。拖拽按列走，起止都落在 token 自己的格子里。
 */
export async function selectWordOnOutputLine(
  page: Page,
  token: string,
  timeoutMs = 20000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const point = await page.evaluate((want) => {
      const rows = Array.from(
        document.querySelectorAll('.terminal-view.visible .xterm-rows > div'),
      )
      // 从下往上找：同一 token 在更早的历史里可能出现过，最近那次才是这次命令的输出
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]
        const text = (row.textContent ?? '').replace(/\u00a0/g, ' ')
        if (!text.trimEnd().endsWith(want)) continue
        if (text.includes(`echo ${want}`) || text.includes(`echo${want}`)) continue
        // token 可能落在某个 span 的某个文本节点里，用 Range 量它自己的矩形
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
        let node: Text | null = null
        let offset = -1
        while (walker.nextNode()) {
          const t = walker.currentNode as Text
          const at = (t.data ?? '').indexOf(want)
          if (at >= 0) {
            node = t
            offset = at
            break
          }
        }
        if (!node) continue
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + want.length)
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) continue
        // 两端各留 1px：让鼠标落进第一格/最后一格内部，而不是压在格子边界上
        return {
          x1: rect.left + 1,
          x2: Math.max(rect.left + 1, rect.right - 1),
          y: rect.top + rect.height / 2,
        }
      }
      return null
    }, token)
    if (point) {
      await page.mouse.move(point.x1, point.y)
      await page.mouse.down()
      await page.mouse.move(point.x2, point.y, { steps: 5 })
      await page.mouse.up()
      return
    }
    await page.waitForTimeout(150)
  }
  throw new Error(`终端里没有"${token}"这一整行的输出（输出还没画出来，或只找到带它的回显行）`)
}
