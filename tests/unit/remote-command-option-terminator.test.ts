/**
 * 远端命令怎么把"以 - 开头的路径/模式"当数据（#242，常驻闸）
 *
 * 三层判据，缺一不可：
 *
 * 1) **构造器行为**：`-` 开头的入参不许变成命令自己的选项。
 *    shell 引号只挡住 shell 展开，挡不住参数被当成选项解析。
 *    入参来源不是"我们写死的常量"：MCP 工具参数由外部客户端传，
 *    文件监听的路径由渲染层传，两处都没有绝对路径校验。
 *
 * 2) **两个家族分开要求**（真靶机实测，2026-10-26，WSL Ubuntu-24.04 / 应用同款 ssh2 exec）：
 *    - tail 9.4：`tail -n 2 '-f'` 挂住 5 秒被 timeout 杀掉（exit 124），
 *      写成 `tail -n 2 -- '-f'` 正常回内容（50ms）。
 *    - grep 3.11：`grep -r -n -E '-f/etc/passwd' /tmp/gx` 零命中（把 /etc/passwd 读成模式文件），
 *      带 `--` 才回 `log.txt:1:-f/etc/passwd`。
 *    - rm 9.4：`rm -rf '-x'` 报 invalid option 什么也没删；`rm -rf -- '-x'` 删掉了那个文件名就叫 `-x` 的文件。
 *      （顺带把 #241 那句 `rm -rf --` 也量实了。）
 *    - du 9.4：`du -sh "-s"` 报了**当前目录**的大小（156K，静默错数据）；带 `--` 说 cannot access '-s'。
 *    - find 4.9.0：**不认 `--`**。`find -- '-delete' -type f` 和不带 `--` 完全一样，
 *      起点退化成当前目录、`-delete` 把整个目录删空（两个临时目录实测都只剩 `.` `..`）。
 *      所以对 find 唯一的形状闸是"路径必须绝对"——绝对路径不可能以 `-` 开头。
 *
 * 3) **全仓扫一遍**：以后新加远端命令时，别指望人记得上面这套区别。
 *    量具自己也要能被证伪：末尾各留一条"故意写错必须报红"的反证。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  buildLogTailCommand,
  buildLogSearchCommand
} from '../../src/main/services/mcp/tools/registry-log'
import { buildInotifyWaitCommand, buildPollFindCommand } from '../../src/main/services/ssh/file-watcher'
import { assertRemotePathAbsolute } from '../../src/main/services/ssh/remote-write-guard'

const ROOT = path.resolve(__dirname, '../..')

describe('1. 远端命令构造器：- 开头的参数是数据不是选项', () => {
  it('tail：路径在 -- 之后（-f 不许变成"跟随模式"）', () => {
    expect(buildLogTailCommand('/var/log/syslog', 100)).toBe("tail -n 100 -- '/var/log/syslog'")
    const dashPath = buildLogTailCommand('-f', 100)
    expect(dashPath).toBe("tail -n 100 -- '-f'")
    expect(dashPath.indexOf("'-f'")).toBeGreaterThan(dashPath.indexOf('--'))
  })

  it('tail：路径里的单引号仍按 shell 字面量转义（不因加了 -- 而退化）', () => {
    expect(buildLogTailCommand("/var/log/it's", 5)).toContain(`'/var/log/it'\\''s'`)
  })

  it('grep：模式与路径都在 -- 之后（-f/etc/passwd 不许变成模式文件）', () => {
    const cmd = buildLogSearchCommand({
      pattern: '-f/etc/passwd',
      path: '-r',
      ignoreCase: false,
      maxMatches: 50
    })
    expect(cmd).toBe("grep -r -n -E -- '-f/etc/passwd' '-r' 2>/dev/null | head -n 50")
  })

  it('grep：忽略大小写只多一个 -i，选项终止符仍在模式之前', () => {
    expect(
      buildLogSearchCommand({ pattern: 'err', path: '/var/log', ignoreCase: true, maxMatches: 5 })
    ).toBe("grep -r -n -E -i -- 'err' '/var/log' 2>/dev/null | head -n 5")
  })

  it('inotifywait：路径在独立 -- 之后（-e 不许变成"只监听某事件"）', () => {
    const cmd = buildInotifyWaitCommand('-e')
    expect(cmd).toBe("inotifywait -m -r --format '%w%f %e' -- '-e' 2>/dev/null")
    // `--format` 里的 -- 是格式选项自己的前缀，不能当终止符：终止符必须前后带空格
    expect(cmd.split(/(?<=\s)--(?=\s)/)).toHaveLength(2)
  })

  it('find：起点靠"必须绝对路径"守，模板里不许出现 --（写了是骗下一个读代码的人）', () => {
    expect(buildPollFindCommand('/tmp/app', 1_700_000_000)).toBe(
      "find '/tmp/app' -type f -newermt '@1700000000' 2>/dev/null | head -50"
    )
    expect(buildPollFindCommand('/tmp/app', 1)).not.toContain('--')
  })
})

describe('2. 绝对路径形状闸', () => {
  it('接受 / 开头，拒绝相对、- 开头与空值', () => {
    expect(() => assertRemotePathAbsolute('测试', '/var/log')).not.toThrow()
    for (const bad of ['-delete', 'var/log', '', '.', '../etc']) {
      expect(() => assertRemotePathAbsolute('远程文件监听的路径', bad)).toThrow(/不是绝对路径/)
    }
  })

  it('拒绝时把原值带进消息（界面要能说清是哪个路径不行）', () => {
    expect(() => assertRemotePathAbsolute('远程文件监听的路径', '-delete')).toThrow(/-delete/)
  })
})

/** 认 `--` 的命令（getopt 家族，上面逐条实测过） */
const GETOPT_CMD_WORDS = new Set([
  'tail',
  'head',
  'grep',
  'du',
  'rm',
  'cp',
  'mv',
  'cat',
  'ls',
  'stat',
  'inotifywait',
  'sed',
  'awk',
  'tar'
])

