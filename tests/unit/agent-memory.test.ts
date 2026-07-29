/**
 * agent-memory.test.ts — Agent 长期记忆系统单测（v2.8）
 *
 * 覆盖：
 * 1. MemoryRepository：upsert 语义/校验拦截/检索/LRU 淘汰/注入块预算
 * 2. memory-extractor：输出解析/节流/失败教训沉淀过滤
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseManager } from '../../src/main/services/db/database'
import {
  MemoryRepository,
  validateMemoryText,
  MAX_PER_TYPE,
  INJECT_BUDGET,
} from '../../src/main/services/db/memory-repo'
import {
  parseExtractOutput,
  buildExtractInput,
  extractMemories,
  recordToolFailure,
  resetExtractThrottle,
  MAX_OPS_PER_EXTRACT,
} from '../../src/main/core/agent/memory/memory-extractor'
import type { ModelMessage } from 'ai'

function freshRepo(): MemoryRepository {
  DatabaseManager.resetInstance()
  return new MemoryRepository(DatabaseManager.getInstance(':memory:'))
}

describe('MemoryRepository — 存储与检索', () => {
  let repo: MemoryRepository

  beforeEach(() => {
    repo = freshRepo()
  })

  it('upsert 新 key 插入，同 key 更新（不堆积重复）', () => {
    expect(repo.upsert({ type: 'environment', key: 'nginx-path', text: '生产机 nginx 安装在 /usr/local/nginx' })).toBe('inserted')
    expect(repo.upsert({ type: 'environment', key: 'nginx-path', text: '生产机 nginx 已迁移到 /opt/nginx 目录下' })).toBe('updated')
    const all = repo.list('environment')
    expect(all).toHaveLength(1)
    expect(all[0].text).toContain('/opt/nginx')
  })

  it('拒绝过短/疑问句/秘密/临时内容', () => {
    expect(validateMemoryText('太短')).toBe('too_short')
    expect(validateMemoryText('用户的服务器是什么系统？')).toBe('question')
    expect(validateMemoryText('数据库 password=Secret123456 需要记住')).toBe('secret')
    expect(validateMemoryText('用户今天在调试 nginx 的配置文件')).toBe('transient')
    expect(validateMemoryText('用户是 Linux 初学者，偏好中文解释')).toBeNull()
  })

  it('upsert 拒绝非法 type 与非法文本并记入审计', () => {
    expect(repo.upsert({ type: 'bogus' as never, key: 'k1', text: '一条完全正常长度的记忆文本' })).toBe('bad_type')
    expect(repo.upsert({ type: 'fact', key: 'k2', text: '短' })).toBe('too_short')
    const audit = repo.auditLog(10)
    expect(audit.some((a) => a.op === 'skip')).toBe(true)
  })

  it('search 中文子串命中并刷新使用统计', () => {
    repo.upsert({ type: 'environment', key: 'nginx-path', text: '生产机 nginx 安装在 /usr/local/nginx' })
    repo.upsert({ type: 'fact', key: 'disk-plan', text: '每周日凌晨执行磁盘清理计划任务' })
    const hits = repo.search('nginx 路径')
    expect(hits).toHaveLength(1)
    expect(hits[0].key).toBe('nginx-path')
    // 使用统计已刷新
    const after = repo.list('environment')[0]
    expect(after.useCount).toBe(1)
    expect(after.lastUsedAt).not.toBeNull()
  })

  it('correction 类型检索加权靠前', () => {
    repo.upsert({ type: 'fact', key: 'f1', text: 'mysql 连接数上限默认 151 需要调优' })
    repo.upsert({ type: 'correction', key: 'c1', text: 'mysql 重启前必须先检查主从同步状态' })
    const hits = repo.search('mysql')
    expect(hits[0].type).toBe('correction')
  })

  it('超过每类上限时 LRU 淘汰（correction 豁免）', () => {
    for (let i = 0; i < MAX_PER_TYPE + 5; i++) {
      repo.upsert({ type: 'fact', key: `fact-${i}`, text: `第 ${i} 条持久事实内容，长度足够通过校验` })
    }
    expect(repo.list('fact').length).toBeLessThanOrEqual(MAX_PER_TYPE)
    // correction 不淘汰
    for (let i = 0; i < MAX_PER_TYPE + 5; i++) {
      repo.upsert({ type: 'correction', key: `corr-${i}`, text: `第 ${i} 条错误教训内容，长度足够通过校验` })
    }
    expect(repo.list('correction').length).toBe(MAX_PER_TYPE + 5)
  })

  it('buildInjectionBlock 空库返回空串，非空时含 authority rule 且不超预算', () => {
    expect(repo.buildInjectionBlock()).toBe('')
    repo.upsert({ type: 'correction', key: 'c1', text: 'rm -rf 类命令必须先向用户确认再执行' })
    repo.upsert({ type: 'user_profile', key: 'u1', text: '用户是 Linux 初学者，偏好逐步解释' })
    const block = repo.buildInjectionBlock()
    expect(block).toContain('长期记忆')
    expect(block).toContain('当前用户指令与真实机器状态永远优先')
    expect(block).toContain('错误教训')
    expect(block.length).toBeLessThanOrEqual(INJECT_BUDGET + 200)
  })

  it('removeById 删除后 list 不再返回', () => {
    repo.upsert({ type: 'fact', key: 'f1', text: '一条即将被删除的持久事实内容' })
    const id = repo.list('fact')[0].id
    expect(repo.removeById(id)).toBe(true)
    expect(repo.list('fact')).toHaveLength(0)
  })

  // v2.9 语义检索：embedding 列 + 向量检索降级
  it('setEmbedding 写入后 listMissingEmbedding 不再包含该 key', () => {
    repo.upsert({ type: 'environment', key: 'nginx-path', text: '生产机 nginx 安装在 /usr/local/nginx' })
    expect(repo.listMissingEmbedding().some((m) => m.key === 'nginx-path')).toBe(true)
    // 写入一个假的 512 维向量（测试环境无 embedding 服务，直接构造）
    const fakeVec = Array.from({ length: 512 }, () => 0.01)
    expect(repo.setEmbedding('nginx-path', fakeVec)).toBe(true)
    expect(repo.listMissingEmbedding().some((m) => m.key === 'nginx-path')).toBe(false)
  })

  it('setEmbedding 空向量/不存在的 key 返回 false', () => {
    expect(repo.setEmbedding('nope', [])).toBe(false)
    expect(repo.setEmbedding('nonexistent-key', [0.1, 0.2])).toBe(false)
  })

  it('searchByVector 在向量扩展不可用时返回空数组（降级契约）', () => {
    repo.upsert({ type: 'fact', key: 'f1', text: '一条用于向量检索降级测试的持久事实' })
    repo.setEmbedding('f1', Array.from({ length: 512 }, () => 0.01))
    // 测试环境 sqlite-vec 未加载 → isVectorEnabled=false → 返回 []（调用方降级关键词）
    expect(repo.searchByVector([0.01, 0.02], 5)).toEqual([])
  })

  it('listMissingEmbedding 只返回 embedding 为空的记忆', () => {
    repo.upsert({ type: 'fact', key: 'has-emb', text: '已有向量的记忆内容占位文本' })
    repo.upsert({ type: 'fact', key: 'no-emb', text: '尚无向量的记忆内容占位文本' })
    repo.setEmbedding('has-emb', Array.from({ length: 512 }, () => 0.02))
    const missing = repo.listMissingEmbedding()
    expect(missing.some((m) => m.key === 'no-emb')).toBe(true)
    expect(missing.some((m) => m.key === 'has-emb')).toBe(false)
  })
})

describe('memory-extractor — 解析与沉淀', () => {
  let repo: MemoryRepository

  beforeEach(() => {
    repo = freshRepo()
    resetExtractThrottle()
  })

  it('parseExtractOutput 解析裸 JSON 与围栏 JSON', () => {
    const raw = '```json\n[{"type":"environment","key":"os-ver","text":"服务器运行 openEuler 22.03 LTS 版本"}]\n```'
    const ops = parseExtractOutput(raw)
    expect(ops).toHaveLength(1)
    expect(ops[0].key).toBe('os-ver')
  })

  it('parseExtractOutput 过滤非法条目并截断到上限', () => {
    const items = Array.from({ length: MAX_OPS_PER_EXTRACT + 5 }, (_, i) => ({
      type: 'fact', key: `k${i}`, text: `第 ${i} 条内容长度足够通过校验的记忆`,
    }))
    items.push({ type: 'invalid', key: 'bad', text: '类型非法应被过滤的一条内容' } as never)
    const ops = parseExtractOutput(JSON.stringify(items))
    expect(ops.length).toBeLessThanOrEqual(MAX_OPS_PER_EXTRACT)
    expect(ops.every((o) => o.type !== ('invalid' as never))).toBe(true)
  })

  it('parseExtractOutput 空串/杂文/坏 JSON 返回空数组', () => {
    expect(parseExtractOutput('')).toEqual([])
    expect(parseExtractOutput('没有可提取内容')).toEqual([])
    expect(parseExtractOutput('[{"type":')).toEqual([])
  })

  it('buildExtractInput 只取最近消息并截断', () => {
    const messages: ModelMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: 'user', content: `消息 ${i} ${'x'.repeat(700)}`,
    })) as ModelMessage[]
    const input = buildExtractInput(messages, '最终回复')
    expect(input).toContain('消息 19')
    expect(input).not.toContain('消息 5')
  })

  it('extractMemories 走 LLM 解析并写库；节流期内第二次跳过', async () => {
    const fakeLlm = async (): Promise<string> =>
      '[{"type":"user_profile","key":"user-level","text":"用户是 Linux 初学者，需要基础解释"}]'
    const messages: ModelMessage[] = [
      { role: 'user', content: '我刚开始学 Linux，磁盘满了怎么办？请用简单的方式解释' } as ModelMessage,
    ]
    const written = await extractMemories(repo, fakeLlm, messages, '可以用 df -h 查看磁盘使用情况……')
    expect(written).toBe(1)
    expect(repo.list('user_profile')).toHaveLength(1)
    // 节流：立即再次调用直接跳过
    const second = await extractMemories(repo, fakeLlm, messages, '第二次回复')
    expect(second).toBe(0)
  })

  it('extractMemories LLM 失败返回 0 不抛错', async () => {
    const failLlm = async (): Promise<string> => {
      throw new Error('network down')
    }
    const messages: ModelMessage[] = [
      { role: 'user', content: '一条足够长的用户消息内容用于通过输入长度检查限制' } as ModelMessage,
    ]
    await expect(extractMemories(repo, failLlm, messages, '回复内容')).resolves.toBe(0)
  })

  it('recordToolFailure 沉淀教训；护栏拦截类失败被过滤', () => {
    recordToolFailure(repo, 'ssh_readonly', 'journalctl -u nginx', 'command not found: journalctl')
    expect(repo.list('correction')).toHaveLength(1)
    // 风险拦截不算教训
    recordToolFailure(repo, 'ssh_readonly', 'rm -rf /', '命令被风险引擎拦截（CRITICAL）')
    expect(repo.list('correction')).toHaveLength(1)
    // 同命令重复失败 upsert 合并不堆积
    recordToolFailure(repo, 'ssh_readonly', 'journalctl -xe', 'command not found: journalctl')
    expect(repo.list('correction')).toHaveLength(1)
  })
})
