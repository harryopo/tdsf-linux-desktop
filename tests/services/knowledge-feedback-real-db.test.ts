/**
 * 知识反馈真的落盘并驱动成功率（#134，真 better-sqlite3 库）
 *
 * 病根两处，都在这条链上：
 * 1. 详情页的"有帮助/没帮助"按下去只改本地 useState。库里没有 feedback 这一列，
 *    serialize 把它丢了，kbUpdate 还返回 true —— 于是每次都"成功"，重开页面又像没答过。
 * 2. `updateSuccessRate()` 全仓零调用。所以侧栏那个"综合置信度评分"没有任何生产者，
 *    是入库那一刻写死的一个数，用户怎么答复它都不动。
 *
 * 现在答复进 knowledge_entries.feedback（schema v2），并由它把这一票并进 successRate。
 * 判据一律读回库里的行，不测反序列化后的对象，也不测界面。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseManager } from '../../src/main/services/db/database'
import { KnowledgeRepository } from '../../src/main/services/db/knowledge-repo'
import type { KnowledgeEntry } from '../../src/shared/models'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let dbm: DatabaseManager
let repo: KnowledgeRepository

function makeEntry(over: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  const now = Date.now()
  return {
    id: 'kb-feedback-1',
    type: 'incident_case',
    title: '磁盘满导致服务起不来',
    problem: 'df 打满',
    commands: ['df -h'],
    keywords: ['磁盘', 'df'],
    tags: ['storage'],
    successRate: 0,
    useCount: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

/** 直接读库里那一行：判据要看落盘结果，不看仓储反序列化出来的对象 */
function rawRow(id: string): { feedback: string | null; successRate: number } {
  return dbm
    .prepare('SELECT feedback, successRate FROM knowledge_entries WHERE id = ?')
    .get(id) as { feedback: string | null; successRate: number }
}

beforeEach(() => {
  DatabaseManager.resetInstance()
  dbm = DatabaseManager.getInstance(':memory:')
  repo = new KnowledgeRepository(dbm)
})

afterEach(() => {
  DatabaseManager.resetInstance()
})

describe('答复落盘', () => {
  it('update 带 feedback 时，库里那一行真的写着这个值', () => {
    expect(repo.add(makeEntry())).toBe(true)

    expect(repo.update('kb-feedback-1', { feedback: 'helpful' })).toBe(true)

    expect(rawRow('kb-feedback-1').feedback).toBe('helpful')
    expect(repo.getById('kb-feedback-1')?.feedback).toBe('helpful')
  })

  it('不带 feedback 的普通更新不会把已记录的答复擦掉', () => {
    repo.add(makeEntry())
    repo.update('kb-feedback-1', { feedback: 'unhelpful' })

    repo.update('kb-feedback-1', { title: '改了标题' })

    expect(rawRow('kb-feedback-1').feedback).toBe('unhelpful')
    expect(repo.getById('kb-feedback-1')?.title).toBe('改了标题')
  })

  it('库里装着脏值时按"没答过"处理，不把任意字符串当答复交给界面', () => {
    repo.add(makeEntry())
    dbm.prepare(`UPDATE knowledge_entries SET feedback = 'yes' WHERE id = ?`).run('kb-feedback-1')

    expect(repo.getById('kb-feedback-1')?.feedback).toBeUndefined()
  })
})

describe('答复是成功率的生产者', () => {
  it('"有帮助"把这一票并进去：0 → 0.1（加权平均 old*0.9 + 1*0.1）', () => {
    repo.add(makeEntry({ successRate: 0 }))

    repo.update('kb-feedback-1', { feedback: 'helpful' })

    expect(rawRow('kb-feedback-1').successRate).toBeCloseTo(0.1, 10)
  })

  it('"没帮助"这一票按 0 并入：0.5 → 0.45', () => {
    repo.add(makeEntry({ successRate: 0.5 }))

    repo.update('kb-feedback-1', { feedback: 'unhelpful' })

    expect(rawRow('kb-feedback-1').successRate).toBeCloseTo(0.45, 10)
  })

  it('同一个答复重复提交不再叠加（点了两次不等于两票）', () => {
    repo.add(makeEntry({ successRate: 0 }))
    repo.update('kb-feedback-1', { feedback: 'helpful' })
    const after = rawRow('kb-feedback-1').successRate

    repo.update('kb-feedback-1', { feedback: 'helpful' })

    expect(rawRow('kb-feedback-1').successRate).toBe(after)
  })

  it('阴性对照：只改标题时成功率一动不动（证明上面那次变化来自答复）', () => {
    repo.add(makeEntry({ successRate: 0.3 }))

    repo.update('kb-feedback-1', { title: '只是改标题' })

    expect(rawRow('kb-feedback-1').successRate).toBeCloseTo(0.3, 10)
  })

  it('教程条目不并入：它这一列存的是阅读时长 hack，混进答复会两头都不是', () => {
    repo.add(makeEntry({ type: 'tutorial', successRate: 2.5 }))

    repo.update('kb-feedback-1', { feedback: 'helpful' })

    expect(rawRow('kb-feedback-1').feedback).toBe('helpful')
    expect(rawRow('kb-feedback-1').successRate).toBeCloseTo(2.5, 10)
  })
})

describe('生产者不许再变成孤儿', () => {
  it('updateSuccessRate 在业务代码里有调用点（不是只有定义）', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'main', 'services', 'db', 'knowledge-repo.ts'),
      'utf8'
    )
    const calls = src.match(/this\.updateSuccessRate\(/g) ?? []
    expect(calls.length, '答复链断了，成功率会重新变成没人写的死数').toBeGreaterThan(0)
  })

  it('KnowledgeEntry 的 feedback 是显式类型，不再是界面层的类型断言', () => {
    const models = readFileSync(join(process.cwd(), 'src', 'shared', 'models.ts'), 'utf8')
    expect(models).toContain('export type KnowledgeFeedback')
    expect(models).toMatch(/feedback\?: KnowledgeFeedback/)

    const page = readFileSync(
      join(process.cwd(), 'src', 'renderer', 'src', 'pages', 'KnowledgeDetailPage.tsx'),
      'utf8'
    )
    expect(page, '还在用 as Partial<KnowledgeEntry> 就是字段没进类型').not.toContain(
      'as Partial<KnowledgeEntry>'
    )
  })
})
