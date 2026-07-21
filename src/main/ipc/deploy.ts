/**
 * Web 部署助手 IPC Handlers
 *
 * 通道列表：
 * - deploy:listTemplates  — 列出所有部署模板
 * - deploy:getTemplate     — 按 ID 获取模板
 * - deploy:validate        — 校验变量
 * - deploy:build           — 构建部署计划
 * - deploy:execute         — 执行计划（异步，结果通过 deploy:done 事件推送）
 * - deploy:cancel          — 取消执行
 * - deploy:getStatus       — 获取计划当前状态
 *
 * 事件通道（主 → 渲染）：
 * - deploy:log             — 实时日志
 * - deploy:stepUpdate      — 步骤状态变化
 * - deploy:done            — 部署完成
 */

import { ipcMain, BrowserWindow } from 'electron'
import { DeployService } from '../services/deploy/deploy-service'

/** 部署服务单例 */
const service = new DeployService()

/**
 * 注册部署相关 IPC handlers
 *
 * @param mainWindow 主窗口（用于推送执行日志）
 */
export function registerDeployIpcHandlers(mainWindow: BrowserWindow): void {
  /** deploy:listTemplates — 列出所有模板 */
  ipcMain.handle('deploy:listTemplates', () => {
    try {
      return service.listTemplates()
    } catch (err) {
      throw new Error(`列出部署模板失败: ${(err as Error).message}`)
    }
  })

  /** deploy:getTemplate — 按 ID 获取模板 */
  ipcMain.handle('deploy:getTemplate', (_event, id: string) => {
    try {
      if (!id || typeof id !== 'string') {
        throw new Error('id 无效')
      }
      return service.getTemplate(id)
    } catch (err) {
      throw new Error(`获取部署模板失败: ${(err as Error).message}`)
    }
  })

  /** deploy:validate — 校验变量 */
  ipcMain.handle(
    'deploy:validate',
    (_event, templateId: string, values: Record<string, string>) => {
      try {
        return service.validate(templateId, values)
      } catch (err) {
        throw new Error(`校验失败: ${(err as Error).message}`)
      }
    }
  )

  /** deploy:build — 构建计划 */
  ipcMain.handle(
    'deploy:build',
    (
      _event,
      templateId: string,
      values: Record<string, string>,
      targetHost: string
    ) => {
      try {
        return service.build(templateId, values, targetHost)
      } catch (err) {
        throw new Error(`构建计划失败: ${(err as Error).message}`)
      }
    }
  )

  /** deploy:execute — 执行计划 */
  ipcMain.handle(
    'deploy:execute',
    async (_event, plan: unknown, sessionId: string) => {
      try {
        if (!plan) throw new Error('plan 无效')
        if (!sessionId || typeof sessionId !== 'string') {
          throw new Error('sessionId 无效')
        }
        // 这里 service.execute 内部异步执行，结果通过事件推送
        // 立即返回 plan.id 给渲染端用于后续 cancel / status
        const result = await service.execute(plan as never, sessionId, mainWindow)
        return result
      } catch (err) {
        throw new Error(`执行部署失败: ${(err as Error).message}`)
      }
    }
  )

  /** deploy:cancel — 取消执行 */
  ipcMain.handle('deploy:cancel', (_event, planId: string) => {
    try {
      return service.cancel(planId)
    } catch (err) {
      throw new Error(`取消失败: ${(err as Error).message}`)
    }
  })

  /** deploy:getStatus — 获取状态 */
  ipcMain.handle('deploy:getStatus', (_event, planId: string) => {
    return service.getStatus(planId)
  })
}
