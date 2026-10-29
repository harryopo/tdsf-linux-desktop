// @vitest-environment jsdom
/**
 * 终端内容在"页面/标签切换"后不丢——判据钉在**没有卸载**上
 *
 * 用户 2026-10-26 原话："终端不会持久化，我切换别的窗口就消失之前留着的内容了"。
 * 取证到两条卸载路径：
 * 1. MainLayout 用 key={location.pathname} 包 Outlet：切监控/知识库/设置时整棵
 *    WorkbenchPage 被卸载，TerminalView 清理函数 dispose 掉 xterm，回滚缓冲陪葬；
 * 2. EditorArea 只在活动标签是 shell 时才渲染 TerminalPanel：切到文件标签同样卸载。
 *
 * 所以这里判两件事，而不是判"回放出来的字符串像不像"：
 * - 路由切走再回来，工作台组件**实例没变**（挂载 1 次、卸载 0 次、DOM 节点同一引用）；
 * - 工作台内切到文件标签再回来，TerminalView **实例没变**（同上）。
 *
 * 真实 xterm 缓冲跨导航保留另有一条 e2e（tests/e2e/terminal-persistence.spec.ts）。
 * 这里把 TerminalView 换成探针：xterm 需要 canvas/尺寸，jsdom 给不了，
 * 而"是否被卸载"是这两个 bug 的共同根因，也是本文件要守的那条线。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import EditorArea, {
  shellTabId,
  type WorkbenchFileTab,
  type WorkbenchTabId,
} from '@/components/workbench/EditorArea'
import MainLayout from '@/components/layout/MainLayout'
import { useTerminalStore } from '@/stores/terminal-store'
import { useServerStore } from '@/stores/server-store'
import { useEditorStore } from '@/stores/editor-store'

const probe = vi.hoisted(() => ({
  terminalMounts: 0,
  terminalUnmounts: 0,
  workbenchMounts: 0,
  workbenchUnmounts: 0,
}))

vi.mock('@/components/terminal/TerminalView', async () => {
  const React = await import('react')
  return {
    default: ({ shellId, visible }: { shellId: string; visible: boolean }) => {
      React.useEffect(() => {
        probe.terminalMounts += 1
        return () => {
          probe.terminalUnmounts += 1
        }
      }, [])
      return React.createElement('div', {
        'data-testid': `terminal-view-${shellId}`,
        'data-shell-id': shellId,
        'data-visible': visible ? '1' : '0',
      })
    },
  }
})

vi.mock('@/components/terminal/SelectionPopover', () => ({ default: () => null }))
vi.mock('@/components/layout/DbDegradedBanner', () => ({ DbDegradedBanner: () => null }))
vi.mock('@/dock/permission-bar', () => ({ PermissionBar: () => null }))
vi.mock('@/shell/activity-rail', () => ({ ActivityRail: () => null }))

// 工作台页面本体换成探针：这里判的是 MainLayout 有没有把它卸载，不是工作台内部长什么样
vi.mock('@/pages/WorkbenchPage', async () => {
  const React = await import('react')
  return {
    WorkbenchPage: ({ active = true }: { active?: boolean }) => {
      React.useEffect(() => {
        probe.workbenchMounts += 1
        return () => {
          probe.workbenchUnmounts += 1
        }
      }, [])
      return React.createElement('div', {
        'data-testid': 'workbench-probe',
        'data-active': active ? '1' : '0',
      })
    },
  }
})

const SHELL_ID = 'shell-e2e-local'
const FILE_TAB: WorkbenchFileTab = {
  id: 'file:/tmp/note.txt',
  path: '/tmp/note.txt',
  name: 'note.txt',
  content: '',
  original: '',
  // loading=true：文件面板走加载态，不必在 jsdom 里拉 Monaco
  loading: true,
  dirty: false,
}

beforeEach(() => {
  probe.terminalMounts = 0
  probe.terminalUnmounts = 0
  probe.workbenchMounts = 0
  probe.workbenchUnmounts = 0
  useTerminalStore.setState({
    shells: [
      { shellId: SHELL_ID, kind: 'local', sessionId: null, title: '本机', openedAt: 1 },
    ],
    activeShellId: SHELL_ID,
    pendingCommand: null,
    commandBlocks: null,
  })
  useServerStore.setState({ activeSessionId: null })
  useEditorStore.setState({ fileTabs: [], activeTabId: null })
})

/** 受控壳：让测试像用户一样点标签切来切去 */
function EditorHarness(): ReactElement {
  const [activeTabId, setActiveTabId] = useState<WorkbenchTabId>(shellTabId(SHELL_ID))
  return (
    <MemoryRouter>
      <EditorArea
        activeTabId={activeTabId}
        onTabChange={setActiveTabId}
        fileTabs={[FILE_TAB]}
        onFileLoaded={() => {}}
      />
    </MemoryRouter>
  )
}

