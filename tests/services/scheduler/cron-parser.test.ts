/**
 * tests/services/scheduler/cron-parser.test.ts
 *
 * 为什么有这个套件：
 *   `scripts/test-cron-parser.ts` 已删（那不是 vitest 套件，是手写 assert 脚本），
 *   cron 的语法面与时区边界一度没有任何常驻判据。这里从**当前实现**和**真实调用点**
 *   重新写断言，不照搬旧脚本——旧脚本里的期望若当时写错，照搬就是把错带回来。
 *
 * 被测对象：src/main/services/scheduler/cron-parser.ts
 *   - FIELD_RANGES / WEEKDAY_NAMES / MONTH_NAMES
 *   - parseSingleValue()：纯数字、前导零、命名星期、命名月份
 *   - parseFieldPart()：`*` / `N` / `*\/N` / `N-M` / `N-M/S`、步长校验、范围校验、start>end
 *   - parseCronField()：逗号列表、空值、末尾 7→0 归一
 *   - parseCron()：5 字段切割、dayOfMonthRestricted / dayOfWeekRestricted 标记
 *   - extractFields() + matchCron() + getNextRun()：时区字段提取、DOM/DOW 并集语义、
 *     「严格大于 from 的第一个整分钟」、366 天上限
 *
 * 与既有 tests/unit/scheduler-cron-dow-7.test.ts 的分工（不重复覆盖）：
 *   那边钉的是 DOW=7 归一、`*` 配 `/15` 的步进地板、以及「扫满 366 天时 formatter 只建一个」的性能机制；
 *   这边钉语法面、并集语义、时区换算、以及 5 字段表达不了的模式必须抛错。
 *
 * 一致性锚点（用户要求）：package.json 里没有 cron 字段（已核，无该配置），
 *   调度器消费的字段来自 @shared/scheduler-types 的 SchedulerTask.cron / .timezone，
 *   主进程在 scheduler.ts:157 调 `getNextRun(task.cron, new Date(), tz)`，
 *   并在 scheduler.ts:158 把结果存成 `nextRunAt = next.getTime()`（epoch ms）。
 *   下面「与真实调用点一致」那组直接从三个任务源文件里**读常量**再断言语义，
 *   而不是把 `'0 9 * * *'` 抄进测试（抄进去就测不到源码改动）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SchedulerTask } from '../../../src/shared/scheduler-types'
import {
  CronParseError,
  getNextRun,
  parseCron,
  parseCronField,
} from '../../../src/main/services/scheduler/cron-parser'

const TZ = 'Asia/Shanghai'

/** 把 UTC 时间投影到指定时区的墙上字段，用于断言「界面上看到的时间」 */
function wallClock(date: Date, timeZone = TZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(date)
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value])) as Record<string, string>
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    weekday: map.weekday,
  }
}

/** 升序数组，便于断言集合内容（Set 的顺序不可依赖） */
function sorted(set: Set<number>): number[] {
  return [...set].sort((a, b) => a - b)
}

/** 从任务源文件里读私有常量（不 import 模块，避免把 ssh / electron-store 拖进测试） */
function readCronConst(file: string, constName: string): string {
  const text = readFileSync(resolve(process.cwd(), 'src/main/services/scheduler', file), 'utf8')
  const m = new RegExp(`const ${constName} = '([^']+)'`).exec(text)
  if (!m) throw new Error(`${file} 里找不到 ${constName}，一致性判据的前提没了`)
  return m[1]
}

