/**
 * 损坏的配置文件不许把应用卡死在启动前
 *
 * conf / electron-store 默认 `clearInvalidConfig: false`：JSON 半截写入（断电、磁盘满、
 * 写盘途中被杀）时，构造或首次读取直接抛错。而 `config` 与 `secure-storage` 两个 store
 * 都在模块顶层构造——一个坏文件等于整个主进程起不来，用户只能自己去 userData 目录
 * 手动删文件，删之前还得先猜到是哪个文件。
 *
 * 策略：构造 store 之前先检查；解析不了就**改名留档**（不删，事后可人工捞），
 * 再让 store 以默认值重建。宁可丢设置，也不能丢"能启动"。
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export interface SalvagedStoreFile {
  /** 原文件路径（已改名，不存在了） */
  file: string
  /** 留档副本路径 */
  backup: string
  /** 解析失败的原因（给日志用） */
  reason: string
}

const salvaged: SalvagedStoreFile[] = []

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * 取 userData 目录；拿不到（单测里只 mock 了部分 electron / 非常规宿主）返回 null
 *
 * 这里必须吞错：留档是"锦上添花"的灾备，不能因为读不到 app 路径
 * 反而把原本能起来的进程带崩——那正是它要修的那类问题。
 */
function resolveUserDataDir(explicit?: string): string | null {
  if (explicit) return explicit
  try {
    const dir = app.getPath('userData')
    return typeof dir === 'string' && dir.length > 0 ? dir : null
  } catch {
    return null
  }
}

/**
 * 检查一份 electron-store 配置文件
 *
 * @param name store 名（对应 `<name>.json`）
 * @param dir 目录，默认 userData（判据可传临时目录）
 * @returns 留档说明；文件不存在、可解析、读不了、或拿不到目录时返回 null
 */
export function salvageCorruptStoreFile(
  name: string,
  dir?: string
): SalvagedStoreFile | null {
  const base = resolveUserDataDir(dir)
  if (!base) return null
  const file = path.join(base, `${name}.json`)
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    // 不存在就走 store 自己的默认值路径；读不了（权限/占用）不是这里能修的
    return null
  }
  try {
    JSON.parse(raw)
    return null
  } catch (err) {
    let backup = path.join(base, `${name}.corrupt-${stamp()}.json`)
    for (let i = 1; fs.existsSync(backup); i++) {
      backup = path.join(base, `${name}.corrupt-${stamp()}-${i}.json`)
    }
    fs.renameSync(file, backup)
    const notice: SalvagedStoreFile = { file, backup, reason: (err as Error).message }
    salvaged.push(notice)
    return notice
  }
}

/**
 * 取走启动期间发生的留档记录（logger 还没初始化时不能直接写日志，
 * 由 main/index.ts 在 initLogger 之后取一次）
 */
export function takeSalvagedStoreFiles(): SalvagedStoreFile[] {
  return salvaged.splice(0, salvaged.length)
}
