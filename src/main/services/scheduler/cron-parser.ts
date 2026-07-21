/**
 * 5 字段 cron 表达式解析器
 *
 * 设计目标（DEC-8：不引入 node-cron 外部依赖）：
 *   纯函数、无副作用、易测试；单文件覆盖解析 + 下次时间计算。
 *
 * 支持的 5 种语法：
 *   - `*`     所有值（minute 字段即 0-59）
 *   - `N`     单值（如 `0`）
 *   - `*\/N`   步进（如 `*\/15` = 0,15,30,45）
 *   - `N-M`   范围（含两端，如 `1-5`）
 *   - `N,M`   列表（多值，如 `1,3,5`）
 *
 * 支持命名星期（`SUN`/`MON`/`TUE`/`WED`/`THU`/`FRI`/`SAT`，0=Sunday）
 * 支持命名月份（`JAN`/`FEB`/.../`DEC`，1=January）
 *
 * 算法（spec SubTask 6.1.1）：
 *   从 from 开始逐分钟递增，找到第一个匹配的 Date（最多扫描 366 天避免死循环）。
 *
 * 时区处理（DEC-7）：
 *   使用 Node.js 内置 Intl.DateTimeFormat 提取指定时区下的字段值，
 *   避免手动处理 DST（夏令时），不引入额外依赖。
 */

/** cron 表达式 5 个字段名 */
export type CronField = 'minute' | 'hour' | 'day-of-month' | 'month' | 'day-of-week'

/**
 * Cron 解析错误
 *
 * 包含出错字段与原始字符串，便于定位问题（如 UI 显示 "minute 字段非法: abc"）。
 */
export class CronParseError extends Error {
  constructor(
    message: string,
    /** 出错字段（顶层解析时可能为 undefined） */
    public readonly field?: CronField,
    /** 原始字符串 */
    public readonly raw?: string
  ) {
    super(message)
    this.name = 'CronParseError'
    // 维持 instanceof 在编译/转译后仍可用
    Object.setPrototypeOf(this, CronParseError.prototype)
  }
}

/** 星期命名（索引 = 数字值，0=Sunday） */
const WEEKDAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const
/** 月份命名（索引 + 1 = 数字值，1=January） */
const MONTH_NAMES = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const

/** 各字段取值范围 */
const FIELD_RANGES: Record<CronField, { min: number; max: number }> = {
  'minute': { min: 0, max: 59 },
  'hour': { min: 0, max: 23 },
  'day-of-month': { min: 1, max: 31 },
  'month': { min: 1, max: 12 },
  'day-of-week': { min: 0, max: 6 },
}

/**
 * 解析后的 cron 表达式
 *
 * `dayOfMonthRestricted` / `dayOfWeekRestricted` 标记对应字段是否为非 `*`，
 * 用于实现 cron 标准的 day-of-month / day-of-week 并集语义：
 *   - 两字段都被限制时取并集（任一满足即匹配）
 *   - 仅一字段被限制时只校验该字段
 *   - 都为 `*` 时日期部分恒匹配
 */
export interface ParsedCron {
  /** 分钟值集合（0-59） */
  minute: Set<number>
  /** 小时值集合（0-23） */
  hour: Set<number>
  /** 日期值集合（1-31） */
  dayOfMonth: Set<number>
  /** 月份值集合（1-12） */
  month: Set<number>
  /** 星期值集合（0-6，0=Sunday） */
  dayOfWeek: Set<number>
  /** day-of-month 是否被显式限制（非 `*`） */
  dayOfMonthRestricted: boolean
  /** day-of-week 是否被显式限制（非 `*`） */
  dayOfWeekRestricted: boolean
}

/**
 * 解析单值（支持纯数字 / 命名星期 / 命名月份）
 *
 * @throws CronParseError 值非法或超出字段范围
 */
function parseSingleValue(raw: string, field: CronField): number {
  const trimmed = raw.trim()
  if (trimmed === '') {
    throw new CronParseError(`字段 "${field}" 包含空值`, field, raw)
  }
  // 纯数字（允许前导零，如 "07"）
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10)
  }
  // 命名星期（仅 day-of-week 字段）
  if (field === 'day-of-week') {
    const upper = trimmed.toUpperCase()
    const idx = WEEKDAY_NAMES.indexOf(upper as (typeof WEEKDAY_NAMES)[number])
    if (idx !== -1) return idx
  }
  // 命名月份（仅 month 字段）
  if (field === 'month') {
    const upper = trimmed.toUpperCase()
    const idx = MONTH_NAMES.indexOf(upper as (typeof MONTH_NAMES)[number])
    if (idx !== -1) return idx + 1 // 月份从 1 开始
  }
  throw new CronParseError(`字段 "${field}" 值非法: "${raw}"`, field, raw)
}

