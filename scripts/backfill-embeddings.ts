/**
 * 批量回填教程 embedding 向量脚本
 *
 * 教学术语：
 * - Embedding：将文本映射为高维向量，用于语义相似度检索
 * - BGE (BAAI General Embedding)：智源研究院开源中文 embedding 模型（本工程使用 BGE-small-zh）
 * - vec0：sqlite-vec 提供的虚拟表类型，存储向量并支持 KNN 检索
 * - Backfill：回填，指对历史已入库但缺失 embedding 字段的条目补齐向量
 *
 * 脚本职责：
 *   1. 用真实 Electron userData 路径初始化 DatabaseManager（复用已下载的 BGE 模型缓存）
 *   2. 创建 TutorialRepository
 *   3. 打印总数 + 待回填条目数
 *   4. 调用 repo.backfillEmbeddings({ batchSize: 16, onProgress })
 *   5. 每 50 条打印进度 + 估算剩余时间
 *   6. 完成后打印统计：total / success / failed / 耗时 / 平均每条耗时
 *   7. 退出码：success > 0 返回 0，全部失败返回 1
 *
 * 运行方式：
 *   node scripts/run-script.cjs backfill-embeddings
 *
 * 依赖说明：
 *   - Electron mock 由 run-script.cjs 的 banner 注入，脚本中只需 `import { app } from 'electron'`
 *   - backfillEmbeddings 内部已处理：模型加载失败、单批失败、断点续传（WHERE embedding IS NULL）
 *   - 触发器会自动把回填的 embedding 同步到 vec0 虚拟表
 *
 * 断点续传：
 *   本脚本可重复执行。每次只处理 embedding IS NULL 的条目，已回填的会跳过。
 *   若中途失败（如断电），再次运行会从未完成的位置继续。
 */

import { app } from 'electron'
import { join } from 'node:path'
import { DatabaseManager } from '../src/main/services/db/database'
import { TutorialRepository } from '../src/main/services/tutorial/tutorial-repo'

// ────────────────────────────────────────────────────────────
// 配置
// ────────────────────────────────────────────────────────────

/** 每批处理条目数（比默认 8 大，提高吞吐量；CPU 模式下 BGE-small 仍能处理） */
const BATCH_SIZE = 16

/** 进度打印间隔（每 N 条打印一次） */
const PROGRESS_INTERVAL = 50

// ────────────────────────────────────────────────────────────
// 工具函数
// ────────────────────────────────────────────────────────────

/**
 * 将毫秒格式化为人类可读时长
 *
 * @param ms 毫秒数
 * @returns 形如 "8m 30s" / "1h 5m" / "45s"
 */
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

