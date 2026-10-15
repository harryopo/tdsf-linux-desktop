/**
 * 远端改写闸（2026-10-15 全维度系统审查 P0-1）
 *
 * 病根：系统关键路径的保护只长在**命令文本**上（`isProtectedWriteTarget` 被 shell
 * 重定向检测与 MCP 形状表调用），而 SFTP 这族平行出口把渲染层传来的 remotePath 直接
 * 喂给 createWriteStream / unlink / chmod。于是 `echo x > /etc/passwd` 会被拦，
 * 编辑器保存 /etc/passwd 一路放行——而本产品连接默认用户名就是 root。
 *
 * 两件事分开验，缺一条就是半个判据：
 *   A 判定语义：含 `..` 绕道（旧 normTarget 不解析 `..`，`/home/u/../etc/passwd` 落在所有前缀之外）；
 *   B 闸的位置：拒绝必须发生在**碰 SSH 之前**。只测判定函数测不到"忘了调"这一类缺陷。
 */
import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Client } from 'ssh2'
import * as ts from 'typescript'
import { isProtectedWriteDestination } from '@main/core/command-gate'
import { SftpManager } from '@main/services/ssh/sftp'
import { SshConnectionManager } from '@main/services/ssh/connection-manager'

const ROOT = path.resolve(__dirname, '../..')

/** 触网哨兵：一旦被调用就说明闸放行到了 SSH 那一步 */
const TOUCHED = 'SENTINEL_GETCLIENT_CALLED'

function managerWith(getClient: (sessionId: string) => Client): SftpManager {
  const fake = Object.create(SshConnectionManager.prototype) as SshConnectionManager
  fake.getClient = getClient
  return new SftpManager(fake)
}

/** 拒绝类用例：断言既报"系统关键路径"，又从未碰 SSH */
async function expectRefusedBeforeWire(call: () => Promise<unknown>, spy: ReturnType<typeof vi.fn>): Promise<void> {
  await expect(call()).rejects.toThrow(/系统关键路径/)
  expect(spy, '拒一个系统路径不该先打开 SSH 通道').not.toHaveBeenCalled()
}

describe('远端写目的地判定（含 .. 绕道）', () => {
  it('系统关键路径一律判保护', () => {
    for (const p of [
      '/etc/passwd',
      '/etc',
      '/root/.ssh/authorized_keys',
      '/usr/lib/systemd/x',
      '/var/log/syslog',
      '/bin/sh',
      '/proc/self/mem',
      '/',
      '/*',
    ]) {
      expect(isProtectedWriteDestination(p), `${p} 应判为系统关键路径`).toBe(true)
    }
  })

  it('用户区路径不误伤（正向对照，否则闸只会把功能关掉）', () => {
    for (const p of ['/home/user/app/server.py', '/tmp/build.log', '/var/www/html/index.html', '/data/db/x.sqlite']) {
      expect(isProtectedWriteDestination(p), `${p} 不该被拦`).toBe(false)
    }
    // 写丢弃位等于没写，放行（历史上 /dev 前缀一刀切误伤过 2>/dev/null）
    expect(isProtectedWriteDestination('/dev/null')).toBe(false)
  })

  it('用 .. 绕道进系统路径仍然判保护', () => {
    for (const p of [
      '/var/www/../log/syslog', // → /var/log/syslog
      '/proc/../etc/shadow', // → /etc/shadow
      '/etc/../../root/.ssh/authorized_keys', // 逃出根之后仍落 /root
      '/../etc/shadow',
      '../etc/passwd', // 相对路径带 ..：按"从根算起"的最坏解释判
    ]) {
      expect(isProtectedWriteDestination(p), `${p} 折叠后应命中保护前缀`).toBe(true)
    }
    // 折叠后仍在用户区的别顺手拦掉：/home/user/../etc/passwd 落点是 /home/etc/passwd，
    // 那是个普通用户目录下的路径，不是 /etc——按 POSIX 语义放行才是不夸大防线的写法
    for (const p of ['/home/user/../etc/passwd', '/home/user/projects/../other/a.txt']) {
      expect(isProtectedWriteDestination(p), `${p} 折叠后不在系统前缀内`).toBe(false)
    }
  })
})

