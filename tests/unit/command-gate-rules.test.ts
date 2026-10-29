/**
 * 命令闸与规则数据的一致性测试（D4：规则数据化）
 *
 * 判据来源：计划 §D4 "规则文件与 gate 行为一致性测试"。
 * 这里盯的是五件事：
 *   1. 数据里声明的结构性拦截器与代码里实现的必须一一对上；
 *   2. deny 底线不许被数据调低（改数据把 rm 判成 safe 要当场红）；
 *   3. 每条数据规则真的作用到判定结果上（列了却没生效的规则等于假安全感）；
 *   4. 级别不许被悄悄改动 —— 前三条都是"实际判定 vs 数据声明"，而判定就是从这份数据算出来的，
 *      自己跟自己对照抓不到"整条降级"（实测把 service-stop 改成 low 时全绿），
 *      所以另加一张人审期望表 + 标记位自洽不变量当独立证人；
 *   5. 只读名单不许被悄悄扩 —— 同一个坑：往 readonlyCommands 塞 systemctl，
 *      判定会变 low 而"只读名单判 low"照样绿。冻结名单 + 与风险规则/关机名单互斥。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { BLOCK_DETECTOR_IDS, evaluateCommand } from '../../src/main/core/command-gate'

const RULES_PATH = path.resolve(__dirname, '../../src/main/core/command-rules.json')
const rules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8')) as {
  version: number
  readonlyCommands: string[]
  readonlyExtraCommands: string[]
  powerCommands?: string[]
  shellLaunchers?: string[]
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
 * 只读名单的人审冻结值（与上面的 EXPECTED_LEVEL 同一个理由）。
 *
 * "只读名单判 low"这类断言是拿名单算判定、再拿判定对名单，自己跟自己一致：
 * 往 readonlyCommands 里塞一个 systemctl，判定会变成 low，而两条现有断言照样全绿。
 * 冻结成这张表之后，加一个名字必须同时改这里 —— 等于逼一次人审。
 */
const EXPECTED_READONLY = [
  'cat', 'less', 'more', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'find', 'fd', 'ls', 'll',
  'ps', 'top', 'free', 'df', 'du', 'uptime', 'whoami', 'id', 'hostname', 'uname',
  'which', 'whereis', 'stat', 'file', 'wc', 'sort', 'uniq', 'date', 'env', 'printenv',
  'ip', 'ifconfig', 'ss', 'netstat', 'lsof', 'journalctl',
  // htop 2026-10-12 移出：它是全屏交互程序，非 tty 下不返回可读结果（会把 AI 的采集挂住）
]

/**
 * 只读工具的扩展名单（2026-10-12 加）同样冻结。
 *
 * 这张表不进 readonlyCommands 是因为后者同时被 argvRules 用来判 low，动它就动了通用闸；
 * 但它一样决定 AI 的 ssh_readonly 能跑什么，所以也必须改这里才算数 ——
 * 每条都靠 readonlyGuards 的子命令/旗标护栏收紧，不是靠命令名。
 */
const EXPECTED_READONLY_EXTRA = [
  'systemctl', 'nginx', 'visudo', 'docker', 'podman', 'kubectl', 'git',
  'apt', 'apt-get', 'dpkg', 'yum', 'pip', 'pip3', 'npm', 'pnpm', 'yarn',
  'lsblk', 'lscpu', 'lsmem', 'lsmod', 'lspci', 'lsusb', 'dmesg', 'sysctl',
  'vmstat', 'iostat', 'mpstat', 'sar', 'pidstat', 'nvidia-smi', 'fdisk', 'blkid',
  'ping', 'ping6', 'traceroute', 'tracepath', 'dig', 'nslookup', 'host', 'curl',
  'cut', 'tr', 'diff', 'cmp', 'pwd', 'realpath', 'readlink', 'basename', 'dirname',
  'openssl',
  // 2026-10-29 人审补：用户在真机上最常用的系统概览命令全被拒（nproc / arch /
  // systemctl --failed / timedatectl / hostnamectl），PAOR 的计划步骤因此整轮 127。
  // 全部无参数即只读，或靠 optionalSubcommands / flagSubcommands 护栏收紧。
  'nproc', 'arch', 'getconf', 'timedatectl', 'hostnamectl', 'localectl',
  'loginctl', 'resolvectl',
]

describe('只读名单不许被悄悄扩（同一类独立证人）', () => {
  it('readonlyCommands 与冻结名单完全一致（多一个少一个都要红）', () => {
    expect([...rules.readonlyCommands].sort(), '只读名单被改动过，请人审后再更新期望').toEqual(
      [...EXPECTED_READONLY].sort()
    )
  })

  it('readonlyExtraCommands 与冻结名单完全一致', () => {
    expect([...rules.readonlyExtraCommands].sort(), '只读扩展名单被改动过，请人审后再更新期望').toEqual(
      [...EXPECTED_READONLY_EXTRA].sort()
    )
  })

  it('两张只读名单不许重叠（重叠等于同一个名字被两处各管一次）', () => {
    const both = rules.readonlyCommands.filter((c) => rules.readonlyExtraCommands.includes(c))
    expect(both, `两处都列了：${both.join(',')}`).toEqual([])
  })

  it('只读名单与风险规则覆盖的命令互不相交', () => {
    const risky = new Set(rules.argvRules.filter((r) => r.id !== 'readonly').flatMap((r) => commandsOf(r)))
    const clash = rules.readonlyCommands.filter((c) => risky.has(c))
    expect(clash, `这些命令既在只读名单里又有风险规则：${clash.join(',')}`).toEqual([])
    const power = new Set<string>(rules.powerCommands ?? [])
    const launchers = new Set<string>(rules.shellLaunchers ?? [])
    const bad = rules.readonlyCommands.filter((c) => power.has(c) || launchers.has(c))
    expect(bad, `关机/起 shell 的命令不许算只读：${bad.join(',')}`).toEqual([])
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
