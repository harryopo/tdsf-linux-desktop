/**
 * 外部 MCP 子进程的环境变量隔离（任务 #173 的安全前置）
 *
 * 旧实现是 `{ ...process.env, ...config.env }`：只要用户在配置里写过任何一个 env，
 * 就把**整个主进程的环境**（里面可能有开发者本机随便一把 API Key）一起交给
 * 一个第三方程序。反过来不写 env 时走 SDK 默认继承表，反倒是干净的——
 * "配了才漏"这种形状最容易让人以为配置是可选加固。
 *
 * 现在只有一个方向：默认继承表 + 用户点名要的键。测试里种的密钥变量
 * 必须"不点名就拿不到"，点名了才拿得到。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { buildExternalChildEnv, MCP_ENV_NAME } from '@main/services/mcp/child-env'

const PLANTED = 'TDSF_E2E_PLANTED_SECRET'

function plant(value: string): void {
  process.env[PLANTED] = value
}

afterEach(() => {
  delete process.env[PLANTED]
  delete process.env.TDSF_E2E_NAMED
})

describe('外部 MCP 子进程能拿到的环境', () => {
  it('没点名任何键：只有 SDK 认为可安全继承的那批，种进去的密钥拿不到', () => {
    plant('sk-live-do-not-leak')
    const env = buildExternalChildEnv(undefined)
    expect(Object.keys(env).sort()).toEqual(Object.keys(getDefaultEnvironment()).sort())
    expect(PLANTED in env, 'process.env 里的秘密被整坨继承给了第三方').toBe(false)
  })

  it('点名要的键才传，且传的是那一刻的真值', () => {
    process.env.TDSF_E2E_NAMED = 'named-value'
    const env = buildExternalChildEnv(['TDSF_E2E_NAMED'])
    expect(env.TDSF_E2E_NAMED).toBe('named-value')
  })

  it('点名了但本机没有这个键：不写空串冒充"有值"', () => {
    const env = buildExternalChildEnv(['TDSF_E2E_ABSENT_KEY'])
    expect('TDSF_E2E_ABSENT_KEY' in env).toBe(false)
  })

  it('非法键名（带空格、点、连字符、$）一律忽略，不拼进环境', () => {
    const env = buildExternalChildEnv(['BAD NAME', 'bad.name', 'bad-name', '$EVIL', ''])
    for (const k of Object.keys(env)) {
      expect(k, `环境里出现了非法键名 ${k}`).not.toMatch(/[.\s$-]/)
    }
  })

  it('键名合法性由同一把尺子判（白名单形状不是抄的）', () => {
    expect(MCP_ENV_NAME.test('MY_VAR_2')).toBe(true)
    expect(MCP_ENV_NAME.test('2MY_VAR')).toBe(false)
    expect(MCP_ENV_NAME.test('my-var')).toBe(false)
    expect(MCP_ENV_NAME.test('my var')).toBe(false)
  })
})
