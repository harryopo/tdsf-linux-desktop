/**
 * 终端状态管理 Store（Zustand）
 *
 * 职责：
 * - 管理本机这一窗口的终端列表（每条 = 主进程里一个 shell 通道）
 * - 跟踪当前活跃的终端（AI 面板与决策页"投进终端"用的就是这个指针）
 * - 命令块摘要与 AI 注入命令的预测回显（状态栏与回显条消费）
 *
 * 为什么不持久化：终端标签是"这一次会话里开着的通道"，重启后主进程里那些
 * ssh2 通道早没了，存标签等于存一堆点不动的按钮。服务器配置与凭据由
 * server-store / SecureStore 负责，那才是该活过重启的东西。
 *
 * 历史坑（2026-10-10 清掉）：这里曾有 addTab / removeTab / closeOtherTabs 三个动作
 * 配一个 tabs 数组，全仓零调用，TerminalTabs.css 也只有样式没有组件——
 * "看着像有多标签，其实一条连接只有一个终端"。现在 shellId 是真的：
 * 主进程按 shellId 分发输出，这一份表就是它的界面投影。
 */
import { create } from 'zustand'

/** 终端跑在哪里：本机 PTY（W3）还是 SSH 远端 */
export type ShellKind = 'local' | 'ssh'

/** 一个打开中的终端（对应主进程的一条 shell 通道） */
export interface TerminalShell {
  /** 主进程发的通道 ID（terminal:data 按它路由，本机与远端共用这套身份） */
  shellId: string
  /** 本机终端还是远端终端：决定写入与"代写命令"走哪条通道 */
  kind: ShellKind
  /** 远端终端所属 SSH 会话；本机终端为 null */
  sessionId: string | null
  /** 标签上显示的名字（通常是主机名，本机终端是 shell 名） */
  title: string
  /** 打开时间戳（同主机多个终端按它编号显示"终端 2"） */
  openedAt: number
}

/** AI 注入命令的预测回显记录（v2.5：终端顶部回显条） */
export interface PendingCommand {
  /** 完整命令文本 */
  command: string
  /** 发送时间戳（用于自动消隐） */
  sentAt: number
}

/** 命令块摘要（terminal/block-model 的对外投影，状态栏与 AI 上下文都读它） */
export interface CommandBlockSummary {
  /** 已切出的命令块总数 */
  count: number
  /** 最近一条有原文的命令 */
  lastCommand: string | null
  /** 最近一条已完成命令的退出码；null = 还没拿到 */
  lastExitCode: number | null
  /** 给 AI 的多行摘要（最近若干条命令 + 成败）；无历史时为空串 */
  context: string
}

/** 终端 Store 状态接口 */
interface TerminalState {
  /** 打开中的终端列表（打开顺序） */
  shells: TerminalShell[]
  /** 当前活跃终端；null = 一个都没开 */
  activeShellId: string | null

  // ===== Actions =====
  /** 记录一条新开的终端并把它设为活跃 */
  addShell: (shell: TerminalShell) => void
  /** 移除一条终端（关标签 / 主进程报通道已关闭）；活跃指针跟着回退 */
  removeShell: (shellId: string) => void
  /** 设为活跃终端 */
  setActiveShell: (shellId: string) => void
  /** 整条会话没了：把它名下所有终端一次摘掉（不能留点不动的死标签） */
  dropSession: (sessionId: string) => void
  /** 与主进程对账：以主进程给的 shellIds 为准增删这一组标签，并把标题回填到这一组上，不抢当前焦点
   *
   * kind='ssh' 时 sessionId 是那条 SSH 会话；kind='local' 时传 null（本机终端不分会话）。
   * 标题每次对账都重刷：第一次对账时服务器档案可能还没水合完，
   * sessionTitle() 只能给回退名，等它认出主机名时已存在的标签也得跟着改口。
   */
  reconcileSession: (
    sessionId: string | null,
    shellIds: string[],
    title: string,
    kind: ShellKind,
  ) => void

