/**
 * Cron Parser & Scheduler 单元测试
 *
 * 测试目标（spec SubTask 6.1.4 ≥ 20 个用例）：
 *   1. cron-parser.ts：5 种语法 + 命名星期/月份 + 时区 + 边界 + 无效表达式
 *   2. scheduler.ts：register/toggle/trigger/list 接口 + 错误隔离 + 单例 + 事件
 *
 * 运行方式（必须加 --tsconfig 才能解析 @shared/* 路径别名，LRN-20260721-001）：
 *   npx tsx --tsconfig tsconfig.node.json scripts/test-cron-parser.ts
 *
 * 参考：
 *   - scripts/test-loop-engineering-smoke.ts（测试脚本模式：🚀 + section + ✅/❌ + 📊）
 *   - DEC-7：Asia/Shanghai 时区
 *   - DEC-8：自实现 cron 解析，不引入 node-cron
 */

import {
  getNextRun,
  parseCron,
  parseCronField,
  CronParseError,
} from '../src/main/services/scheduler/cron-parser'
import { Scheduler, resetScheduler } from '../src/main/services/scheduler/scheduler'

// ============================================================
// 测试工具函数
// ============================================================

let passCount = 0
let failCount = 0

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`)
    passCount++
  } else {
    console.log(`  ❌ FAIL: ${message}`)
    failCount++
  }
}

function section(name: string): void {
  console.log('\n' + '='.repeat(60))
  console.log(`🔍 ${name}`)
  console.log('='.repeat(60))
}

function expectThrows(fn: () => unknown, description: string): void {
  try {
    fn()
    assert(false, `${description}（未抛错）`)
  } catch (e) {
    assert(e instanceof Error, `${description}（已抛错: ${(e as Error).message}）`)
  }
}

async function expectThrowsAsync(fn: () => Promise<unknown>, description: string): Promise<void> {
  try {
    await fn()
    assert(false, `${description}（未抛错）`)
  } catch (e) {
    assert(e instanceof Error, `${description}（已抛错: ${(e as Error).message}）`)
  }
}

interface ShanghaiFields {
  minute: number
  hour: number
  day: number
  month: number
  year: number
  weekday: string
}

/** 提取 Asia/Shanghai 时区下的字段，用于断言返回时间 */
function getShanghaiFields(date: Date): ShanghaiFields {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  })
  const parts = fmt.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  return {
    minute: parseInt(map.minute, 10),
    hour: parseInt(map.hour, 10) % 24,
    day: parseInt(map.day, 10),
    month: parseInt(map.month, 10),
    year: parseInt(map.year, 10),
    weekday: map.weekday,
  }
}

// ============================================================
// 主测试函数
// ============================================================

async function main(): Promise<void> {
  console.log('🚀 Phase 6 Task 6.1 Cron Parser & Scheduler 单元测试')
  console.log('   测试场景：5 种 cron 语法 + 命名星期/月份 + 时区 + 边界 + 调度引擎接口')

  // ────────── Cron Parser 测试 ──────────

  section('Cron Parser: 5 种语法 + 命名星期 + 时区 + 边界')

  // 1. * 语法（5 字段全 *，应返回下一整分钟）
  {
    const from = new Date('2024-06-15T10:30:45Z')
    const next = getNextRun('* * * * *', from)
    assert(next.getTime() > from.getTime(), '* * * * * 应返回 from 之后的时间')
    const expected = new Date('2024-06-15T10:31:00Z')
    assert(next.getTime() === expected.getTime(), `* * * * * 应返回下一整分钟，实际 ${next.toISOString()}`)
  }

  // 2. N 字面量（0 9 * * * 应返回 09:00）
  {
    const from = new Date('2024-06-15T00:00:00Z') // Shanghai 08:00
    const next = getNextRun('0 9 * * *', from)
    const f = getShanghaiFields(next)
    assert(f.hour === 9 && f.minute === 0, `0 9 * * * 应返回 09:00，实际 ${f.hour}:${f.minute}`)
  }

  // 3. */N 步进（每 5 分钟）
  {
    const from = new Date('2024-06-15T10:32:00Z')
    const next = getNextRun('*/5 * * * *', from)
    const f = getShanghaiFields(next)
    assert(f.minute % 5 === 0, `*/5 应返回 5 的倍数分钟，实际 ${f.minute}`)
    assert(next.getTime() > from.getTime(), '返回时间应严格大于 from')
  }

  // 4. */15 步进
  {
    const from = new Date('2024-06-15T10:32:00Z')
    const next = getNextRun('*/15 * * * *', from)
    const f = getShanghaiFields(next)
    assert([0, 15, 30, 45].includes(f.minute), `*/15 应返回 0/15/30/45，实际 ${f.minute}`)
  }

  // 5. N-M 范围（0 9-18 * * * 应返回 9-18 点整点）
  {
    const from = new Date('2024-06-15T01:30:00Z') // Shanghai 09:30
    const next = getNextRun('0 9-18 * * *', from)
    const f = getShanghaiFields(next)
    assert(f.hour >= 9 && f.hour <= 18 && f.minute === 0, `0 9-18 * * * 应返回 9-18 点整点，实际 ${f.hour}:${f.minute}`)
  }

  // 6. N,M 列表
  {
    const from = new Date('2024-06-15T10:10:00Z')
    const next = getNextRun('0,30 * * * *', from)
    const f = getShanghaiFields(next)
    assert(f.minute === 0 || f.minute === 30, `0,30 应返回 0 或 30 分，实际 ${f.minute}`)
  }

  // 7. 命名星期 MON
  {
    const from = new Date('2024-06-15T00:00:00Z') // Saturday
    const next = getNextRun('0 9 * * MON', from)
    const f = getShanghaiFields(next)
    assert(f.weekday === 'Mon' && f.hour === 9 && f.minute === 0, `0 9 * * MON 应返回周一 09:00，实际 ${f.weekday} ${f.hour}:${f.minute}`)
  }

  // 8. 数字星期 1 = Monday（与 MON 等价）
  {
    const from = new Date('2024-06-15T00:00:00Z')
    const next1 = getNextRun('0 9 * * 1', from)
    const next2 = getNextRun('0 9 * * MON', from)
    assert(next1.getTime() === next2.getTime(), '数字 1 与 MON 应返回相同时间')
  }

  // 9. 数字星期 0 = Sunday
  {
    const from = new Date('2024-06-15T00:00:00Z') // Saturday
    const next = getNextRun('0 9 * * 0', from)
    const f = getShanghaiFields(next)
    assert(f.weekday === 'Sun' && f.hour === 9, `0 9 * * 0 应返回周日 09:00，实际 ${f.weekday}`)
  }

  // 10. 命名星期范围 MON-FRI（工作日）
  {
    const from = new Date('2024-06-15T00:00:00Z') // Saturday
    const next = getNextRun('0 9 * * MON-FRI', from)
    const f = getShanghaiFields(next)
    const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(f.weekday)
    assert(isWeekday && f.hour === 9, `MON-FRI 应返回工作日 09:00，实际 ${f.weekday}`)
  }

  // 11. 命名月份 JAN（与 1 等价）
  {
    const from = new Date('2024-06-15T00:00:00Z')
    const next1 = getNextRun('0 0 1 JAN *', from)
    const next2 = getNextRun('0 0 1 1 *', from)
    assert(next1.getTime() === next2.getTime(), 'JAN 与 1 应返回相同时间')
  }

  // 12. 时区支持 Asia/Shanghai
  {
    const from = new Date('2024-06-15T00:00:00Z') // UTC 00:00 = Shanghai 08:00
    const next = getNextRun('0 9 * * *', from, 'Asia/Shanghai')
    const f = getShanghaiFields(next)
    assert(f.hour === 9, `Shanghai 时区应返回 09:00，实际 ${f.hour}`)
    const expectedUtc = new Date('2024-06-15T01:00:00Z') // Shanghai 09:00 = UTC 01:00
    assert(next.getTime() === expectedUtc.getTime(), `UTC 应为 01:00，实际 ${next.toISOString()}`)
  }

  // 13. 边界：月末（0 0 1 * * 应返回下月 1 日 00:00）
  {
    const from = new Date('2024-06-15T10:00:00Z')
    const next = getNextRun('0 0 1 * *', from)
    const f = getShanghaiFields(next)
    assert(f.day === 1 && f.hour === 0 && f.minute === 0, `应返回下月 1 日 00:00，实际 ${f.month}/${f.day} ${f.hour}:${f.minute}`)
    assert(f.month === 7, `6 月之后应是 7 月，实际 ${f.month}`)
  }

  // 14. 边界：年末（0 0 1 1 * 应返回明年 1 月 1 日 00:00）
  {
    const from = new Date('2024-06-15T10:00:00Z')
    const next = getNextRun('0 0 1 1 *', from)
    const f = getShanghaiFields(next)
    assert(f.month === 1 && f.day === 1 && f.hour === 0, `应返回明年 1 月 1 日 00:00，实际 ${f.year}-${f.month}-${f.day}`)
    assert(f.year === 2025, `应返回 2025 年，实际 ${f.year}`)
  }

  // 15. 边界：闰年 2 月 29 日
  {
    // from 设在 2024-02-29 之前（2024 是闰年），确保 366 天扫描上限内能匹配
    const from = new Date('2024-01-01T00:00:00Z')
    const next = getNextRun('0 0 29 2 *', from)
    const f = getShanghaiFields(next)
    assert(f.month === 2 && f.day === 29, `应返回 2 月 29 日，实际 ${f.month}/${f.day}`)
    assert(f.year === 2024, `应返回 2024 年（闰年），实际 ${f.year}`)
  }

  // 16. 范围 + 步进（0-59/15）
  {
    const from = new Date('2024-06-15T10:10:00Z')
    const next = getNextRun('0-59/15 * * * *', from)
    const f = getShanghaiFields(next)
    assert([0, 15, 30, 45].includes(f.minute), `0-59/15 应返回 0/15/30/45，实际 ${f.minute}`)
  }

  // 17. 无效：字段数不足
  expectThrows(() => getNextRun('0 9 * *', new Date()), '字段数不足应抛错')

  // 18. 无效：字段数过多
  expectThrows(() => getNextRun('0 9 * * * *', new Date()), '字段数过多应抛错')

  // 19. 无效：minute 超范围
  expectThrows(() => getNextRun('60 9 * * *', new Date()), 'minute 超范围应抛错')

  // 20. 无效：非法字符
  expectThrows(() => getNextRun('a 9 * * *', new Date()), '非法字符应抛错')

  // 21. 无效：空字符串
  expectThrows(() => getNextRun('', new Date()), '空字符串应抛错')

  // 22. parseCron 返回结构正确
  {
    const parsed = parseCron('0 9 * * 1')
    assert(parsed.minute.has(0), 'parseCron minute 应包含 0')
    assert(parsed.hour.has(9), 'parseCron hour 应包含 9')
    assert(parsed.dayOfWeek.has(1), 'parseCron dayOfWeek 应包含 1')
    assert(parsed.dayOfMonthRestricted === false, 'day-of-month 为 * 时 restricted 应为 false')
    assert(parsed.dayOfWeekRestricted === true, 'day-of-week 为 1 时 restricted 应为 true')
  }

  // 23. parseCronField 独立调用
  {
    const set = parseCronField('minute', '0,15,30,45')
    assert(set.size === 4, `parseCronField 列表应返回 4 个值，实际 ${set.size}`)
    assert(set.has(0) && set.has(45), 'parseCronField 应包含 0 和 45')
  }

  // 24. CronParseError 类型与继承
  {
    try {
      getNextRun('invalid-cron', new Date())
      assert(false, '应抛错但未抛出')
    } catch (e) {
      assert(e instanceof CronParseError, '应抛出 CronParseError 类型')
      assert(e instanceof Error, 'CronParseError 应继承 Error')
    }
  }

  // ────────── Scheduler 测试 ──────────

  section('Scheduler: register/toggle/trigger/list + 错误隔离 + 单例')

  // 25. register + list 接口
  {
    resetScheduler()
    const sched = Scheduler.getInstance()
    sched.register({
      id: 'daily-health-check',
      name: '每日健康检查',
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      enabled: true,
      handler: async () => ({ success: true, summary: 'ok', durationMs: 10 }),
    })
    const list = sched.list()
    assert(list.length === 1, `list 应有 1 个任务，实际 ${list.length}`)
    assert(list[0].id === 'daily-health-check', 'id 应匹配')
    assert(list[0].nextRunAt !== null, 'enabled 任务应有 nextRunAt')
  }

  // 26. toggle 启停接口
  {
    const sched = Scheduler.getInstance()
    sched.toggle('daily-health-check', false)
    const disabled = sched.list()
    assert(disabled[0].enabled === false, 'toggle(false) 后 enabled 应为 false')
    assert(disabled[0].nextRunAt === null, '禁用后 nextRunAt 应为 null')

    sched.toggle('daily-health-check', true)
    const enabled = sched.list()
    assert(enabled[0].enabled === true, 'toggle(true) 后 enabled 应为 true')
    assert(enabled[0].nextRunAt !== null, '启用后 nextRunAt 应不为 null')
  }

  // 27. trigger 立即触发接口
  {
    const sched = Scheduler.getInstance()
    const result = await sched.trigger('daily-health-check')
    assert(result.success === true, 'trigger 应返回成功结果')
    assert(result.summary === 'ok', `summary 应为 'ok'，实际 '${result.summary}'`)
    assert(typeof result.durationMs === 'number', 'durationMs 应为数字')
  }

  // 28. trigger 后 lastResult / lastRunAt 更新
  {
    const sched = Scheduler.getInstance()
    await sched.trigger('daily-health-check')
    const list = sched.list()
    assert(list[0].lastResult !== null, 'trigger 后 lastResult 应不为 null')
    assert(list[0].lastRunAt !== null, 'trigger 后 lastRunAt 应不为 null')
  }

  // 29. 错误隔离：一个任务失败不影响其他任务
  {
    resetScheduler()
    const sched = Scheduler.getInstance()
    sched.register({
      id: 'daily-health-check',
      name: '正常任务',
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      enabled: true,
      handler: async () => ({ success: true, summary: '正常完成', durationMs: 5 }),
    })
    sched.register({
      id: 'daily-decision-archive',
      name: '失败任务',
      cron: '0 18 * * *',
      timezone: 'Asia/Shanghai',
      enabled: true,
      handler: async () => { throw new Error('模拟失败') },
    })

    const failResult = await sched.trigger('daily-decision-archive')
    assert(failResult.success === false, '失败任务应返回 success=false')
    assert(failResult.error !== undefined, '失败任务应有 error 字段')

    const okResult = await sched.trigger('daily-health-check')
    assert(okResult.success === true, '正常任务不应受失败任务影响（错误隔离）')
  }

  // 30. 单例模式：getInstance() 两次返回同一实例
  {
    resetScheduler()
    const s1 = Scheduler.getInstance()
    const s2 = Scheduler.getInstance()
    assert(s1 === s2, 'getInstance() 两次应返回同一实例')
  }

  // 31. resetScheduler 重置单例
  {
    resetScheduler()
    const s1 = Scheduler.getInstance()
    resetScheduler()
    const s2 = Scheduler.getInstance()
    assert(s1 !== s2, 'resetScheduler 后应返回新实例')
  }

  // 32. EventEmitter 事件（task-start / task-done）
  {
    resetScheduler()
    const sched = Scheduler.getInstance()
    let startCount = 0
    let doneCount = 0
    sched.on('task-start', () => { startCount++ })
    sched.on('task-done', () => { doneCount++ })

    sched.register({
      id: 'daily-health-check',
      name: '事件测试',
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      enabled: true,
      handler: async () => ({ success: true, summary: '事件测试', durationMs: 1 }),
    })

    await sched.trigger('daily-health-check')
    assert(startCount === 1, `应触发 1 次 task-start，实际 ${startCount}`)
    assert(doneCount === 1, `应触发 1 次 task-done，实际 ${doneCount}`)
  }

  // 33. task-error 事件（handler 失败时推送）
  {
    resetScheduler()
    const sched = Scheduler.getInstance()
    let errorCount = 0
    sched.on('task-error', () => { errorCount++ })

    sched.register({
      id: 'daily-decision-archive',
      name: '失败任务',
      cron: '0 18 * * *',
      timezone: 'Asia/Shanghai',
      enabled: true,
      handler: async () => { throw new Error('测试错误') },
    })

    await sched.trigger('daily-decision-archive')
    assert(errorCount === 1, `应触发 1 次 task-error，实际 ${errorCount}`)
  }

  // 34. toggle 不存在任务应抛错
  {
    resetScheduler()
    const sched = Scheduler.getInstance()
    expectThrows(() => sched.toggle('nonexistent' as never, true), 'toggle 不存在任务应抛错')
  }

  // 35. trigger 不存在任务应抛错
  {
    const sched = Scheduler.getInstance()
    await expectThrowsAsync(() => sched.trigger('nonexistent' as never), 'trigger 不存在任务应抛错')
  }

  // ────────── 清理 ──────────
  resetScheduler()

  // ────────── 汇总 ──────────
  console.log('\n' + '='.repeat(60))
  console.log('📊 测试汇总')
  console.log('='.repeat(60))
  console.log(`  ✅ 通过: ${passCount}`)
  console.log(`  ❌ 失败: ${failCount}`)
  console.log('='.repeat(60))

  if (failCount > 0) {
    console.log('\n❌ 测试失败，请检查 cron-parser.ts / scheduler.ts')
    process.exit(1)
  } else {
    console.log('\n✅ 全部测试通过！Cron 调度引擎核心基础设施就绪')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('\n💥 测试执行异常:', err)
  process.exit(2)
})
