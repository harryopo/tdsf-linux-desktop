/**
 * 远程文件搜索的命令构造（#240；#242 用真靶机把口径改准）
 *
 * 输入来自界面的"根目录/关键词"，两处都必须当成**数据**，不能变成 find/grep 的选项：
 * shell 单引号只挡 shell 展开，挡不住"以 - 开头的参数被当成选项"。
 * 但两个命令家族的解法不一样，是量出来的（2026-10-26，WSL Ubuntu-24.04）：
 * - grep 3.11 认 `--`。不带它时 `grep -r -n -E '-f/etc/passwd' /tmp/gx` 零命中
 *   （把 /etc/passwd 读成了模式文件），带上才正常回 `log.txt:1:-f/etc/passwd`。
 * - find 4.9.0 **不认** `--`。`find -- '-delete' -type f` 与不带的写法结果一样：
 *   起点退化成当前目录，`-delete` 把整个目录删空（两个临时目录实测都被删光）。
 *   所以对 find 改成"根目录必须是绝对路径"——绝对路径不可能以 `-` 开头。
 */
import { describe, it, expect } from 'vitest'
import { buildFindCommand, buildGrepCommand } from '../../src/main/ipc/sftp-search'

describe('buildFindCommand', () => {
  it('正常路径：起点与关键词都在单引号里（find 不写 --，写了也没用）', () => {
    expect(buildFindCommand('/tmp/e2e-search', 'probe')).toBe(
      "find '/tmp/e2e-search' -type f -name '*probe*' 2>/dev/null | head -50",
    )
  })

  it('以 - 开头或相对的根目录直接拒绝（真靶机实测：-- 挡不住 find 把 -delete 读成动作）', () => {
    expect(() => buildFindCommand('-delete', 'x')).toThrow(/不是绝对路径/)
    expect(() => buildFindCommand('etc', 'x')).toThrow(/不是绝对路径/)
    expect(() => buildFindCommand('', 'x')).toThrow(/不是绝对路径/)
  })

  it('单引号注入仍被转义成 shell 字面量', () => {
    const cmd = buildFindCommand("/tmp/it's", "a'b")
    expect(cmd).toContain(`'/tmp/it'\\''s'`)
    expect(cmd).toContain(`'*a'\\''b*'`)
    const evil = buildFindCommand('/tmp', "'; rm -rf / #")
    // 先闭合单引号，再把这一小段作为字面量拼进去（shellQuote 的标准写法）
    expect(evil).toContain(`'*'\\''; rm -rf / #*'`)
  })
})

describe('buildGrepCommand', () => {
  const base = { pattern: 'root', path: '/var/log', isRegex: false, caseSensitive: true, wholeWord: false }

  it('非正则 + 区分大小写：-Fn，模式与路径都在 -- 之后', () => {
    const cmd = buildGrepCommand(base)
    expect(cmd).toBe("grep -rn -F -- 'root' '/var/log' 2>/dev/null | head -100")
  })

  it('以 - 开头的模式/路径不会被 grep 当成选项（-f/etc/passwd 是模式文件）', () => {
    const cmd = buildGrepCommand({ ...base, pattern: '-f/etc/passwd', path: '-r' })
    expect(cmd).toContain("grep -rn -F -- '-f/etc/passwd' '-r'")
    expect(cmd.indexOf('--')).toBeLessThan(cmd.indexOf("'-f/etc/passwd'"))
  })

  it('正则 + 忽略大小写 + 整词：选项齐且仍以 -- 收尾', () => {
    const cmd = buildGrepCommand({ ...base, isRegex: true, caseSensitive: false, wholeWord: true })
    expect(cmd.startsWith('grep -rn -i -w --')).toBe(true)
  })
})
