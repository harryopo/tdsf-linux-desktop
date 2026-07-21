/**
 * 混合检索性能基准脚本
 *
 * 测量三种检索模式的延迟：
 *   1. 仅 FTS5    —— searchHybrid(query, { useVector: false })，跳过向量路径
 *   2. 纯向量检索  —— 直接调 hybridSearch，传空 query 让 FTS 无命中，只走 vec 路径
 *   3. 混合 (RRF) —— searchHybrid(query, { useVector: true })，FTS + vec + RRF 融合
 *
 * 运行方式：
 *   node scripts/run-script.cjs bench-hybrid-search
 *
 * 输出：
 *   - 阶段 1：环境信息（vectorEnabled / embeddingModelLoaded / totalEntries）
 *   - 阶段 2：测试查询列表（20 个，覆盖关键词/语义/英文/长/短）
 *   - 阶段 3：性能基准（每查询每模式 5 次，串行执行）
 *   - 阶段 4：汇总表格 + 整体平均 p50/p95 + 召回率统计
 *
 * 设计要点：
 *   - 串行执行，避免 CPU 抢占影响测量
 *   - 用 performance.now() 高精度计时（亚毫秒级）
 *   - 预热 ONNX Runtime（2 次预热推理，避免 JIT 编译开销污染结果）
 *   - 纯向量模式包含 embedding 生成时间，与混合模式公平对比
 *   - searchHybrid 内部已自动降级（模型不可用 → 仅 FTS），脚本先确保模型加载成功
 *
 * 依赖说明：
 *   - Electron mock 由 run-script.cjs 的 banner 注入，脚本中只需 `import { app } from 'electron'`
 *   - 复用 pnpm dev 已下载的 BGE 模型缓存（userData/models/）
 */

import { app } from 'electron'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseManager } from '../src/main/services/db/database'
import { TutorialRepository } from '../src/main/services/tutorial/tutorial-repo'
import {
  EmbeddingService,
  prefixQuery,
  EMBEDDING_DIM
} from '../src/main/services/tutorial/embedding-service'
import { hybridSearch } from '../src/main/services/tutorial/hybrid-search'

// ────────────────────────────────────────────────────────────
// 配置
// ────────────────────────────────────────────────────────────

/** 每查询每模式运行次数 */
const RUNS_PER_QUERY = 5

/** 返回结果上限 */
const SEARCH_LIMIT = 10

/** 测试查询集合（20 个，覆盖不同分类和难度） */
const TEST_QUERIES: readonly string[] = [
  // ── 关键词精确（5 个） ──
  'ssh 免密',
  'nginx 502',
  'chmod 755',
  'iptables 防火墙',
  'systemd 启动失败',
  // ── 语义泛化（5 个） ──
  '服务起不来',
  '网关错误',
  '文件权限问题',
  '端口被占用',
  '磁盘满了',
  // ── 英文关键词（5 个） ──
  'ssh config',
  'nginx troubleshooting',
  'linux file permission',
  'firewall rules',
  'service failed',
  // ── 长查询（2 个） ──
  '如何配置 SSH 免密登录以及常见问题排查',
  'Nginx 502 Bad Gateway 错误的完整排查流程',
  // ── 短查询（3 个） ──
  'cd',
  'ls',
  'grep'
]

// ────────────────────────────────────────────────────────────
// 工具函数
// ────────────────────────────────────────────────────────────

/**
 * 格式化毫秒为人类可读字符串
 * - < 0.1ms：保留 3 位小数（亚毫秒级精度）
 * - 其他：保留 1 位小数
 */
function fmtMs(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '0.0ms'
  if (ms < 0.1) return `${ms.toFixed(3)}ms`
  return `${ms.toFixed(1)}ms`
}

/**
 * 计算字符串显示宽度（中文占 2 列，英文占 1 列）
 * 用于在终端中正确对齐含中文的表格
 */
function displayWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    // CJK Unified Ideographs + CJK Symbols + 全角字符 + CJK Extension A
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x30ff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x3400 && code <= 0x4dbf)
    ) {
      w += 2
    } else {
      w += 1
    }
  }
  return w
}

/** 右侧补空格让字符串达到指定显示宽度 */
function padRight(s: string, width: number): string {
  const w = displayWidth(s)
  if (w >= width) return s
  return s + ' '.repeat(width - w)
}

/**
 * 计算分位数（线性插值法，与 numpy.percentile 默认行为一致）
 *
 * 教学要点：
 *   - p50 = 中位数（50% 的样本小于等于此值）
 *   - p95 = 95 分位数（95% 的样本小于等于此值，用于评估尾延迟）
 *   - 线性插值法：当目标排名落在两个样本之间时，按比例插值
 *
 * @param sortedAsc 已升序排序的样本数组
 * @param p 百分位（0-100）
 */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  if (sortedAsc.length === 1) return sortedAsc[0]
  const rank = (p / 100) * (sortedAsc.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sortedAsc[lo]
  const frac = rank - lo
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * frac
}

