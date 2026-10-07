/**
 * 阶段 A · A3 判据：known_hosts 写入是"先删这一台旧行再追加"
 *
 * 计划原文：「同一 host 重复 learn 后文件里只 1 行；旧指纹不会被短路命中（主力项目红线 12）」。
 * 此前只有通配/否定匹配的测试（known-hosts-pattern.test.ts），**真正会出事的那一步没人测**：
 * 若 append 之前没删干净，known_hosts 里会留着同一台主机的两把钥匙，
 * 校验按行扫描时先命中的是哪一把取决于写入顺序 —— 换密钥的告警就这样被旧行短路掉。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkKnownHosts, replaceKnownHost } from '../../src/main/services/ssh/known-hosts'
import { generateHostKey } from '../e2e/ssh-fixture-server'

/** 造一把一次性主机密钥，返回 ssh 线格式公钥 blob（checkKnownHosts 收的就是这个） */
function hostKeyBlob(): Buffer {
  return generateHostKey().publicBlob
}

let file = ''

beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-known-hosts-')), 'known_hosts')
  fs.writeFileSync(file, '', 'utf8')
})

afterEach(() => {
  fs.rmSync(path.dirname(file), { recursive: true, force: true })
})

function lines(): string[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

describe('known_hosts 先删后加（A3）', () => {
  it('同一 host:port 反复 learn 后文件里只剩 1 行', async () => {
    for (let i = 0; i < 3; i++) {
      await replaceKnownHost('10.0.0.9', 22, hostKeyBlob(), file)
    }
    expect(lines().filter((l) => l.startsWith('10.0.0.9 ')), `实际内容：${lines().join(' ⏎ ')}`).toHaveLength(1)
  })

  it('换密钥后旧指纹不会被短路命中，新指纹才 match', async () => {
    const oldKey = hostKeyBlob()
    const newKey = hostKeyBlob()
    await replaceKnownHost('10.0.0.9', 22, oldKey, file)
    await replaceKnownHost('10.0.0.9', 22, newKey, file)

    expect((await checkKnownHosts('10.0.0.9', 22, oldKey, file)).status, '旧钥匙不该再被认成 match').not.toBe('match')
    expect((await checkKnownHosts('10.0.0.9', 22, newKey, file)).status, '新钥匙应 match').toBe('match')
  })

  it('只删这一台：别的主机与同主机的别的端口都不被误删', async () => {
    await replaceKnownHost('10.0.0.9', 22, hostKeyBlob(), file)
    await replaceKnownHost('10.0.0.9', 2222, hostKeyBlob(), file)
    await replaceKnownHost('10.0.0.10', 22, hostKeyBlob(), file)
    expect(lines(), `实际内容：${lines().join(' ⏎ ')}`).toHaveLength(3)

    await replaceKnownHost('10.0.0.9', 22, hostKeyBlob(), file)
    const kept = lines()
    expect(kept, `换密钥后应仍留 3 行，实际：${kept.join(' ⏎ ')}`).toHaveLength(3)
    expect(kept.some((l) => l.startsWith('[10.0.0.9]:2222 ')), '同主机不同端口那条不能被带走').toBe(true)
    expect(kept.some((l) => l.startsWith('10.0.0.10 ')), '别的主机那条不能被带走').toBe(true)
  })

  it('非 22 端口按 OpenSSH 的 [host]:port 写法记录', async () => {
    await replaceKnownHost('10.0.0.9', 2222, hostKeyBlob(), file)
    expect(lines()[0], `实际：${lines()[0]}`).toMatch(/^\[10\.0\.0\.9\]:2222 ssh-/)
  })

  it('非 22 端口不会拿 22 端口那条记录来顶替校验', async () => {
    const key = hostKeyBlob()
    await replaceKnownHost('10.0.0.9', 22, key, file)
    // 同一把钥匙、同一台主机、不同端口：按 OpenSSH 语义这是另一条记录，
    // 顶替了就会让 :2222 上的中间人拿着 :22 的钥匙过关
    const r = await checkKnownHosts('10.0.0.9', 2222, key, file)
    expect(r.status, ':22 的记录不该满足 :2222 的校验').toBe('not-found')
  })
})
