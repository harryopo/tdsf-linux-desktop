/**
 * 活跃 !important 预算闸
 *
 * 判据来自 scripts/design/count-important.mjs：CSS 里生效的 !important 总数只许降不许升。
 * 2026-10-07 antd 整体退出渲染层后，global.css 那 176 行 .ant-* 覆盖与
 * SshSettings.css 的 .ssh-modal .ant-* 全成了死样式，一并删掉后实测 99→33。
 * 留这条闸是因为 !important 是"样式打架打不赢就硬压"的痕迹：
 * 每多一处，后面的页面就得再加一处才盖得住它。
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const SCRIPT = path.join(ROOT, 'scripts', 'design', 'count-important.mjs')

/** 2026-10-07 实测值，只能往下调 */
const CAP = 33

describe('!important 预算', () => {
  const run = spawnSync(process.execPath, [SCRIPT, String(CAP)], { cwd: ROOT, encoding: 'utf8' })

  it('脚本跑起来了（不是空跑）', () => {
    expect(run.stdout, run.stderr).toContain('合计')
  })

  it(`活跃 !important 总数不超过 ${CAP}`, () => {
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
  })
})