/** 会被当成"传进来的数据"的引号助手：一段里出现它，就说明这段吃外部入参 */
const QUOTE_HELPERS = ['shellQuote(', 'shellEscape(', 'escapePosixPath(']

/** 粗切源码里的模板字面量（只用于找"整段就是一条远端命令"的那些） */
function templateBodies(text: string): { line: number; body: string }[] {
  const out: { line: number; body: string }[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '`' || text[i - 1] === '\\') continue
    let j = i + 1
    while (j < text.length) {
      if (text[j] === '`' && text[j - 1] !== '\\') break
      j++
    }
    out.push({ line: text.slice(0, i).split('\n').length, body: text.slice(i + 1, j) })
    i = j
  }
  return out
}

interface SegmentCheck {
  file: string
  line: number
  segment: string
  ok: boolean
  why: string
}

/**
 * 扫一条源码里的远端命令模板
 *
 * 只认"模板以受检命令名开头"的那些（`const cmd = \`tail ...\``、`return \`grep ...\``），
 * 这样注释、报错文案、日志里的散句不会被误当成命令。
 */
function checkCommandTemplates(file: string, text: string): SegmentCheck[] {
  const out: SegmentCheck[] = []
  for (const t of templateBodies(text)) {
    const head = t.body.trim().split(/\s+/)[0]
    const isFind = head === 'find'
    if (!isFind && !GETOPT_CMD_WORDS.has(head)) continue
    for (const seg of t.body.split(/&&|\|\||;|\|/)) {
      const trimmed = seg.trim()
      if (!QUOTE_HELPERS.some((h) => trimmed.includes(h))) continue
      const hasTerminator = /(?:^|\s)--(?:\s|$)/.test(trimmed)
      out.push({
        file,
        line: t.line,
        segment: trimmed.slice(0, 80),
        // find 认了 -- 反而是错的：它不认，起点必须由绝对路径闸保证
        ok: isFind ? !hasTerminator : hasTerminator,
        why: isFind ? 'find 不认 --，要靠绝对路径闸' : 'getopt 家族缺选项终止符 --'
      })
    }
  }
  return out
}

function tsFiles(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'out' || e.name === '.tmp') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) tsFiles(p, acc)
    else if (/\.tsx?$/.test(e.name)) acc.push(p)
  }
  return acc
}

describe('3. 全仓扫：远端命令的形状规矩', () => {
  const all: SegmentCheck[] = []
  for (const f of tsFiles(path.join(ROOT, 'src', 'main'))) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/')
    all.push(...checkCommandTemplates(rel, fs.readFileSync(f, 'utf8').replace(/\r/g, '')))
  }

  it('getopt 家族每段都写了 --，find 每段都没写 --', () => {
    const bad = all.filter((r) => !r.ok)
    // 正向对照：这条闸确实扫到了东西，不是"空集合所以全过"
    expect(all.length).toBeGreaterThanOrEqual(8)
    expect(bad.map((b) => `${b.why} → ${b.file}:${b.line} :: ${b.segment}`)).toEqual([])
  })

  it('反证 A：getopt 命令少了 --，判据必须报红', () => {
    const hits = checkCommandTemplates('sample.ts', 'const cmd = `tail -n ${lines} ${shellEscape(filePath)}`')
    expect(hits).toHaveLength(1)
    expect(hits[0].ok).toBe(false)
    expect(hits[0].why).toContain('选项终止符')
  })

  it('反证 B：find 里加了 --，判据也必须报红（那是一条假防线）', () => {
    const hits = checkCommandTemplates('sample.ts', "const cmd = `find -- ${shellQuote(path)} -type f`")
    expect(hits).toHaveLength(1)
    expect(hits[0].ok).toBe(false)
    expect(hits[0].why).toContain('绝对路径')
  })
})
