/**
 * 损坏的配置文件不许卡住启动（#258）
 *
 * conf/electron-store 默认 `clearInvalidConfig: false`：一个半截写入的
 * `config.json`（断电/磁盘满）会让它在构造或首次读取时抛错。而我们的两个 store
 * 都在模块顶层构造——等于用户只能自己去 userData 目录删文件才能打开应用。
 *
 * 这里钉的是"留档 + 放行"那一步：坏文件必须被改名（原字节不丢），
 * 好文件一动不动，且 electron-store 带着 clearInvalidConfig 能真的起来。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const box = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => box.userData },
}))

import {
  salvageCorruptStoreFile,
  takeSalvagedStoreFiles,
} from '../../src/main/services/storage/store-recovery'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-store-recover-'))
  box.userData = dir
  takeSalvagedStoreFiles()
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('损坏配置的留档与放行', () => {
  it('JSON 半截写入：改名留档、原文件让位、原字节不丢', () => {
    const file = path.join(dir, 'config.json')
    const corrupt = '{"sshServers": [{"id": "a", "host": "10.0.0.1"'
    fs.writeFileSync(file, corrupt)

    const notice = salvageCorruptStoreFile('config', dir)

    expect(notice, '坏文件没被识别：应用会在构造 store 时直接起不来').not.toBeNull()
    expect(fs.existsSync(file), '原文件还在，store 仍会去读它并抛错').toBe(false)
    expect(fs.readFileSync(notice!.backup, 'utf8'), '留档必须是原字节，不能顺手修一下').toBe(
      corrupt
    )
    expect(path.basename(notice!.backup)).toMatch(/^config\.corrupt-\d{8}-\d{6}\.json$/)
    expect(takeSalvagedStoreFiles()).toHaveLength(1)
    expect(takeSalvagedStoreFiles(), '取走一次就该清空，否则日志会重复报同一件事').toHaveLength(0)
  })

  it('同一秒内坏两次：第二份留档不许覆盖第一份', () => {
    const file = path.join(dir, 'config.json')
    fs.writeFileSync(file, '{bad-1')
    const first = salvageCorruptStoreFile('config', dir)
    fs.writeFileSync(file, '{bad-2')
    const second = salvageCorruptStoreFile('config', dir)

    expect(second).not.toBeNull()
    expect(second!.backup).not.toBe(first!.backup)
    expect(fs.readFileSync(first!.backup, 'utf8')).toBe('{bad-1')
    expect(fs.readFileSync(second!.backup, 'utf8')).toBe('{bad-2')
  })

  it('能解析的文件一动不动，也不登记', () => {
    const file = path.join(dir, 'config.json')
    const good = JSON.stringify({ sshServers: [], uiSettings: { theme: 'dark' } })
    fs.writeFileSync(file, good)

    expect(salvageCorruptStoreFile('config', dir)).toBeNull()
    expect(fs.readFileSync(file, 'utf8')).toBe(good)
    expect(takeSalvagedStoreFiles()).toHaveLength(0)
  })

  it('文件不存在：不算损坏，也不创建任何东西', () => {
    expect(salvageCorruptStoreFile('config', dir)).toBeNull()
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('留档之后，真的 electron-store 能带着默认值起来', async () => {
    fs.writeFileSync(path.join(dir, 'config.json'), '{"sshServers": [')
    salvageCorruptStoreFile('config', dir)

    // 用真库（不是替身）跑一次：证明 clearInvalidConfig 这条路在装的这个版本上有效
    const { default: Store } = await import('electron-store')
    const store = new Store<{ sshServers: unknown[] }>({
      name: 'config',
      cwd: dir,
      clearInvalidConfig: true,
      defaults: { sshServers: [] },
    })
    expect(store.get('sshServers')).toEqual([])
  })

  it('反向对照：同一份坏文件，不开 clearInvalidConfig 时真的会抛', async () => {
    fs.writeFileSync(path.join(dir, 'config.json'), '{"sshServers": [')

    const { default: Store } = await import('electron-store')
    // 这条不是多余的：它证明上面那条绿是因为开关，而不是因为这份坏文件其实不坏。
    // 抛点在构造那一刻——正是"模块顶层 new Store"会让主进程起不来的原因。
    expect(
      () =>
        new Store<{ sshServers: unknown[] }>({
          name: 'config',
          cwd: dir,
          defaults: { sshServers: [] },
        })
    ).toThrow()
  })
})
