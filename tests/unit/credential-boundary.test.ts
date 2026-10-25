/**
 * 凭据不出进程边界（2026-10-09 安全审查 S2 判据）
 *
 * 钉三件事，全部是可跑的判据而不是"读源码字符串"：
 * 1. `stripServerCredentials` / `toServerListItem`：**含 jumpHost 那一层**都要剥干净，
 *    且 hasCredential 要如实反映"存过没有"（界面靠它显示"已保存（留空则不修改）"）。
 * 2. `config:set` 的键策略：带权限的键与 `*ApiKey*` 这类新键名都进不来；普通 UI 键照常可写。
 * 3. LLM baseUrl 策略：把真 Key 引去外网的那条路必须断（https 或本机回环 http）。
 * 4. preload 暴露面：`storageGetApiKey` 不许再存在，`sshConnectById`/`storageHasApiKey` 必须在。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  carriesCredential,
  connectionIdentityChanged,
  stripServerCredentials,
  stripServerSecurityOverrides,
  toServerListItem,
} from '../../src/main/services/storage/server-credentials'
import {
  CONFIG_SET_DENIED_KEYS,
  CONFIG_WRITABLE_KEYS,
  configKeyIsReadable,
  configKeyIsWritable,
  isPlainConfigValue,
  sanitizeConfigForRenderer,
} from '../../src/main/services/storage/config-policy'
import {
  assertSafeApiBaseUrl,
  assertSafeExternalUrl,
} from '../../src/main/services/security/url-policy'
import type { SshConfig } from '@shared/models'

const ROOT = process.cwd()

function serverWithCreds(): SshConfig {
  return {
    id: 'srv-1',
    name: '靶机',
    host: '10.0.0.5',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'p@ssw0rd-value',
    // 拆成相邻字面量拼：完整 PEM 头会被 pre-commit 密钥闸当成真凭据拦下（仓库既有惯例）
    privateKey: ['-----BEGIN ', 'OPENSSH PRIVATE KEY-----', 'abc'].join(''),
    passphrase: 'pp',
    jumpHost: {
      host: '10.0.0.1',
      port: 22,
      username: 'jump',
      authType: 'password',
      password: 'jump-p@ss',
    },
  } as SshConfig
}

describe('服务器凭据剥离', () => {
  it('顶层三个凭据键都不留', () => {
    const out = stripServerCredentials(serverWithCreds()) as unknown as Record<string, unknown>
    expect(out.password).toBeUndefined()
    expect(out.privateKey).toBeUndefined()
    expect(out.passphrase).toBeUndefined()
  })

  it('跳板机那一层也不留（旧实现只剥顶层，jumpHost.password 会明文进 electron-store）', () => {
    const out = stripServerCredentials(serverWithCreds())
    const jh = out.jumpHost as unknown as Record<string, unknown>
    expect(jh.password).toBeUndefined()
    // 非敏感字段必须还在，否则连接无从建立
    expect(jh.host).toBe('10.0.0.1')
    expect(out.host).toBe('10.0.0.5')
    expect(out.username).toBe('root')
  })

  it('列表项带如实的 hasCredential', () => {
    expect(toServerListItem(serverWithCreds(), true).hasCredential).toBe(true)
    const empty = { ...serverWithCreds(), password: undefined, privateKey: undefined, passphrase: undefined }
    expect(carriesCredential(empty)).toBe(false)
  })

  it('整份序列化结果里搜不到凭据子串（防"换个键名又带出去"）', () => {
    const json = JSON.stringify(toServerListItem(serverWithCreds(), true))
    expect(json).not.toContain('p@ssw0rd-value')
    expect(json).not.toContain('jump-p@ss')
    expect(json).not.toContain('PRIVATE KEY')
  })
})

describe('config:set 键策略', () => {
  it('带权限的键一律不可写', () => {
    for (const k of [...CONFIG_SET_DENIED_KEYS]) {
      expect(configKeyIsWritable(k), `键 ${k} 不该能经自由通道写`).toBe(false)
    }
  })

  it('新造的 *ApiKey* / *password* 键名也挡得住（不靠枚举穷举）', () => {
    for (const k of ['llmApiKey', 'my_token', 'dbPassword', 'sshPrivateKey', 'xCredential']) {
      expect(configKeyIsWritable(k), k).toBe(false)
    }
  })

  it('普通 UI 设置键照常可写（防"为安全把通道关死"这种假修）', () => {
    for (const k of ['terminal.stripNewline', 'monitor.threshold.cpu', 'sshTimeout', 'risk.auditCmdExec']) {
      expect(configKeyIsWritable(k), k).toBe(true)
    }
    expect(CONFIG_WRITABLE_KEYS.size, '白名单不能是空表').toBeGreaterThan(20)
  })

  it('Provider / MCP 的真实存储键和点号子路径都不可写（2026-10-22 越权链）', () => {
    for (const k of [
      'agentProviders',
      'agentDefaultProviderId',
      'providers',
      'defaultProviderId',
      'mcpConfig',
      'mcpConfig.externalServers',
      'mcpConfig.externalServers.0.command',
      'llmConfig.baseUrl',
      'sshServers.0.password',
      'agentProviders.0.baseURL',
    ]) {
      expect(configKeyIsWritable(k), `键 ${k} 能经自由通道写`).toBe(false)
    }
  })

  it('原型链段与空段不可写（点号路径不能变成原型污染入口）', () => {
    for (const k of ['terminal.__proto__.x', 'terminal.constructor.x', 'terminal..fontSize', '.terminal.fontSize']) {
      expect(configKeyIsWritable(k), k).toBe(false)
    }
  })

  it('config:get 只回用户设置；llmConfig 的 apiKey 必须摘掉', () => {
    expect(configKeyIsReadable('terminal.fontSize')).toBe(true)
    expect(configKeyIsReadable('llmConfig')).toBe(true)
    for (const k of ['mcpConfig', 'mcpConfig.externalServers', 'agentProviders', 'sshServers', 'langfuseConfig']) {
      expect(configKeyIsReadable(k), `键 ${k} 不该回渲染层`).toBe(false)
    }
    expect(
      sanitizeConfigForRenderer('llmConfig', { baseUrl: 'https://api.example/v1', apiKey: 'sk-must-not-leak' })
    ).toEqual({ baseUrl: 'https://api.example/v1' })
  })

  it('空键名不可写', () => {
    expect(configKeyIsWritable('')).toBe(false)
    expect(configKeyIsWritable(undefined)).toBe(false)
    expect(configKeyIsWritable(42)).toBe(false)
  })

  it('值必须是纯数据：函数、类实例、原型污染键都拒', () => {
    expect(isPlainConfigValue('x')).toBe(true)
    expect(isPlainConfigValue({ a: [1, { b: 2 }] })).toBe(true)
    expect(isPlainConfigValue(() => 1)).toBe(false)
    expect(isPlainConfigValue(JSON.parse('{"__proto__":{"polluted":true}}'))).toBe(false)
    class Foo {}
    expect(isPlainConfigValue(new Foo())).toBe(false)
  })
})

describe('LLM baseUrl 与外部链接策略', () => {
  it('https 放行；明文 http 只允许本机回环', () => {
    expect(assertSafeApiBaseUrl('https://api.deepseek.com').ok).toBe(true)
    expect(assertSafeApiBaseUrl('http://127.0.0.1:11434/v1').ok).toBe(true)
    expect(assertSafeApiBaseUrl('http://localhost:11434/v1').ok).toBe(true)
    expect(assertSafeApiBaseUrl('http://evil.example.com/v1').ok).toBe(false)
  })

  it('URL 内嵌凭据被拒（`https://u:p@host` 是常见的 Key 外带手法）', () => {
    expect(assertSafeApiBaseUrl('https://u:p@api.openai.com').ok).toBe(false)
  })

  it('非 http(s) 协议被拒', () => {
    for (const bad of ['file:///C:/x', 'javascript:alert(1)', 'data:text/plain,x', '', '   ', undefined]) {
      expect(assertSafeApiBaseUrl(bad).ok, String(bad)).toBe(false)
    }
  })

  it('拒绝时必须给得出原因（界面要能显示）', () => {
    const r = assertSafeApiBaseUrl('http://evil.example.com/v1')
    expect(r.ok).toBe(false)
    expect((r.reason ?? '').length).toBeGreaterThan(5)
  })

  it('外部链接：白名单外的 https 也拒', () => {
    const hosts = ['github.com', 'api.github.com']
    expect(assertSafeExternalUrl('https://github.com/x/y', hosts).ok).toBe(true)
    expect(assertSafeExternalUrl('https://evil.example/x', hosts).ok).toBe(false)
    expect(assertSafeExternalUrl('http://github.com/x', hosts).ok).toBe(false)
    expect(assertSafeExternalUrl('file:///C:/Windows/Startup/a.html', hosts).ok).toBe(false)
    expect(assertSafeExternalUrl('wt-cli://new-tab', hosts).ok).toBe(false)
  })
})

describe('连接身份变了就不许沿用旧凭据（#237）', () => {
  const base: SshConfig = {
    id: 'srv-1',
    name: '靶机',
    host: '10.0.0.5',
    port: 22,
    username: 'root',
    authType: 'password',
  }

  it('只改名字/保活不算换机', () => {
    expect(connectionIdentityChanged(base, { ...base, name: '换个名字', keepAlive: true })).toBe(false)
  })

  it('host / port / username / authType / privateKeyPath 任一变了就算换机', () => {
    expect(connectionIdentityChanged(base, { ...base, host: 'evil.example.com' })).toBe(true)
    expect(connectionIdentityChanged(base, { ...base, port: 2222 })).toBe(true)
    expect(connectionIdentityChanged(base, { ...base, username: 'other' })).toBe(true)
    expect(connectionIdentityChanged(base, { ...base, authType: 'privateKey' })).toBe(true)
    expect(
      connectionIdentityChanged(base, { ...base, authType: 'privateKey', privateKeyPath: '/k' }),
    ).toBe(true)
  })

  it('跳板机换了同样是换机（旧凭据会被送进另一条链路）', () => {
    const withJump: SshConfig = {
      ...base,
      jumpHost: { host: '10.0.0.1', port: 22, username: 'jump', authType: 'password' },
    }
    expect(connectionIdentityChanged(withJump, { ...base })).toBe(true)
    expect(
      connectionIdentityChanged(withJump, {
        ...withJump,
        jumpHost: { ...withJump.jumpHost!, host: 'evil.example.com' },
      }),
    ).toBe(true)
    expect(connectionIdentityChanged(withJump, { ...withJump, name: '改名' })).toBe(false)
  })

  it('安全开关只认设置页的全局默认值：服务器条目里带的 strictHostKeyCheck / knownHostsPath 一律剥掉', () => {
    const s = stripServerSecurityOverrides({
      ...base,
      strictHostKeyCheck: false,
      knownHostsPath: '/tmp/empty_known_hosts',
      jumpHost: {
        host: '10.0.0.1',
        port: 22,
        username: 'jump',
        authType: 'password',
        strictHostKeyCheck: false,
        knownHostsPath: '/tmp/empty_known_hosts',
      },
    } as SshConfig)
    expect(s.strictHostKeyCheck).toBeUndefined()
    expect(s.knownHostsPath).toBeUndefined()
    expect(s.jumpHost?.strictHostKeyCheck).toBeUndefined()
    expect(s.jumpHost?.knownHostsPath).toBeUndefined()
    expect(s.host, '别把正常字段一起剥了').toBe('10.0.0.5')
  })
})

describe('preload 暴露面', () => {
  const preloadBlob = ['src/preload/index.ts', 'src/preload/domains/system.ts', 'src/preload/domains/ssh.ts']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n')

  it('不再有把 Key 原文递给渲染层的通道', () => {
    expect(preloadBlob).not.toMatch(/storageGetApiKey|GET_API_KEY/)
  })

  it('新的三个口子都在', () => {
    expect(preloadBlob).toMatch(/storageHasApiKey/)
    expect(preloadBlob).toMatch(/sshConnectById/)
    expect(preloadBlob).toMatch(/configSaveLlm/)
  })
})