// ─────────────────────────────────────────────────────────────
// parseCronField：5 种语法 + 命名 + 边界（对应 FIELD_RANGES / parseFieldPart）
// ─────────────────────────────────────────────────────────────
describe('parseCronField · 语法面', () => {
  it('`*` 在各字段展开为该字段的完整取值范围（FIELD_RANGES）', () => {
    expect(sorted(parseCronField('minute', '*'))).toEqual(
      Array.from({ length: 60 }, (_, i) => i)
    )
    expect(sorted(parseCronField('hour', '*'))).toEqual(Array.from({ length: 24 }, (_, i) => i))
    expect(sorted(parseCronField('day-of-month', '*'))).toEqual(
      Array.from({ length: 31 }, (_, i) => i + 1)
    )
    expect(sorted(parseCronField('month', '*'))).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    // day-of-week 的 range 是 0-7，`*` 填出 0..7，再由 parseCronField 末尾把 7 归一到 0
    // → 集合最终是 0..6（7 个值）。这条能抓住「把 range 改成 0-6」这类回退。
    expect(sorted(parseCronField('day-of-week', '*'))).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('`*/n` 按步进取值，且被字段上限截断（parseFieldPart 的 `*` + step 分支）', () => {
    expect(sorted(parseCronField('minute', '*/15'))).toEqual([0, 15, 30, 45])
    // hour 上限 23：0,5,10,15,20 —— 25 已经越界，不能凭空补一个 25
    expect(sorted(parseCronField('hour', '*/5'))).toEqual([0, 5, 10, 15, 20])
  })

  it('`N-M` 含两端（parseFieldPart 的 range 分支）', () => {
    expect(sorted(parseCronField('hour', '9-18'))).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18])
  })

  it('`N-M/S` 从 N 起步、每 S 取一个（扩展语法）', () => {
    expect(sorted(parseCronField('minute', '0-30/10'))).toEqual([0, 10, 20, 30])
    expect(sorted(parseCronField('minute', '1-5/2'))).toEqual([1, 3, 5])
  })

  it('`N,M` 列表与「列表里混范围」都按逗号拆分后合并', () => {
    expect(sorted(parseCronField('minute', '0,30'))).toEqual([0, 30])
    expect(sorted(parseCronField('minute', '1-3,10'))).toEqual([1, 2, 3, 10])
  })

  it('命名星期与命名月份走 parseSingleValue 的查表分支', () => {
    // 0=Sun, 1=Mon … 5=Fri
    expect(sorted(parseCronField('day-of-week', 'MON-FRI'))).toEqual([1, 2, 3, 4, 5])
    expect(sorted(parseCronField('month', 'JAN-MAR'))).toEqual([1, 2, 3])
    // 大小写不敏感（实现里做了 toUpperCase）
    expect(sorted(parseCronField('day-of-week', 'sat'))).toEqual([6])
  })

  it('前导零按十进制解析（`07` 是 7，不是八进制）', () => {
    expect(sorted(parseCronField('minute', '07'))).toEqual([7])
  })
})

// ─────────────────────────────────────────────────────────────
// 非法表达式：必须抛 CronParseError，而不是"静默返回一个空集合/默认值"
// ─────────────────────────────────────────────────────────────
describe('非法表达式 · 一律抛 CronParseError', () => {
  it('空字段与纯空白字段（parseCronField 入口的空值分支）', () => {
    expect(() => parseCronField('minute', '')).toThrow(CronParseError)
    expect(() => parseCronField('minute', '   ')).toThrow(CronParseError)
  })

  it('列表里出现空项（`1,,5`）', () => {
    expect(() => parseCronField('minute', '1,,5')).toThrow(CronParseError)
  })

  it('步长为 0 或非数字（`*/0`、`*/x`）', () => {
    expect(() => parseCronField('minute', '*/0')).toThrow(/步长必须 > 0/)
    expect(() => parseCronField('minute', '*/x')).toThrow(/步长非法/)
  })

  it('超界：minute 60、day-of-month 32、month 13、day-of-week 8', () => {
    expect(() => parseCronField('minute', '60')).toThrow(/超出范围/)
    expect(() => parseCronField('day-of-month', '32')).toThrow(/超出范围/)
    expect(() => parseCronField('month', '13')).toThrow(/超出范围/)
    expect(() => parseCronField('day-of-week', '8')).toThrow(/超出范围/)
  })

  it('范围倒置 `5-1`，以及只写半个范围 `5-` / `-1`', () => {
    expect(() => parseCronField('hour', '5-1')).toThrow(/start > end/)
    expect(() => parseCronField('hour', '5-')).toThrow(CronParseError)
    expect(() => parseCronField('minute', '-1')).toThrow(CronParseError)
  })

  it('parseCron 的字段数必须是 5（多一个少一个都拒绝）', () => {
    expect(() => parseCron('0 9 * *')).toThrow(/必须为 5 个字段/)
    expect(() => parseCron('0 9 * * * *')).toThrow(/必须为 5 个字段/)
    expect(() => parseCron('')).toThrow(/为空/)
    expect(() => parseCron('   ')).toThrow(/为空/)
  })

  it('错误对象带出字段名与原始串，供界面定位（CronParseError 的 field/raw）', () => {
    try {
      parseCronField('minute', 'abc')
      expect.unreachable('应当抛错')
    } catch (e) {
      expect(e).toBeInstanceOf(CronParseError)
      expect((e as CronParseError).field).toBe('minute')
      expect((e as CronParseError).raw).toBe('abc')
    }
    // 顶层解析（字段数不对）拿不到具体字段，field 应为 undefined
    try {
      parseCron('0 9 * *')
      expect.unreachable('应当抛错')
    } catch (e) {
      expect((e as CronParseError).field).toBeUndefined()
    }
  })
})

