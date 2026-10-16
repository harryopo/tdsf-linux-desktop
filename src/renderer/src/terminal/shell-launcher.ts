/**
 * 开终端 / 关终端的唯一动作入口
 *
 * 为什么单独一个文件：以前"连接服务器"这件事在 WorkbenchTitlebar 与 SshSettings
 * 两条路径里各自 `sshShellStart(sessionId)` 一次，谁都没记账，
 * 于是同一份输出被推两遍（2026-10-10 的字符翻倍缺陷）。现在开/关终端只从这里走，
 * 界面拿到的 shellId 与 store 里的标签天然一致。
 */
import type { TerminalShell } from '../stores/terminal-store'
import { isElectronAPIAvailable } from '../utils/electron-api'
import { useServerStore } from '../stores/server-store'
import { useTerminalStore } from '../stores/terminal-store'

/** 开/关终端的结果：失败时带原因，调用方必须把原因显示出来，不许静默 */
export type ShellResult = { ok: true; shellId: string } | { ok: false; reason: string }

/** 主机名或"服务器"——标签标题的唯一算法（两处自己拼就会写出两种样子） */
export function shellTitleOf(hostOrName: string | undefined): string {
  const name = (hostOrName ?? '').trim()
  return name || '服务器'
}

/**
 * 该会话对应的服务器名
 *
 * sessionMap 是 serverId → sessionId，所以这里反查一次。
 * 三处要标题的地方（+ 按钮、两条"连接服务器"路径）都从这里拿，
 * 免得同一台主机在标签上写出三个名字。
 */
export function sessionTitle(sessionId: string): string {
  const { sessionMap, servers } = useServerStore.getState()
  const serverId = Object.keys(sessionMap).find((id) => sessionMap[id] === sessionId)
  const server = serverId ? servers.find((s) => s.id === serverId) : undefined
  return shellTitleOf(server?.name ?? server?.host)
}

/**
 * 在该会话上新开一个终端（同一条连接开第二个 shell）
 */