/**
 * 解析 cron 单字段，返回所有合法值集合
 *
 * 支持 5 种基本语法 + 组合：
 *   - `*`           所有值
 *   - `N`           单值
 *   - `*\/N`         步进
 *   - `N-M`         范围
 *   - `N,M`         列表
 *   - `N-M/S`       范围 + 步进（扩展语法，兼容标准 cron）
 *   - `MON-FRI`     命名范围
 *
 * @param field 字段名
 * @param raw 原始字符串
 * @returns 合法值集合
 * @throws CronParseError 字段非法
 */
export function parseCronField(field: CronField, raw: string): Set<number> {
  if (!raw || raw.trim() === '') {
    throw new CronParseError(`字段 "${field}" 为空`, field, raw)
  }
  const range = FIELD_RANGES[field]
  const result = new Set<number>()

  // 逗号分隔的子表达式（N,M → 多个子表达式）
  const parts = raw.split(',')
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed === '') {
      throw new CronParseError(`字段 "${field}" 包含空值`, field, raw)
    }
    parseFieldPart(field, trimmed, range, result)
  }

  if (result.size === 0) {
    throw new CronParseError(`字段 "${field}" 解析后无有效值`, field, raw)
  }
  return result
}

/**
 * 解析单个子表达式（不含逗号）
 *
 * 子表达式可能形式：`*` / `N` / `*\/N` / `N-M` / `N-M/S`
 */
function parseFieldPart(
  field: CronField,
  part: string,
  range: { min: number; max: number },
  result: Set<number>
): void {
  // 提取步进（/N）
  let step = 1
  let basePart = part
  const slashIdx = part.indexOf('/')
  if (slashIdx !== -1) {
    basePart = part.slice(0, slashIdx)
    const stepStr = part.slice(slashIdx + 1)
    if (!/^\d+$/.test(stepStr)) {
      throw new CronParseError(`字段 "${field}" 步长非法: "${part}"`, field, part)
    }
    step = parseInt(stepStr, 10)
    if (step <= 0) {
      throw new CronParseError(`字段 "${field}" 步长必须 > 0: "${part}"`, field, part)
    }
  }

  // 解析 base
  let start: number
  let end: number
  if (basePart === '*') {
    start = range.min
    end = range.max
  } else if (basePart.includes('-')) {
    const dashIdx = basePart.indexOf('-')
    const startStr = basePart.slice(0, dashIdx)
    const endStr = basePart.slice(dashIdx + 1)
    start = parseSingleValue(startStr, field)
    end = parseSingleValue(endStr, field)
  } else {
    start = parseSingleValue(basePart, field)
    end = start
  }

  // 范围校验
  if (start < range.min || start > range.max) {
    throw new CronParseError(
      `字段 "${field}" 值 ${start} 超出范围 [${range.min}, ${range.max}]`,
      field, part
    )
  }
  if (end < range.min || end > range.max) {
    throw new CronParseError(
      `字段 "${field}" 值 ${end} 超出范围 [${range.min}, ${range.max}]`,
      field, part
    )
  }
  if (start > end) {
    throw new CronParseError(
      `字段 "${field}" 范围 start > end: "${part}"`,
      field, part
    )
  }

  // 填充值
  for (let v = start; v <= end; v += step) {
    result.add(v)
  }
}

/**
 * 解析完整 cron 表达式（5 字段）
 *
 * @param cronExpr 5 字段表达式，如 `"0 9 * * 1"`
 * @returns 解析结果（含 day-of-month/day-of-week 限制标记）
 * @throws CronParseError 表达式非法
 */
export function parseCron(cronExpr: string): ParsedCron {
  if (!cronExpr || cronExpr.trim() === '') {
    throw new CronParseError('cron 表达式为空')
  }
  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new CronParseError(
      `cron 表达式必须为 5 个字段，实际 ${parts.length} 个: "${cronExpr}"`
    )
  }
  const [minuteRaw, hourRaw, domRaw, monthRaw, dowRaw] = parts

  // 标记字段是否被限制（非 *）。多字符 *（如 " * "）经 trim 后已处理。
  const isRestricted = (raw: string): boolean => raw.trim() !== '*'

  return {
    minute: parseCronField('minute', minuteRaw),
    hour: parseCronField('hour', hourRaw),
    dayOfMonth: parseCronField('day-of-month', domRaw),
    month: parseCronField('month', monthRaw),
    dayOfWeek: parseCronField('day-of-week', dowRaw),
    dayOfMonthRestricted: isRestricted(domRaw),
    dayOfWeekRestricted: isRestricted(dowRaw),
  }
}

