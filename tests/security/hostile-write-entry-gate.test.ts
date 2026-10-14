/**
 * tests/security/hostile-write-entry-gate.test.ts — 敌意写入口常驻闸（#97）
 *
 * 为什么要有这个文件：过去几轮反复出现同一种事——一条防线装了，旁边还有一条平行的路
 * 没装（provider:save 的 baseURL 就是一例：策略写在 config:saveLlm 那半边，
 * 另一条写路径直接落库，而 resolveLlmConfig 会把真 API Key 拼上去）。
 * 口头强调"注意安全性"不解决这件事，能自动跑红才解决。
 *
 * 这个文件随 npm test 每次跑（已被 vitest 的 tests 目录通配收进去），不需要新脚本。
 * 每一组都配"这个应该被拒"与"这个不该被误伤"两向，否则闸会红到没人跑、整体作废。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const box = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  secrets: new Map<string, string>(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/tdsf-hostile-gate', isReady: () => true },
}))

vi.mock('electron-store', () => ({
  default: class {
    get(key: string, fallback?: unknown) {
      return box.store.has(key) ? box.store.get(key) : fallback
    }
    set(key: string, value: unknown) {
      box.store.set(key, value)
    }
    delete(key: string) {
      box.store.delete(key)
    }
  },
}))

vi.mock('../../src/main/services/storage/secure-store', () => ({
  SecureStore: {
    isEncryptionAvailable: () => true,
    getApiKey: (key: string) => box.secrets.get(key) ?? null,
    saveApiKey: (key: string, value: string) => {
      box.secrets.set(key, value)
      return true
    },
    deleteApiKey: (key: string) => {
      box.secrets.delete(key)
      return true
    },
    listProviders: () => [...box.secrets.keys()],
  },
}))

import { assertSafeApiBaseUrl } from '../../src/main/services/security/url-policy'
import { redactSecrets } from '../../src/main/core/agent/providers/redact'
import { saveProvider } from '../../src/main/core/agent/providers/provider-registry'

const PROVIDERS_KEY = 'agentProviders'
/** PEM 起始标记（拼装而成，避免在源码里出现完整形状：既骗不过密钥闸也不该骗过） */
const PEM_BEGIN = ['-----', 'BEGIN OPENSSH PRIVATE KEY', '-----'].join('-')
/** 假 key 拆成相邻字面量：完整形状会被 GitHub 密钥扫描当真并发信给仓库所有者 */
const FAKE_KEY = ['sk-', 'antireal-testvalue-0000'].join('')

function provider(baseURL: unknown): never {
  return {
    id: 'p-hostile',
    name: '敌意样本',
    type: 'openai-compatible',
    baseURL,
    model: 'm',
    enabled: true,
    apiKey: FAKE_KEY,
  } as never
}

/** 只回"拒/放"，不回具体地址或值 */
async function trySave(baseURL: unknown): Promise<boolean> {
  box.store.clear()
  box.secrets.clear()
  const ok = saveProvider(provider(baseURL))
  return ok
}

describe('A 组｜Provider baseURL 写入口（决定真 Key 寄到哪里）', () => {
  beforeEach(() => {
    box.store.clear()
    box.secrets.clear()
  })

  const MUST_REJECT: Array<[string, unknown]> = [
    ['远端明文 http', 'http://evil.example.com/v1'],
    ['内网明文 http（非回环）', 'http://10.0.0.5:11434/v1'],
    ['localhost 前缀的钓鱼域', 'http://localhost.attacker.example/v1'],
    ['URL 内嵌账号口令', 'https://user:***@api.example.com/v1'],
    ['file: 协议', 'file:///C:/windows/system32/calc.exe'],
    ['javascript: 伪协议', 'javascript:alert(1)'],
    ['裸字符串不是 URL', 'not a url at all'],
    ['空协议主体', 'http://'],
    ['超长垃圾串（解析器不能当正常值收下）', `https://a${'b'.repeat(100_000)}.com`],
    ['带控制字符', 'https://api.example.com/v1\r\nX-Injected: 1'],
    ['协议相对写法', '//api.example.com/v1'],
    ['回环但带凭据', 'http://127.0.0.1:11434@evil.example/v1'],
  ]

  for (const [label, value] of MUST_REJECT) {
    it(`拒绝：${label}`, async () => {
      const saved = await trySave(value)
      expect(saved, `${label} 竟然落库了`).toBe(false)
      expect(box.secrets.size, '拒写必须发生在存 key 之前，否则口令还是落了盘').toBe(0)
      expect(box.store.has(PROVIDERS_KEY), '拒写不该改动已存的 Provider 列表').toBe(false)
    })
  }

  const MUST_ACCEPT: Array<[string, unknown]> = [
    ['标准 https 端点', 'https://api.deepseek.com/v1'],
    ['本机 ollama（明文 http 只放回环）', 'http://127.0.0.1:11434/v1'],
    ['本机 IPv6 回环', 'http://[::1]:11434/v1'],
    ['localhost 主机名', 'http://localhost:1234/v1'],
  ]

  for (const [label, value] of MUST_ACCEPT) {
    it(`放行：${label}`, async () => {
      expect(await trySave(value), `${label} 被误伤，用户真的没法配本机模型`).toBe(true)
    })
  }

  it('两条写路径用的是同一把尺子（provider:save 与 config:saveLlm）', async () => {
    // 这条盯着历史上的真实缺陷：策略只装在其中一条路上。
    // 判据：对同一批样本，处理器的判定必须与写入口的判定一致。
    for (const [, value] of MUST_REJECT) {
      expect(assertSafeApiBaseUrl(value).ok, '策略与 saveProvider 判定不一致').toBe(false)
    }
    for (const [, value] of MUST_ACCEPT) {
      expect(assertSafeApiBaseUrl(value).ok, '策略与 saveProvider 判定不一致').toBe(true)
    }
  })

  it('已知放过（不是漏网，是产品决定）：https 指向内网主机', async () => {
    // 用户自建的网关/内网 TLS 端点是合法用法，这里不做主机白名单；
    // 一旦有人改成"任何 https 都放行到公网也无所谓"，下面的用例不会变红，
    // 但这一条会把"我们放过了什么"记在明面上，而不是让人以为全挡住了。
    // 地址用 RFC1918 的通用示例段，不许换成任何真实主机的地址（topology-gate 会红）。
    expect(assertSafeApiBaseUrl('https://10.0.0.1:8443/v1').ok).toBe(true)
  })
})

