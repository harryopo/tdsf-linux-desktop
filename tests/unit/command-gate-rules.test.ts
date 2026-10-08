/**
 * 命令闸与规则数据的一致性测试（D4：规则数据化）
 *
 * 判据来源：计划 §D4 "规则文件与 gate 行为一致性测试"。
 * 这里盯的是四件事：
 *   1. 数据里声明的结构性拦截器与代码里实现的必须一一对上；
 *   2. deny 底线不许被数据调低（改数据把 rm 判成 safe 要当场红）；
 *   3. 每条数据规则真的作用到判定结果上（列了却没生效的规则等于假安全感）；
 *   4. 级别不许被悄悄改动 —— 前三条都是"实际判定 vs 数据声明"，而判定就是从这份数据算出来的，
 *      自己跟自己对照抓不到"整条降级"（实测把 service-stop 改成 low 时全绿），
 *      所以另加一张人审期望表 + 标记位自洽不变量当独立证人。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { BLOCK_DETECTOR_IDS, evaluateCommand } from '../../src/main/core/command-gate'

const RULES_PATH = path.resolve(__dirname, '../../src/main/core/command-rules.json')
const rules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8')) as {
  version: number
  readonlyCommands: string[]
  argvRules: Array<{
    id: string
    commands: string[] | string
    subcommands: string[] | null
    level: string
    reason: string
    requiresConfirm: boolean
    audit: boolean
    irreversible: boolean
  }>
  denyBaseline: { mustNotBeBelow: Record<string, string>; blockDetectors: string[] }
}

/** 取一条规则实际覆盖的命令名（支持 '@xxx' 引用同级名单） */
function commandsOf(rule: (typeof rules.argvRules)[number]): string[] {
  if (Array.isArray(rule.commands)) return rule.commands
  return rules[rule.commands.slice(1) as 'readonlyCommands'] as string[]
}

describe('数据与代码对账', () => {
  it('denyBaseline.blockDetectors 与代码实现的拦截器一一对应', () => {
    expect([...rules.denyBaseline.blockDetectors].sort()).toEqual([...BLOCK_DETECTOR_IDS].sort())
  })

  it('每条规则都有 id / 级别 / 中文理由，三个标记位都是布尔', () => {
    const ids = new Set<string>()
    for (const rule of rules.argvRules) {
      expect(ids.has(rule.id), `规则 id 重复：${rule.id}`).toBe(false)
      ids.add(rule.id)
      expect(rule.reason.length).toBeGreaterThan(1)
      expect(['block', 'high', 'medium', 'low', 'safe']).toContain(rule.level)
      for (const flag of ['requiresConfirm', 'audit', 'irreversible'] as const) {
        expect(typeof rule[flag], `${rule.id}.${flag} 不是布尔`).toBe('boolean')
      }
    }
  })

  it('规则不许声明 block —— 拦截只能来自代码里的结构性判据', () => {
    // 数据里出现 block 意味着有人以为"加一行 JSON 就能拦"，
    // 而真正的拦截器在代码里，两边会各说各话。
    for (const rule of rules.argvRules) {
      expect(rule.level, `规则 ${rule.id} 不该在数据里声明 block`).not.toBe('block')
    }
  })
})

describe('deny 底线不被数据调低', () => {
  const RANK: Record<string, number> = { safe: 0, low: 1, medium: 2, high: 3, block: 4 }

  it('mustNotBeBelow 里每条命令的实际判定都不低于声明的级别', () => {
    // 用一个最小的真实调用形态去判，而不是只看数据自己说自己是几级
    const probes: Record<string, string> = {
      rm: 'rm a.txt',
      userdel: 'userdel bob',
      groupdel: 'groupdel staff',
      passwd: 'passwd bob',
      kill: 'kill 1234',
      killall: 'killall nginx',
      pkill: 'pkill node',
    }
    for (const [cmd, minLevel] of Object.entries(rules.denyBaseline.mustNotBeBelow)) {
      expect(probes[cmd], `${cmd} 缺探针`).toBeTruthy()
      const verdict = evaluateCommand(probes[cmd])
      expect(
        RANK[verdict.level] >= RANK[minLevel],
        `${cmd} 被判成 ${verdict.level}，低于底线 ${minLevel}`
      ).toBe(true)
    }
  })

  it('结构性拦截不受数据级别影响', () => {
    // rm 在数据里是 high，但 rm -rf / 必须由代码判成 block
    expect(evaluateCommand('rm -rf /').level).toBe('block')
    expect(evaluateCommand('sudo rm -rf /etc').level).toBe('block')
  })
})