// ────────────────────────────────────────────────────────────
// 主流程
// ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // ─── 步骤 1：初始化数据库 ───
  console.log('[backfill] 初始化数据库...')

  // 用真实 Electron userData 路径，复用 pnpm dev 已下载的 BGE 模型缓存
  const userDataPath = app.getPath('userData')
  const dbPath = join(userDataPath, 'tdsf.db')
  console.log(`[backfill] 数据库路径: ${dbPath}`)

  // DatabaseManager 是单例，首次调用会初始化表 + 加载 sqlite-vec 扩展
  const db = DatabaseManager.getInstance(dbPath)

  // 检查数据库是否真正可用（better-sqlite3 加载成功）
  if (!db.isAvailable()) {
    console.error('[backfill] 数据库不可用（better-sqlite3 加载失败），无法继续')
    process.exit(1)
  }

  // ─── 步骤 2：创建 TutorialRepository ───
  const repo = new TutorialRepository(db)

  // ─── 步骤 3：查询并打印总数 ───
  const totalCount = repo.count()
  console.log(`[backfill] 当前 tutorial 总数: ${totalCount}`)

  if (totalCount === 0) {
    console.log('[backfill] 数据库为空，无需回填。退出。')
    process.exit(0)
  }

  // ─── 步骤 4：查询待回填条目数 ───
  // 直接走 SQL COUNT（不通过 repo API，因为 repo 没有暴露这个查询）
  // 这里只读不改，符合脚本场景
  const pendingRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM knowledge_entries
       WHERE type = ? AND embedding IS NULL`
    )
    .get('tutorial') as { cnt: number } | undefined
  const pendingCount = pendingRow?.cnt ?? 0

  console.log(`[backfill] 待回填 embedding 条目: ${pendingCount}`)

  if (pendingCount === 0) {
    console.log('[backfill] 所有条目已包含 embedding，无需回填。退出。')
    process.exit(0)
  }

  // ─── 步骤 5：启动回填 ───
  console.log(`[backfill] 启动回填（batchSize=${BATCH_SIZE}）...`)
  console.log('[backfill] 模型加载中（首次约 10-30 秒）...')

  const startTime = Date.now()
  let lastProgressPrintedAt = 0 // 上次打印进度时的条目数（用于控制每 50 条打印一次）

  // 调用 backfillEmbeddings：
  //   - 内部已实现分批 + 模型懒加载 + 单批失败容错
  //   - WHERE embedding IS NULL 天然支持断点续传
  //   - 触发器会自动同步到 vec0 虚拟表
  const result = await repo.backfillEmbeddings({
    batchSize: BATCH_SIZE,
    onProgress: (current: number, total: number) => {
      // 首次回调 + 每 PROGRESS_INTERVAL 条打印一次
      // current 是当前已处理条目数（从 1 开始递增到 total）
      const shouldPrint =
        current === 1 ||
        current - lastProgressPrintedAt >= PROGRESS_INTERVAL ||
        current === total

      if (!shouldPrint) {
        return
      }

      lastProgressPrintedAt = current

      const elapsedMs = Date.now() - startTime
      const percent = total > 0 ? (current / total) * 100 : 0

      // 估算剩余时间：基于已用时长 + 平均速度
      //   avgMsPerItem = elapsedMs / current
      //   remainingMs = avgMsPerItem * (total - current)
      let etaText: string
      if (current > 0) {
        const remainingMs = (elapsedMs / current) * (total - current)
        etaText = `估计剩余 ${formatDuration(remainingMs)}`
      } else {
        etaText = '估计剩余 -'
      }

      console.log(
        `[backfill] 进度: ${current}/${total} (${percent.toFixed(1)}%) ` +
          `用时 ${formatDuration(elapsedMs)} ${etaText}`
      )
    }
  })

  const elapsedMs = Date.now() - startTime

  // ─── 步骤 6：打印最终统计 ───
  console.log('[backfill] 完成!')
  console.log('[backfill] 统计:')
  console.log(`  总条目:    ${result.total}`)
  console.log(`  成功:      ${result.success}`)
  console.log(`  失败:      ${result.failed}`)
  console.log(`  耗时:      ${formatDuration(elapsedMs)}`)

  // 平均每条耗时（仅按成功条目计算，避免失败条目拉高均值误导）
  const avgMsPerItem =
    result.success > 0 ? Math.round(elapsedMs / result.success) : 0
  console.log(`  平均速度:  ${avgMsPerItem}ms/条`)
  console.log(`  批处理量:  ${BATCH_SIZE}`)

  if (result.failed > 0) {
    console.warn(
      `[backfill] 警告: 有 ${result.failed} 条失败，可重新运行脚本断点续传`
    )
  }

  // ─── 步骤 7：退出码 ───
  // success > 0 返回 0；全部失败返回 1
  const exitCode = result.success > 0 ? 0 : 1
  process.exit(exitCode)
}

// 启动主流程
// 注：不用 try/catch 包裹，让错误自然抛出便于诊断
//     未捕获的 Promise rejection 也会导致 Node 进程非零退出
main().catch((err: unknown) => {
  console.error('[backfill] 致命错误:', err)
  process.exit(1)
})
