/**
 * SFTP 族的预算判据（2026-10-15 全维度系统审查 B 族）
 *
 * 病根：ssh2 的 sftp/readdir/stat/fastPut/流 全是回调式，连接半开时回调永不回来，
 * 以前的裸 Promise 就永久挂住——界面转圈、主进程既不报错也不超时。
 *
 * 判据分两半，缺一条就是半个判据：
 *   A 预算真的会到期并如实报错（含"到期时把流 destroy 掉"，否则留半开通道）
 *   B 正常路径不许被预算干扰（有进展就续期；一步就回来的调用不受影响）
 * 最后一条是结构核对：新增的 ssh2 调用若没走 withinBudget 就直接红，
 * 因为"忘了挂预算"这件事只能靠结构兜住（上一轮 SFTP 写闸就是这么补的）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Client, SFTPWrapper } from 'ssh2'
import * as ts from 'typescript'
import { SftpManager } from '@main/services/ssh/sftp'
import { SshConnectionManager } from '@main/services/ssh/connection-manager'

const ROOT = path.resolve(__dirname, '../..')

/** 一个可编排的假 SFTPWrapper：每个方法按 specs 里登记的剧本走 */
type Script = (cb: unknown) => void
interface FakeSftp {
  wrapper: SFTPWrapper
  destroyed: string[]
  /** 传输类调用交出来的 step：测试靠它模拟"这一拍有进展" */
  steps: Array<(transferred: number) => void>
}

function fakeSftp(scripts: Record<string, Script>): FakeSftp {
  const destroyed: string[] = []
  const steps: Array<(transferred: number) => void> = []
  const noopTouch = (): void => undefined
  const wrapper = {
    readdir: (p: string, cb: unknown) => scripts.readdir?.(cb),
    stat: (p: string, cb: unknown) => scripts.stat?.(cb),
    unlink: (p: string, cb: unknown) => scripts.unlink?.(cb),
    rmdir: (p: string, cb: unknown) => scripts.rmdir?.(cb),
    rename: (a: string, b: string, cb: unknown) => scripts.rename?.(cb),
    chmod: (p: string, m: number, cb: unknown) => scripts.chmod?.(cb),
    mkdir: (p: string, cb: unknown) => scripts.mkdir?.(cb),
    fastPut: (_l: string, _r: string, opts: { step?: (n: number) => void }, cb: unknown) => {
      if (opts.step) steps.push(opts.step)
      scripts.fastPut?.(cb)
    },
    fastGet: (_r: string, _l: string, opts: { step?: (n: number) => void }, cb: unknown) => {
      if (opts.step) steps.push(opts.step)
      scripts.fastGet?.(cb)
    },
    createReadStream: (p: string, _o: unknown) => stream('read', p),
    createWriteStream: (p: string, _o: unknown) => stream('write', p),
    end: noopTouch
  } as unknown as SFTPWrapper
  function stream(kind: string, _p: string): unknown {
    const handlers: Record<string, (arg?: unknown) => void> = {}
    return {
      on: (ev: string, fn: (arg?: unknown) => void) => {
        handlers[ev] = fn
      },
      end: () => undefined,
      destroy: () => destroyed.push(kind),
      __emit: (ev: string, arg?: unknown) => handlers[ev]?.(arg)
    }
  }
  return { wrapper, destroyed, steps }
}

