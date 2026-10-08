/**
 * 夹具主机密钥生成器的可靠性闸
 *
 * 起因：2026-10-07 把 generateHostKey 改成"逐个候选试 parseKey"之后仍然随机红
 * （2026-10-08 全量 vitest 里 known-hosts-learn 又红一次，单跑必过）。
 * 一条 1/3 概率红的夹具等于没有夹具——所以这里连抽 30 次，把"偶发拿不到公钥"
 * 变成一条会稳定复现的断言。30 次里只要有一次不成 blob 就红，
 * 按老写法的失败率，这条测试漏红的概率约 (2/3)^30 ≈ 5e-6。
 */
import { describe, expect, it } from 'vitest'
import { generateHostKey } from '../e2e/ssh-fixture-server'

describe('夹具主机密钥生成器（ssh-fixture-server）', () => {
  it('连抽 30 次每次都要给出可用的 ssh-ed25519 blob 与私钥', () => {
    const blobs = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const { private: priv, publicBlob } = generateHostKey()
      // 线格式：4 字节长度 + "ssh-ed25519"(11) + 4 字节长度 + 32 字节密钥
      expect(publicBlob.length, `第 ${i} 次 blob 长度`).toBe(51)
      expect(publicBlob.readUInt32BE(0), `第 ${i} 次类型字段长度`).toBe(11)
      expect(publicBlob.toString('utf8', 4, 15), `第 ${i} 次类型`).toBe('ssh-ed25519')
      expect(publicBlob.readUInt32BE(15), `第 ${i} 次密钥长度`).toBe(32)
      // ssh2 的 Server 要的是 OpenSSH 格式私钥文本
      const text = priv.toString('utf8')
      expect(text, `第 ${i} 次私钥格式`).toContain('OPENSSH PRIVATE KEY')
      blobs.add(publicBlob.toString('base64'))
    }
    // 每次都该是新钥匙：若 30 次里有重复，说明生成器在返回同一份缓存
    expect(blobs.size, '30 次生成的公钥应互不相同').toBe(30)
  })
})
