/**
 * 知识包导入执行器（#180）
 *
 * 把"用户选的几个文件"变成"库里真的多了/改了这些条目"，并把结果如实交回界面。
 * 与 knowledge-repo.importEntries 的分工：
 * - importEntries 是**相似度合并**（给 MCP 那类"导一个包、按关键词去重"的外部调用）；
 * - 这里是**按身份覆盖**（文件名 + 小节标题）：同一份笔记改了正文再导，
 *   覆盖原来那一条，而不是模糊合并成第三篇。两种语义混用会让人无法预测导入结果。
 *
 * 三条口径：
 * 1. 本机经验不外搬也不外清：覆盖内容时只写内容列，useCount / successRate / feedback 原样保留。
 * 2. 内容真变了才重算向量：旧向量先作废（否则语义检索还在找老正文），
 *    没变的条目一次推理都不发。
 * 3. 模型不可用不是导入失败：文字照样入库，把原因带回去让界面说清楚。
 */

import { promises as fs } from 'node:fs'
import { basename, extname } from 'node:path'
import type { DatabaseManager } from '../db/database'
import type { KnowledgeRepository } from '../db/knowledge-repo'
import type { KnowledgeEntry } from '@shared/models'
import { logger } from '../log/logger'
import {
  IMPORT_FILE_EXTENSIONS,
  MAX_IMPORT_FILE_BYTES,
  parseKnowledgeFile,
} from '../db/knowledge-import'
import { embedKnowledgeEntries, writeEmbedding, type KbEmbedder } from './kb-embedding'

/** 调用方（IPC 层）构造选项时也要用这个类型 */
export type { KbEmbedder } from './kb-embedding'

export interface KbImportOptions {
  /** 用户通过对话框选中的文件（已记入 confinement 授权集） */
  paths: string[]
  repo: KnowledgeRepository
  db: DatabaseManager
  embedder: KbEmbedder
}

/** 一条没进来的输入：哪个文件、哪一节、为什么 */
export interface KbImportRejection {
  file: string
  source: string
  reason: string
}

export interface KbImportResult {
  /** 成功读取并解析的文件数 */
  files: number
  /** 本次涉及的条目 id（新增或命中已有的都算），供界面刷新与判据用 */
  ids: string[]
  inserted: number
  updated: number
  unchanged: number
  rejected: KbImportRejection[]
  /** 本次真正写入向量的条数 */
  embedded: number
  /** 向量没能生成的说明（模型未就绪等），界面原样展示 */
  embedNote?: string
}

/** 内容列（不含本机经验计数与答复，见文件头第 1 条） */
function contentOf(entry: KnowledgeEntry): Partial<KnowledgeEntry> {
  return {
    type: entry.type,
    title: entry.title,
    problem: entry.problem,
    rootCause: entry.rootCause ?? undefined,
    commands: entry.commands,
    rollbackCommands: entry.rollbackCommands ?? undefined,
    verification: entry.verification ?? undefined,
    keywords: entry.keywords,
    tags: entry.tags,
  }
}

/** 逐列比内容：不看时间戳、不看经验计数 */
function sameContent(a: KnowledgeEntry, b: KnowledgeEntry): boolean {
  const ca = contentOf(a)
  const cb = contentOf(b)
  return Object.keys(cb).every(
    (key) => JSON.stringify(ca[key as keyof KnowledgeEntry] ?? null) === JSON.stringify(cb[key as keyof KnowledgeEntry] ?? null)
  )
}

/** 超限文件给人看的大小说明 */
function sizeReason(sizeBytes: number): string {
  const actual = (sizeBytes / 1024 / 1024).toFixed(1)
  const limit = (MAX_IMPORT_FILE_BYTES / 1024 / 1024).toFixed(0)
  return `文件有 ${actual}MB，超过 ${limit}MB 上限，没有导入`
}

/**
 * 导入一组知识文件
 *
 * 单个文件失败不影响其他文件；被丢掉的每一节都带原因回来。
 */
export async function importKnowledgeFiles(opts: KbImportOptions): Promise<KbImportResult> {
  const result: KbImportResult = {
    files: 0,
    ids: [],
    inserted: 0,
    updated: 0,
    unchanged: 0,
    rejected: [],
    embedded: 0,
  }

  for (const path of opts.paths) {
    const file = basename(path)
    const ext = extname(file).replace(/^\./, '').toLowerCase()

    // 先看后缀再读盘：陌生后缀（私钥、二进制）一个字节都不该读进来
    if (!(IMPORT_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      result.rejected.push({
        file,
        source: file,
        reason: `不认识的文件类型 .${ext || '?'}，跳过（可导入 ${IMPORT_FILE_EXTENSIONS.map((e) => `.${e}`).join(' / ')}）`,
      })
      continue
    }

    let text: string
    try {
      const stat = await fs.stat(path)
      if (stat.size > MAX_IMPORT_FILE_BYTES) {
        result.rejected.push({ file, source: file, reason: sizeReason(stat.size) })
        continue
      }
      text = await fs.readFile(path, 'utf8')
    } catch (err) {
      result.rejected.push({
        file,
        source: file,
        reason: `文件读不出来：${err instanceof Error ? err.message : String(err)}`,
      })
      continue
    }

    const parsed = parseKnowledgeFile(file, text)
    for (const rejection of parsed.rejected) {
      result.rejected.push({ file, ...rejection })
    }
    result.files++

    for (const entry of parsed.entries) {
      const existing = opts.repo.getById(entry.id)
      if (!existing) {
        if (opts.repo.add(entry)) {
          result.inserted++
          result.ids.push(entry.id)
        } else {
          result.rejected.push({ file, source: entry.title, reason: '写库失败（这次没有存进来）' })
        }
        continue
      }
      result.ids.push(entry.id)
      if (sameContent(existing, entry)) {
        result.unchanged++
        continue
      }
      // 内容变了：先作废旧向量，再覆盖内容列（经验计数由 update 自己保住）
      writeEmbedding(opts.db, entry.id, null)
      if (opts.repo.update(entry.id, contentOf(entry))) {
        result.updated++
      } else {
        result.rejected.push({ file, source: entry.title, reason: '更新失败（库里那条没改动）' })
      }
    }
  }

  if (result.ids.length > 0) {
    const embedded = await embedKnowledgeEntries(opts.db, result.ids, opts.embedder)
    result.embedded = embedded.embedded
    if (embedded.note) result.embedNote = embedded.note
    if (embedded.failed > 0) {
      result.embedNote = result.embedNote ?? `有 ${embedded.failed} 条没算出向量，语义检索暂时查不到它们`
    }
  }

  logger.info('KB.IMPORT', '知识包导入完成', {
    files: result.files,
    inserted: result.inserted,
    updated: result.updated,
    unchanged: result.unchanged,
    rejected: result.rejected.length,
    embedded: result.embedded,
  })
  return result
}
