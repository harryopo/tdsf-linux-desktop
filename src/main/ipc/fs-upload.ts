/**
 * 文件系统 IPC Handlers（v2.2 P1 修复 #22：AIPanel 图片附件基础版）
 *
 * 暴露给渲染进程的图片上传能力：
 * - fs:upload-image — 弹出文件选择对话框 → 读取图片 → 返回 base64 data URL
 *
 * 设计说明（简化方案 · CLAUDE.md A7 质量优先 + A8 避免重复造轮子）：
 * - 不引入图片压缩库（browser-image-compression 等），仅做基础读取 + base64 编码
 * - 限制图片大小 4MB（避免 IPC 传输过大 + base64 膨胀 33%）
 * - 限制图片类型：png / jpg / jpeg / gif / webp / bmp（常见图片格式）
 * - 返回标准 data URL（如 `data:image/png;base64,xxx`），可直接用于 <img src>
 *
 * 安全：
 * - 文件路径来自用户选择（dialog.showOpenDialog），不接受渲染进程传入的路径
 * - catch 块错误信息经 redactSecrets 脱敏（A3 红线）
 * - 不写入磁盘，不修改文件，仅读取
 */
import { ipcMain, dialog } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { FS } from '@shared/ipc-channels'
import { logger } from '../services/log/logger'
import { redactSecrets } from '../core/agent/providers/redact'

/**
 * 图片上传结果（成功时返回）
 */
export interface ImageUploadResult {
  /** 是否成功 */
  success: true
  /** base64 data URL（可直接用于 <img src>） */
  dataUrl: string
  /** 文件名（含扩展名，不含路径） */
  fileName: string
  /** 文件大小（字节） */
  fileSize: number
  /** MIME 类型（如 'image/png'） */
  mimeType: string
}

/**
 * 图片上传错误（失败时返回）
 */
export interface ImageUploadError {
  /** 是否成功（失败时为 false） */
  success: false
  /** 错误信息（已脱敏） */
  error: string
}

/**
 * 允许的图片扩展名（小写，含点）
 *
 * 与 dialog.showOpenDialog 的 filters.extensions 对齐，
 * 读取后再次校验扩展名（防御性编程）。
 */
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']

/**
 * 扩展名 → MIME 类型映射
 *
 * 用于构造 data URL 的 MIME 部分。
 */
const EXTENSION_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

/** 最大图片大小（4MB，避免 IPC 传输过大 + base64 膨胀） */
const MAX_IMAGE_SIZE = 4 * 1024 * 1024

/**
 * 读取文件并转为 base64 data URL
 *
 * @param filePath 文件绝对路径
 * @param mimeType MIME 类型（如 'image/png'）
 * @returns base64 data URL（如 `data:image/png;base64,xxx`）
 */
async function readFileAsDataUrl(filePath: string, mimeType: string): Promise<string> {
  const buffer = await fs.readFile(filePath)
  const base64 = buffer.toString('base64')
  return `data:${mimeType};base64,${base64}`
}

/** 注册文件系统 IPC handlers（无需 mainWindow） */
export function registerFsIpcHandlers(): void {
  /**
   * fs:upload-image — 弹出文件选择对话框 → 读取图片 → 返回 base64 data URL
   *
   * 流程：
   * 1. dialog.showOpenDialog 弹出文件选择器（仅允许图片类型）
   * 2. 用户取消选择：返回 { success: false, error: '用户取消选择' }
   * 3. 校验扩展名（防御性，dialog 已过滤但二次校验）
   * 4. 校验文件大小（≤ 4MB）
   * 5. 读取文件 → base64 编码 → 构造 data URL
   * 6. 返回 ImageUploadResult
   *
   * 错误处理：
   * - 文件读取失败：返回 ImageUploadError（已脱敏）
   * - 文件过大：返回 ImageUploadError 提示大小限制
   * - 不支持的类型：返回 ImageUploadError 提示允许的类型
   */
  ipcMain.handle(FS.UPLOAD_IMAGE, async (): Promise<ImageUploadResult | ImageUploadError> => {
    try {
      // 1. 弹出文件选择对话框
      const result = await dialog.showOpenDialog({
        title: '选择图片',
        properties: ['openFile'],
        filters: [
          {
            name: '图片',
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
          },
        ],
      })

      // 2. 用户取消选择
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '用户取消选择' }
      }

      const filePath = result.filePaths[0]
      const ext = path.extname(filePath).toLowerCase()

      // 3. 校验扩展名（防御性，dialog 已过滤但二次校验）
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        const msg = `不支持的图片类型: ${ext}（允许: ${ALLOWED_EXTENSIONS.join(', ')}）`
        logger.warn('FS_UPLOAD', msg, { filePath: redactSecrets(filePath) })
        return { success: false, error: msg }
      }

      // 4. 校验文件大小
      const stat = await fs.stat(filePath)
      if (stat.size > MAX_IMAGE_SIZE) {
        const sizeMB = (stat.size / 1024 / 1024).toFixed(2)
        const limitMB = (MAX_IMAGE_SIZE / 1024 / 1024).toFixed(0)
        const msg = `图片过大: ${sizeMB}MB（上限 ${limitMB}MB）`
        logger.warn('FS_UPLOAD', msg, { filePath: redactSecrets(filePath), size: stat.size })
        return { success: false, error: msg }
      }

      // 5. 读取文件 → base64
      const mimeType = EXTENSION_TO_MIME[ext] ?? 'application/octet-stream'
      const dataUrl = await readFileAsDataUrl(filePath, mimeType)
      const fileName = path.basename(filePath)

      logger.info('FS_UPLOAD', '图片上传成功', {
        fileName,
        size: stat.size,
        mimeType,
      })

      return {
        success: true,
        dataUrl,
        fileName,
        fileSize: stat.size,
        mimeType,
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err)
      const safeMessage = redactSecrets(rawMessage)
      logger.error('FS_UPLOAD', '图片上传失败', { error: safeMessage })
      return { success: false, error: safeMessage }
    }
  })
}
