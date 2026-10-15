/**
 * 连接失败话术分类的判据（审查 F3）
 *
 * 用例里的原文全部取自本机代码真实会抛出的字符串（connection-manager 的中文话术、
 * known-hosts 的中文话术、ssh2 内建的英文原文），不是编的样例——
 * 编样例的风险是"表能匹配上自己编的话，却匹配不上线上真话"。
 */
import { describe, it, expect } from 'vitest'
import { connectFailureText, describeConnectFailure } from '@renderer/lib/connect-failure'

describe('连接失败话术分类', () => {
  it.each([
    ['connect ECONNREFUSED 10.0.0.1:22', '地址或端口不通'],
    ['connect ETIMEDOUT 10.0.0.1:22', '连上了但握手超时'],
    ['getaddrinfo ENOTFOUND db.internal', '地址或端口不通'],
    ['Timed out while waiting for handshake', '连上了但握手超时'],
    ['SSH 连接超时（30000ms）: 192.0.2.10', '连上了但握手超时'],
    ['All configured authentication methods failed', '用户名或凭据不对'],
    ['读取私钥文件失败: /home/me/id_rsa - ENOENT', '用户名或凭据不对'],
    ['密码认证需要提供 password', '用户名或凭据不对'],
    ['主机 192.0.2.10:22 的密钥已被吊销（@revoked）', '主机密钥对不上'],
    ['无法解析服务器返回的 host key', '主机密钥对不上'],
    ['跳板机连接失败: connect ECONNREFUSED 10.0.0.9:22', '跳板机这一跳失败'],
  ])('原文「%s」判成「%s」', (raw, label) => {
    expect(describeConnectFailure(raw).label).toBe(label)
  })

  it('每一类都带得着下一步（只说"失败"等于没帮到初学者）', () => {
    for (const raw of ['ECONNREFUSED', 'handshake', 'authentication', '主机密钥', '跳板机']) {
      const f = describeConnectFailure(`测试：${raw}`)
      expect(f.nextStep.length, `${raw} 这一类没有下一步建议`).toBeGreaterThan(8)
    }
  })

  it('认不出的错误保留原文，不许硬编一个原因（反向对照）', () => {
    const f = describeConnectFailure('某个没见过的第三方报错')
    expect(f.label).toBe('原因未识别')
    expect(f.raw).toBe('某个没见过的第三方报错')
    expect(connectFailureText('某个没见过的第三方报错')).toContain('某个没见过的第三方报错')
  })

  it('空原文不能弹出一句空白错误', () => {
    expect(connectFailureText('')).toBe('连接失败：未知原因')
  })

  it('分类后的文案里带着原文（报障时线索不丢）', () => {
    const text = connectFailureText('connect ECONNREFUSED 10.0.0.1:22')
    expect(text).toContain('地址或端口不通')
    expect(text).toContain('下一步')
    expect(text).toContain('connect ECONNREFUSED 10.0.0.1:22')
  })

  it('两处连接路径共用这一份（不许再长第二张表）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(__dirname, '../..')
    for (const rel of ['src/renderer/src/hooks/useServerConnect.ts', 'src/renderer/src/pages/SshSettings.tsx']) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8')
      expect(src, `${rel} 还在自己拼连接失败文案`).toContain('connectFailureText(')
      expect(src, `${rel} 仍把 err.message 直接甩给用户`).not.toMatch(/连接失败: \$\{/)
    }
  })
})
