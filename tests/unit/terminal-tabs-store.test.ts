/**
 * 终端标签表（terminal-store 的 shells）判据
 *
 * 钉的是"标签身份不能是数组下标"这一类回归：以前 tabs 的 activeTabId 与数组位置混用，
 * 关掉中间一个会让别的标签指错终端（用户往 A 里敲的命令进了 B）。
 * 另外钉住"会话断了标签必须消失"——留着点不动的死标签比少一个标签更糟。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  useTerminalStore,
  shellTabLabel,
  visibleShells,
  type ShellKind,
  type TerminalShell,
} from '@/stores/terminal-store'

function shell(
  shellId: string,
  sessionId: string | null,
  title: string,
  openedAt: number,
  kind: ShellKind = 'ssh',
): TerminalShell {
  return { shellId, kind, sessionId, title, openedAt }
}

function state() {
  return useTerminalStore.getState()
}

beforeEach(() => {
  useTerminalStore.setState({ shells: [], activeShellId: null, pendingCommand: null, commandBlocks: null })
})

describe('终端标签表', () => {
  it('开一个终端就设为活跃；同主机的第二个标签带编号', () => {
    state().addShell(shell('a', 's1', 'web-03', 1))
    expect(state().activeShellId).toBe('a')

    state().addShell(shell('b', 's1', 'web-03', 2))
    expect(state().activeShellId).toBe('b')

    const all = state().shells
    expect(shellTabLabel(all[0], all)).toBe('web-03 · 1')
    expect(shellTabLabel(all[1], all)).toBe('web-03 · 2')
  })

  it('只有一台主机时不加编号（编号是噪声）', () => {
    state().addShell(shell('a', 's1', 'web-03', 1))
    const all = state().shells
    expect(shellTabLabel(all[0], all)).toBe('web-03')
  })

  it('关掉中间一个，其余标签的身份与顺序不变', () => {
    state().addShell(shell('a', 's1', 'A', 1))
    state().addShell(shell('b', 's1', 'B', 2))
    state().addShell(shell('c', 's2', 'C', 3))

    state().removeShell('b')
    expect(state().shells.map((s) => s.shellId)).toEqual(['a', 'c'])
    // 关掉的正是活跃标签（上面 add 把 c 设为活跃，这里显式回到 b 再关）
    state().addShell(shell('d', 's1', 'D', 4))
    state().setActiveShell('a')
    state().removeShell('a')
    expect(state().activeShellId, '关活跃标签后必须落到还活着的终端上').not.toBeNull()
    expect(state().shells.some((s) => s.shellId === state().activeShellId)).toBe(true)
  })

  it('关到最后一个时活跃指针清空（不是留在已关掉的 id 上）', () => {
    state().addShell(shell('only', 's1', 'A', 1))
    state().removeShell('only')
    expect(state().activeShellId).toBeNull()
    expect(state().shells).toEqual([])
  })

  it('会话断了，它名下的标签整批消失，别的会话不动', () => {
    state().addShell(shell('a1', 's1', 'A', 1))
    state().addShell(shell('a2', 's1', 'A', 2))
    state().addShell(shell('b1', 's2', 'B', 3))

    state().dropSession('s1')

    expect(state().shells.map((s) => s.shellId)).toEqual(['b1'])
    expect(state().activeShellId).toBe('b1')
  })

  it('dropSession 只动指定会话（注入自证：另一个会话的标签不该被顺手清掉）', () => {
    state().addShell(shell('a1', 's1', 'A', 1))
    state().addShell(shell('b1', 's2', 'B', 2))
    state().dropSession('不存在')
    expect(state().shells).toHaveLength(2)
    expect(state().shells.map((s) => s.shellId)).toEqual(['a1', 'b1'])
  })

  it('本机终端不受会话影响：连上服务器后本机标签还在', () => {
    state().addShell(shell('local1', null, '本机 · pwsh', 1, 'local'))
    state().addShell(shell('r1', 's1', 'web-03', 2))

    expect(visibleShells(state().shells, 's1').map((s) => s.shellId)).toEqual(['local1', 'r1'])
    expect(visibleShells(state().shells, 's2').map((s) => s.shellId)).toEqual(['local1'])
    expect(visibleShells(state().shells, null).map((s) => s.shellId)).toEqual(['local1'])
  })

  it('断开某条会话不会带走本机终端', () => {
    state().addShell(shell('local1', null, '本机 · pwsh', 1, 'local'))
    state().addShell(shell('r1', 's1', 'web-03', 2))
    state().dropSession('s1')
    expect(state().shells.map((s) => s.shellId)).toEqual(['local1'])
  })

  it('对账会把标题回填到已存在的标签（连接时还不知道主机名的场景）', () => {
    // 生产链路是 shell-launcher 每轮对账调 reconcileSession(会话, 主进程给的 shellIds, sessionTitle())。
    // 第一轮对账时服务器档案可能还没水合完，sessionTitle() 只能给回退名；
    // 等它认出主机名，已经挂在屏上的那个标签也得跟着改口，不能一直叫"服务器"。
    state().addShell(shell('a', 's1', '服务器', 1))
    state().reconcileSession('s1', ['a'], 'db-01', 'ssh')
    expect(state().shells.map((s) => [s.shellId, s.title])).toEqual([['a', 'db-01']])
  })

  it('标题没变时对账不换标签对象（每轮对账都不该把行重渲染一遍）', () => {
    state().addShell(shell('a', 's1', 'db-01', 1))
    const before = state().shells[0]
    state().reconcileSession('s1', ['a'], 'db-01', 'ssh')
    expect(state().shells[0]).toBe(before)
  })
})