/** 造一个只认一条会话的连接管理器（沿用同目录另一判据的做法：不碰真 SSH） */
function managerWithWrapper(fake: FakeSftp): SftpManager {
  const mgr = Object.create(SshConnectionManager.prototype) as SshConnectionManager
  mgr.getClient = (): Client =>
    ({
      sftp: (cb: (err: Error | null, sftp?: SFTPWrapper) => void) => cb(null, fake.wrapper)
    }) as unknown as Client
  return new SftpManager(mgr)
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('SFTP 预算', () => {
  /** ssh2 的 Stats 是带判定方法的对象，这里按 statsToSftpEntry 真读到的字段造 */
  const fileStats = {
    mode: 0o644,
    size: 10,
    mtime: 1,
    atime: 1,
    uid: 0,
    gid: 0,
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false
  }

  it('readdir 的回调永不回来 → 20 秒后如实报超时', async () => {
    const fake = fakeSftp({ readdir: () => undefined })
    const m = managerWithWrapper(fake)
    // 先挂上断言再推进计时器：超时是在那一拍抛出的，晚一步 Node 就报未处理拒绝
    const assertion = expect(m.list('s1', '/home/user')).rejects.toThrow(/列出目录 '\/home\/user'.*没有结果/)
    await vi.advanceTimersByTimeAsync(20_000)
    await assertion
  })

  it('一步就回来的调用不受预算影响（反向对照，否则功能被自己关掉）', async () => {
    const fake = fakeSftp({
      readdir: (cb) => {
        ;(cb as (e: Error | null, list?: unknown[]) => void)(null, [])
      }
    })
    const m = managerWithWrapper(fake)
    await expect(m.list('s1', '/home/user')).resolves.toEqual([])
  })

  it('读取流卡住 → 到期既报错也把流 destroy（不留半开通道）', async () => {
    const fake = fakeSftp({
      stat: (cb) => {
        ;(cb as (e: Error | null, s?: unknown) => void)(null, fileStats)
      }
    })
    const m = managerWithWrapper(fake)
    const assertion = expect(m.readFile('s1', '/home/user/a.txt')).rejects.toThrow(/读取远程文件/)
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(fake.destroyed, '到期不 destroy 就是留一条永不回来的通道').toContain('read')
  })

  it('上传有进展就续期：静默够久才判死，一直在动不许被杀', async () => {
    const local = path.join(ROOT, 'package.json')
    const fake = fakeSftp({ fastPut: () => undefined })
    const m = managerWithWrapper(fake)
    const p = m.upload('s1', local, '/home/user/x.bin')
    let settled = 'pending'
    p.then(
      () => (settled = 'ok'),
      (e: Error) => (settled = e.message)
    )
    // upload 先 await openSftp 才发 fastPut，冲掉这几拍微任务否则剧本还没跑到
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.steps.length, '没把 step 交出来就是这条判据在空跑').toBe(1)
    // 传输预算 60s：每 20 秒喂一次进展，累计 60 秒以上仍然不该到期
    for (let round = 0; round < 4; round++) {
      await vi.advanceTimersByTimeAsync(20_000)
      fake.steps.forEach((s) => s(round * 1000))
    }
    await Promise.resolve()
    expect(settled, `一直在动的传输被判死了：${settled}`).toBe('pending')
    // 停止续期后再静默 61 秒 → 这才算挂死
    const assertion = expect(p).rejects.toThrow(/没有任何进展/)
    await vi.advanceTimersByTimeAsync(61_000)
    await assertion
  })

  it('写入流卡住（没有任何 finish 进展）→ 到期 destroy 写流', async () => {
    const fake = fakeSftp({})
    const m = managerWithWrapper(fake)
    const assertion = expect(m.writeFile('s1', '/home/user/a.txt', 'hello')).rejects.toThrow(
      /写入 '\/home\/user\/a\.txt'/
    )
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(fake.destroyed).toContain('write')
  })

  it('openSftp 本身也有预算（这一条以前是最容易整条通道挂住的地方）', async () => {
    const mgr = Object.create(SshConnectionManager.prototype) as SshConnectionManager
    mgr.getClient = (): Client => ({ sftp: () => undefined }) as unknown as Client
    const m = new SftpManager(mgr)
    const assertion = expect(m.list('s1', '/home/user')).rejects.toThrow(/打开 SFTP 通道超过/)
    await vi.advanceTimersByTimeAsync(20_000)
    await assertion
  })

  /**
   * 结构核对：每一个 ssh2 回调式调用都必须待在 withinBudget 的剧本函数里。
   * 行为判据只能证明现有几条挂了预算，证明不了"新加一个 statvfs 也记得挂"。
   */
  it('每个 ssh2 回调调用都在预算里', () => {
    const SFTP_CALLS = new Set([
      'readdir',
      'stat',
      'unlink',
      'rmdir',
      'rename',
      'chmod',
      'mkdir',
      'fastPut',
      'fastGet',
      'createReadStream',
      'createWriteStream',
      'sftp'
    ])
    const file = path.join(ROOT, 'src/main/services/ssh/sftp.ts')
    const src = fs.readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)

    const outside: string[] = []
    let depthInsideBudget = 0
    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        const name = ts.isPropertyAccessExpression(callee) ? callee.name.getText() : callee.getText()
        if (name === 'withinBudget') {
          depthInsideBudget++
          node.arguments.forEach(walk)
          depthInsideBudget--
          return
        }
        if (SFTP_CALLS.has(name) && depthInsideBudget === 0) outside.push(name)
      }
      ts.forEachChild(node, walk)
    }
    walk(sf)
    expect(outside, `这些 ssh2 调用没走预算：${outside.join(', ')}`).toEqual([])
    const used = (src.match(/withinBudget</g) || []).length
    expect(used, `只扫到 ${used} 处 withinBudget 调用（<10），先怀疑扫描本身`).toBeGreaterThanOrEqual(10)
  })
})
