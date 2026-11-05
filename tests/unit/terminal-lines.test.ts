/**
 * terminal-lines 的单测 —— 钉住"残字粘行首"时判据仍然成立，且没有把量具放水
 *
 * 现场串全部来自 2026-11-05 的受控复现（PowerShell 5.1 PSReadLine 写历史失败 →
 * 长错误在 ConPTY 折行处漏出残字，粘到下一行行首）。
 */
import { describe, expect, it } from 'vitest'
import { countOutputLines, hasOutputLine, stripAnsi, terminalLines } from '../e2e/terminal-lines'

describe('terminal-lines', () => {
  it('干净输出：token 独占一行才算输出', () => {
    const blob = 'PS C:\\Users\\Administrator> echo systemctl\r\nsystemctl\r\nPS C:\\Users\\Administrator> '
    expect(hasOutputLine(blob, 'systemctl')).toBe(true)
  })

  it('只有回显没有输出 → 不算（命令没执行时不许判过）', () => {
    const blob = 'PS C:\\Users\\Administrator> echo systemctl\r\n'
    expect(hasOutputLine(blob, 'systemctl')).toBe(false)
    expect(countOutputLines(blob, 'systemctl')).toBe(0)
  })

  it('PSReadLine 报错残字粘在行首 → 仍认得出这是输出行', () => {
    const blob =
      'PS C:\\Users\\Administrator> echo BASE_x\r\n' +
      '\u001b[91mError reading or writing history file ...\r\n' +
      '\u01b0m\u001b[mBASE_x\r\n'
    expect(hasOutputLine(blob, 'BASE_x')).toBe(true)
    expect(countOutputLines(blob, 'BASE_x')).toBe(1)
  })

  it('残字带空格（u / un）也不影响识别', () => {
    expect(hasOutputLine('PS C:\\Users\\Administrator> echo BASE_x\r\nu BASE_x\r\n', 'BASE_x')).toBe(true)
    expect(hasOutputLine('PS C:\\Users\\Administrator> echo journalctl\r\nun journalctl\r\n', 'journalctl')).toBe(
      true,
    )
  })

  it('token 被拼进上一条命令 → 不算单独成行（拦截失效时量具要能红）', () => {
    const blob = 'PS C:\\Users\\Administrator> rm -rf /echo AFTER_x\r\n'
    expect(hasOutputLine(blob, 'AFTER_x')).toBe(false)
    expect(countOutputLines(blob, 'AFTER_x')).toBe(0)
  })

  it('整批未转发：只有回显 → 计数 0', () => {
    const blob = 'PS C:\\Users\\Administrator> echo SAFE_x\r\nPS C:\\Users\\Administrator> '
    expect(countOutputLines(blob, 'SAFE_x')).toBe(0)
    // 残字粘在下一行提示符上也不能被算成 SAFE_x 的输出
    expect(countOutputLines('PS C:\\Users\\Administrator> echo SAFE_x\r\n\u01b0m PS C:\\Users\\Administrator> ', 'SAFE_x')).toBe(0)
  })

  it('stripAnsi / terminalLines 去掉控制序列、\r 与 NBSP', () => {
    expect(stripAnsi('\u001b[91mred\u001b[m')).toBe('red')
    expect(terminalLines('\u001b[91mred\u001b[m\u00a0\u00a0\r\nblue')).toEqual(['red', 'blue'])
  })
})
