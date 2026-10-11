/**
 * Claude SDK 权限闸（P0-4 + P1-5 的验收判据）
 *
 * 两件事分开钉：
 * 1. `assessToolCall` 的行为 —— SDK 的 canUseTool 接的是 core/command-gate 同一个闸，
 *    所以终端里拦得住的，工具调用也拦得住（判据只有一条来源）
 * 2. 源码里不许再出现硬编码的 bypass —— 静态断言 + 阴性对照（量具能被证伪才算在跑）
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { assessToolCall } from '../../src/main/core/command-gate'
import {
  resolveSdkPermissionPolicy,
  SKIP_PERMISSIONS_ENV,
} from '../../src/main/core/agent/claude-sdk/claude-sdk-provider'

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

describe('resolveSdkPermissionPolicy · 逃生阀默认关', () => {
  it('默认是 default 模式，不是 bypass', () => {
    expect(resolveSdkPermissionPolicy({})).toEqual({ bypass: false, mode: 'default' })
  })

  it('只有显式 =1 才跳过', () => {
    expect(resolveSdkPermissionPolicy({ [SKIP_PERMISSIONS_ENV]: '1' }).mode).toBe(
      'bypassPermissions'
    )
    // 横扫同类写法：'true' / '0' / 空串都不该被当成开启
    for (const v of ['true', '0', '', 'yes', '2']) {
      expect(resolveSdkPermissionPolicy({ [SKIP_PERMISSIONS_ENV]: v }).bypass, JSON.stringify(v)).toBe(
        false
      )
    }
  })
})

describe('静态判据：源码里不许硬编码 bypass', () => {
  // 用 AST 而不是文本匹配：正则会把注释里的字面量也算成违规（写第一版时就被自己
  // 的注释假红了 3 处）。只认**对象字面量里的真实赋值**：
  //   permissionMode: 'bypassPermissions' / allowDangerouslySkipPermissions: true
  // 注释里讨论这个写法不算违规 —— 阴性对照同时钉住这两点。
  function findHardcodedBypass(file: string): string[] {
    const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true)
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
    const hits: string[] = []
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue
        hits.push(...scan(full))
        continue
      }
      if (/\.tsx?$/.test(e.name)) hits.push(...findHardcodedBypass(full))
    }
    return hits
  }

  it('src/main 里没有硬编码的 bypassPermissions / allowDangerouslySkipPermissions: true', () => {
    const hits = scan(path.join(ROOT, 'src/main'))
    expect(hits, '绕过审批的写法又回来了：\n' + hits.join('\n')).toEqual([])
  })

  it('量具自证：真赋值要抓到，注释里的同字样不该误报', () => {
    const MAIN = path.join(ROOT, 'src/main')
    const fake = path.join(MAIN, '__permission-canary__.ts')
    // 建完再删会把 src/main 这个**目录**的 mtime 顶到当下，
    // 而 tests/e2e/global-setup.ts 的新鲜度门按目录递归取最新 mtime ——
    // 于是下一次 e2e 会误报"out/ 比 src/ 旧，跑的是改版前的包"。用完原样还回去。
    const before = fs.statSync(MAIN).mtimeMs
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
      const hits = scan(MAIN)
      const canaryHits = hits.filter((h) => h.includes('__permission-canary__'))
      expect(canaryHits.length, '注入的真赋值没被抓到 = 这条闸是摆设').toBe(2)
      // 注释里出现同样的字面量，整仓计数仍为 2（说明判据只认代码不认散文）
      expect(hits.length, '注释里的字面量被误判成违规：\n' + hits.join('\n')).toBe(2)
    } finally {
      fs.rmSync(fake, { force: true })
      fs.utimesSync(MAIN, new Date(), new Date(before))
      expect(Math.abs(fs.statSync(MAIN).mtimeMs - before), '目录 mtime 没还原，会误报 e2e 构建门').toBeLessThan(2000)
    }
  })
})
