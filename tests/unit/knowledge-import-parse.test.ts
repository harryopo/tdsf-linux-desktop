/**
 * 知识包文件解析（#180）——导入入口的地基
 *
 * 用户手上的东西是一份份自己记的 Markdown 笔记和从别处导出的 JSON，
 * 所以"导入"必须先把这两种形状解析成 KnowledgeEntry，并且把不能信的东西挡在外面。
 *
 * 三条判据来自产品的核心承诺（AI 说的话要能证明自己做过）：
 * 1. 幂等：同一条内容再导一次不产生第二条重复条目 ⇒ id 由内容哈希给，不由时间戳给。
 * 2. 经验计数不外import：successRate / useCount / feedback 是**这台机器**用出来的经历，
 *    别人打包带来的 0.99 会直接变成模型嘴里的"这条经验很靠谱"。一律归零。
 * 3. 坏数据要留名：整批丢掉或静默少几条都不行，每条被丢的都要有原因回给用户。
 */
import { describe, it, expect } from 'vitest'
import {
  parseKnowledgeFile,
  knowledgeIdForHeading,
  IMPORT_FILE_EXTENSIONS,
  MAX_IMPORT_FILE_BYTES,
} from '../../src/main/services/db/knowledge-import'

/** Markdown 里带代码围栏，用数组拼行，避免模板字面量把反引号当语法 */
function md(lines: string[]): string {
  return lines.join('\n')
}

describe('Markdown 解析', () => {
  it('每个标题切成一条，围栏代码行进 commands', () => {
    const text = md([
      '# nginx 502 排查',
      '',
      '网关报错先看上流是否活着。',
      '',
      '```bash',
      'nginx -t',
      'curl -I 127.0.0.1',
      '```',
      '',
      '# 磁盘满清理',
      '',
      'df 打满时先找大日志。',
      '',
      '  ```',
      'du -sh /var/log/*',
      '  ```',
    ])

    const result = parseKnowledgeFile('ops-notes.md', text)

    expect(result.rejected).toEqual([])
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0].title).toBe('nginx 502 排查')
    expect(result.entries[0].commands).toEqual(['nginx -t', 'curl -I 127.0.0.1'])
    expect(result.entries[1].title).toBe('磁盘满清理')
    // 缩进过的围栏同样是围栏，不能因为前面有空格就被当成正文
    expect(result.entries[1].commands).toEqual(['du -sh /var/log/*'])
    // 正文不该把围栏原文再带一遍（否则模型读到两遍命令）
    expect(result.entries[0].problem).not.toContain('nginx -t')
  })

  it('第一个标题之前的正文也收，标题用文件名（不含后缀）', () => {
    const result = parseKnowledgeFile(
      'my-notes.markdown',
      md(['这段没有标题。', '', '# 有标题的段', '', '这段有内容。']),
    )
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0].title).toBe('my-notes')
    expect(result.entries[0].problem).toContain('这段没有标题。')
    expect(result.entries[1].title).toBe('有标题的段')
  })

  it('只有标题、一句正文都没有的小节被拒（不是知识，是待办）', () => {
    const result = parseKnowledgeFile('n.md', md(['# 回头补', '', '', '# 磁盘满', '', '看 df。']))
    expect(result.entries).toHaveLength(1)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].source).toBe('回头补')
  })

  it('同一个文件的同一个小节再导一次还是同一条（正文改了也对得上，不产生重复）', () => {
    const before = parseKnowledgeFile('ops.md', md(['# 磁盘满', '', '先看 df。'])).entries[0]
    const after = parseKnowledgeFile('ops.md', md(['# 磁盘满', '', '先看 df -h，再找大日志。'])).entries[0]
    expect(after.id).toBe(before.id)
  })

  it('身份只看文件名加标题，不看正文（标题+文件定条，抄 LlamaIndex 的 doc_id 思路）', () => {
    expect(parseKnowledgeFile('ops.md', md(['# 磁盘满', '', '甲'])).entries[0].id).toBe(
      knowledgeIdForHeading('ops', '磁盘满')
    )
  })

  it('不同文件里的同名小节是两条，不许互相覆盖', () => {
    const a = parseKnowledgeFile('a.md', md(['# 排查', '', '甲。'])).entries[0]
    const b = parseKnowledgeFile('b.md', md(['# 排查', '', '乙。'])).entries[0]
    expect(a.id).not.toBe(b.id)
  })

  it('同一文件里重复出现的同名小节各自成条（后一条不能被前一条吃掉）', () => {
    const result = parseKnowledgeFile('ops.md', md(['# 排查', '', '甲。', '', '# 排查', '', '乙。']))
    expect(result.entries).toHaveLength(2)
    expect(new Set(result.entries.map((e) => e.id)).size).toBe(2)
  })

  it('正文超长时如实截断并留下标记，不悄悄切', () => {
    const long = '故'.repeat(5000)
    const result = parseKnowledgeFile('n.md', md(['# 超长', '', long]))
    expect(result.entries[0].problem.length).toBeLessThan(long.length)
    expect(result.entries[0].problem).toContain('已截断')
  })

  it('关键词从标题与命令行现推（检索与去重都靠它，不能留空）', () => {
    const result = parseKnowledgeFile(
      'n.md',
      md(['# nginx 502 排查', '', '看上游。', '', '```bash', 'nginx -t', 'df -h', '```']),
    )
    const keywords = result.entries[0].keywords
    expect(keywords).toContain('nginx 502 排查')
    expect(keywords).toContain('nginx')
    expect(keywords).toContain('df')
  })

  it('Markdown 条目也带「外部导入」标记（不是本机沉淀的）', () => {
    const result = parseKnowledgeFile('n.md', md(['# 磁盘满', '', '看 df。']))
    expect(result.entries[0].tags).toContain('外部导入')
    expect(result.entries[0].type).toBe('incident_case')
  })

  it('空文件不产出条目也不报错', () => {
    expect(parseKnowledgeFile('n.md', '   \n\n  ')).toEqual({ entries: [], rejected: [] })
  })
})

