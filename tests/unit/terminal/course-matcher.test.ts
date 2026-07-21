/**
 * CourseMatcher 单元测试
 */
import { describe, it, expect } from 'vitest'
import { getCourseHint, guessCourseByWord, COURSE_CHAPTERS } from '../../../src/renderer/src/utils/course-matcher'
import { translate, loadDict } from '../../../src/renderer/src/components/terminal/translator'

describe('course-matcher.getCourseHint', () => {
  it('应返回 grep 的课程关联', () => {
    const result = translate('grep', loadDict())
    const hint = getCourseHint(result)
    expect(hint).not.toBe(null)
    expect(hint?.chapterId).toBe('ch07-text')
    expect(hint?.title).toContain('文本处理')
  })

  it('应返回 ls 的课程关联', () => {
    const result = translate('ls', loadDict())
    const hint = getCourseHint(result)
    expect(hint?.chapterId).toBe('ch03-files')
  })

  it('无关联词条应返回 null', () => {
    const result = translate('file', loadDict())
    const hint = getCourseHint(result)
    // file 没有 courseChapter 字段
    expect(hint).toBe(null)
  })
})

describe('course-matcher.guessCourseByWord', () => {
  it('文件操作应映射到 ch03', () => {
    expect(guessCourseByWord('ls')).toBe('ch03-files')
    expect(guessCourseByWord('cat')).toBe('ch03-files')
  })

  it('网络命令应映射到 ch08', () => {
    expect(guessCourseByWord('ping')).toBe('ch08-network')
    expect(guessCourseByWord('curl')).toBe('ch08-network')
  })

  it('大小写不敏感', () => {
    expect(guessCourseByWord('LS')).toBe('ch03-files')
  })

  it('未知词应返回 null', () => {
    expect(guessCourseByWord('xyzabc123')).toBe(null)
  })
})

describe('course-matcher.COURSE_CHAPTERS', () => {
  it('至少包含 10 个章节', () => {
    expect(Object.keys(COURSE_CHAPTERS).length).toBeGreaterThanOrEqual(10)
  })

  it('章节顺序从 1 开始递增', () => {
    const orders = Object.values(COURSE_CHAPTERS).map(c => c.order).sort((a, b) => a - b)
    expect(orders[0]).toBe(1)
  })
})
