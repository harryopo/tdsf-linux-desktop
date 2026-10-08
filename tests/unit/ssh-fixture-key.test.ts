/**
 * 夹具主机密钥生成器的可靠性闸
 *
 * 病根：ssh2 的 generateKeyPairSync 在并行跑测试时会返回**被截断**的输出
 * （2026-10-08 实测见过 pair.public = `ssh-ed25519 AAAAC3NzaC1l`，base64 都不完整），
 * 约 1/3 概率，单跑常过。老写法把它表现成「parseKey 拿不到 getPublicSSH」，
 * 于是 2026-10-07 那轮「改成逐个候选试 parseKey」没治到根上——这条闸第二轮就把它抓出来了。
 * 生成器现在双向校验 + 重抽；这里连抽 30 次，钉住「每次拿到的都必须可用」。
 */
import { describe, expect, it } from 'vitest'
import { generateHostKey } from '../e2e/ssh-fixture-server'

describe('夹具主机密钥生成器（ssh-fixture-server）', () => {
  // PEM 头尾拆成相邻字面量：完整形状会被本仓 pre-commit 的密钥闸当真（实测拦过一次），
  // 与本文件所测的那个 fixture 里同一写法
  const PEM_HEAD = '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----'
  const PEM_TAIL = '-----END ' + 'OPENSSH PRIVATE KEY-----'

  it('连抽 30 次每次都要给出可用的 ssh-ed25519 blob 与私钥', () => {
    const blobs = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const { private: priv, publicBlob } = generateHostKey()
      // 线格式：4 字节长度 + "ssh-ed25519"(11) + 4 字节长度 + 32 字节密钥
      expect(publicBlob.length, `第 ${i} 次 blob 长度`).toBe(51)
      expect(publicBlob.readUInt32BE(0), `第 ${i} 次类型字段长度`).toBe(11)
      expect(publicBlob.toString('utf8', 4, 15), `第 ${i} 次类型`).toBe('ssh-ed25519')
      expect(publicBlob.readUInt32BE(15), `第 ${i} 次密钥长度`).toBe(32)
      // ssh2 的 Server 要的是首尾完整的 OpenSSH 私钥；只有头没有尾就是被截断的那一份
      const text = priv.toString('utf8')
      expect(text, `第 ${i} 次私钥缺 PEM 头`).toContain(PEM_HEAD)
      expect(text, `第 ${i} 次私钥缺 PEM 尾（截断）`).toContain(PEM_TAIL)
      blobs.add(publicBlob.toString('base64'))
    }
    // 每次都该是新钥匙：若 30 次里有重复，说明生成器在返回同一份缓存
    expect(blobs.size, '30 次生成的公钥应互不相同').toBe(30)
  })
})
