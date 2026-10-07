/**
 * 拦截规则只读链路 + 假设置清扫
 *
 * 钉住四件事（都是实测过的行为，不是文风约定）：
 * 1. 主进程导出的规则快照里命令名已展开，没有 '@readonlyCommands' 这种内部引用
 *    ——设置页直接显示这份数据，露出内部名就等于没做这件事。
 * 2. risk:rules 通道三段齐全：主进程 handler / preload 桥 / 设置页取值。
 * 3. 设置页不再有可编辑规则表：没有新增/编辑/删除，也就不可能把 rm -rf 拦截项删掉。
 * 4. 六个没人消费的假设置键（含 risk.rules）真的从 src 里消失了，不许回来。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { COMMAND_RULES_SNAPSHOT } from '../../src/main/core/command-gate'

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 递归收集 src 下全部 .ts/.tsx（跳过 .d.ts） */
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) acc.push(p)
  }
  return acc
}
const srcFiles = walk('src')

const PAGE = 'src/renderer/src/pages/RiskSettings.tsx'

describe('规则快照可直接展示', () => {
  it('扫到了规则（不是空跑）', () => {
    // 2026-10-06 实测 7 条 argv 规则
    expect(COMMAND_RULES_SNAPSHOT.rules.length).toBeGreaterThanOrEqual(7)
  })

  it('每条规则的命令名都已展开成真实命令，没有 @名单引用', () => {
    const unresolved = COMMAND_RULES_SNAPSHOT.rules
      .filter((r) => r.commands.some((c) => c.startsWith('@')))
      .map((r) => r.id)
    expect(unresolved, `这些规则还带着内部引用名：${unresolved.join(', ')}`).toEqual([])
  })

  it('每条规则都有可渲染的级别、理由与非空命令名单', () => {
    const LEVELS = new Set(['safe', 'low', 'medium', 'high', 'block'])
    for (const rule of COMMAND_RULES_SNAPSHOT.rules) {
      expect(LEVELS.has(rule.level), `${rule.id} 的级别 ${rule.level} 界面画不出来`).toBe(true)
      expect(rule.commands.length).toBeGreaterThan(0)
      expect(rule.reason.length).toBeGreaterThan(0)
    }
  })

  it('block 级规则一律 requiresConfirm=false（拒绝优先，不给"确认后执行"的口子）', () => {
    const leaky = COMMAND_RULES_SNAPSHOT.rules
      .filter((r) => r.level === 'block' && r.requiresConfirm)
      .map((r) => r.id)
    expect(leaky).toEqual([])
  })
})

describe('risk:rules 三段链路齐全', () => {
  it('主进程注册了 handler', () => {
    expect(read('src/main/ipc/risk.ts')).toMatch(/ipcMain\.handle\(\s*RISK\.RULES/)
  })

  it('preload 暴露了 riskGetRules', () => {
    expect(read('src/preload/index.ts')).toMatch(
      /riskGetRules:\s*\(\)[^=]*=>\s*ipcRenderer\.invoke\(RISK\.RULES/,
    )
  })

  it('设置页从通道取数，而不是自己存一份', () => {
    const page = read(PAGE)
    expect(page).toContain('riskGetRules')
    expect(page).not.toContain("'risk.rules'")
  })
})

describe('规则表是只读的', () => {
  it('页面上没有新增/编辑/删除规则的按钮与弹窗', () => {
    const page = read(PAGE)
    for (const forbidden of ['新增规则', 'handleAddRule', 'handleEditRule', 'handleDeleteRule', 'RiskRuleModal']) {
      expect(page, `只读表里又出现了 ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('取数失败有兜底：错误态 + 重新读取，不静默显示空表', () => {
    const page = read(PAGE)
    expect(page).toMatch(/status:\s*'loading'/)
    expect(page).toMatch(/status:\s*'error'/)
    expect(page).toMatch(/重新读取/)
  })
})

describe('六个假设置键已从界面上删除', () => {
  const DEAD_KEYS = [
    'risk.protectionLevel',
    'risk.autoBlock',
    'risk.desensitize',
    'risk.permissionMode',
    'risk.recordingRetention',
    'risk.rules',
  ]

  it('src 里没有任何一处还在读写这些键', () => {
    const hits: string[] = []
    for (const f of srcFiles) {
      const code = read(f)
      for (const key of DEAD_KEYS) {
        if (code.includes(`'${key}'`) || code.includes(`"${key}"`)) hits.push(`${f} <- ${key}`)
      }
    }
    expect(hits, `假设置回来了：\n${hits.join('\n')}`).toEqual([])
  })

  it('GeneralSettings 的导出清单里也没有它们', () => {
    const general = read('src/renderer/src/pages/GeneralSettings.tsx')
    for (const key of DEAD_KEYS) expect(general, `导出了不存在的 ${key}`).not.toContain(key)
  })
})

describe('「记录文件修改」开关有真实消费者', () => {
  it('SFTP 六个写入口都调用了审计', () => {
    const ssh = read('src/main/ipc/ssh.ts')
    expect(ssh).toMatch(/const auditFileMod = \(/)
    // 上传 / 删除 / 改名 / 改权限 / 写文件 / 建目录
    expect((ssh.match(/auditFileMod\('/g) ?? []).length).toBe(6)
  })

  it('file_mod 类别绑到 risk.auditFileMod 这个键', () => {
    const repo = read('src/main/services/db/audit-repo.ts')
    expect(repo).toMatch(/file_mod:\s*'risk\.auditFileMod'/)
  })

  it('审计写入的文件路径不会带进文件内容', () => {
    const ssh = read('src/main/ipc/ssh.ts')
    // 写文件只记字节数：内容里可能有口令/密钥
    expect(ssh).toMatch(/content\.length/)
  })
})
