/**
 * 裸 console 上限闸 + 两个 logger 合并（2026-10-09 安全审查 S5 / P1-4）
 *
 * 打包后的 Windows 没有控制台，`console.warn` 的内容不会进任何文件——
 * 「审计写失败」「采集降级」这类事就这样静默消失。报告要求两件事：
 *   1. 第二个 logger（只写 console、不落盘）删掉，消费者并进主 logger；
 *   2. src/main 里裸 console.warn|error 的数量设上限，只许降不许升。
 *
 * 上限闸本身要能被证伪：所以有 canary（注入一段必被数到的代码）
 * 和"确实扫到了文件"的断言，避免扫描器坏了时把 0 当成通过。
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const MAIN_ROOT = join(__dirname, '../../src/main')
const BARE_CONSOLE = /console\.(?:warn|error)\(/g

/**
 * 允许直接写控制台的文件（相对 src/main）。
 * 它们本身就是控制台输出通道，不是"无痕失败"。名单只许缩短。
 */
const CONSOLE_WRITERS = ['services/log/logger.ts', 'services/log/drain3-bridge.ts']

/**
 * 上限：本轮实测值冻结在此，之后只能调低。
 * 54 → 50（2026-10-13）：agent-workflow.ts 里 4 处 console.warn 并进主 logger
 * （确认超时、Drain3 降级、Ground-Check 重采失败、llmReasoner 降级——打包态全是无痕失败）。
 */
const CAP = 50

function walkTs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkTs(full))
    else if (name.endsWith('.ts')) out.push(full)
  }
  return out
}

/** 数出一段源码里的裸 console.warn|error 次数 */
function countBare(source: string): number {
  return source.match(new RegExp(BARE_CONSOLE.source, 'g'))?.length ?? 0
}

interface Census {
  files: number
  hits: number
  perFile: Array<{ rel: string; hits: number }>
}

function census(): Census {
  const perFile: Array<{ rel: string; hits: number }> = []
  let files = 0
  let hits = 0
  for (const abs of walkTs(MAIN_ROOT)) {
    files++
    const rel = relative(MAIN_ROOT, abs).split(sep).join('/')
    if (CONSOLE_WRITERS.includes(rel)) continue
    const n = countBare(readFileSync(abs, 'utf8'))
    if (n > 0) perFile.push({ rel, hits: n })
    hits += n
  }
  return { files, hits, perFile }
}

describe('裸 console 上限闸', () => {
  it('量具能数出注入的样本（阴性对照：不然 0 命中说明扫描器坏了）', () => {
    expect(countBare('console.warn("a"); foo(); console.error(new Error("b"))')).toBe(2)
    expect(countBare('logger.warn("a")')).toBe(0)
    const c = census()
    expect(c.files, '一个 .ts 都没扫到就是扫描面塌了').toBeGreaterThan(40)
    expect(c.hits, '全仓一个裸 console 都没有也不可能').toBeGreaterThan(0)
  })

  it(`src/main 的裸 console.warn|error 不超过上限 ${CAP}`, () => {
    const c = census()
    expect(
      c.hits,
      `裸 console 会让打包 Windows 里的失败静默消失。当前 ${c.hits} 处，最多的几处：` +
        c.perFile
          .sort((a, b) => b.hits - a.hits)
          .slice(0, 5)
          .map((f) => `${f.rel}=${f.hits}`)
          .join(' ')
    ).toBeLessThanOrEqual(CAP)
  })

  it('豁免名单里没有空条目（谁不再写控制台就把它划掉）', () => {
    for (const rel of CONSOLE_WRITERS) {
      const abs = join(MAIN_ROOT, rel)
      expect(existsSync(abs), `豁免的文件不存在：${rel}`).toBe(true)
      expect(countBare(readFileSync(abs, 'utf8')), `${rel} 已不含裸 console，应从名单删除`).toBeGreaterThan(0)
    }
  })

  it('第二个 logger 已经删掉，没有文件再引它', () => {
    expect(existsSync(join(MAIN_ROOT, 'core/logger.ts')), 'core/logger 应该已经并入主 logger').toBe(false)
    const importers: string[] = []
    for (const abs of walkTs(MAIN_ROOT)) {
      const src = readFileSync(abs, 'utf8')
      // 注释里提它不算引用，只有真 import 才算
      if (/from\s+['"][^'"]*core\/logger['"]/.test(src)) importers.push(relative(MAIN_ROOT, abs))
    }
    expect(importers, '还在引用第二个 logger：' + importers.join(' ')).toEqual([])
  })
})
