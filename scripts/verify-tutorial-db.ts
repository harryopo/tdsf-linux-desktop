/**
 * 教程库数据验证脚本
 *
 * 验证目标：
 * 1. 数据库可连接，教程总数与分类分布
 * 2. 本地教材（项目指导文档）是否已正确入库
 * 3. PathRecommender 生成的默认路径 / 目标路径是否合理
 * 4. 输出可疑数据（空标题、异常分类、source 缺失）
 */

import * as path from 'node:path'
import * as os from 'node:os'
import { DatabaseManager, resolveDbPath } from '../src/main/services/db/database'
import { TutorialRepository } from '../src/main/services/tutorial/tutorial-repo'
import { PathRecommender } from '../src/main/services/tutorial/path-recommender'
import type { TutorialCategory } from '../src/main/services/tutorial/types'

function getUserDataDir(): string {
  const homedir = os.homedir()
  if (process.platform === 'win32') {
    return path.join(homedir, 'AppData', 'Roaming', 'tdsf-linux-desktop')
  }
  if (process.platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', 'tdsf-linux-desktop')
  }
  return path.join(homedir, '.config', 'tdsf-linux-desktop')
}

function main(): void {
  const userDataDir = getUserDataDir()
  const dbPath = resolveDbPath(userDataDir)
  console.log(`[verify] userDataDir: ${userDataDir}`)
  console.log(`[verify] dbPath:      ${dbPath}`)

  const db = DatabaseManager.getInstance(dbPath)
  console.log(`[verify] db available: ${db.isAvailable()}`)
  console.log(`[verify] vector enabled: ${db.isVectorEnabled()}`)

  const repo = new TutorialRepository(db)
  const all = repo.listAll()
  console.log(`\n[verify] 教程总数: ${all.length}`)

  // 1. 分类分布
  const summary = repo.categorySummary()
  console.log('\n[verify] 分类分布:')
  for (const s of summary) {
    if (s.count > 0) {
      console.log(`  ${s.category.padEnd(18)} ${String(s.count).padStart(5)}  ${s.label}`)
    }
  }

  // 2. source 统计
  const byKind = new Map<string, number>()
  const localCount = { offlineDump: 0, shenzhen: 0, both: 0 }
  for (const t of all) {
    const kind = t.source?.kind ?? 'unknown'
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
    const isOffline = kind === 'offline-dump'
    const isShenzhen = (t.source?.name ?? '').includes('深圳信息')
    if (isOffline && isShenzhen) localCount.both++
    else if (isOffline) localCount.offlineDump++
    else if (isShenzhen) localCount.shenzhen++
  }
  console.log('\n[verify] source kind 分布:')
  for (const [kind, count] of byKind.entries()) {
    console.log(`  ${kind.padEnd(18)} ${String(count).padStart(5)}`)
  }
  console.log(`\n[verify] 本地教材统计:`)
  console.log(`  offline-dump 且含"深圳信息": ${localCount.both}`)
  console.log(`  仅 offline-dump:              ${localCount.offlineDump}`)
  console.log(`  仅含"深圳信息":                ${localCount.shenzhen}`)

  // 3. 可疑数据
  const suspicious = all.filter(
    (t) =>
      !t.title ||
      t.title.trim().length === 0 ||
      t.readingTime <= 0 ||
      t.readingTime > 600 ||
      !t.source?.name
  )
  console.log(`\n[verify] 可疑数据条数: ${suspicious.length}`)
  if (suspicious.length > 0) {
    for (const t of suspicious.slice(0, 10)) {
      console.log(`  - id=${t.id}, title=${JSON.stringify(t.title)}, readingTime=${t.readingTime}, source=${t.source?.name}`)
    }
  }

  // 4. 推荐路径验证
  const recommender = new PathRecommender(db)
  console.log('\n[verify] 默认路径（无目标）:')
  const defaultPaths = recommender.recommend({ currentLevel: 'beginner', maxSteps: 3 })
  for (const p of defaultPaths) {
    console.log(`\n  [${p.targetCategory}] ${p.name}`)
    console.log(`  description: ${p.description}`)
    console.log(`  reason: ${p.reason}`)
    for (const s of p.steps) {
      console.log(`    ${s.order}. [${s.category}] ${s.title} (${s.readingTime}min) ${s.commands.slice(0, 3).join(',')}`)
    }
  }

  console.log('\n[verify] 目标路径（用户权限）:')
  const userPath = recommender.recommend({ goal: '学习用户权限', currentLevel: 'beginner', maxSteps: 3 })
  for (const p of userPath) {
    console.log(`\n  [${p.targetCategory}] ${p.name}`)
    for (const s of p.steps) {
      console.log(`    ${s.order}. [${s.category}] ${s.title} (${s.readingTime}min)`)
    }
  }

  console.log('\n[verify] 目标路径（Linux 基础）:')
  const basicPath = recommender.recommend({ goal: 'Linux 基础', currentLevel: 'beginner', maxSteps: 3 })
  for (const p of basicPath) {
    console.log(`\n  [${p.targetCategory}] ${p.name}`)
    for (const s of p.steps) {
      console.log(`    ${s.order}. [${s.category}] ${s.title} (${s.readingTime}min)`)
    }
  }

  // 5. 各分类取第一条示例
  console.log('\n[verify] 各分类第一条示例（本地教材优先）:')
  const categories: TutorialCategory[] = [
    'linux-basics', 'user-management', 'networking', 'services',
    'security', 'shell-scripting', 'containers', 'troubleshooting'
  ]
  for (const cat of categories) {
    const entries = repo.listByCategory(cat)
    const localFirst = entries
      .filter((e) => e.difficulty === 'beginner')
      .sort((a, b) => {
        const aLocal = (a.source?.kind === 'offline-dump' || (a.source?.name ?? '').includes('深圳信息')) ? 1 : 0
        const bLocal = (b.source?.kind === 'offline-dump' || (b.source?.name ?? '').includes('深圳信息')) ? 1 : 0
        if (aLocal !== bLocal) return bLocal - aLocal
        return a.readingTime - b.readingTime
      })
    const first = localFirst[0] ?? entries[0]
    if (first) {
      console.log(`  ${cat.padEnd(18)} ${first.title.slice(0, 40).padEnd(42)} source=${first.source?.name ?? '?'}`)
    } else {
      console.log(`  ${cat.padEnd(18)} <无教程>`)
    }
  }

  db.close()
  DatabaseManager.resetInstance()
  console.log('\n[verify] 完成')
}

main()
