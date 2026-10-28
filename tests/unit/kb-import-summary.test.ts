/**
 * 导入结果怎么说（#259）
 *
 * 病灶：`importKnowledgeFiles` 对每个**处理过**的文件都 `files++`，
 * 哪怕它一节都没解析出来（空文件、只有分隔线的文件）。界面拿 `files > 0`
 * 当"有东西导进来了"，于是空文件会弹一条绿色的「导入完成：新增 0 条，更新 0 条」。
 *
 * 这条链的对话框是系统原生的，e2e 点不到；把"该说什么"做成纯函数，
 * 才能在单测里把每一档都钉住。
 */
import { describe, it, expect } from 'vitest'
import { summarizeKbImport } from '../../src/renderer/src/utils/kb-import-summary'

describe('summarizeKbImport', () => {
  it('取消：什么都不说', () => {
    expect(summarizeKbImport({ ok: false, canceled: true })).toEqual({ kind: 'canceled' })
  })

  it('主进程报错：原样带出原因', () => {
    const out = summarizeKbImport({ ok: false, error: '磁盘只读' })
    expect(out.kind).toBe('failed')
    expect('message' in out && out.message).toContain('磁盘只读')
  })

  it('主进程报错但没给原因：也要说"没有说明原因"，不许空着一句', () => {
    const out = summarizeKbImport({ ok: false })
    expect(out.kind).toBe('failed')
    expect('message' in out && out.message).toContain('没有说明原因')
  })

  it('文件里没有可导入的条目：说清是哪个文件、为什么', () => {
    const out = summarizeKbImport({
      ok: true,
      files: 0,
      inserted: 0,
      updated: 0,
      rejected: [{ file: 'empty.md', source: 'empty.md', reason: '这一节只有标题没有内容' }],
    })
    expect(out.kind).toBe('empty')
    expect('message' in out && out.message).toContain('empty.md')
    expect('message' in out && out.message).toContain('这一节只有标题没有内容')
  })

  it('文件有内容但一条都没写进库：不许报"导入完成"', () => {
    const out = summarizeKbImport({
      ok: true,
      files: 1,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      rejected: [{ file: 'ops.md', source: '写库', reason: '写库失败（这次没有存进来）' }],
    })
    expect(
      out.kind,
      'files>0 只说明"处理过"，不说明"导进去了"——这里报成功就是假成功'
    ).toBe('failed')
    expect('message' in out && out.message).toContain('写库失败')
  })

  it('同一份文件再导一次（全是没变化）：这是正常结果，不是失败', () => {
    const out = summarizeKbImport({
      ok: true,
      files: 1,
      inserted: 0,
      updated: 0,
      unchanged: 3,
    })
    expect(out.kind).toBe('done')
    expect('message' in out && out.message).toContain('没变化 3')
  })

  it('正常导入：新增/更新/索引各说各的，没建索引就不提那一项', () => {
    const out = summarizeKbImport({
      ok: true,
      files: 2,
      inserted: 3,
      updated: 1,
      unchanged: 0,
      embedded: 0,
    })
    expect(out.kind).toBe('done')
    const msg = 'message' in out ? out.message : ''
    expect(msg).toContain('新增 3')
    expect(msg).toContain('更新 1')
    expect(msg, '零索引也写成一项，会让人以为语义检索就绪了').not.toContain('语义索引')
  })

  it('建了索引：把条数说出来', () => {
    const out = summarizeKbImport({ ok: true, files: 1, inserted: 2, updated: 0, embedded: 2 })
    expect('message' in out && out.message).toContain('已建语义索引 2 条')
  })

  it('部分条目没进来 + 模型没就绪：成功照报，两条提醒都要带上', () => {
    const out = summarizeKbImport({
      ok: true,
      files: 1,
      inserted: 1,
      updated: 0,
      note: '本地向量模型还没下载好',
      rejected: [{ file: 'ops.md', source: '第 2 条', reason: '缺少标题' }],
    })
    expect(out.kind).toBe('done')
    const warnings = 'warnings' in out ? out.warnings : []
    expect(warnings.some((w) => w.includes('向量模型'))).toBe(true)
    expect(warnings.some((w) => w.includes('缺少标题'))).toBe(true)
  })
})