describe('工作台内标签切换：终端实例不重建', () => {
  it('切到文件标签再切回来，TerminalView 仍是同一个节点（缓冲没有随卸载丢掉）', () => {
    render(<EditorHarness />)

    const terminalBefore = screen.getByTestId(`terminal-view-${SHELL_ID}`)
    expect(probe.terminalMounts).toBe(1)

    // 用户点文件标签
    fireEvent.click(screen.getByRole('tab', { name: /note\.txt/ }))
    // 终端槽只是被藏起来，没有被卸载
    expect(screen.getByTestId(`terminal-view-${SHELL_ID}`)).toBe(terminalBefore)
    expect(probe.terminalMounts).toBe(1)
    expect(probe.terminalUnmounts).toBe(0)
    // 藏起来的时候 xterm 的 visible 是 false（回来时会重算行列 + 重画）
    expect(terminalBefore.getAttribute('data-visible')).toBe('0')

    // 切回终端标签
    fireEvent.click(screen.getByRole('tab', { name: /本机/ }))
    expect(screen.getByTestId(`terminal-view-${SHELL_ID}`)).toBe(terminalBefore)
    expect(probe.terminalMounts).toBe(1)
    expect(terminalBefore.getAttribute('data-visible')).toBe('1')
  })

  it('关掉终端标签时仍然真的卸载并 dispose（保活不包庇已关闭的会话）', () => {
    render(<EditorHarness />)
    expect(probe.terminalMounts).toBe(1)

    act(() => {
      useTerminalStore.getState().removeShell(SHELL_ID)
    })

    expect(screen.queryByTestId(`terminal-view-${SHELL_ID}`)).toBeNull()
    expect(probe.terminalUnmounts).toBe(1)
  })
})

/** 应用内导航的按钮（真实 ActivityRail 被 mock 掉了） */
function RouteProbe(): ReactElement {
  const navigate = useNavigate()
  return (
    <div>
      <button type="button" onClick={() => navigate('/monitor')}>
        go-monitor
      </button>
      <button type="button" onClick={() => navigate('/workbench')}>
        go-workbench
      </button>
    </div>
  )
}

describe('应用内导航：工作台常驻，不随路由卸载', () => {
  it('工作台 ↔ 监控来回切，工作台实例与隐藏层都保持挂载', async () => {
    render(
      <MemoryRouter initialEntries={['/workbench']}>
        <RouteProbe />
        <Routes>
          <Route element={<MainLayout />}>
            {/* 与真实 router 一致：工作台本体在 MainLayout，路由只留一个占位 element */}
            <Route path="workbench" element={<span data-testid="workbench-route-slot" />} />
            <Route path="monitor" element={<div data-testid="monitor-page" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    const workbenchBefore = await screen.findByTestId('workbench-probe')
    expect(probe.workbenchMounts).toBe(1)
    expect(workbenchBefore.getAttribute('data-active')).toBe('1')

    // 切去监控：监控页出现，工作台只被 display:none
    fireEvent.click(screen.getByRole('button', { name: 'go-monitor' }))
    expect(screen.getByTestId('monitor-page')).toBeTruthy()
    expect(screen.getByTestId('workbench-probe')).toBe(workbenchBefore)
    expect(workbenchBefore.getAttribute('data-active')).toBe('0')
    expect(probe.workbenchMounts).toBe(1)
    expect(probe.workbenchUnmounts).toBe(0)
    expect(workbenchBefore.closest('.wb-route-pane')?.className).toContain('wb-route-pane-hidden')

    // 切回工作台：同一个实例回来，并拿到 active=true（终端据此重画）
    fireEvent.click(screen.getByRole('button', { name: 'go-workbench' }))
    expect(screen.getByTestId('workbench-probe')).toBe(workbenchBefore)
    expect(workbenchBefore.getAttribute('data-active')).toBe('1')
    expect(probe.workbenchMounts).toBe(1)
    expect(probe.workbenchUnmounts).toBe(0)
    expect(workbenchBefore.closest('.wb-route-pane')?.className).not.toContain(
      'wb-route-pane-hidden',
    )
  })
})
