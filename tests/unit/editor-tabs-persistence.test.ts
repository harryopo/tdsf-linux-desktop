/**
 * 文件标签在页面重挂后不丢（2026-10-21 全维度审查 E2）
 *
 * MainLayout 用 key={pathname} 强制整页重挂；fileTabs 原先在 WorkbenchPage 的
 * useState 里，切去设置页再回来，打开的标签与未保存内容一起消失。
 * 现在放在 editor-store；顺带钉住切机保存保护（不能把 A 机内容写进 B 机）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  canSaveFileTab,
  fileTabSessionId,
  useEditorStore,
} from '@renderer/stores/editor-store'
import type { WorkbenchFileTab } from '@renderer/components/workbench/EditorArea'

function tab(over: Partial<WorkbenchFileTab> = {}): WorkbenchFileTab {
  return {
    id: 'file:/home/u/app.py',
    path: '/home/u/app.py',
    name: 'app.py',
    content: 'print(1)',
    original: 'print(0)',
    loading: false,
    dirty: true,
    ...over,
  }
}

beforeEach(() => {
  useEditorStore.setState({ fileTabs: [], activeTabId: null })
})

describe('文件标签存放在 store 里', () => {
  it('写入后从新读取（模拟组件重挂）仍在', () => {
    useEditorStore.getState().setFileTabs([tab({ sessionId: 'sA' })])
    useEditorStore.getState().setActiveTabId('file:/home/u/app.py')
    // 组件重挂只是重新订阅 store，不会重置它
    const again = useEditorStore.getState()
    expect(again.fileTabs).toHaveLength(1)
    expect(again.fileTabs[0].content).toBe('print(1)')
    expect(again.activeTabId).toBe('file:/home/u/app.py')
  })

  it('函数式更新与 useState 同型', () => {
    useEditorStore.getState().setFileTabs((prev) => [...prev, tab()])
    useEditorStore.getState().setFileTabs((prev) => prev.filter((t) => t.id !== 'file:/home/u/app.py'))
    expect(useEditorStore.getState().fileTabs).toHaveLength(0)
  })
})

describe('切机保存保护', () => {
  it('标签记的会话优先于当前会话', () => {
    expect(fileTabSessionId({ sessionId: 'sA' }, 'sB')).toBe('sA')
    expect(fileTabSessionId({}, 'sB')).toBe('sB')
    expect(fileTabSessionId({}, null)).toBeNull()
  })

  it('当前会话变了就不许保存（否则会把 A 的内容写进 B 的同名路径）', () => {
    expect(canSaveFileTab({ sessionId: 'sA' }, 'sB')).toBe(false)
    expect(canSaveFileTab({ sessionId: 'sA' }, 'sA')).toBe(true)
    // 断开状态（null）不在这里拦：保存会因会话不可用失败，错误更准确
    expect(canSaveFileTab({ sessionId: 'sA' }, null)).toBe(true)
  })
})
