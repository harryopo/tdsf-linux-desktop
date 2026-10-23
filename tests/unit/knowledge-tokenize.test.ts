/**
 * 中文全文检索的分词（#181）
 *
 * 病根：FTS5 的 unicode61 把一整段没有空格的中文当一个 token，于是
 * 「磁盘满了怎么办」在索引里就是一个词，拿「磁盘」去 MATCH 永远命中不了
 * （仓库里 DedupePool 的注释早就写过这件事，但 FTS 那条腿一直没治）。
 *
 * 做法（业界小规模本地方案）：入库前自己先切词、用空格连起来，FTS 只负责按空格切；
 * 查询侧用同一套规则切，再把切出来的词按 OR 连起来。
 *   - 中文按**二元组（bigram）**切：磁盘满了 → 磁盘 / 盘满 / 满了。
 *     不按单字切，是因为单字会让 BM25 的 IDF 被"的/了/是"稀释掉；
 *     不按词库切，是因为本地不引 jieba 这类几百 KB~几 MB 的依赖，二元组对短查询已经够用。
 *   - 查询侧必须是 OR：若按 AND 连，查「磁盘满了怎么办」会要求索引里同时出现
 *     「了怎」「怎么」「么办」，短文档永远不满足——召回直接归零。
 *   - 英文/数字照原样保留（长度 ≥2），nginx / 502 / systemctl 仍然精确命中。
 */
import { describe, it, expect } from 'vitest'
import {
  segmentForIndex,
  buildFtsMatchQuery,
  MAX_SEGMENT_TOKENS,
} from '../../src/main/services/db/knowledge-tokenize'

describe('入库分词', () => {
  it('中文按二元组切，空格分隔（FTS 只按空格切）', () => {
    expect(segmentForIndex('磁盘满了怎么办')).toBe('磁盘 盘满 满了 了怎 怎么 么办')
  })

  it('单字中文保留单字（两字以内整段就一个词）', () => {
    expect(segmentForIndex('盘')).toBe('盘')
    expect(segmentForIndex('磁盘')).toBe('磁盘')
  })

  it('中英混排各自成词，英文与数字原样小写保留', () => {
    expect(segmentForIndex('Nginx 502 磁盘')).toBe('nginx 502 磁盘')
    expect(segmentForIndex('systemctl restart 服务')).toBe('systemctl restart 服务')
  })

  it('标点与换行当分隔符，不产生空词', () => {
    expect(segmentForIndex('磁盘满，先看 df -h。')).toBe('磁盘 盘满 先看 df')
  })

  it('单个字母/数字不当检索词（噪音太大）', () => {
    expect(segmentForIndex('a b 5 abc')).toBe('abc')
  })

  it('重复词只留一份，且有上限（入库文本可能很长）', () => {
    // 磁盘磁盘磁盘 → 二元组只有 磁盘/盘磁 两种（交替出现），去重后两个
    expect(segmentForIndex('磁盘磁盘磁盘')).toBe('磁盘 盘磁')
    const long = '磁'.repeat(2000)
    const tokens = segmentForIndex(long).split(' ')
    expect(tokens.length).toBeLessThanOrEqual(MAX_SEGMENT_TOKENS)
    // 只出现一次的相邻重复字不重复堆（磁磁 只有一个）
    expect(new Set(tokens).size).toBe(tokens.length)
  })
})

describe('查询构造', () => {
  it('二元组按 OR 连接（AND 会让短文档一条都命中不了）', () => {
    expect(buildFtsMatchQuery('磁盘')).toBe('"磁盘"')
    expect(buildFtsMatchQuery('磁盘满')).toBe('"磁盘" OR "盘满"')
  })

  it('中英混排的查询同样 OR 起来', () => {
    expect(buildFtsMatchQuery('nginx 502')).toBe('"nginx" OR "502"')
  })

  it('FTS 语法字符被切掉，不会被当成操作符（注入面）', () => {
    expect(buildFtsMatchQuery('ssh" OR * NOT')).toBe('"ssh"')
  })

  it('空查询/纯标点返回空串，调用方据此跳过 FTS 这条腿', () => {
    expect(buildFtsMatchQuery('')).toBe('')
    expect(buildFtsMatchQuery('   ，。！?  ')).toBe('')
  })
})
