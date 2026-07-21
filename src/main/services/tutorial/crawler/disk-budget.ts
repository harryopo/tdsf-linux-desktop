/**
 * 磁盘空间管控模块
 *
 * 教学术语：
 * - Disk Quota (磁盘配额)：限制临时文件占用总量
 * - Sweep (清扫)：定期清理过期临时文件
 * - Atomic Cleanup (原子清理)：抓取完成后立即清空，不留残留
 *
 * 设计目标：
 *   1. 所有爬虫临时文件统一到 <userData>/crawler-tmp/<source-id>/
 *   2. 单次抓取完成后立即 rm -rf（成功/失败/取消都清）
 *   3. 启动时扫描 + 清理超过 24h 的孤儿文件
 *   4. 总占用上限 1GB（超限提示用户）
 *
 * 与 v0.6 的区别：
 *   - 之前临时文件散落在 os.tmpdir() 各处
 *   - 抓取失败/取消时无清理钩子
 *   - 长期使用后 C 盘膨胀
 *
 * 使用：
 *   import { DiskBudget, getDiskInfo, sweepOrphans } from './disk-budget'
 *
 *   const budget = new DiskBudget({ maxBytes: 1024 * 1024 * 1024 })
 *   const dir = await budget.allocDir('arch-wiki')   // 申请临时目录
 *   try {
 *     // ... 下载/解压到 dir
 *   } finally {
 *     await budget.releaseDir(dir)                   // 抓取结束清理
 *   }
 */