describe('SFTP 改写族在触网前过闸', () => {
  it('写/删/改名/改权限/建目录/上传 都拒系统路径，且不开 SSH 通道', async () => {
    const spy = vi.fn(() => {
      throw new Error(TOUCHED)
    })
    const m = managerWith(spy)

    await expectRefusedBeforeWire(() => m.writeFile('s1', '/etc/passwd', 'x'), spy)
    await expectRefusedBeforeWire(() => m.delete('s1', '/root/.ssh/authorized_keys'), spy)
    await expectRefusedBeforeWire(() => m.chmod('s1', '/etc/shadow', 0o777), spy)
    await expectRefusedBeforeWire(() => m.mkdir('s1', '/usr/lib/x'), spy)
    await expectRefusedBeforeWire(() => m.upload('s1', 'package.json', '/etc/hosts'), spy)
    // 改名要看两侧：源在用户区、目标落进 /etc 同样拒
    await expectRefusedBeforeWire(() => m.rename('s1', '/home/user/a.txt', '/etc/cron.d/evil'), spy)

    expect(spy, '六次拒绝一次都不该碰 SSH').not.toHaveBeenCalled()
  })

  it('改名源在系统路径也拒（只查目标会漏反向绕道）', async () => {
    const spy = vi.fn(() => {
      throw new Error(TOUCHED)
    })
    const m = managerWith(spy)
    await expectRefusedBeforeWire(() => m.rename('s1', '/etc/sudoers', '/home/user/backup'), spy)
  })

  it('用户区写入照旧放行到 SSH（证明闸不是把整条通道关掉）', async () => {
    const spy = vi.fn(() => {
      throw new Error(TOUCHED)
    })
    const m = managerWith(spy)
    await expect(m.writeFile('s1', '/home/user/app/x.py', 'print(1)')).rejects.toThrow(TOUCHED)
    expect(spy, '合法路径必须走到开 SSH 那一步').toHaveBeenCalledTimes(1)
  })

  it('拒绝话术给了下一步（初学者产品不能只说"不允许"）', async () => {
    const spy = vi.fn(() => {
      throw new Error(TOUCHED)
    })
    const m = managerWith(spy)
    await expect(m.writeFile('s1', '/etc/hosts', '1 2 3')).rejects.toThrow(/终端里自己执行/)
  })

  /**
   * 结构核对：闸必须长在"每一个会改写远端文件的方法"上。
   *
   * 三条行为判据能证明现有方法受管，但证明不了"新加一个 deleteDir 也记得装"。
   * 所以这里从类声明里现量：凡入参带远端路径、函数体又出现远端写汇
   * （createWriteStream / unlink / rename / chmod / mkdir / writeFile）的方法，
   * 都必须调用 assertRemoteWriteAllowed；读类方法（list/stat/readFile/download）不误伤。
   * 最后一个断言是分母：扫出来的受管方法少于 6 个，说明扫描本身坏了或被绕过，不许空过。
   */
  it('每个远端改写方法都挂着闸（含以后新增的）', () => {
    const REMOTE_PATH_PARAM = /(remotePath|oldPath|newPath|destPath|targetPath)/
    const REMOTE_WRITE_SINK = new Set([
      'createWriteStream',
      'unlink',
      'rmdir',
      'rename',
      'chmod',
      'mkdir',
      'fastPut',
    ])
    const file = path.join(ROOT, 'src/main/services/ssh/sftp.ts')
    const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)

    const guarded: string[] = []
    const unguarded: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
        const name = node.name.text
        const takesRemotePath = node.parameters.some((p) => REMOTE_PATH_PARAM.test(p.name.getText()))
        let touchesWriteSink = false
        let callsGuard = false
        const walk = (n: ts.Node): void => {
          if (ts.isCallExpression(n)) {
            const callee = n.expression
            const bare = ts.isPropertyAccessExpression(callee) ? callee.name.getText() : callee.getText()
            if (REMOTE_WRITE_SINK.has(bare)) touchesWriteSink = true
            if (bare === 'assertRemoteWriteAllowed') callsGuard = true
          }
          ts.forEachChild(n, walk)
        }
        if (node.body) walk(node.body)
        if (takesRemotePath && touchesWriteSink) {
          ;(callsGuard ? guarded : unguarded).push(name)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(src)

    expect(unguarded, `这些远端改写方法没挂闸：${unguarded.join(', ')}`).toEqual([])
    expect(guarded.length, `只扫到 ${guarded.length} 个受管方法（<6），先怀疑扫描本身`).toBeGreaterThanOrEqual(6)
  })
})
