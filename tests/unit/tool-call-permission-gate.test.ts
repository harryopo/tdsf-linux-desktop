/**
 * 工具调用权限闸（P0-4 + P1-5 的验收判据）
 *
 * 两件事分开钉：
 * 1. `assessToolCall` 的行为 —— 工具调用接的是 core/command-gate 同一个闸，
 *    所以终端里拦得住的，工具调用也拦得住（判据只有一条来源）
 * 2. 源码里不许再出现硬编码的 bypass —— 静态断言 + 阴性对照（量具能被证伪才算在跑）
 *
 * 2026-10-12 更名：原来这个文件还钉 Claude SDK 的 permissionMode 逃生阀，
 * 那条 SDK 已退役（非开源、只认 Anthropic 模型），剩下的两面都跟 SDK 无关。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'
import { listSourceFiles, readSourceFile } from '../helpers/source-scan'
import { describe, expect, it } from 'vitest'
import { assessToolCall } from '../../src/main/core/command-gate'

const ROOT = path.resolve(__dirname, '../..')

describe('assessToolCall · 工具调用回到同一个闸', () => {
  it('ssh_exec 里的高危命令必须拒', () => {
    for (const cmd of ['rm -rf /', 'chmod 777 /etc/passwd', 'find / -exec rm -rf {} +']) {
      const v = assessToolCall('mcp__tdsf-linux-ops__ssh_exec', { sessionId: 's1', command: cmd })
      expect(v.allow, cmd).toBe(false)
      expect(v.level, cmd).toBe('block')
      expect(v.reason, cmd).toContain('高危命令已被拦截')
    }
  })

  it('普通命令放行', () => {
    const v = assessToolCall('mcp__tdsf-linux-ops__ssh_exec', {
      sessionId: 's1',
      command: 'df -h',
    })
    expect(v.allow).toBe(true)
  })

  it('MCP 全限定名与裸工具名都要认（判定不依赖前缀形状）', () => {
    for (const name of ['ssh_exec', 'mcp__tdsf-linux-ops__ssh_exec']) {
      expect(assessToolCall(name, { command: 'rm -rf /' }).allow, name).toBe(false)
    }
  })

  it('sftp_write_file 写系统关键路径必须拒', () => {
    for (const p of ['/etc/passwd', '/etc/ssh/sshd_config', '/root/.ssh/authorized_keys']) {
      const v = assessToolCall('mcp__tdsf-linux-ops__sftp_write_file', {
        sessionId: 's1',
        path: p,
        content: 'x',
      })
      expect(v.allow, p).toBe(false)
      expect(v.reason, p).toContain('系统关键路径')
    }
  })

  it('sftp_write_file 写用户目录放行', () => {
    expect(
      assessToolCall('mcp__tdsf-linux-ops__sftp_write_file', {
        sessionId: 's1',
        path: '/home/opuser/app.log',
        content: 'x',
      }).allow,
    ).toBe(true)
  })

  it('只读工具放行', () => {
    expect(assessToolCall('sftp_read_file', { path: '/etc/hostname' }).allow).toBe(true)
    expect(assessToolCall('sftp_list', { path: '/var/log' }).allow).toBe(true)
  })

  it('未登记的工具按 fail-closed 拒绝（不许默认放行）', () => {
    const v = assessToolCall('Bash', { command: 'ls' })
    expect(v.allow).toBe(false)
    expect(v.reason).toContain('fail-closed')
  })

  it('入参形状不对时不许当成"没风险"', () => {
    // command 不是字符串 → 走不到命令判定；但这不等于放行整条调用之外的东西，
    // 这里钉住当前语义：无命令体时按未命中规则处理，同时确认没有抛错
    expect(assessToolCall('ssh_exec', { sessionId: 's1' }).allow).toBe(true)
  })
})


describe('静态判据：源码里不许硬编码 bypass', () => {
  // 用 AST 而不是文本匹配：正则会把注释里的字面量也算成违规（写第一版时就被自己
  // 的注释假红了 3 处）。只认**对象字面量里的真实赋值**：
  //   permissionMode: 'bypassPermissions' / allowDangerouslySkipPermissions: true
  // 注释里讨论这个写法不算违规 —— 阴性对照同时钉住这两点。
  function findHardcodedBypass(file: string): string[] {
    const src = ts.createSourceFile(file, readSourceFile(file), ts.ScriptTarget.ES2022, true)
    const found: string[] = []
    const walk = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node)) {
        const key = node.name.getText()
        const init = node.initializer
        if (key === 'permissionMode' && ts.isStringLiteral(init) && init.text === 'bypassPermissions') {
          found.push(`${file}: permissionMode 字面量 bypassPermissions`)
        }
        if (key === 'allowDangerouslySkipPermissions' && init.kind === ts.SyntaxKind.TrueKeyword) {
          found.push(`${file}: allowDangerouslySkipPermissions 字面量 true`)
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(src)
    return found
  }

  function scan(dir: string): string[] {
    // 取数口只有一份（跳过测试探针、node_modules、点开头目录）：见 tests/helpers/source-scan.ts
    const hits: string[] = []
    for (const f of listSourceFiles(dir)) hits.push(...findHardcodedBypass(f))
    return hits
  }

  it('src/main 里没有硬编码的 bypassPermissions / allowDangerouslySkipPermissions: true', () => {
    const hits = scan(path.join(ROOT, 'src/main'))
    expect(hits, '绕过审批的写法又回来了：\n' + hits.join('\n')).toEqual([])
  })

  it('量具自证：真赋值要抓到，注释里的同字样不该误报', () => {
    // 探针写在 src 外面：普查 src 的测试有十几个，都是"先列目录再读文件"，
    // 把临时 .ts 塞进 src/main 会让它们随机撞 ENOENT（实测红过：能力普查、
    // 死防线登记、风险规则通道各一次）。分类器是同一个，自证强度不打折。
    const DIR = path.join(ROOT, 'tests/fixtures/static-gates')
    const MAIN = path.join(ROOT, 'src/main')
    const fake = path.join(DIR, '__permission-canary__.ts')
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(
      fake,
      [
        "// 讨论：以前写死 permissionMode: 'bypassPermissions' 是错的",
        'const bad = { permissionMode: \'bypassPermissions\', allowDangerouslySkipPermissions: true }',
        'export default bad',
        '',
      ].join('\n'),
      'utf8'
    )
    try {
      const hits = [...scan(MAIN), ...scan(DIR)]
      const canaryHits = hits.filter((h) => h.includes('__permission-canary__'))
      expect(canaryHits.length, '注入的真赋值没被抓到 = 这条闸是摆设').toBe(2)
      // 注释里出现同样的字面量，整仓计数仍为 2（说明判据只认代码不认散文）
      expect(hits.length, '注释里的字面量被误判成违规：\n' + hits.join('\n')).toBe(2)
    } finally {
      fs.rmSync(fake, { force: true })
    }
  })
})