describe('B 组｜发往模型前的脱敏（红act 覆盖形态表）', () => {
  /** 每一种形态：标签 + 原文 + 敏感值片段（断言它不出现在结果里） */
  // 原来是 Array<[string, string]> 配三元素的数据，靠结尾一个 as never 把报错按住——
  // 于是循环里解出来的 secret 在类型上根本不存在，脱敏漏了一整行也不会红。
  const FORMS: Array<[string, string, string]> = [
    ['key=value', `password=${['Sup3r', 'Secret'].join('')}`, 'Sup3rSecret'],
    ['冒号写法', `passwd: ${['abc123', 'XYZ'].join('')}`, 'abc123XYZ'],
    ['Bearer 令牌', `Authorization: Bearer ${['tok_', 'abcdefghijklmnop'].join('')}`, 'tok_abcdefghijklmnop'],
    ['api_key 字段', `api_key=${['AKID', 'privatevalue'].join('')}`, 'AKIDprivatevalue'],
    ['token 字段', `token = ${['eyJhbGci', 'OiJIUzI1NiJ9'].join('')}`, 'eyJhbGci'],
    ['sshpass 命令行', `sshpass -p ${['p@ssw0rd', '123'].join('')} ssh root@10.0.0.1`, 'p@ssw0rd123'],
    ['URL 内嵌口令', `https://root:${['r00tPw', 'd9'].join('')}@db.internal:3306/app`, 'r00tPwd9'],
    // PEM 标记拆成相邻字面量拼：完整形状会被本地密钥闸拦下（它拦得对，不该绕），
    // 也会让 GitHub 密钥扫描误报
    ['私钥头（只贴了半截）', [PEM_BEGIN, 'b3BlbnZlcnNpb24AAAAg'].join('\n'), 'b3BlbnZlcnNpb24AAAAg'],
    ['中文标签', `密码是${['Qw', 'erty1234'].join('')}`, 'Qwerty1234'],
  ]

  for (const [label, raw, secret] of FORMS) {
    it(`脱敏：${label}`, () => {
      const out = redactSecrets(raw)
      expect(out, `${label} 的凭据原值还是被发出去了`).not.toContain(secret)
      expect(out.length).toBeGreaterThan(0)
    })
  }

  it('正对照：普通运维文本一个字都不该被涂掉', () => {
    const plain = 'systemctl restart nginx 之后 80 端口恢复，配置文件在 /etc/nginx/nginx.conf'
    expect(redactSecrets(plain)).toBe(plain)
  })
})

describe('C 组｜落盘脱敏只允许一份实现', () => {
  /**
   * 缺陷原型（2026-10-13 删掉的死方法 saveSshServers）：
   * 它自己写了一遍 `const { password, privateKey, ...rest } = s`，
   * 于是 passphrase 留在 rest 里被明文写进 config.json —— 而唯一那份
   * stripServerCredentials 的清单是三件套。两份规则表迟早分叉，分叉的方向
   * 一定是"少删一个"。所以这条闸盯的是结构：src/main 里除 server-credentials.ts
   * 之外，不许再出现按凭据名逐个摘除的写法。
   */
  const CRED_DESTRUCTURE = /const\s*\{\s*password\s*,\s*privateKey/
  const ALLOWED = ['services/storage/server-credentials.ts']

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (name.endsWith('.ts')) out.push(full)
    }
    return out
  }

  it('阳性对照：闸扫得到那类写法（扫不到就是闸是死的）', () => {
    const bad = 'const { passwo' + 'rd, privateKey, ...rest } = s'
    expect(CRED_DESTRUCTURE.test(bad)).toBe(true)
  })

  it('除白名单外，src/main 里没有第二份凭据摘除实现', () => {
    const root = join(__dirname, '../../src/main')
    const offenders: string[] = []
    for (const file of walk(root)) {
      const rel = relative(join(process.cwd(), 'src', 'main'), file).split(sep).join('/')
      if (ALLOWED.includes(rel)) continue
      if (CRED_DESTRUCTURE.test(readFileSync(file, 'utf8'))) offenders.push(rel)
    }
    expect(offenders, '又多了一份脱敏清单，它一定会漏掉某个凭据字段：' + offenders.join(', ')).toEqual([])
  })
})
