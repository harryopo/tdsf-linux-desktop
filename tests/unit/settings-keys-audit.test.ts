/**
 * tests/unit/settings-keys-audit.test.ts — 设置键登记闸
 *
 * 判据来自 scripts/design/settings-keys-audit.mjs：界面上每个能写的设置键，
 * 要么登记了真实消费者，要么记在"未接"欠账清单里且数量不超过上限。
 * 这条测试守的是"别再加拨了没反应的假开关"（2026-10-06 一次就扫出 25 个）。
 */
import { vi, describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import * as path from 'node:path'

// 本文件的每条用例都要起一个真子进程跑门禁脚本：全量并行时 20 秒全局预算不够（现量见
// scripts/quality/subprocess-test-timeout.cjs 的文件头），所以只给这一份放宽。
vi.setConfig({ testTimeout: 60000 })

const ROOT = path.resolve(__dirname, '../..')
const SCRIPT = path.join(ROOT, 'scripts', 'design', 'settings-keys-audit.mjs')

describe('设置键消费者登记闸', () => {
  const run = spawnSync(process.execPath, [SCRIPT, '--gate'], {
    cwd: ROOT,
    encoding: 'utf8',
  })

  it('脚本跑起来了（不是空跑）', () => {
    expect(run.stdout, run.stderr).toContain('设置键')
  })

  it('每个设置键都登记了消费者或已记入欠账，且欠账没回涨', () => {
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(run.stdout).toContain('PASS')
  })
})