  /** 最近一条 AI 注入命令（预测回显条数据源，v2.5） */
  pendingCommand: PendingCommand | null
  /** 登记/清除 AI 注入命令 */
  setPendingCommand: (cmd: PendingCommand | null) => void
  /** 命令块摘要（OSC 133/633 切块结果，状态栏与 AI 上下文消费） */
  commandBlocks: CommandBlockSummary | null
  /** 写入命令块摘要 */
  setCommandBlocks: (summary: CommandBlockSummary | null) => void
}

/** 终端 Store */
export const useTerminalStore = create<TerminalState>()((set) => ({
  shells: [],
  activeShellId: null,

  addShell: (shell) =>
    set((state) => ({
      shells: [...state.shells, shell],
      activeShellId: shell.shellId,
    })),

  removeShell: (shellId) =>
    set((state) => {
      const shells = state.shells.filter((s) => s.shellId !== shellId)
      // 关掉的正是活跃终端时，回退到最后一条；一个不剩就是 null
      const activeShellId =
        state.activeShellId !== shellId
          ? state.activeShellId
          : (shells[shells.length - 1]?.shellId ?? null)
      return { shells, activeShellId }
    }),

  setActiveShell: (shellId) => set({ activeShellId: shellId }),

  dropSession: (sessionId) =>
    set((state) => {
      const shells = state.shells.filter((s) => s.sessionId !== sessionId)
      const stillThere = shells.some((s) => s.shellId === state.activeShellId)
      return {
        shells,
        activeShellId: stillThere ? state.activeShellId : (shells[shells.length - 1]?.shellId ?? null),
      }
    }),

  reconcileSession: (sessionId, shellIds, title, kind) =>
    set((state) => {
      const wanted = new Set(shellIds)
      const known = new Set(state.shells.map((s) => s.shellId))
      const now = Date.now()
      // 别的会话的标签原样留着；本会话的按主进程那份表增删，并把标题刷新一遍
      // （只在真的变了时才换对象，没变的一律沿用原引用，免得标签行白白重渲染）
      const kept = state.shells
        .filter((s) => s.sessionId !== sessionId || wanted.has(s.shellId))
        .map((s) => (s.sessionId === sessionId && s.title !== title ? { ...s, title } : s))
      const added: TerminalShell[] = shellIds
        .filter((shellId) => !known.has(shellId))
        .map((shellId) => ({ shellId, kind, sessionId, title, openedAt: now }))
      const shells = [...kept, ...added]
      // 只在"原来的活跃终端没了"时才改指针：别的会话后台开了终端不该把人从当前标签上拽走
      const stillThere = shells.some((s) => s.shellId === state.activeShellId)
      return {
        shells,
        activeShellId: stillThere
          ? state.activeShellId
          : (shells[shells.length - 1]?.shellId ?? null),
      }
    }),

  pendingCommand: null,
  setPendingCommand: (cmd) => set({ pendingCommand: cmd }),

  commandBlocks: null,
  setCommandBlocks: (summary) => set({ commandBlocks: summary }),
}))

/**
 * 这一屏该显示哪些终端标签
 *
 * 本机终端（kind='local'）永远在：它不属于任何 SSH 会话，连上服务器之后
 * 把本机的终端从标签条上抹掉是莫名其妙的事。远端终端按当前会话过滤。
 */
export function visibleShells(shells: TerminalShell[], activeSessionId: string | null): TerminalShell[] {
  return shells.filter((s) => s.kind === 'local' || s.sessionId === activeSessionId)
}

/**
 * 标签显示名：同一台主机开第二个终端时补编号，
 * 否则两个都叫"web-03"，用户分不清往哪个敲命令。
 */
export function shellTabLabel(shell: TerminalShell, all: TerminalShell[]): string {
  const sameSession = all.filter((s) => s.sessionId === shell.sessionId)
  if (sameSession.length <= 1) return shell.title
  const index = sameSession
    .slice()
    .sort((a, b) => a.openedAt - b.openedAt)
    .findIndex((s) => s.shellId === shell.shellId)
  return `${shell.title} · ${index + 1}`
}