import { mkdir, rm, stat, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** 磁盘信息（用于 UI 展示） */
export interface DiskInfo {
  /** 临时文件总占用（字节） */
  tempBytes: number
  /** 知识库占用（字节，来自 knowledge_entries） */
  knowledgeBytes: number
  /** 配额上限（字节） */
  quotaBytes: number
  /** 占用比例 (0-1) */
  usageRatio: number
  /** 各 source 占用明细 */
  bySource: Array<{ sourceId: string; bytes: number; files: number }>
  /** 孤儿文件数（>24h 未访问） */
  orphanFiles: number
}

/** DiskBudget 配置 */
export interface DiskBudgetOptions {
  /** 配额上限（默认 1GB） */
  maxBytes?: number
  /** 临时目录根（默认 <userData>/crawler-tmp） */
  rootDir?: string
  /** 孤儿文件判定时间（默认 24h） */
  orphanAgeMs?: number
}

/**
 * 磁盘预算管理器
 */
export class DiskBudget {
  private readonly maxBytes: number
  private readonly rootDir: string
  private readonly orphanAgeMs: number

  constructor(options: DiskBudgetOptions = {}) {
    this.maxBytes = options.maxBytes ?? 1024 * 1024 * 1024 // 1GB
    this.rootDir = options.rootDir ?? this.getDefaultRootDir()
    this.orphanAgeMs = options.orphanAgeMs ?? 24 * 60 * 60 * 1000 // 24h
  }

  /** 获取默认根目录 */
  private getDefaultRootDir(): string {
    try {
      return join(app.getPath('userData'), 'crawler-tmp')
    } catch {
      // 非 Electron 环境（测试）用当前目录
      return join(process.cwd(), '.crawler-tmp')
    }
  }

  /**
   * 申请一个临时目录（自动 mkdir）
   *
   * @param sourceId 爬虫源 ID
   * @returns 临时目录绝对路径
   */
  async allocDir(sourceId: string): Promise<string> {
    const dir = join(this.rootDir, sourceId)
    await mkdir(dir, { recursive: true })
    return dir
  }

  /**
   * 释放一个临时目录（rm -rf）
   *
   * @param dir 目录绝对路径
   */
  async releaseDir(dir: string): Promise<void> {
    if (!dir.startsWith(this.rootDir)) {
      // 安全检查：必须是我们管的目录
      console.warn(`[DiskBudget] 拒绝清理非托管目录：${dir}`)
      return
    }
    try {
      await rm(dir, { recursive: true, force: true })
    } catch (err) {
      console.warn(`[DiskBudget] 清理失败 ${dir}: ${(err as Error).message}`)
    }
  }

  /**
   * 计算目录占用
   *
   * @param dir 目录绝对路径
   * @returns 字节数
   */
  async getDirBytes(dir: string): Promise<number> {
    if (!existsSync(dir)) return 0
    return await this._dirSize(dir)
  }

  /** 递归计算目录大小 */
  private async _dirSize(dir: string): Promise<number> {
    let total = 0
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          total += await this._dirSize(p)
        } else if (e.isFile()) {
          try {
            const s = await stat(p)
            total += s.size
          } catch {
            // 跳过无法访问的文件
          }
        }
      }
    } catch {
      // 目录无法读取，忽略
    }
    return total
  }

  /**
   * 获取磁盘信息（用于 UI）
   */
  async getDiskInfo(knowledgeBytes: number = 0): Promise<DiskInfo> {
    const bySource: Array<{ sourceId: string; bytes: number; files: number }> = []
    let totalTemp = 0
    let orphans = 0
    const now = Date.now()

    if (existsSync(this.rootDir)) {
      try {
        const sourceDirs = await readdir(this.rootDir, { withFileTypes: true })
        for (const sd of sourceDirs) {
          if (!sd.isDirectory()) continue
          const dirPath = join(this.rootDir, sd.name)
          const bytes = await this._dirSize(dirPath)
          const files = await this._countFiles(dirPath)
          // 检测孤儿文件
          try {
            const statInfo = await stat(dirPath)
            if (now - statInfo.mtimeMs > this.orphanAgeMs) {
              orphans += files
            }
          } catch {
            // ignore
          }
          bySource.push({ sourceId: sd.name, bytes, files })
          totalTemp += bytes
        }
      } catch {
        // 根目录无法读取
      }
    }

    return {
      tempBytes: totalTemp,
      knowledgeBytes,
      quotaBytes: this.maxBytes,
      usageRatio: totalTemp / this.maxBytes,
      bySource,
      orphanFiles: orphans
    }
  }

  /** 递归统计文件数 */
  private async _countFiles(dir: string): Promise<number> {
    let count = 0
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.isFile()) count++
        else if (e.isDirectory()) count += await this._countFiles(join(dir, e.name))
      }
    } catch {
      // ignore
    }
    return count
  }

  /**
   * 扫描并清理孤儿文件
   *
   * @returns 清理的字节数
   */
  async sweepOrphans(): Promise<number> {
    if (!existsSync(this.rootDir)) return 0
    const now = Date.now()
    let cleanedBytes = 0

    try {
      const sourceDirs = await readdir(this.rootDir, { withFileTypes: true })
      for (const sd of sourceDirs) {
        if (!sd.isDirectory()) continue
        const dirPath = join(this.rootDir, sd.name)
        try {
          const statInfo = await stat(dirPath)
          if (now - statInfo.mtimeMs > this.orphanAgeMs) {
            const bytes = await this._dirSize(dirPath)
            await rm(dirPath, { recursive: true, force: true })
            cleanedBytes += bytes
            console.log(`[DiskBudget] 清理孤儿目录 ${sd.name}：${(bytes / 1024 / 1024).toFixed(2)} MB`)
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    return cleanedBytes
  }
}

/** 全局单例（懒加载） */
let _diskBudget: DiskBudget | null = null
export function getDiskBudget(): DiskBudget {
  if (!_diskBudget) {
    _diskBudget = new DiskBudget()
  }
  return _diskBudget
}

/** 便捷函数：获取磁盘信息 */
export async function getDiskInfo(knowledgeBytes: number = 0): Promise<DiskInfo> {
  return getDiskBudget().getDiskInfo(knowledgeBytes)
}

/** 便捷函数：清理孤儿 */
export async function sweepOrphans(): Promise<number> {
  return getDiskBudget().sweepOrphans()
}