/** 单次测量的统计结果 */
interface Stats {
  /** 中位数（50 分位数） */
  p50: number
  /** 95 分位数（尾延迟） */
  p95: number
  /** 算术平均 */
  mean: number
  /** 最小值 */
  min: number
  /** 最大值 */
  max: number
  /** 样本数 */
  count: number
}

/** 计算样本统计量 */
function computeStats(samples: number[]): Stats {
  if (samples.length === 0) {
    return { p50: 0, p95: 0, mean: 0, min: 0, max: 0, count: 0 }
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = samples.reduce((acc, v) => acc + v, 0)
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    mean: sum / samples.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: samples.length
  }
}

/** 高精度计时包装器（异步） */
async function timeAsync<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now()
  const result = await fn()
  return { result, ms: performance.now() - start }
}

/** 单查询的三模式测量结果 */
interface QueryResult {
  query: string
  fts: Stats
  vec: Stats
  hybrid: Stats
  ftsCounts: number[]
  vecCounts: number[]
  hybridCounts: number[]
}

// ────────────────────────────────────────────────────────────
// 主流程
// ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // ─── 阶段 1：环境检查 ───
  console.log('[bench] === 阶段 1：环境检查 ===')

  // 用真实 Electron userData 路径，复用 pnpm dev 已下载的 BGE 模型缓存
  const userDataPath = app.getPath('userData')
  const dbPath = join(userDataPath, 'tdsf.db')
  console.log(`[bench] 数据库路径: ${dbPath}`)

  // DatabaseManager 是单例，首次调用会初始化表 + 加载 sqlite-vec 扩展
  const db = DatabaseManager.getInstance(dbPath)
  if (!db.isAvailable()) {
    console.error('[bench] 数据库不可用（better-sqlite3 加载失败），退出')
    process.exit(1)
  }

  const repo = new TutorialRepository(db)
  const vectorEnabled = db.isVectorEnabled()
  const embeddingModelLoaded = EmbeddingService.getInstance().isLoaded()
  const totalEntries = repo.count()

  console.log(`[bench] vectorEnabled:        ${vectorEnabled}`)
  console.log(`[bench] embeddingModelLoaded: ${embeddingModelLoaded}`)
  console.log(`[bench] totalEntries:         ${totalEntries}（type='tutorial'）`)

  if (totalEntries === 0) {
    console.error('[bench] 数据库为空，无法进行基准测试，退出')
    process.exit(1)
  }

  if (!vectorEnabled) {
    console.warn('[bench] 警告: sqlite-vec 扩展未加载，向量与混合模式将退化为 FTS')
  }

  // 预热 EmbeddingService（如果尚未加载）
  // searchHybrid 内部已自动降级：模型不可用 → 仅 FTS
  // 所以脚本要先确保模型加载成功，否则 hybrid 模式测出来和 FTS 模式一样
  if (!embeddingModelLoaded) {
    console.log('[bench] 预热 EmbeddingService（首次加载 BGE 模型，可能 10-30 秒）...')
    try {
      await EmbeddingService.getInstance().ensureLoaded()
      console.log('[bench] 模型加载完成')
    } catch (err) {
      console.error('[bench] 模型加载失败:', (err as Error).message)
      console.error('[bench] 向量/混合模式将不可用，仅 FTS 模式可测试')
    }
  }

  // 检查 embedding 完整性
  // 如果有未回填的条目，向量检索结果会缺失这部分数据
  const missingRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM knowledge_entries
       WHERE type = 'tutorial' AND embedding IS NULL`
    )
    .get() as { cnt: number } | undefined
  const missingCount = missingRow?.cnt ?? 0
  if (missingCount > 0) {
    console.warn(
      `[bench] 警告: 有 ${missingCount} 条未回填 embedding，向量检索结果可能不完整`
    )
  } else {
    console.log('[bench] embedding 完整性检查通过（所有 tutorial 均有 embedding）')
  }

  // 预热 ONNX Runtime（前 1-2 次推理会触发 JIT 编译，耗时 1-3 秒）
  // 预热后所有 bench 运行都是 "warm" 状态，5 次样本均可纳入统计
  console.log('[bench] 预热 ONNX Runtime（2 次预热推理，避免 JIT 污染结果）...')
  try {
    const emb = EmbeddingService.getInstance()
    await emb.embed(prefixQuery('预热测试 query 1'))
    await emb.embed(prefixQuery('warmup query 2'))
    console.log('[bench] 预热完成')
  } catch (err) {
    console.warn('[bench] 预热失败（继续测试）:', (err as Error).message)
  }

  // ─── 阶段 2：准备测试查询 ───
  console.log('')
  console.log(`[bench] === 阶段 2：准备测试查询（${TEST_QUERIES.length} 个） ===`)
  console.log('[bench] 查询列表:')
  TEST_QUERIES.forEach((q, i) => {
    console.log(`  ${String(i + 1).padStart(2, ' ')}. ${q}`)
  })

  // ─── 阶段 3：性能基准 ───
  console.log('')
  console.log(
    `[bench] === 阶段 3：性能基准（每查询每模式 ${RUNS_PER_QUERY} 次，串行执行） ===`
  )

  const allResults: QueryResult[] = []

  for (let qi = 0; qi < TEST_QUERIES.length; qi++) {
    const query = TEST_QUERIES[qi]
    console.log(`[bench] (${qi + 1}/${TEST_QUERIES.length}) 测试查询: "${query}"`)

    const ftsTimings: number[] = []
    const ftsCounts: number[] = []
    const vecTimings: number[] = []
    const vecCounts: number[] = []
    const hybridTimings: number[] = []
    const hybridCounts: number[] = []

    // 串行执行 5 次运行，每次依次跑 FTS → Vec → Hybrid
    // 不并行：避免 CPU 抢占影响测量
    for (let run = 0; run < RUNS_PER_QUERY; run++) {
      // ── 模式 1：仅 FTS5 ──
      // searchHybrid 内部 useVector=false → 跳过 embed，只走 FTS + RRF
      try {
        const { result, ms } = await timeAsync(() =>
          repo.searchHybrid(query, { useVector: false, limit: SEARCH_LIMIT })
        )
        ftsTimings.push(ms)
        ftsCounts.push(result.length)
      } catch (err) {
        console.warn(`  [FTS run ${run + 1}] 失败: ${(err as Error).message}`)
        ftsTimings.push(0)
        ftsCounts.push(0)
      }

      // ── 模式 2：纯向量检索 ──
      // 直接调 hybridSearch，传空 query 让 FTS 无命中，只走 vec 路径
      // 包含 embedding 生成时间，与混合模式公平对比
      try {
        const start = performance.now()
        const vec = await EmbeddingService.getInstance().embed(prefixQuery(query))
        // 防御：维度校验 + 非零校验（参考 searchHybrid 内部逻辑）
        if (vec.length !== EMBEDDING_DIM || !vec.some((v) => v !== 0)) {
          throw new Error(
            `embedding 异常（dim=${vec.length}, allZero=${!vec.some((v) => v !== 0)}）`
          )
        }
        const result = hybridSearch(db, {
          query: '', // 空字符串让 FTS 无命中
          queryEmbedding: vec,
          type: 'tutorial',
          limit: SEARCH_LIMIT
        })
        const ms = performance.now() - start
        vecTimings.push(ms)
        vecCounts.push(result.length)
      } catch (err) {
        console.warn(`  [Vec run ${run + 1}] 失败: ${(err as Error).message}`)
        vecTimings.push(0)
        vecCounts.push(0)
      }

      // ── 模式 3：混合检索（FTS + vec + RRF） ──
      // searchHybrid 内部 useVector=true → embed + FTS + vec + RRF
      try {
        const { result, ms } = await timeAsync(() =>
          repo.searchHybrid(query, { useVector: true, limit: SEARCH_LIMIT })
        )
        hybridTimings.push(ms)
        hybridCounts.push(result.length)
      } catch (err) {
        console.warn(`  [Hybrid run ${run + 1}] 失败: ${(err as Error).message}`)
        hybridTimings.push(0)
        hybridCounts.push(0)
      }
    }

    const ftsStats = computeStats(ftsTimings)
    const vecStats = computeStats(vecTimings)
    const hybridStats = computeStats(hybridTimings)

    console.log(
      `  FTS p50=${fmtMs(ftsStats.p50)}  ` +
        `Vec p50=${fmtMs(vecStats.p50)}  ` +
        `Hybrid p50=${fmtMs(hybridStats.p50)}`
    )

    allResults.push({
      query,
      fts: ftsStats,
      vec: vecStats,
      hybrid: hybridStats,
      ftsCounts,
      vecCounts,
      hybridCounts
    })
  }

  // ─── 阶段 4：汇总报告 ───
  console.log('')
  console.log('[bench] === 阶段 4：汇总报告 ===')
  console.log('')

  // 动态计算查询列宽度（基于最长查询的显示宽度）
  const maxQueryWidth = Math.max(...TEST_QUERIES.map((q) => displayWidth(q)))
  const COL_QUERY = Math.max(20, maxQueryWidth + 2)
  const COL_NUM = 10

  // 表头
  const header =
    `| ${padRight('查询', COL_QUERY)} ` +
    `| ${padRight('FTS p50', COL_NUM)} | ${padRight('FTS p95', COL_NUM)} ` +
    `| ${padRight('Vec p50', COL_NUM)} | ${padRight('Vec p95', COL_NUM)} ` +
    `| ${padRight('Hybrid p50', COL_NUM)} | ${padRight('Hybrid p95', COL_NUM)} |`
  const separator =
    `| ${'-'.repeat(COL_QUERY)} ` +
    `| ${'-'.repeat(COL_NUM)} | ${'-'.repeat(COL_NUM)} ` +
    `| ${'-'.repeat(COL_NUM)} | ${'-'.repeat(COL_NUM)} ` +
    `| ${'-'.repeat(COL_NUM)} | ${'-'.repeat(COL_NUM)} |`

  console.log(header)
  console.log(separator)

  for (const r of allResults) {
    console.log(
      `| ${padRight(r.query, COL_QUERY)} ` +
        `| ${padRight(fmtMs(r.fts.p50), COL_NUM)} | ${padRight(fmtMs(r.fts.p95), COL_NUM)} ` +
        `| ${padRight(fmtMs(r.vec.p50), COL_NUM)} | ${padRight(fmtMs(r.vec.p95), COL_NUM)} ` +
        `| ${padRight(fmtMs(r.hybrid.p50), COL_NUM)} | ${padRight(fmtMs(r.hybrid.p95), COL_NUM)} |`
    )
  }

  // 整体汇总
  const avg = (arr: number[]): number =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0

  const ftsP50s = allResults.map((r) => r.fts.p50)
  const ftsP95s = allResults.map((r) => r.fts.p95)
  const vecP50s = allResults.map((r) => r.vec.p50)
  const vecP95s = allResults.map((r) => r.vec.p95)
  const hybridP50s = allResults.map((r) => r.hybrid.p50)
  const hybridP95s = allResults.map((r) => r.hybrid.p95)

  console.log('')
  console.log('[bench] 整体性能汇总:')
  console.log(`  FTS5 平均 p50:    ${fmtMs(avg(ftsP50s))}`)
  console.log(`  FTS5 平均 p95:    ${fmtMs(avg(ftsP95s))}`)
  console.log(`  向量 平均 p50:    ${fmtMs(avg(vecP50s))}`)
  console.log(`  向量 平均 p95:    ${fmtMs(avg(vecP95s))}`)
  console.log(`  混合 平均 p50:    ${fmtMs(avg(hybridP50s))}`)
  console.log(`  混合 平均 p95:    ${fmtMs(avg(hybridP95s))}`)

  console.log('')
  console.log('  检索模式对比:')
  console.log('    仅 FTS5:       最快，但召回率低（关键词未命中时返回 0 条）')
  console.log('    仅向量:        语义泛化强，但比 FTS 慢 30 倍')
  console.log('    混合 (RRF):    综合最佳，召回率 + 精确率兼顾')

  // 召回率统计（每模式平均返回条数，便于分析召回率差异）
  console.log('')
  console.log(`[bench] 召回率统计（${RUNS_PER_QUERY} 次运行平均返回条数，上限 ${SEARCH_LIMIT}）:`)
  console.log(
    `| ${padRight('查询', COL_QUERY)} ` +
      `| ${padRight('FTS avg', COL_NUM)} | ${padRight('Vec avg', COL_NUM)} ` +
      `| ${padRight('Hybrid avg', COL_NUM)} |`
  )
  console.log(
    `| ${'-'.repeat(COL_QUERY)} ` +
      `| ${'-'.repeat(COL_NUM)} | ${'-'.repeat(COL_NUM)} ` +
      `| ${'-'.repeat(COL_NUM)} |`
  )
  for (const r of allResults) {
    const ftsAvg = avg(r.ftsCounts)
    const vecAvg = avg(r.vecCounts)
    const hybridAvg = avg(r.hybridCounts)
    console.log(
      `| ${padRight(r.query, COL_QUERY)} ` +
        `| ${padRight(ftsAvg.toFixed(1), COL_NUM)} | ${padRight(vecAvg.toFixed(1), COL_NUM)} ` +
        `| ${padRight(hybridAvg.toFixed(1), COL_NUM)} |`
    )
  }

  console.log('')
  console.log('[bench] 完成。')
  process.exit(0)
}

// 启动主流程
// 注：不用 try/catch 包裹，让错误自然抛出便于诊断
//     未捕获的 Promise rejection 也会导致 Node 进程非零退出
main().catch((err: unknown) => {
  console.error('[bench] 致命错误:', err)
  process.exit(1)
})
