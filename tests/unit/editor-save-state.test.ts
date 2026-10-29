/**
 * 编辑器保存状态机的纯函数判据（#235）
 *
 * 为什么单独测这层：2026-10-25 深度审查发现，`Ctrl+S` 那条路只查了"有活动文件 + 有会话"，
 * 而工具栏那条路查得更全（`canSaveFileTab` 等）。于是出现三种真实的数据风险：
 *   1. 文件还在读（标签 `content` 是空串、`loading: true`）时按 Ctrl+S ⇒ 把空正文写回远端；
 *   2. 标签属于 A 机、人已切到 B 机时按 Ctrl+S ⇒ 拿当前会话把 A 的内容写进 B 的同路径文件；
 *   3. 保存失败时走的是"读取成功"那个回调，它无条件把 `dirty` 置 false ⇒ 改动标记消失，
 *      关标签时不再提示，"全部保存"也会跳过。
 * 把这些判断抽成纯函数，组件只负责接线；判据直接钉住上面三种形状。
 */
import { describe, it, expect } from 'vitest'
import {
  saveBlockReason,
  applySavedContent,
  applySaveFailure,
  type SaveTabShape,
} from '../../src/renderer/src/stores/editor-store'

const base: SaveTabShape = {
  content: 'line-1',
  original: 'line-1',
  loading: false,
  dirty: true,
  sessionId: 'sess-A',
}

describe('编辑器保存状态机（#235）', () => {
  it('1. 文件还在读（loading）时不许保存——那时 content 是空串，写出去就是清空远端文件', () => {
    const loadingTab: SaveTabShape = { ...base, content: '', original: '', loading: true }
    expect(saveBlockReason(loadingTab, 'sess-A', false)).toBe('loading')
  })

  it('2. 只读标签不许保存', () => {
    expect(saveBlockReason({ ...base, readOnly: true }, 'sess-A', false)).toBe('read-only')
  })

  it('3. 标签属于另一台机器时不许用当前会话保存（会把 A 的内容写进 B）', () => {
    expect(saveBlockReason(base, 'sess-B', false)).toBe('other-server')
    // 没记录归属（老标签）或当前没会话时，沿用原来的行为：允许
    expect(saveBlockReason({ ...base, sessionId: undefined }, 'sess-B', false)).toBe(null)
    expect(saveBlockReason(base, null, false)).toBe(null)
  })

  it('4. 正在保存中再按一次：不重复发请求', () => {
    expect(saveBlockReason(base, 'sess-A', true)).toBe('saving')
  })

  it('5. 没有任何改动时按保存是空操作，不算错', () => {
    expect(saveBlockReason({ ...base, dirty: false }, 'sess-A', false)).toBe('not-dirty')
  })

  it('6. 正常的"改过 + 同一台机 + 不在保存中"才放行', () => {
    expect(saveBlockReason(base, 'sess-A', false)).toBe(null)
  })

  it('7. 保存成功且期间没再输入：脏标记清掉，original 跟上', () => {
    const next = applySavedContent(base, 'line-1')
    expect(next.dirty).toBe(false)
    expect(next.original).toBe('line-1')
    expect(next.content).toBe('line-1')
  })

  it('8. 保存期间又打了字：不许把新内容回退成刚存下的那份，脏标记要留着', () => {
    const typed = { ...base, content: 'line-1\nline-2（保存中又敲的）' }
    const next = applySavedContent(typed, 'line-1')
    expect(next.content).toBe('line-1\nline-2（保存中又敲的）')
    expect(next.original).toBe('line-1')
    expect(next.dirty).toBe(true)
  })

  it('9. 保存失败：脏标记必须保留（否则关标签不再提示、全部保存也会跳过），错误原样带上', () => {
    const next = applySaveFailure(base, 'ECONNRESET')
    expect(next.dirty).toBe(true)
    expect(next.saveError).toContain('ECONNRESET')
    expect(next.content).toBe('line-1')
  })

  it('10. 保存失败不许写 error：那是"根本没读出来"的通道，写了编辑器整块换成错误面板，用户那份没存的正文就从屏上消失', () => {
    const next = applySaveFailure(base, 'EROFS: read-only file system, write')
    expect(next.error).toBeUndefined()
    expect(next.content).toBe('line-1')
  })

  it('11. 保存成功要连上一次的失败横幅一起清掉（不然存好了还挂着"保存失败"）', () => {
    const failed = applySaveFailure({ ...base, content: 'line-1 改过' }, '写入超时')
    const next = applySavedContent(failed, 'line-1 改过')
    expect(next.saveError).toBeUndefined()
    expect(next.dirty).toBe(false)
  })
})
