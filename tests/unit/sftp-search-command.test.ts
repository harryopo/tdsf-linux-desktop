/**
 * 远程文件搜索的命令构造（#240）
 *
 * 输入来自界面的"根目录/关键词"，两处都必须当成**数据**，不能变成 find/grep 的选项：
 * shell 单引号只挡 shell 展开，挡不住"以 - 开头的参数被 getopt 当成选项"。
 * 例如路径 `-delete` 在 `find <path> -type f` 里会变成动作；`-f/etc/passwd` 会让
 * grep 把系统文件当模式文件读。构造器统一在路径/模式前加 `--`（GNU find/grep 都支持），
 * 引号仍照旧负责 shell 层。
 */
import { describe, it, expect } from 'vitest'
import { buildFindCommand, buildGrepCommand } from '../../src/main/ipc/sftp-search'

describe('buildFindCommand', () => {
  it('正常路径：-- 在路径前，关键词整段在单引号里', () => {
    expect(buildFindCommand('/tmp/e2e-search', 'probe')).toBe(
      "find -- '/tmp/e2e-search' -type f -name '*probe*' 2>/dev/null | head -50",
    )
  })

  it('以 - 开头的路径是数据不是选项（-delete 不许变成 find 的动作）', () => {
    const cmd = buildFindCommand('-delete', 'x')
    expect(cmd).toContain("find -- '-delete' -type f")
    // 选项在 -- 之后：find 只会把它当起点路径
    expect(cmd.indexOf("'-delete'")).toBeGreaterThan(cmd.indexOf('--'))
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
