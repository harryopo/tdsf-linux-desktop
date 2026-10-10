/**
 * 应用窗口 IPC Handlers（W4：真·第二个窗口）
 *
 * 只暴露一个动作：再开一个窗口。第二窗口与主窗口跑同一份渲染层、同一套 preload，
 * 终端标签靠渲染层与主进程的对账（syncShells）自动出现，所以这里不需要
 * "窗口之间同步状态"的协议——主进程那张 shell 表就是唯一事实。
 *
 * 故意不提供 close/focus/枚举：那等于让一个窗口去动另一个窗口的东西。
 */
import { ipcMain } from 'electron'
import { WINDOW } from '@shared/ipc-channels'
import { createSecondaryWindow, getAppWindows } from '../windows/main-window'
import { logger } from '../services/log/logger'

/** 注册窗口相关通道（无长生命周期订阅，因此不需要返回卸载函数） */
export function registerAppWindowHandlers(): void {
  ipcMain.handle(WINDOW.OPEN_SECONDARY, () => {
    try {
      createSecondaryWindow()
    } catch (err) {
      // 开窗口失败要抛回界面，不能只留一行日志：用户点了"新建窗口"必须知道成没成
      logger.error('APP', '创建第二窗口失败', { error: (err as Error).message })
      throw new Error(`新建窗口失败：${(err as Error).message}`)
    }
    return getAppWindows().length
  })
}