/** Intl.DateTimeFormat weekday 缩写 → cron 数字（0=Sunday） */
const WEEKDAY_FORMAT_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

/**
 * 提取指定时区下的 5 个 cron 字段值
 *
 * 使用 Intl.DateTimeFormat 避免 DST 计算错误。
 *
 * 注意事项：
 *   - `hour12: false` 在部分 ICU 实现下午夜会返回 "24"，故 `hour % 24` 兜底
 *   - `getMonth()` 返回 0-11，cron 月份是 1-12，故 +1
 *   - weekday 缩写 `Sun/Mon/.../Sat` 映射到 0-6
 *
 * @param date UTC 时间戳
 * @param timezone IANA 时区（如 `Asia/Shanghai`）
 */
function extractFields(
  date: Date,
  timezone: string
): { minute: number; hour: number; dayOfMonth: number; month: number; dayOfWeek: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
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
  for (const p of parts) {
    map[p.type] = p.value
  }

  const minute = parseInt(map.minute, 10)
  const hour = parseInt(map.hour, 10) % 24 // 兜底 24→0
  const dayOfMonth = parseInt(map.day, 10)
  const month = parseInt(map.month, 10) // 1-12
  const dayOfWeek = WEEKDAY_FORMAT_MAP[map.weekday]
  if (dayOfWeek === undefined) {
    throw new CronParseError(`无法解析星期: ${map.weekday}`)
  }

  return { minute, hour, dayOfMonth, month, dayOfWeek }
}

/**
 * 判断指定时间是否匹配 cron 表达式
 *
 * 实现 cron 标准的 day-of-month / day-of-week 并集语义：
 *   - 两字段都被限制 → 取并集（任一满足即匹配）
 *   - 仅一字段被限制 → 只校验该字段
 *   - 都为 `*`        → 日期部分恒匹配
 */
function matchCron(
  parsed: ParsedCron,
  fields: {
    minute: number
    hour: number
    dayOfMonth: number
    month: number
    dayOfWeek: number
  }
): boolean {
  // minute/hour/month 是 AND 关系
  if (!parsed.minute.has(fields.minute)) return false
  if (!parsed.hour.has(fields.hour)) return false
  if (!parsed.month.has(fields.month)) return false

  // day-of-month / day-of-week 并集语义
  if (parsed.dayOfMonthRestricted && parsed.dayOfWeekRestricted) {
    return (
      parsed.dayOfMonth.has(fields.dayOfMonth) ||
      parsed.dayOfWeek.has(fields.dayOfWeek)
    )
  } else if (parsed.dayOfMonthRestricted) {
    return parsed.dayOfMonth.has(fields.dayOfMonth)
  } else if (parsed.dayOfWeekRestricted) {
    return parsed.dayOfWeek.has(fields.dayOfWeek)
  }
  // 都是 *，日期部分恒匹配
  return true
}

/** 最大扫描时长（毫秒）：366 天，避免死循环（spec SubTask 6.1.1） */
const MAX_SCAN_MS = 366 * 24 * 60 * 60 * 1000
/** 扫描步长（毫秒）：1 分钟 */
const STEP_MS = 60 * 1000

/**
 * 计算下一次运行时间
 *
 * 算法：从 `from` 之后第一个整分钟开始逐分钟递增，
 *       找到第一个匹配的 Date；最多扫描 366 天避免死循环。
 *
 * 注意：返回时间严格大于 `from`。若 `from` 正好匹配 cron，
 *       仍返回下一次匹配（与 node-cron / croniter 行为一致）。
 *
 * @param cronExpr 5 字段 cron 表达式
 * @param from 起点 UTC 时间
 * @param timezone IANA 时区（默认 `Asia/Shanghai`，DEC-7）
 * @returns 下一次匹配时间
 * @throws CronParseError 表达式非法或 366 天内无匹配
 */
export function getNextRun(
  cronExpr: string,
  from: Date,
  timezone: string = 'Asia/Shanghai'
): Date {
  const parsed = parseCron(cronExpr)

  // 从 from 之后第一个整分钟开始（丢弃秒和毫秒）
  // 例：from = 09:00:30.500 → candidate = 09:01:00.000
  const fromMs = from.getTime()
  let candidate = Math.floor(fromMs / STEP_MS) * STEP_MS + STEP_MS

  const deadline = fromMs + MAX_SCAN_MS

  while (candidate <= deadline) {
    const fields = extractFields(new Date(candidate), timezone)
    if (matchCron(parsed, fields)) {
      return new Date(candidate)
    }
    candidate += STEP_MS
  }

  throw new CronParseError(`cron 表达式 "${cronExpr}" 在 366 天内无匹配时间`)
}