// ─────────────────────────────────────────────────────────────
// parseCron：restricted 标记决定 matchCron 走哪条并集分支
// ─────────────────────────────────────────────────────────────
describe('parseCron · DOM/DOW 限制标记', () => {
  it('四个组合的标记与字段集合都对得上（对应 parseCron 的 isRestricted）', () => {
    const both = parseCron('0 9 1 * 1')
    expect(both.dayOfMonthRestricted).toBe(true)
    expect(both.dayOfWeekRestricted).toBe(true)
    expect(sorted(both.dayOfMonth)).toEqual([1])
    expect(sorted(both.dayOfWeek)).toEqual([1])

    const domOnly = parseCron('0 9 15 * *')
    expect(domOnly.dayOfMonthRestricted).toBe(true)
    expect(domOnly.dayOfWeekRestricted).toBe(false)

    const dowOnly = parseCron('0 9 * * 3')
    expect(dowOnly.dayOfMonthRestricted).toBe(false)
    expect(dowOnly.dayOfWeekRestricted).toBe(true)

    const neither = parseCron('0 9 * * *')
    expect(neither.dayOfMonthRestricted).toBe(false)
    expect(neither.dayOfWeekRestricted).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// getNextRun：时间语义 + matchCron 三段并集
// ─────────────────────────────────────────────────────────────
describe('getNextRun · 时间语义', () => {
  it('`* * * * *` 返回严格大于 from 的下一个整分钟（丢秒/毫秒）', () => {
    const from = new Date('2026-11-06T10:30:45.500Z')
    const next = getNextRun('* * * * *', from, TZ)
    expect(next.toISOString()).toBe('2026-11-06T10:31:00.000Z')
  })

  it('from 恰好命中时仍返回下一次，而不是原地返回（日期算术的边界）', () => {
    // 2026-11-06 09:00 上海 = 01:00Z；`0 9 * * *` 命中该分钟
    const from = new Date('2026-11-06T01:00:00.000Z')
    const next = getNextRun('0 9 * * *', from, TZ)
    expect(next.toISOString()).toBe('2026-11-07T01:00:00.000Z')
  })

  it('仅 day-of-month 被限制：只按日期匹配（matchCron 的第二分支）', () => {
    const from = new Date('2026-11-06T00:00:00Z') // 上海 11-06 08:00
    const next = getNextRun('0 0 15 * *', from, TZ)
    expect(next.toISOString()).toBe('2026-11-14T16:00:00.000Z') // 上海 11-15 00:00
    expect(wallClock(next)).toMatchObject({ month: 11, day: 15, hour: 0, minute: 0 })
  })

  it('仅 day-of-week 被限制：只按星期匹配（matchCron 的第三分支）', () => {
    const from = new Date('2026-11-06T00:00:00Z') // 上海周五
    const next = getNextRun('0 0 * * 3', from, TZ)
    expect(next.toISOString()).toBe('2026-11-10T16:00:00.000Z') // 上海 11-11 周三 00:00
    expect(wallClock(next).weekday).toBe('Wed')
  })

  it('两字段都被限制 → 取并集（OR），不是交集（matchCron 的第一分支）', () => {
    // 2026-10-13 周二 08:00 上海起，`0 0 1 * 1` 同时表示「每月 1 日」和「每周一」。
    // 并集语义下下一次是 10-19 周一，而不是等到 11-01。
    const from = new Date('2026-10-13T00:00:00Z')
    const next = getNextRun('0 0 1 * 1', from, TZ)
    expect(next.toISOString()).toBe('2026-10-18T16:00:00.000Z') // 上海 10-19 00:00
    expect(wallClock(next)).toMatchObject({ month: 10, day: 19, weekday: 'Mon' })
  })

  it('两字段都是 `*`：日期部分恒匹配，取次日零点（matchCron 的末尾兜底）', () => {
    const from = new Date('2026-10-13T00:00:00Z')
    const next = getNextRun('0 0 * * *', from, TZ)
    expect(next.toISOString()).toBe('2026-10-13T16:00:00.000Z') // 上海 10-14 00:00
  })
})

// ─────────────────────────────────────────────────────────────
// 证伪：5 字段表达不了「每月第几个周五」，必须抛错或给出可解释的错答案
// ─────────────────────────────────────────────────────────────
describe('5 字段表达不了的模式：不能静默给出"看似正确"的时间', () => {
  it('`FRI#3` / `5#3` 这类 nth-weekday 写法直接抛错，不被当成普通星期吃掉', () => {
    expect(() => parseCron('0 9 * * FRI#3')).toThrow(CronParseError)
    expect(() => parseCron('0 9 * * 5#3')).toThrow(/值非法/)
    expect(() => getNextRun('0 9 * * 5#3', new Date('2026-11-06T00:00:00Z'), TZ)).toThrow(
      CronParseError
    )
  })

  it('用 `20 号 + 周五` 模仿"第三个周五"会被 OR 语义拆成两个条件，可被证伪', () => {
    // 2026-11 的第三个周五是 11-20；2027-05 的第三个周五是 05-21。
    // `0 9 20 * 5` 看上去像"20 号且周五"，实测是「20 号 或 周五」：
    // 从 2027-05-19（周三）起算，它会给出 05-20 09:00 —— 那天是周四，不是第三个周五。
    const next = getNextRun('0 9 20 * 5', new Date('2027-05-19T00:00:00Z'), TZ)
    expect(next.toISOString()).toBe('2027-05-20T01:00:00.000Z') // 上海 05-20 09:00
    expect(wallClock(next).weekday).toBe('Thu')
    // 真正的第三个周五是 05-21；这条断言证明上面的结果不是"第三个周五"
    expect(wallClock(next).day).not.toBe(21)
    // 标记也印证了 OR：两个字段都被判为 restricted
    const parsed = parseCron('0 9 20 * 5')
    expect(parsed.dayOfMonthRestricted && parsed.dayOfWeekRestricted).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// 时区换算（extractFields 用 Intl 提取指定时区的墙上字段）
// ─────────────────────────────────────────────────────────────
describe('时区换算', () => {
  it('同一 UTC 起点下，Asia/Shanghai 与 UTC 的 09:00 相差正好 8 小时', () => {
    const from = new Date('2026-11-06T00:00:00.000Z')
    const shanghai = getNextRun('0 9 * * *', from, 'Asia/Shanghai')
    const utc = getNextRun('0 9 * * *', from, 'UTC')
    expect(shanghai.toISOString()).toBe('2026-11-06T01:00:00.000Z')
    expect(utc.toISOString()).toBe('2026-11-06T09:00:00.000Z')
    expect(utc.getTime() - shanghai.getTime()).toBe(8 * 60 * 60 * 1000)
  })

  it('跨 DST 切换日：本地 02:30 不存在的那天会被跳过，而不是凭空造一个时间', () => {
    // 2026-03-08 是美国夏令时开始（本地 02:00 直接跳到 03:00），当天没有 02:30。
    // 实现是逐 UTC 分钟投影回本地字段，所以那一天不会有匹配；下一次应是 03-09 02:30 EDT。
    const from = new Date('2026-03-08T00:00:00-05:00')
    const next = getNextRun('30 2 * * *', from, 'America/New_York')
    expect(next.toISOString()).toBe('2026-03-09T06:30:00.000Z')
    expect(wallClock(next, 'America/New_York')).toMatchObject({
      month: 3,
      day: 9,
      hour: 2,
      minute: 30,
    })
  })
})

// ─────────────────────────────────────────────────────────────
// 与调度器真实调用点一致：SchedulerTask 的 cron/timezone → nextRunAt(epoch ms)
// ─────────────────────────────────────────────────────────────
describe('与调度器实际消费字段一致', () => {
  it('SchedulerTask 上被消费的 cron/timezone 能直接喂给 getNextRun，结果是整数 epoch ms', () => {
    // 对齐 scheduler.ts:156-158：`const tz = task.timezone || this.timezone`
    //                          `const next = getNextRun(task.cron, new Date(), tz)`
    //                          `nextRunAt = next.getTime()`
    const task: SchedulerTask = {
      // SchedulerTaskId 是三个真实任务的封闭联合，没有任意 id 的位置
      id: 'daily-health-check',
      name: '探针',
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      enabled: true,
      handler: async () => ({ success: true, summary: '', durationMs: 0 }),
    }
    expect(task.cron.trim().split(/\s+/)).toHaveLength(5)

    const next = getNextRun(task.cron, new Date('2026-11-06T00:00:00Z'), task.timezone)
    expect(Number.isInteger(next.getTime())).toBe(true)
    // nextRunAt 存的是 epoch ms，不是 Date 对象；list() 会原样把它送过 IPC
    expect(typeof next.getTime()).toBe('number')
  })

  it('三个真实任务的 cron 常量都能解析，且语义与文件头注明的触发时间一致', () => {
    // 这些常量是各任务文件里的私有 const，不 import 模块（会拖进 ssh / electron-store），
    // 直接读源码文本 —— 常量一旦被改，这条会红，不会像"抄一份字符串进测试"那样睡着。
    const from = new Date('2026-11-06T00:00:00Z') // 上海 11-06（周五）08:00

    const healthCron = readCronConst('daily-health-check.ts', 'DAILY_HEALTH_CHECK_CRON')
    expect(healthCron).toBe('0 9 * * *')
    // scheduler.ts 的 DEFAULT_TIMEZONE 也是 Asia/Shanghai（DEC-7）
    expect(readCronConst('daily-health-check.ts', 'DEFAULT_TIMEZONE')).toBe(TZ)
    expect(getNextRun(healthCron, from, TZ).toISOString()).toBe('2026-11-06T01:00:00.000Z')

    const archiveCron = readCronConst('daily-decision-archive.ts', 'DAILY_DECISION_ARCHIVE_CRON')
    expect(archiveCron).toBe('0 18 * * *')
    expect(readCronConst('daily-decision-archive.ts', 'DEFAULT_TIMEZONE')).toBe(TZ)
    expect(getNextRun(archiveCron, from, TZ).toISOString()).toBe('2026-11-06T10:00:00.000Z')

    const weeklyCron = readCronConst('weekly-ops-report.ts', 'WEEKLY_OPS_REPORT_CRON')
    expect(weeklyCron).toBe('0 9 * * 1')
    expect(readCronConst('weekly-ops-report.ts', 'DEFAULT_TIMEZONE')).toBe(TZ)
    // 周五之后的下一次周一 09:00 = 11-09；若 DOW 被误当 0（周日）这里会变成 11-08
    const weeklyNext = getNextRun(weeklyCron, from, TZ)
    expect(weeklyNext.toISOString()).toBe('2026-11-09T01:00:00.000Z')
    expect(wallClock(weeklyNext)).toMatchObject({ day: 9, weekday: 'Mon', hour: 9, minute: 0 })
  })
})
