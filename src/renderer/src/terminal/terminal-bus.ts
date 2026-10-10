/**
 * terminal-bus —— terminal:data 在本窗口的唯一订阅点
 *
 * 要解决的问题：主进程推输出的时机和 xterm 视图挂上的时机本来就对不上。
 * 开一条终端到 TerminalView 的 useEffect 真正注册监听，中间隔着「IPC 返回 →
 * 写进 store → React 渲染 → effect」这么几帧，而远端的开场输出（MOTD、第一条
 * 回显）就在这几毫秒里发完了。以前 TerminalView 各自订阅 IPC，那段时间的字节
 * 直接丢掉 —— 屏幕上从第二条命令开始才有内容，命令块也少一块。
 *
 * 所以总线在 App 启动时装好唯一一个 IPC 订阅：
 * - 有人订阅（视图挂着）→ 直接转发；
 * - 没人订阅 → 按 shellId 暂存，视图挂上时一次性补写；
 * - 暂存的 shellId 在 store 里查无此终端 → 这终端不是本窗口点开的
 *   （另一个窗口 / 页面重载前 / 测试直接走 IPC），去主进程对账把标签补出来。
 *
 * IPC 事件订阅只在这里发生一次，不在组件里反复 on/off
 * （W0 的教训：订阅叠加等于同一份输出被写两遍）。
 */
import { isElectronAPIAvailable } from '../utils/electron-api'
import { useTerminalStore } from '../stores/terminal-store'
import { syncShells } from './shell-launcher'
import { logger } from '../utils/logger'

/** 某个终端的输出回调（TerminalView 用它往 xterm 写） */
type Handler = (data: string) => void

/** shellId → 实时订阅者 */
const handlers = new Map<string, Set<Handler>>()
/** 无人订阅时暂存的输出分片 */
const buffered = new Map<string, string[]>()
/** shellId → 已暂存的字符数（与 buffered 同步增删；长度是 UTF-16 长度，不是字节） */
const bufferedChars = new Map<string, number>()

/**
 * 单个终端最多暂存多少字符。超出就丢最早的分片，保尾弃头：
 * 终端要看的是最近在跑什么，而切掉中间一段最多让一块命令块解析不出来，
 * 比整块屏幕空白好。
 */
const BUFFER_CAP_CHARS = 512 * 1024

/** 对账去抖：一段时间内来多少个未知 shellId 都只问主进程一次 */
const SYNC_DEBOUNCE_MS = 120

/** 是否已装好（装第二次是 no-op，StrictMode 双跑 effect 也不会叠订阅） */
let installed = false
let syncTimer: ReturnType<typeof setTimeout> | null = null

/** 收到一段输出：有人听就转发，没人听就暂存 */
function dispatch(shellId: string, data: string): void {
  const set = handlers.get(shellId)
  if (set && set.size > 0) {
    for (const handler of set) handler(data)
    return
  }

  const chunks = buffered.get(shellId)
  if (chunks) chunks.push(data)
  else buffered.set(shellId, [data])
  let chars = (bufferedChars.get(shellId) ?? 0) + data.length
  bufferedChars.set(shellId, chars)
  while (chars > BUFFER_CAP_CHARS) {
    const list = buffered.get(shellId)
    if (!list || list.length <= 1) break
    const dropped = list.shift() ?? ''
    chars -= dropped.length
    bufferedChars.set(shellId, chars)
  }

  const known = useTerminalStore.getState().shells.some((s) => s.shellId === shellId)
  if (!known) queueSync()
}

function queueSync(): void {
  if (syncTimer) return
  syncTimer = setTimeout(() => {
    syncTimer = null
    void syncShells().catch((err: unknown) => {
      logger.warn('Terminal', '终端标签与主进程对账失败', { err: String(err) })
    })
  }, SYNC_DEBOUNCE_MS)
}

/**
 * 装上总线（App 启动时调一次）
 *
 * 必须在任何终端开出来之前装好，否则开场输出还是没人接。
 * 非 Electron 环境（单测、浏览器预览）里是 no-op：没人推，也就没什么可接。
 */
export function installTerminalBus(): void {
  if (installed || !isElectronAPIAvailable()) return
  const api = window.electronAPI
  if (!api?.onTerminalData) return
  installed = true
  api.onTerminalData((shellId: string, data: string) => {
    dispatch(shellId, data)
  })
}

/**
 * 订阅某个终端的输出，并把之前暂存的先补给它
 *
 * 返回退订函数。退订只摘订阅者、不清暂存 —— 切标签时视图会重建，
 * 那段时间的输出还得能补上。
 */
export function subscribeShellData(shellId: string, handler: Handler): () => void {
  let set = handlers.get(shellId)
  if (!set) {
    set = new Set<Handler>()
    handlers.set(shellId, set)
  }
  set.add(handler)

  const chunks = buffered.get(shellId)
  if (chunks && chunks.length > 0) {
    buffered.delete(shellId)
    bufferedChars.delete(shellId)
    handler(chunks.join(''))
  }

  return () => {
    const current = handlers.get(shellId)
    if (!current) return
    current.delete(handler)
    if (current.size === 0) handlers.delete(shellId)
  }
}