export async function openShell(sessionId: string, title: string): Promise<ShellResult> {
  if (!isElectronAPIAvailable()) {
    return { ok: false, reason: '桌面桥不可用，无法开终端' }
  }
  const api = window.electronAPI
  if (!api?.sshShellStart) {
    return { ok: false, reason: '当前构建没有 sshShellStart，请重启应用' }
  }
  try {
    const shellId = await api.sshShellStart(sessionId)
    useTerminalStore.getState().addShell({ shellId, kind: 'ssh', sessionId, title, openedAt: Date.now() })
    return { ok: true, shellId }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * "连接服务器"用的那个语义：这台主机已经有终端就把它设为活跃，不要再开一个
 *
 * 与 openShell 的区别就是这一句判断——没有它，多点几次连接会攒出一排指向
 * 同一台主机的空终端标签。
 */
export async function ensureShellForSession(
  sessionId: string,
  title: string,
): Promise<ShellResult> {
  const store = useTerminalStore.getState()
  const existing = store.shells.find((s) => s.sessionId === sessionId)
  if (existing) {
    store.setActiveShell(existing.shellId)
    return { ok: true, shellId: existing.shellId }
  }
  return openShell(sessionId, title)
}

/**
 * 关闭一个终端：先问主进程（它要 end 通道），再从标签表里移除
 *
 * 主进程失败也要移除标签：那条通道已经没法再写，留着一个点不动的标签
 * 比"少了个标签"更糟。返回值只说明主进程那侧有没有真的关掉。
 */
export async function closeShell(shellId: string): Promise<boolean> {
  const store = useTerminalStore.getState()
  const kind = store.shells.find((s) => s.shellId === shellId)?.kind ?? 'ssh'
  store.removeShell(shellId)
  if (!isElectronAPIAvailable()) return false
  const api = window.electronAPI
  const call = kind === 'local' ? api?.localTtyClose : api?.sshShellClose
  if (!call) return false
  try {
    return await call.call(api, shellId)
  } catch {
    return false
  }
}

/** 本机终端可用性（与 ipc-contract 里 localTtyStatus 的返回同形） */
export interface LocalTtyStatus {
  available: boolean
  reason: string | null
  shellPath: string | null
}

/** 本机终端的可用性（问一次缓存着；主进程那边不会中途装上 node-pty） */
let localStatusCache: LocalTtyStatus | null = null

export async function getLocalShellStatus(): Promise<LocalTtyStatus> {
  if (localStatusCache) return localStatusCache
  if (!isElectronAPIAvailable() || !window.electronAPI?.localTtyStatus) {
    return { available: false, reason: '当前环境不支持本机终端（非 Electron 环境）', shellPath: null }
  }
  try {
    localStatusCache = await window.electronAPI.localTtyStatus()
  } catch (err) {
    localStatusCache = {
      available: false,
      reason: err instanceof Error ? err.message : String(err),
      shellPath: null,
    }
  }
  return localStatusCache
}

/** 本机终端的标签名：用 shell 的文件名，两个本机终端时要能分清是哪个 */
export function localShellTitle(status: LocalTtyStatus): string {
  const file = (status.shellPath ?? '').split(/[\\/]/).pop() ?? ''
  return file ? `本机 · ${file.replace(/\.exe$/i, '')}` : '本机终端'
}

/**
 * 开一条本机终端（不连 SSH 也能敲命令）
 *
 * node-pty 装不上的平台（部分 Linux）走这里会拿到明确原因，
 * 调用方必须把 reason 显示出来——静默点了没反应是最难查的那种坏。
 */
export async function openLocalShell(): Promise<ShellResult> {
  if (!isElectronAPIAvailable() || !window.electronAPI?.localTtyStart) {
    return { ok: false, reason: '当前环境不支持本机终端（非 Electron 环境）' }
  }
  const status = await getLocalShellStatus()
  if (!status.available) return { ok: false, reason: status.reason ?? '本机终端不可用' }
  try {
    const shellId = await window.electronAPI.localTtyStart()
    useTerminalStore
      .getState()
      .addShell({
        shellId,
        kind: 'local',
        sessionId: null,
        title: localShellTitle(status),
        openedAt: Date.now(),
      })
    return { ok: true, shellId }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 把一条代写命令投进"该去的那个终端"
 *
 * 顺序：当前活跃终端（本机或远端都算）→ 当前 SSH 会话上顺手开一个 → 开一条本机终端。
 * 用户点的是"在终端执行"，先让他去找按钮是把成本推回去；
 * 而"先连一台服务器才能用 AI 执行"对练本机命令的人来说是无妄之灾。
 */
export async function resolveShellForCommand(
  sessionId: string | null,
): Promise<{ ok: true; shell: TerminalShell } | { ok: false; reason: string }> {
  const store = useTerminalStore.getState()
  const active = store.shells.find((s) => s.shellId === store.activeShellId)
  if (active) return { ok: true, shell: active }
  if (sessionId) {
    const opened = await ensureShellForSession(sessionId, sessionTitle(sessionId))
    if (opened.ok) {
      const shell = useTerminalStore.getState().shells.find((s) => s.shellId === opened.shellId)
      if (shell) return { ok: true, shell }
      return { ok: false, reason: '终端已打开但界面没记上，请重开一个终端' }
    }
    return { ok: false, reason: opened.reason }
  }
  const local = await openLocalShell()
  if (!local.ok) return { ok: false, reason: local.reason }
  const shell = useTerminalStore.getState().shells.find((s) => s.shellId === local.shellId)
  if (!shell) return { ok: false, reason: '终端已打开但界面没记上' }
  return { ok: true, shell }
}

/** 把整条代写命令交给主进程（它会先过风险闸）；本机与远端各自走自己的通道 */
export async function runAuthoredInShell(
  shell: TerminalShell,
  command: string,
): Promise<void> {
  const api = window.electronAPI
  if (shell.kind === 'local') {
    if (!api?.localTtyRunAuthored) throw new Error('当前环境不支持本机终端执行')
    await api.localTtyRunAuthored(shell.shellId, command)
    return
  }
  if (!api?.sshRunAuthored) throw new Error('当前环境不支持终端执行（非 Electron 环境）')
  await api.sshRunAuthored(shell.shellId, command)
}

/**
 * 和主进程对一次终端表（标签的唯一真值在主进程那张 Map 里）
 *
 * 为什么需要：本窗口的 store 只认识"从这个窗口点开的终端"。三种情况它一定落后——
 * ① 页面重载（store 是内存态，主进程的通道还活着）；② 另一个窗口开的终端（W4）；
 * ③ 输出先到、标签后建的竞态（terminal-bus 收到不认识的 shellId 时就来对账）。
 * 逐条会话调 sshShellList，把界面收敛成主进程的样子：多的补上、少的摘掉。
 */
/**
 * 对账轮次号
 *
 * syncShells 会被好几处同时叫到（页面挂载、终端总线收到不认识的 shellId、断开清理），
 * 而 IPC 的响应顺序不等于出发顺序。谁最后落账，界面就是谁的形状。
 */
let syncIssued = 0
let syncApplied = 0

export async function syncShells(): Promise<void> {
  if (!isElectronAPIAvailable()) return
  const api = window.electronAPI
  if (!api?.sshShellList) return
  const round = ++syncIssued
  const { sessionMap, activeSessionId } = useServerStore.getState()
  const sessionIds = new Set<string>(Object.values(sessionMap))
  if (activeSessionId) sessionIds.add(activeSessionId)
  for (const sessionId of sessionIds) {
    let shellIds: string[]
    try {
      shellIds = await api.sshShellList(sessionId)
    } catch {
      // 单条会话问不到就跳过：可能是刚刚断开的，它的标签由 dropSession 负责摘
      continue
    }
    // 手里这份是过期快照（有更新的一轮已经落过账）就整轮作废：
    // 拿"过去某一秒主进程有哪些通道"去删现在的标签，会让还活着的终端凭空消失
    if (round < syncApplied) return
    syncApplied = round
    useTerminalStore
      .getState()
      .reconcileSession(sessionId, shellIds, sessionTitle(sessionId), 'ssh')
  }

  // 本机终端同样要认账：页面重载后主进程那边的 PTY 还在，标签却没了
  if (api.localTtyList && api.localTtyStatus) {
    try {
      const [ids, status] = await Promise.all([api.localTtyList(), api.localTtyStatus()])
      if (round < syncApplied) return
      syncApplied = round
      useTerminalStore
        .getState()
        .reconcileSession(null, ids, localShellTitle(status), 'local')
    } catch {
      // node-pty 不可用的平台上这条本来就没有终端，跳过即可
    }
  }
}