describe('数据规则真的作用到判定上', () => {
  it('每条规则至少有一个命令能命中它声明的级别', () => {
    for (const rule of rules.argvRules) {
      const cmds = commandsOf(rule)
      expect(cmds.length, `规则 ${rule.id} 没覆盖任何命令`).toBeGreaterThan(0)
      // 子命令型规则要带上一个声明过的子命令才该命中
      const probe = rule.subcommands ? `${cmds[0]} ${rule.subcommands[0]}` : `${cmds[0]} arg`
      const verdict = evaluateCommand(probe)
      expect(
        RANK_OF(verdict.level) >= RANK_OF(rule.level),
        `规则 ${rule.id}：${probe} 只判出 ${verdict.level}，达不到声明的 ${rule.level}`
      ).toBe(true)
    }
  })

  it('子命令型规则不被无关子命令误伤', () => {
    expect(evaluateCommand('systemctl status nginx').level).toBe('safe')
    expect(evaluateCommand('apt list --installed').level).toBe('safe')
  })

  it('只读名单判 low', () => {
    for (const cmd of ['df', 'free', 'journalctl', 'lsof']) {
      expect(evaluateCommand(`${cmd} -h`).level).toBe('low')
    }
  })
})

/**
 * 每条规则"应该是几级"的人审期望。
 *
 * 为什么单独立一张表：其余断言都是"实际判定不低于数据声明"，而实际判定就是从这份数据算出来的
 * —— 自己跟自己对照，把 service-stop 从 medium 悄悄改成 low，8 条断言全绿（2026-10-08 实测）。
 * deny 底线那几条有加载期断言兜着（rm/kill/userdel… 改低会直接拒绝启动），
 * 但 medium 档的三条（service-stop / package-change / firewall）不在底线名单里，没人管。
 * 这张表就是那个"独立的证人"：改数据必须同时改这里，等于逼一次人审。
 */
const EXPECTED_LEVEL: Record<string, string> = {
  rm: 'high',
  account: 'high',
  kill: 'high',
  'service-stop': 'medium',
  'package-change': 'medium',
  firewall: 'medium',
  readonly: 'low',
}

describe('级别不许被悄悄改动（D4 的独立证人）', () => {
  it('期望表覆盖全部规则，且每条级别与数据一致', () => {
    const ids = rules.argvRules.map((r) => r.id)
    expect([...ids].sort(), '新增规则必须同时补进期望表（没人审过的级别等于没有级别）').toEqual(
      [...Object.keys(EXPECTED_LEVEL)].sort()
    )
    const drift = rules.argvRules
      .filter((r) => r.level !== EXPECTED_LEVEL[r.id])
      .map((r) => `${r.id}: 数据=${r.level} 人审期望=${EXPECTED_LEVEL[r.id]}`)
    expect(drift, drift.join(' | ')).toEqual([])
  })

  it('标记位与级别自洽：不可逆必 high，要确认/要审计的不许是 low', () => {
    for (const r of rules.argvRules) {
      if (r.irreversible) expect(r.level, `${r.id} 标了不可逆却不到 high`).toBe('high')
      if (r.requiresConfirm) expect(RANK_OF(r.level), `${r.id} 要用户确认却低于 medium`).toBeGreaterThanOrEqual(RANK_OF('medium'))
      if (r.audit) expect(r.level, `${r.id} 要审计却判成 low 以下`).not.toBe('safe')
    }
  })
})

function RANK_OF(level: string): number {
  return { safe: 0, low: 1, medium: 2, high: 3, block: 4 }[level] ?? -1
}