describe('JSON 知识包解析', () => {
  const valid = {
    id: 'kb-external-1',
    type: 'incident_case',
    title: 'mysql 连不上',
    problem: 'bind-address 只监听 127.0.0.1',
    commands: ['ss -lntp | grep 3306'],
    keywords: ['mysql', 'bind-address'],
    tags: ['db'],
    successRate: 0.99,
    useCount: 88,
    feedback: 'helpful',
    embedding: [0.1, 0.2],
    createdAt: 1,
    updatedAt: 2,
  }

  it('数组与 {entries:[...]} 两种顶层形状都收', () => {
    expect(parseKnowledgeFile('p.json', JSON.stringify([valid])).entries).toHaveLength(1)
    expect(parseKnowledgeFile('p.json', JSON.stringify({ entries: [valid] })).entries).toHaveLength(1)
  })

  it('外来经验计数一律归零、答复与向量一律丢弃', () => {
    const entry = parseKnowledgeFile('p.json', JSON.stringify([valid])).entries[0]
    expect(entry.successRate).toBe(0)
    expect(entry.useCount).toBe(0)
    expect(entry.feedback).toBeUndefined()
    expect(entry.embedding).toBeUndefined()
    // 来源留下标记，界面上能看出这条不是本机沉淀的
    expect(entry.tags).toContain('外部导入')
  })

  it('标题或问题为空的条目被拒并写明原因，不静默丢', () => {
    const bad = { ...valid, title: '   ' }
    const result = parseKnowledgeFile('p.json', JSON.stringify([valid, bad]))
    expect(result.entries).toHaveLength(1)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].reason).toContain('标题')
  })

  it('type 不认识时拒掉，不猜成默认类型', () => {
    const result = parseKnowledgeFile('p.json', JSON.stringify([{ ...valid, type: 'wisdom' }]))
    expect(result.entries).toHaveLength(0)
    expect(result.rejected[0].reason).toContain('type')
  })

  it('缺 type 时按故障案例收（用户手写的包通常不写这个字段）', () => {
    const { type: _omit, ...rest } = valid
    const entry = parseKnowledgeFile('p.json', JSON.stringify([rest])).entries[0]
    expect(entry.type).toBe('incident_case')
  })

  it('commands 不是字符串数组时整条拒掉（否则写库时炸在半路）', () => {
    const result = parseKnowledgeFile('p.json', JSON.stringify([{ ...valid, commands: 'df -h' }]))
    expect(result.entries).toHaveLength(0)
    expect(result.rejected[0].reason).toContain('commands')
  })

  it('JSON 语法坏了不抛异常，回一条拒绝原因', () => {
    const result = parseKnowledgeFile('p.json', '{ "entries": [ 坏掉的')
    expect(result.entries).toEqual([])
    expect(result.rejected[0].reason).toContain('JSON')
  })
})

describe('不支持的输入', () => {
  it('扩展名不在白名单时整份拒绝', () => {
    const result = parseKnowledgeFile('key.pem', '---- BEGIN ----')
    expect(result.entries).toEqual([])
    expect(result.rejected[0].reason).toContain('.pem')
  })

  it('白名单与体积上限是可核对的单源', () => {
    expect(IMPORT_FILE_EXTENSIONS).toEqual(['md', 'markdown', 'txt', 'json'])
    expect(MAX_IMPORT_FILE_BYTES).toBeGreaterThan(0)
  })
})
