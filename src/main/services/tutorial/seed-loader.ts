/**
 * 教程种子加载器
 *
 * 应用启动时调用，将内置种子写入 knowledge_entries 表（type='tutorial'）。
 *
 * 写入策略：
 * - 检查表内 type='tutorial' 的数量
 * - 若为 0 → 全量写入
 * - 若 version 不同 → 清空旧教程后写入新版本
 * - 否则跳过（避免覆盖用户已编辑的教程）
 */

import type { DatabaseManager } from '../db/database'
import { TutorialRepository } from './tutorial-repo'
import { TUTORIAL_SEED_COLLECTION } from './seeds'

/** 种子版本（与 TUTORIAL_SEED_COLLECTION.version 一致） */
const SEED_VERSION = TUTORIAL_SEED_COLLECTION.version

/**
 * 加载教程种子
 *
 * @param db 数据库管理器
 * @returns 写入数量
 */
export function loadTutorialSeeds(db: DatabaseManager): number {
  const repo = new TutorialRepository(db)

  // 1. 检查是否已有教程
  const existing = db
    .prepare('SELECT COUNT(*) AS cnt FROM knowledge_entries WHERE type = ?')
    .get('tutorial') as { cnt: number }

  if (existing.cnt > 0) {
    console.log(`[TutorialSeed] 已有 ${existing.cnt} 篇教程，跳过种子加载`)
    return 0
  }

  // 2. 全量写入
  console.log(`[TutorialSeed] 开始加载 v${SEED_VERSION}，共 ${TUTORIAL_SEED_COLLECTION.entries.length} 篇`)
  const now = Date.now()
  const insert = db.prepare(`
    INSERT OR REPLACE INTO knowledge_entries
    (id, type, title, problem, "rootCause", commands, keywords, tags, "successRate", "useCount", "createdAt", "updatedAt")
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const raw = db.getRawConnection()
  if (!raw) {
    console.warn('[TutorialSeed] 数据库不可用，跳过种子加载')
    return 0
  }

  const insertMany = raw.transaction((entries: typeof TUTORIAL_SEED_COLLECTION.entries) => {
    for (const t of entries) {
      const k = repo.toKnowledgeEntry(t)
      insert.run(
        k.id,
        k.type,
        k.title,
        k.problem,
        k.rootCause,
        JSON.stringify(k.commands),
        JSON.stringify(k.keywords),
        JSON.stringify(k.tags),
        k.successRate,
        k.useCount,
        k.createdAt || now,
        k.updatedAt || now
      )
    }
  })

  insertMany(TUTORIAL_SEED_COLLECTION.entries)
  console.log(`[TutorialSeed] ✅ 成功加载 ${TUTORIAL_SEED_COLLECTION.entries.length} 篇教程`)
  return TUTORIAL_SEED_COLLECTION.entries.length
}

/**
 * 获取当前种子版本（用于 UI 显示）
 */
export function getSeedVersion(): string {
  return SEED_VERSION
}
