/**
 * 调度器的"占位任务"不许回来（#228）
 *
 * 背景：调度器有三个定时任务（每日 09:00 巡检 / 每日 18:00 决策归档 / 每周一周报），
 * 三条都真在 `src/main/ipc/scheduler.ts` 里注册。但同一批文件里还留着两个**没人调用的占位工厂**：
 * - `createDailyDecisionArchiveTask()`：handler 打一行 warn，然后返回 `success: true`
 *   （"归档任务跳过：未注入 repository"）——调度面板会把它显示成"成功"；
 * - `createWeeklyOpsReportTask()`：拿两个 Placeholder 仓储（永远返回空数据）跑周报。
 * 名字最顺手的那个恰恰是假的：下一个人照着名字接线，得到的是"每天准点报成功、什么都没做"。
 * 真实在用的是 `...WithRepos` 两个变体。按本仓口径（不留半态）整删占位版。
 *
 * 判据怎么防自己变哑：禁用形状按"整名 + 左括号"匹配，`...WithRepos(` 不会被误伤（第 1 条的对照）；
 * 第 3 条把真在跑的两个变体钉住，谁把它们删了当场红。
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..', '..')

/** 整名 + 左括号：`createDailyDecisionArchiveTaskWithRepos(` 里 Task 后面是 W，匹配不上 */
const BANNED_CALLS = [
  /\bcreateDailyDecisionArchiveTask\s*\(/,
  /\bcreateWeeklyOpsReportTask\s*\(/,
]
const BANNED_SHAPES = ['PlaceholderDecisionRepo', 'PlaceholderKnowledgeRepo']

function walk(dir: string, out: string[]): string[] {
  for (const e of readdirSync(dir)) {
    const abs = join(dir, e)
    if (statSync(abs).isDirectory()) walk(abs, out)
    else if (/\.tsx?$/.test(e)) out.push(abs)
  }
  return out
}

function srcFiles(): Array<{ file: string; text: string }> {
  return walk(join(ROOT, 'src'), []).map((abs) => ({
    file: relative(ROOT, abs).replace(/\\/g, '/'),
    text: readFileSync(abs, 'utf8'),
  }))
}

describe('调度器占位任务整删后的常驻判据（#228）', () => {
  it('1. src 全树没有"占位工厂调用"与"占位仓储"（且不误伤 WithRepos）', () => {
    const files = srcFiles()
    expect(files.length).toBeGreaterThanOrEqual(400)

    const hits = files.filter(
      (f) => BANNED_CALLS.some((re) => re.test(f.text)) || BANNED_SHAPES.some((s) => f.text.includes(s))
    )
    expect(hits.map((h) => h.file), '这些文件还留着占位工厂/占位仓储').toEqual([])

    // 对照：整名 + 左括号的写法不会命中 WithRepos 变体（防这条判据以后被"松化成前缀匹配"）
    const withRepos = 'createDailyDecisionArchiveTaskWithRepos(d, k)'
    expect(BANNED_CALLS.some((re) => re.test(withRepos))).toBe(false)
    // 注入正样本：真写出来必须命中
    expect(BANNED_CALLS.some((re) => re.test('scheduler.register(createDailyDecisionArchiveTask())'))).toBe(true)
    expect(BANNED_CALLS.some((re) => re.test('scheduler.register(createWeeklyOpsReportTask())'))).toBe(true)
    expect(BANNED_SHAPES.some((s) => 'new PlaceholderDecisionRepo()'.includes(s))).toBe(true)
  })

  it('2. 真在跑的 WithRepos 两个变体必须还在，且仍由 ipc/scheduler.ts 注册', () => {
    const archive = join(ROOT, 'src/main/services/scheduler/daily-decision-archive.ts')
    const weekly = join(ROOT, 'src/main/services/scheduler/weekly-ops-report.ts')
    expect(existsSync(archive)).toBe(true)
    expect(existsSync(weekly)).toBe(true)
    expect(readFileSync(archive, 'utf8')).toContain('createDailyDecisionArchiveTaskWithRepos')
    expect(readFileSync(weekly, 'utf8')).toContain('createWeeklyOpsReportTaskWithRepos')

    const ipc = readFileSync(join(ROOT, 'src/main/ipc/scheduler.ts'), 'utf8')
    expect(ipc).toContain('createDailyDecisionArchiveTaskWithRepos(')
    expect(ipc).toContain('createWeeklyOpsReportTaskWithRepos(')
    // 首页巡检那条不在这两个文件里，但它同样必须真注册（否则倒计时显示一个不存在的任务）
    expect(ipc).toContain('createDailyHealthCheckTask(')
  })

  it('3. 调度器里注册的就是三条任务，名字与 id 对得上', () => {
    const Ipc = readFileSync(join(ROOT, 'src/main/ipc/scheduler.ts'), 'utf8')
    for (const id of ['daily-health-check', 'daily-decision-archive', 'weekly-ops-report']) {
      expect(Ipc.includes(id), `ipc/scheduler.ts 里找不到任务 id：${id}`).toBe(true)
    }
    const registers = Ipc.match(/scheduler\.register\(/g) ?? []
    expect(registers.length, '注册次数与三条任务对不上').toBe(3)
  })
})
