/**
 * Boot IPC Handlers（M5 新增）
 *
 * 在主进程加载关键阶段向渲染层推送进度，BootPage 据此推进进度条。
 *
 * 通道：
 * - boot:loading-stage — push 通道，主进程在关键节点 emit
 *
 * 设计说明：
 * - 推送时机由主进程 index.ts 的 init 流程触发（IPC ready / SQLite init / KB indexed / done）
 * - 推送内容包含 stage 标识 + progress（0-100）+ message（中文描述）
 * - 渲染层订阅后用于推进进度条，但保留 3s 最小展示时长避免闪现
 *
 * 设计依据：M5 Task 3 · IPC 4 步同步铁律
 */

import { BrowserWindow, ipcMain } from 'electron'
import { BOOT } from '@shared/ipc-channels'
import { logger } from '../services/log/logger'

/** 加载阶段标识 */
export type BootStage = 'ipc-ready' | 'sqlite-init' | 'kb-indexed' | 'done'

/** 推送给渲染层的加载阶段 payload */
export interface BootLoadingStage {
  stage: BootStage
  progress: number
  message: string
}

/** 阶段 → 进度百分比映射（保留 3s 最小展示时长由渲染层控制） */
const STAGE_PROGRESS: Record<BootStage, { progress: number; message: string }> = {
  'ipc-ready': { progress: 30, message: '正在初始化 IPC 通道…' },
  'sqlite-init': { progress: 60, message: '正在加载本地数据库…' },
  'kb-indexed': { progress: 85, message: '正在索引知识库…' },
  done: { progress: 100, message: '就绪 · 点击进入工作台' },
}

/**
 * 向所有 BrowserWindow 推送加载阶段
 *
 * 在主进程 init 流程关键节点调用：
 * - ipc/index.ts registerAllIpcHandlers 完成后 → pushStage('ipc-ready')
 * - database.ts initDatabase 完成后 → pushStage('sqlite-init')
 * - tutorial-repo.ts 索引完成后 → pushStage('kb-indexed')
 * - 全部就绪 → pushStage('done')
 *
 * @param stage 加载阶段标识
 * @param windows 当前所有 BrowserWindow 列表
 */
export function pushBootLoadingStage(stage: BootStage, windows: BrowserWindow[]): void {
  const payload: BootLoadingStage = {
    stage,
    progress: STAGE_PROGRESS[stage].progress,
    message: STAGE_PROGRESS[stage].message,
  }
  lastStage = payload
  logger.info('IPC.BOOT', '推送启动加载阶段', {
    stage: payload.stage,
    progress: payload.progress,
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
 * 界面就永久停在"系统初始化中…"且"进入工作台"按钮点不动。
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
