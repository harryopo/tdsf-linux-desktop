/**
 * SSH 连接状态推送的全局订阅
 *
 * 主进程在心跳失败/重连/最终断开时广播 `ssh:state-changed`，preload 也早就
 * 暴露了 `onSshStateChanged`，但渲染层此前 0 个订阅者——远端断链后状态栏
 * 仍显示「SSH已连接」，用户会继续往死通道里敲命令（2026-10-21 全维度审查 E1）。
 *
 * 订阅和 Agent 流式事件一样提升到应用入口：组件挂载/卸载不影响状态机。
 * 只改颜色与文案，不在这里清 sessionMap / 终端标签——那会把"断线"演成"消失"，
 * 用户还需要看到原终端内容决定是否重连。
 */
import { useServerStore } from './server-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'

let subscribed = false

export function initSshStateSubscription(): void {
  if (subscribed) return
  if (!isElectronAPIAvailable() || !window.electronAPI.onSshStateChanged) return
  subscribed = true
  window.electronAPI.onSshStateChanged((event) => {
    const next = event.state === 'reconnecting' ? 'connecting' : 'error'
    useServerStore.getState().setConnectionState(event.serverId, next)
  })
}
