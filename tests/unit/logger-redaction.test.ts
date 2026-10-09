/**
 * 脱敏收口到 log() 的判据（2026-10-09 安全审查 S5 / P1-3）
 *
 * 以前的写法是"靠调用方自觉"：485 处 logger 调用只有 16 个文件引了 redactSecrets，
 * 于是 sandbox 的 commandPreview、渲染层上报的日志、以及任何新加的调用点，
 * 都会把原文写进磁盘。收口只有一个地方——log() 自己。
 *
 * 判据按报告原文：写入含 sk-… 的 meta，断言 getEntries() 查不到原串。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { logger } from '../../src/main/services/log/logger'

// 拆成相邻字面量：写成完整形态会被 secret-gate（和 GitHub 推送扫描）当成真 key 报警
const SECRET_KEY = 'sk-' + 'abcdefghijklmnopqrstuvwxyz123456'

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  logger.clearBuffer()
  // 主 logger 会同时写控制台，测试里把它吞掉，只看进 buffer 的那份
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  consoleSpy.mockRestore()
})

describe('log() 内部统一脱敏', () => {
  it('meta 里的 API Key 不落盘（报告的原始判据）', () => {
    logger.info('LLM', '模型调用失败', { apiKey: SECRET_KEY, provider: 'openai' })
    const entry = logger.getEntries({ category: 'LLM' }).at(-1)!
    const dumped = JSON.stringify(entry.meta)
    expect(dumped, '原串还在 meta 里就等于落盘了').not.toContain(SECRET_KEY)
    expect(dumped, '遮掉的标记（按值形态或按键名都算）').toMatch(/\[REDACTED/)
    expect(entry.message, '正常字段不许被吃掉').toContain('模型调用失败')
    expect(entry.meta?.provider).toBe('openai')
  })

  it('message 里内联的口令同样不落盘', () => {
    logger.warn('SSH', '登录被拒 password=Sup3rPass2026 host=10.0.0.5')
    const entry = logger.getEntries({ category: 'SSH' }).at(-1)!
    expect(entry.message).not.toContain('Sup3rPass2026')
    expect(entry.message).toContain('host=10.0.0.5')
  })

  it('嵌套对象与数组里的凭据也要盖住（只盖正在看的那一条必然漏）', () => {
    logger.error('SSH', '传输失败', {
      headers: ['Authorization: Basic QWxhZGRpbjpPcGVuU2VzYW1l', 'Accept: */*'],
      inner: { deep: { keyPath: 'C:\\Users\\harryopo\\.ssh\\id_rsa' } },
      dsn: 'postgres://admin:S3cr3tPw@10.0.0.5/tdsf',
    })
    const dumped = JSON.stringify(logger.getEntries({ category: 'SSH' }).at(-1)!.meta)
    expect(dumped).not.toContain('QWxhZGRpbjpPcGVuU2VzYW1l')
    expect(dumped).not.toContain('S3cr3tPw')
    expect(dumped).not.toContain('harryopo')
    expect(dumped, '数组的长度与位置不许变，否则日志没法读').toContain('Accept: */*')
  })

  it('渲染层上报的日志走同一条路（ipc/log 那条绕过样本）', () => {
    logger.log('INFO', 'UI', '前端异常', {
      meta: { token: 'abcdefghij1234567890XYZ' },
      source: 'renderer',
    })
    const entry = logger.getEntries({ category: 'UI' }).at(-1)!
    expect(entry.source).toBe('renderer')
    expect(JSON.stringify(entry.meta)).not.toContain('abcdefghij1234567890XYZ')
  })

  it('没有敏感值的日志逐字段原样保留（阴性对照：不许顺手改坏正常日志）', () => {
    const meta = {
      sessionId: '3f2a8b1c-4d5e-6f70-8a9b-0c1d2e3f4a5b',
      count: 50,
      ok: true,
      tags: ['df', 'free'],
      ratio: 0.91,
      missing: null,
    }
    const before = logger.getRedactionCount()
    logger.info('DB', '查询完成', meta)
    const entry = logger.getEntries({ category: 'DB' }).at(-1)!
    expect(entry.meta).toEqual(meta)
    expect(logger.getRedactionCount(), '这条日志里没有敏感值，命中数不该动').toBe(before)
  })

  it('Date 等非普通对象原样交给 JSON.stringify（不为了脱敏改坏日志内容）', () => {
    const when = new Date('2026-10-09T00:00:00.000Z')
    logger.info('APP', '带时间的日志', { when })
    const entry = logger.getEntries({ category: 'APP' }).at(-1)!
    expect(entry.meta?.when).toBe(when)
  })

  it('循环引用不会把 log() 炸掉', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(() => logger.info('APP', '循环对象', a)).not.toThrow()
    const dumped = JSON.stringify(logger.getEntries({ category: 'APP' }).at(-1)!.meta)
    expect(dumped).toContain('循环引用')
  })

  it('键名是凭据时，值哪怕没有形态也遮掉；正常计数不许被吞', () => {
    logger.info('AUTH', '凭据载入', {
      token: '随机的一串没有任何形态的值',
      passwordHint: 'also-opaque-value',
      creds: { apiKey: 'opaque' },
      maxTokens: 1024,
      tokenCount: 7,
      promptTokens: 400,
    })
    const meta = logger.getEntries({ category: 'AUTH' }).at(-1)!.meta!
    const dumped = JSON.stringify(meta)
    expect(dumped).not.toContain('随机的一串没有任何形态的值')
    expect(dumped, '按前缀也要认得 passwordHint 这类派生名').not.toContain('also-opaque-value')
    expect(dumped).not.toContain('opaque')
    expect(meta.maxTokens, 'maxTokens 是运行参数，按包含匹配会把它当凭据吞掉').toBe(1024)
    expect(meta.tokenCount).toBe(7)
    expect(meta.promptTokens).toBe(400)
  })

  it('命中数能被观测到（闸真的在动，不是字符串没变）', () => {
    const before = logger.getRedactionCount()
    logger.info('AUTH', '凭据已载入', { apiKey: SECRET_KEY })
    expect(logger.getRedactionCount(), '至少统计到一次命中').toBeGreaterThan(before)
  })
})
