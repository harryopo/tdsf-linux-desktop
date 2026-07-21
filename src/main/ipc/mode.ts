/**
 * Mode IPC Handlers（v0.9.5 P0 - 组 2 新增）
 *
 * 注册 v0.9.5 引入的五模式切换相关 IPC 通道。
 *
 * 通道命名规范（与 IpcChannelMap 对应，方案书 §11.2）：
 * - mode:list        — 列出所有可用 mode 配置（不含 systemPrompt，避免泄露）
 * - mode:set-default — 设置当前默认 mode
 * - mode:get-current — 返回当前默认 mode
 *
 * 与现有 mode-registry.ts 的关系：
 * - mode-registry.ts 提供 MODE_CONFIGS / getModeConfig / isValidMode / getAllowedTools / getCurrentMode / setCurrentMode
 * - 本文件仅做 IPC 包装：调用 mode-registry 函数，返回 IPC 友好的响应类型
 * - 不修改 mode-registry.ts 的现有函数签名（仅在 v0.9.5 新增 getCurrentMode / setCurrentMode）
 *
 * 设计要点：
 * - mode:list 返回 ModeInfo[]（不含 systemPrompt，避免泄露内部 prompt 模板）
 * - mode:set-default 入参用 isValidMode 类型守卫防御非法值
 * - mode:get-current 返回 ModeCurrentResponse（含 displayName，便于 UI 直接渲染）
 *
 * 方案书依据：v0.9.5 §UI接入接线图（5 组 P0 级缺失 IPC - 组 2：五模式切换）
 */

import { ipcMain } from 'electron'
import {
  MODE_CONFIGS,
  isValidMode,
  getCurrentMode,
  setCurrentMode,
  getAllModes,
} from '../core/agent/modes/mode-registry'
import type {
  AgentMode,
  ModeInfo,
  ModeListResponse,
  ModeSetDefaultRequest,
  ModeSetDefaultResponse,
  ModeCurrentResponse,
} from '@shared/agent-types'
import { logger } from '../services/log/logger'

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 将 ModeConfig 转换为 ModeInfo（剔除 systemPrompt 字段）
 *
 * ModeConfig 是 main 内部使用的完整配置（含 systemPrompt），
 * ModeInfo 是 IPC 传输用的精简配置（不含 systemPrompt，避免泄露内部 prompt 模板）。
 *
 * @param mode AgentMode
 * @returns ModeInfo（不含 systemPrompt）
 */
function toModeInfo(mode: AgentMode): ModeInfo {
  const config = MODE_CONFIGS[mode]
  return {
    name: config.mode,
    displayName: config.displayName,
    description: config.description,
    allowedTools: [...config.allowedTools],
  }
}

// ============================================================================
// IPC Handler 注册
// ============================================================================

/**
 * 注册 Mode IPC handlers
 *
 * 注册以下通道：
 * - mode:list        — 列出所有可用 mode 配置
 * - mode:set-default — 设置当前默认 mode
 * - mode:get-current — 返回当前默认 mode
 *
 * IPC 4 步同步：
 * 1. main 层 handler：本文件
 * 2. ipc/index.ts：导入并调用 registerModeHandlers()
 * 3. preload/index.ts：暴露 modeList / modeSetDefault / modeGetCurrent 方法
 * 4. electron.d.ts：声明 3 个类型
 */
export function registerModeHandlers(): void {
  // ------------------------------------------------------------------
  // mode:list — 列出所有可用 mode 配置（不含 systemPrompt）
  // ------------------------------------------------------------------
  // 参数：无
  // 返回：ModeInfo[]（5 个 mode：chat / ask / plan / code / debug）
  // 用途：UI 模式选择器渲染（如下拉框 / Radio Group）
  //
  // 注意：不返回 systemPrompt 字段，避免泄露内部 prompt 模板给渲染进程
  ipcMain.handle(
    'mode:list',
    async (): Promise<ModeListResponse> => {
      try {
        const modes = getAllModes()
        const list: ModeInfo[] = modes.map(toModeInfo)
        logger.debug('IPC.MODE', `mode:list`, {
          count: list.length,
          modes: list.map((m) => m.name),
        })
        return list
      } catch (err) {
        const msg = (err as Error)?.message ?? '获取 mode 列表失败'
        logger.error('IPC.MODE', `mode:list 失败: ${msg}`)
        throw new Error(`获取 mode 列表失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // mode:set-default — 设置当前默认 mode
  // ------------------------------------------------------------------
  // 参数：(request: ModeSetDefaultRequest) — { mode: AgentMode }
  // 返回：ModeSetDefaultResponse — { success, previousMode, currentMode }
  // 用途：UI 模式切换器（用户切换 mode 时调用）
  //
  // 防御：
  // - 入参用 isValidMode 类型守卫防御非法字符串
  // - 非法 mode 返回 success=false，currentMode 保持原值
  ipcMain.handle(
    'mode:set-default',
    async (_event, request: ModeSetDefaultRequest): Promise<ModeSetDefaultResponse> => {
      try {
        const previousMode = getCurrentMode()

        // 入参校验
        if (!request || typeof request.mode !== 'string' || !isValidMode(request.mode)) {
          logger.warn('IPC.MODE', `mode:set-default 入参非法`, {
            request,
          })
          return {
            success: false,
            previousMode,
            currentMode: previousMode,
          }
        }

        const ok = setCurrentMode(request.mode)
        const currentMode = getCurrentMode()

        logger.info('IPC.MODE', `mode:set-default`, {
          requested: request.mode,
          previousMode,
          currentMode,
          success: ok,
        })

        return {
          success: ok,
          previousMode,
          currentMode,
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? '设置默认 mode 失败'
        logger.error('IPC.MODE', `mode:set-default 失败: ${msg}`)
        throw new Error(`设置默认 mode 失败: ${msg}`)
      }
    }
  )

  // ------------------------------------------------------------------
  // mode:get-current — 返回当前默认 mode
  // ------------------------------------------------------------------
  // 参数：无
  // 返回：ModeCurrentResponse — { mode, displayName }
  // 用途：UI 启动时获取当前默认 mode（用于初始化模式选择器的选中状态）
  ipcMain.handle(
    'mode:get-current',
    async (): Promise<ModeCurrentResponse> => {
      try {
        const mode = getCurrentMode()
        const config = MODE_CONFIGS[mode]
        const response: ModeCurrentResponse = {
          mode,
          displayName: config.displayName,
        }
        logger.debug('IPC.MODE', `mode:get-current`, { mode, displayName: response.displayName })
        return response
      } catch (err) {
        const msg = (err as Error)?.message ?? '获取当前 mode 失败'
        logger.error('IPC.MODE', `mode:get-current 失败: ${msg}`)
        throw new Error(`获取当前 mode 失败: ${msg}`)
      }
    }
  )

  logger.info('IPC.MODE', `Mode IPC handlers 已注册`, {
    channels: ['mode:list', 'mode:set-default', 'mode:get-current'],
  })
}
