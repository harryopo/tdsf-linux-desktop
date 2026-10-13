/**
 * tests/unit/scheduler-cron-dow-7.test.ts — 星期字段要认 7（vixie/POSIX 的星期日写法）
 *
 * 为什么钉这一条：调度器里 `0 9 * * 7`（每周日 09:00）这类写法以前直接抛
 * CronParseError（范围卡在 0-6），而 scheduler.ts 捕获后把 nextRunAt 置 null ——
 * 任务在界面上算"已注册"，实际永远不会跑。7 是用户最容易写对的星期日，
 * 必须归一到 0 而不是报错。
 *
 * 调度器的 cron 解析器此前没有任何单测覆盖（grep tests/ = 0 命中），
 * 所以这里顺带钉住三条基础行为，作为后续改动的地板。
 */
import { describe, it, expect } from 'vitest'
import { getNextRun, parseCron, parseCronField } from '../../src/main/services/scheduler/cron-parser'

const TZ = 'Asia/Shanghai'

describe('cron 的 day-of-week 字段', () => {
  it('1. 单独写 7 归一成星期日（0）', () => {
    expect(parseCronField('day-of-week', '7')).toEqual(new Set([0]))
  })

  it('2. `0 9 * * 7` 能算出下一次执行时间，且真的是星期日 09:00', () => {
    // 2026-10-13 是星期二；下一次星期日 09:00 = 2026-10-18 09:00（本地时区）
    const from = new Date('2026-10-13T00:00:00+08:00')
    const next = getNextRun('0 9 * * 7', from, TZ)
    expect(next).toBeTruthy()
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(next)
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]))
    expect(map.weekday).toBe('Sun')
    expect(Number(map.hour)).toBe(9)
    expect(map.minute).toBe('00')
  })

  it('3. 0-7 的区间写法不报错，且包含星期日（7→0）', () => {
    const set = parseCronField('day-of-week', '5-7')
    expect([...set].sort()).toEqual([0, 5, 6])
  })

  it('4. 8 仍然拒绝（归一 7 不等于放开范围）', () => {
    expect(() => parseCronField('day-of-week', '8')).toThrow()
  })

  it('5. 地板：`*\/15 * * * *` 的下次时间落在 15 分钟刻度上', () => {
    const from = new Date('2026-10-13T10:07:30+08:00')
    const next = getNextRun('*/15 * * * *', from, TZ)
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hour12: false,
      minute: '2-digit',
    }).formatToParts(next)
    const minute = Number(Object.fromEntries(p.map((x) => [x.type, x.value]))['minute'])
    expect(minute % 15).toBe(0)
    expect(next.getTime()).toBeGreaterThan(from.getTime())
  })

  it('6. 永远匹配不上的表达式：扫满 366 天有界返回，不卡住主进程', () => {
    // 2 月 30 日不存在 → 一定要把 366 天×1440 分钟全扫一遍才报错。
    // 这条判据盯的是"扫一遍"这件事的耗时：老实现每个候选分钟都新建一个
    // Intl.DateTimeFormat（52 万次），同步跑在主进程上会冻结几十秒；
    // 按时区缓存 formatter 之后应当是秒级。
    const from = new Date('2026-03-01T00:00:00+08:00')
    const started = Date.now()
    expect(() => getNextRun('0 0 30 2 *', from, TZ)).toThrow(/无匹配/)
    const cost = Date.now() - started
    expect(cost, `扫满 366 天用了 ${cost}ms，时区级 formatter 缓存没生效`).toBeLessThan(5000)
  })

  it('7. parseCron 与 parseCronField 对同一条表达式给出的星期集合一致', () => {
    const parsed = parseCron('0 9 * * 7')
    expect(parsed.dayOfWeek).toEqual(parseCronField('day-of-week', '7'))
    expect(parsed.dayOfWeekRestricted).toBe(true)
  })
})
