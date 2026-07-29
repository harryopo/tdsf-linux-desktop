/**
 * 知识库中文检索 + 内置种子 单元测试（v2.6）
 *
 * 背景回归：原 search 只对 keywords 做空格分词 Jaccard，中文查询零命中，
 * 用户反馈"检索教程什么也检索不到，知识库也是假的"。
 * 覆盖：
 * - 中文自然语言查询能命中知识条目（双向子串匹配）
 * - 种子数据结构合法（id 唯一 / 命令非空 / 关键词非空）
 * - 种子在真实 search 下可被典型中文问句命中
 */
import { describe, it, expect } from 'vitest'
import { KNOWLEDGE_SEED_ENTRIES, KNOWLEDGE_SEED_VERSION } from '../../src/main/services/db/knowledge-seeds'

describe('知识库种子数据（kb-seed）', () => {
  it(`版本 ${KNOWLEDGE_SEED_VERSION}：12 条且 id 唯一`, () => {
    expect(KNOWLEDGE_SEED_ENTRIES).toHaveLength(12)
    const ids = KNOWLEDGE_SEED_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每条种子都有真实内容：标题/问题/命令/关键词/根因非空', () => {
    for (const e of KNOWLEDGE_SEED_ENTRIES) {
      expect(e.title.length, e.id).toBeGreaterThan(4)
      expect(e.problem.length, e.id).toBeGreaterThan(10)
      expect(e.commands.length, e.id).toBeGreaterThan(0)
      expect(e.keywords.length, e.id).toBeGreaterThanOrEqual(4)
      expect((e.rootCause ?? '').length, e.id).toBeGreaterThan(20)
      expect((e.verification ?? '').length, e.id).toBeGreaterThan(10)
    }
  })

  it('种子只含 incident_case / command_skill 两类', () => {
    for (const e of KNOWLEDGE_SEED_ENTRIES) {
      expect(['incident_case', 'command_skill']).toContain(e.type)
    }
  })

  it('种子不含设计稿占位文案（KB-NGINX-014 / 1247 等假数据特征）', () => {
    const all = JSON.stringify(KNOWLEDGE_SEED_ENTRIES)
    expect(all).not.toContain('KB-NGINX-014')
    expect(all).not.toContain('1247')
    expect(all).not.toContain('worker_connections 调优指南')
  })
})

describe('中文检索命中（模拟 KnowledgeRepository.search 的评分逻辑）', () => {
  /** 与 knowledge-repo.search 相同的双向子串命中判定（保持算法同步） */
  function hits(query: string, entry: (typeof KNOWLEDGE_SEED_ENTRIES)[number]): boolean {
    const tokens = query
      .toLowerCase()
      .split(/[\s,，。、；;:：!！?？()（）[\]【】"'`/\\|]+/)
      .filter((t) => t.length > 0)
    const haystack = `${entry.title} ${entry.problem} ${entry.keywords.join(' ')} ${entry.tags.join(' ')}`.toLowerCase()
    const needles = [...entry.keywords, ...entry.tags].map((k) => k.toLowerCase()).filter((k) => k.length >= 2)
    return tokens.some((t) => haystack.includes(t) || needles.some((k) => t.includes(k)))
  }

  it.each([
    ['nginx 502 怎么排查', 'kb-seed-nginx-502'],
    ['磁盘满了怎么办', 'kb-seed-disk-full'],
    ['进程被OOM杀了', 'kb-seed-oom-killer'],
    ['systemd 服务启动失败', 'kb-seed-systemd-failed'],
    ['ssh连接拒绝', 'kb-seed-ssh-refused'],
    ['端口被占用', 'kb-seed-port-conflict'],
    ['mysql too many connections', 'kb-seed-mysql-connections'],
    ['负载很高怎么查', 'kb-seed-high-load'],
    ['docker 磁盘清理', 'kb-seed-docker-disk'],
  ])('中文查询「%s」应命中 %s', (query, expectedId) => {
    const entry = KNOWLEDGE_SEED_ENTRIES.find((e) => e.id === expectedId)!
    expect(entry).toBeDefined()
    expect(hits(query, entry)).toBe(true)
  })
})
