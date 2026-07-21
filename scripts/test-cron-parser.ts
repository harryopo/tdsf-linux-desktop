/**
 * cron-parser 单元测试
 *
 * 运行方式：
 *   npx tsx scripts/test-cron-parser.ts
 *
 * 测试覆盖（spec SubTask 6.1.4，≥ 20 用例）：
 *   1.  5 种语法：星号 / 单值N / 步进星号N / 范围N-M / 列表N,M
 *   2.  命名星期（MON/TUE/.../SUN）与数字（0-6）互转
 *   3.  命名月份（JAN/FEB/.../DEC）与数字（1-12）互转
 *   4.  闰年 / 跨年 / 跨月边界
 *   5.  时区 Asia/Shanghai（DEC-7）
 *   6.  错误表达式处理（空 / 非法 / 字段数不符）
 *
 * 所有期望时间以 ISO 8601 UTC 字符串表达，便于跨环境稳定比对。
 * 上海时区无 DST，+08:00 偏移全年固定。
 */

import {
  getNextRun,
  parseCronField,
  parseCron,
  CronParseError,
} from '../src/main/services/scheduler/cron-parser'

// ============================================================
// 测试工具函数
// ============================================================

let passCount = 0
let failCount = 0
const failures: string[] = []

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`)
    passCount++
  } else {
    console.log(`  ❌ FAIL: ${message}`)
    failCount++
    failures.push(message)
  }
}

function section(name: string): void {
  console.log('\n' + '='.repeat(60))
  console.log(`🔍 ${name}`)
  console.log('='.repeat(60))
}

/**
 * 断言 getNextRun 返回时间等于期望时间（毫秒精度）
 *
 * @param cron cron 表达式
 * @param fromISO 起点 ISO 字符串（建议带时区，如 '2026-07-21T10:30:00+08:00'）
 * @param expectedISO 期望返回时间 ISO 字符串
 * @param timezone 时区，默认 'Asia/Shanghai'
 */
function expectNextRun(
  cron: string,
  fromISO: string,
  expectedISO: string,
  timezone: string = 'Asia/Shanghai'
): Date {
  const from = new Date(fromISO)
  const expected = new Date(expectedISO)
  const actual = getNextRun(cron, from, timezone)
  const ok = actual.getTime() === expected.getTime()
  assert(
    ok,
    `cron="${cron}" from="${fromISO}" → 期望 ${expectedISO}，实际 ${actual.toISOString()}`
  )
  return actual
}

/**
 * 断言抛出 CronParseError
 */
function expectThrow(fn: () => unknown, label: string): void {
  try {
    fn()
    assert(false, `${label}：未抛出 CronParseError`)
  } catch (e) {
    if (e instanceof CronParseError) {
      assert(true, `${label}：正确抛出 CronParseError（${e.message}）`)
    } else {
      assert(
        false,
        `${label}：抛出的不是 CronParseError（实际 ${(e as Error).constructor.name}）`
      )
    }
  }
}

// ============================================================
// 用例 1：`* * * * *` 每分钟
// ============================================================
function testCase01(): void {
  section('用例 1：`* * * * *` 每分钟')
  expectNextRun(
    '* * * * *',
    '2026-07-21T10:30:00+08:00',
    '2026-07-21T10:31:00+08:00'
  )
}

// ============================================================
// 用例 2：`0 * * * *` 每小时第 0 分钟
// ============================================================
function testCase02(): void {
  section('用例 2：`0 * * * *` 每小时第 0 分钟')
  expectNextRun(
    '0 * * * *',
    '2026-07-21T10:30:00+08:00',
    '2026-07-21T11:00:00+08:00'
  )
}

// ============================================================
// 用例 3：`0 9 * * *` 每日 09:00
// ============================================================
function testCase03(): void {
  section('用例 3：`0 9 * * *` 每日 09:00')
  expectNextRun(
    '0 9 * * *',
    '2026-07-21T10:30:00+08:00',
    '2026-07-22T09:00:00+08:00'
  )
}

// ============================================================
// 用例 4：`0 18 * * *` 每日 18:00
// ============================================================
function testCase04(): void {
  section('用例 4：`0 18 * * *` 每日 18:00')
  expectNextRun(
    '0 18 * * *',
    '2026-07-21T10:30:00+08:00',
    '2026-07-21T18:00:00+08:00'
  )
}

// ============================================================
// 用例 5：`0 9 * * 1` 每周一 09:00
// ============================================================
function testCase05(): void {
  section('用例 5：`0 9 * * 1` 每周一 09:00')
  // 2026-07-21 是周二
  expectNextRun(
    '0 9 * * 1',
    '2026-07-21T10:30:00+08:00',
    '2026-07-27T09:00:00+08:00'
  )
}

// ============================================================
// 用例 6：`*/30 * * * *` 每 30 分钟
// ============================================================
function testCase06(): void {
  section('用例 6：`*/30 * * * *` 每 30 分钟')
  expectNextRun(
    '*/30 * * * *',
    '2026-07-21T10:15:00+08:00',
    '2026-07-21T10:30:00+08:00'
  )
}

// ============================================================
// 用例 7：`0 9 * * 1-5` 工作日 09:00（N-M 语法 + day-of-week）
// ============================================================
function testCase07(): void {
  section('用例 7：`0 9 * * 1-5` 工作日 09:00')
  // 2026-07-21 周二 10:30 → 下一个工作日 09:00 是周三 09:00
  expectNextRun(
    '0 9 * * 1-5',
    '2026-07-21T10:30:00+08:00',
    '2026-07-22T09:00:00+08:00'
  )
}

// ============================================================
// 用例 8：`0 9,18 * * *` 每日 09:00 和 18:00（N,M 语法）
// ============================================================
function testCase08(): void {
  section('用例 8：`0 9,18 * * *` 每日 09:00 和 18:00')
  expectNextRun(
    '0 9,18 * * *',
    '2026-07-21T10:30:00+08:00',
    '2026-07-21T18:00:00+08:00'
  )
}

// ============================================================
// 用例 9：`0 0 1 * *` 每月 1 号 00:00
// ============================================================
function testCase09(): void {
  section('用例 9：`0 0 1 * *` 每月 1 号 00:00')
  expectNextRun(
    '0 0 1 * *',
    '2026-07-21T10:30:00+08:00',
    '2026-08-01T00:00:00+08:00'
  )
}

// ============================================================
// 用例 10：`0 0 1 1 *` 每年 1 月 1 号
// ============================================================
function testCase10(): void {
  section('用例 10：`0 0 1 1 *` 每年 1 月 1 号')
  expectNextRun(
    '0 0 1 1 *',
    '2026-07-21T10:30:00+08:00',
    '2027-01-01T00:00:00+08:00'
  )
}

// ============================================================
// 用例 11：`0 9 * * MON` 命名星期
// ============================================================
function testCase11(): void {
  section('用例 11：`0 9 * * MON` 命名星期')
  // 等价于 `0 9 * * 1`（每周一 09:00）
  expectNextRun(
    '0 9 * * MON',
    '2026-07-21T10:30:00+08:00',
    '2026-07-27T09:00:00+08:00'
  )
}

// ============================================================
// 用例 12：`0 9 1 JAN *` 命名月份
// ============================================================
function testCase12(): void {
  section('用例 12：`0 9 1 JAN *` 命名月份')
  // 等价于 `0 9 1 1 *`（每年 1 月 1 日 09:00）
  expectNextRun(
    '0 9 1 JAN *',
    '2026-07-21T10:30:00+08:00',
    '2027-01-01T09:00:00+08:00'
  )
}

// ============================================================
// 用例 13：`0 9 * * 0` 周日
// ============================================================
function testCase13(): void {
  section('用例 13：`0 9 * * 0` 周日')
  // 2026-07-21 周二 → 本周日 09:00
  expectNextRun(
    '0 9 * * 0',
    '2026-07-21T10:30:00+08:00',
    '2026-07-26T09:00:00+08:00'
  )
}

// ============================================================
// 用例 14：`30 14 * * 2,4,6` 周二四六 14:30
// ============================================================
function testCase14(): void {
  section('用例 14：`30 14 * * 2,4,6` 周二四六 14:30')
  // 2026-07-21 周二 10:30 → 当日 14:30
  expectNextRun(
    '30 14 * * 2,4,6',
    '2026-07-21T10:30:00+08:00',
    '2026-07-21T14:30:00+08:00'
  )
}

// ============================================================
// 用例 15：`0-5 * * * *` 0-5 分钟（N-M 语法）
// ============================================================
function testCase15(): void {
  section('用例 15：`0-5 * * * *` 0-5 分钟（N-M 语法）')
  // 10:06 → 10:07-10:59 不匹配（分钟 7-59 不在 0-5 集合），11:00 才匹配
  expectNextRun(
    '0-5 * * * *',
    '2026-07-21T10:06:00+08:00',
    '2026-07-21T11:00:00+08:00'
  )
}

// ============================================================
// 用例 16：`0 0 29 2 *` 2 月 29 号（闰年处理）
// ============================================================
function testCase16(): void {
  section('用例 16：`0 0 29 2 *` 2 月 29 号（闰年处理）')
  // 2028 是闰年。from 选 2028-02-28 23:59 → 下一次 2028-02-29 00:00
  expectNextRun(
    '0 0 29 2 *',
    '2028-02-28T23:59:00+08:00',
    '2028-02-29T00:00:00+08:00'
  )
}

// ============================================================
// 用例 17：跨年边界（12/31 → 1/1）
// ============================================================
function testCase17(): void {
  section('用例 17：跨年边界（12/31 → 1/1）')
  expectNextRun(
    '0 0 1 1 *',
    '2026-12-31T23:59:00+08:00',
    '2027-01-01T00:00:00+08:00'
  )
}

// ============================================================
// 用例 18：跨月边界（1/31 → 2/1）
// ============================================================
function testCase18(): void {
  section('用例 18：跨月边界（1/31 → 2/1）')
  expectNextRun(
    '0 0 1 * *',
    '2026-01-31T23:59:00+08:00',
    '2026-02-01T00:00:00+08:00'
  )
}

// ============================================================
// 用例 19：时区 Asia/Shanghai 测试（UTC+8）
// ============================================================
function testCase19(): void {
  section('用例 19：时区 Asia/Shanghai 测试（UTC+8）')
  // cron `0 9 * * *` 在 Asia/Shanghai 时区每日 09:00 触发
  // from = UTC 01:00 = 上海 09:00（恰好匹配，但 getNextRun 严格大于 from，应返回次日）
  //   - 上海 09:00 = UTC 01:00，from=UTC 01:00 → 下一次匹配上海次日 09:00 = UTC 次日 01:00
  //   - 若时区错误（误用 UTC），则 from=UTC 01:00 < UTC 09:00，会返回当日 UTC 09:00（错误）
  expectNextRun(
    '0 9 * * *',
    '2026-07-21T01:00:00Z', // UTC 01:00 = 上海 09:00
    '2026-07-22T01:00:00Z', // 次日 UTC 01:00 = 上海次日 09:00
    'Asia/Shanghai'
  )

  // 反向用例：若使用 UTC 时区，同一 cron 应返回当日 UTC 09:00
  expectNextRun(
    '0 9 * * *',
    '2026-07-21T01:00:00Z',
    '2026-07-21T09:00:00Z', // UTC 时区，当日 09:00
    'UTC'
  )
}

// ============================================================
// 用例 20：错误表达式处理（空字符串 / 非法字段 / 字段过多）
// ============================================================
function testCase20(): void {
  section('用例 20：错误表达式处理')

  // 20a. 空字符串
  expectThrow(() => getNextRun('', new Date()), '20a. 空字符串')

  // 20b. 字段过多（6 个字段）
  expectThrow(() => getNextRun('0 9 * * 1 5', new Date()), '20b. 字段过多（6 个）')

  // 20c. 字段过少（4 个字段）
  expectThrow(() => getNextRun('0 9 * *', new Date()), '20c. 字段过少（4 个）')

  // 20d. day-of-week 超出范围（7）
  expectThrow(
    () => parseCronField('day-of-week', '7'),
    '20d. day-of-week=7 超出 [0,6]'
  )

  // 20e. minute 超出范围（60）
  expectThrow(() => parseCronField('minute', '60'), '20e. minute=60 超出 [0,59]')

  // 20f. 非法命名星期
  expectThrow(
    () => parseCronField('day-of-week', 'FOO'),
    '20f. 非法命名星期 FOO'
  )

  // 20g. 非法命名月份
  expectThrow(() => parseCronField('month', 'XYZ'), '20g. 非法命名月份 XYZ')

  // 20h. 步长为 0
  expectThrow(() => parseCronField('minute', '*/0'), '20h. 步长为 0')

  // 20i. 范围 start > end
  expectThrow(() => parseCronField('minute', '5-3'), '20i. 范围 5-3（start > end）')

  // 20j. parseCron 验证（顶层）
  expectThrow(() => parseCron('0 9 * *'), '20j. parseCron 字段数不足')
}

// ============================================================
// 附加用例 21：parseCronField 直接验证
// ============================================================
function testCase21(): void {
  section('附加用例 21：parseCronField 集合验证')

  // `*/15` minute → {0, 15, 30, 45}
  const set1 = parseCronField('minute', '*/15')
  assert(
    set1.size === 4 && set1.has(0) && set1.has(15) && set1.has(30) && set1.has(45),
    `*/15 → {0,15,30,45}，实际 size=${set1.size}`
  )

  // `1-5` day-of-week → {1,2,3,4,5}
  const set2 = parseCronField('day-of-week', '1-5')
  assert(
    set2.size === 5 && [1, 2, 3, 4, 5].every((v) => set2.has(v)),
    `1-5 day-of-week → {1,2,3,4,5}`
  )

  // `MON-FRI` 命名星期 → {1,2,3,4,5}
  const set3 = parseCronField('day-of-week', 'MON-FRI')
  assert(
    set3.size === 5 && [1, 2, 3, 4, 5].every((v) => set3.has(v)),
    `MON-FRI → {1,2,3,4,5}`
  )

  // `1,3,5` → {1,3,5}
  const set4 = parseCronField('hour', '1,3,5')
  assert(
    set4.size === 3 && set4.has(1) && set4.has(3) && set4.has(5),
    `1,3,5 → {1,3,5}`
  )

  // `JAN,JUL,DEC` 命名月份 → {1,7,12}
  const set5 = parseCronField('month', 'JAN,JUL,DEC')
  assert(
    set5.size === 3 && set5.has(1) && set5.has(7) && set5.has(12),
    `JAN,JUL,DEC → {1,7,12}`
  )

  // `*` minute → 0-59（60 个值）
  const set6 = parseCronField('minute', '*')
  assert(set6.size === 60, `* minute → 60 个值，实际 ${set6.size}`)

  // `0-59/15` minute → {0,15,30,45}
  const set7 = parseCronField('minute', '0-59/15')
  assert(
    set7.size === 4 && set7.has(0) && set7.has(15) && set7.has(30) && set7.has(45),
    `0-59/15 → {0,15,30,45}（扩展语法 N-M/S）`
  )
}

// ============================================================
// 主入口
// ============================================================

function main(): void {
  console.log('🚀 cron-parser 单元测试 · Phase 6.1.4')
  console.log(`   时间：${new Date().toISOString()}`)
  console.log(`   Node：${process.version}`)

  testCase01()
  testCase02()
  testCase03()
  testCase04()
  testCase05()
  testCase06()
  testCase07()
  testCase08()
  testCase09()
  testCase10()
  testCase11()
  testCase12()
  testCase13()
  testCase14()
  testCase15()
  testCase16()
  testCase17()
  testCase18()
  testCase19()
  testCase20()
  testCase21()

  console.log('\n' + '='.repeat(60))
  console.log('📊 测试结果汇总')
  console.log('='.repeat(60))
  console.log(`  ✅ PASS: ${passCount}`)
  console.log(`  ❌ FAIL: ${failCount}`)
  if (failures.length > 0) {
    console.log('\n失败用例：')
    for (const f of failures) {
      console.log(`  - ${f}`)
    }
  }
  console.log('')

  if (failCount > 0) {
    process.exit(1)
  }
}

main()
