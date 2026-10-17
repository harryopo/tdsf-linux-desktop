/**
 * Boot IPC Handlers（M5 新增）
 *
 * 主进程走到哪个启动阶段就告诉渲染层一句人话，BootPage 把它显示在加载页上。
 *
 * 通道：
 * - boot:loading-stage — push 通道，主进程在关键节点 emit
 * - boot:get-state — invoke 通道，渲染层挂载晚于推送时补拉一次
 *
 * 载荷形状以 @shared/boot-types 为准（已登记进 src/shared/ipc-contract.ts）。
 * 就绪判定只看 stage === 'done'，不看百分比。
 */

import { BrowserWindow, ipcMain } from 'electron'
import { BOOT } from '@shared/ipc-channels'
import type { BootLoadingStage, BootStage } from '@shared/boot-types'
import { logger } from '../services/log/logger'

/**
 * 阶段 → 界面文案
 *
 * 文案末尾不带省略号：启动页在文字后面画了一个闪烁的块状光标来表示"还在进行"，
 * 再叠一个"…"就是两种等待符号打架。done 也不再说"点击进入工作台"——
 * 2026-10-17 起加载完自动进，界面上没有那个按钮了。
 */
const STAGE_MESSAGE: Record<BootStage, string> = {
  'ipc-ready': '正在初始化 IPC 通道',
  'sqlite-init': '正在加载本地数据库',
  'kb-indexed': '正在索引知识库',
  done: '准备就绪',
}

/**
 * 向所有 BrowserWindow 推送加载阶段
 *
 * 在主进程 init 流程关键节点调用：
 * - ipc/index.ts 注册完全部 handler → 'ipc-ready'
 * - 本地数据库就绪 → 'sqlite-init'
 * - 知识库索引就绪 → 'kb-indexed'
 * - 全部就绪 → 'done'
 *
 * @param stage 加载阶段标识
 * @param windows 当前所有 BrowserWindow 列表
 */
export function pushBootLoadingStage(stage: BootStage, windows: BrowserWindow[]): void {
  const payload: BootLoadingStage = { stage, message: STAGE_MESSAGE[stage] }
  lastStage = payload
  logger.info('IPC.BOOT', '推送启动加载阶段', {
    stage: payload.stage,
    message: payload.message,
  })
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(BOOT.LOADING_STAGE, payload)
    }
  }
}

/**
 * 最近一次推送的阶段。
 *
 * 存在的理由：主进程 init 可能比渲染层挂载快（生产构建里几乎必然），
 * 那时 fire-and-forget 的推送没有任何订阅者，BootPage 收不到 done，
 * 界面就永久停在加载页、永远不会自动进工作台。
 * 渲染层订阅之后必须还能把这一条拉回来。
 */
let lastStage: BootLoadingStage | null = null

/** 供 handler 与测试读取；未推送过时为 null */
export function getLatestBootStage(): BootLoadingStage | null {
  return lastStage
}

/** 仅测试用：回到未推送状态 */
export function __resetBootStageForTest(): void {
  lastStage = null
}

/**
 * 注册 boot 域的 invoke handler
 *
 * - BOOT.GET_STATE → 返回最近一次加载阶段（没有则 null），让渲染层补齐错过的推送
 */
export function registerBootHandlers(): void {
  ipcMain.handle(BOOT.GET_STATE, (): BootLoadingStage | null => lastStage)
  logger.info('IPC.BOOT', 'Boot IPC handlers 已注册', {
    channels: [BOOT.GET_STATE],
  })
}
