/**
 * 开终端 / 关终端的唯一动作入口
 *
 * 为什么单独一个文件：以前"连接服务器"这件事在 WorkbenchTitlebar 与 SshSettings
 * 两条路径里各自 `sshShellStart(sessionId)` 一次，谁都没记账，
 * 于是同一份输出被推两遍（2026-10-10 的字符翻倍缺陷）。现在开/关终端只从这里走，
 * 界面拿到的 shellId 与 store 里的标签天然一致。
 */
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
    useTerminalStore.getState().addShell({ shellId, sessionId, title, openedAt: Date.now() })
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
  store.removeShell(shellId)
  if (!isElectronAPIAvailable() || !window.electronAPI?.sshShellClose) return false
  try {
    return await window.electronAPI.sshShellClose(shellId)
  } catch {
    return false
  }
}

/**
 * 和主进程对一次终端表（标签的唯一真值在主进程那张 Map 里）
 *
 * 为什么需要：本窗口的 store 只认识"从这个窗口点开的终端"。三种情况它一定落后——
 * ① 页面重载（store 是内存态，主进程的通道还活着）；② 另一个窗口开的终端（W4）；
 * ③ 输出先到、标签后建的竞态（terminal-bus 收到不认识的 shellId 时就来对账）。
 * 逐条会话调 sshShellList，把界面收敛成主进程的样子：多的补上、少的摘掉。
 */
export async function syncShells(): Promise<void> {
  if (!isElectronAPIAvailable()) return
  const api = window.electronAPI
  if (!api?.sshShellList) return
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
    useTerminalStore.getState().reconcileSession(sessionId, shellIds, sessionTitle(sessionId))
  }
}
