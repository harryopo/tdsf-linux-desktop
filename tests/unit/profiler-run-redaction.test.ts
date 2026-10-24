/**
 * 架构感知报告的凭据脱敏必须装在渲染那一处（#208）
 *
 * 起因：`profiler:exportMd` / `exportPdf` 这两条写文件的出口在落盘前调了 `redactSecrets`，
 * 但同一份 md 还有**另一个出口**——AI 工具 `profiler_run` 把 `data.md` 直接回给对话链路
 * （进模型上下文、进界面卡片）。那份 markdown 的内容来自远端命令输出
 * （`cat /etc/*`、`ps`、`env`、日志），最容易夹着 `mysql -uroot -p…` / `PGPASSWORD=…`。
 * 只装住"导出文件"这一个口，等于没装：同一段文本从哪个口出去都该过同一道闸。
 *
 * 所以这条判据钉的是出口而不是通道：走真链路调 `executeProfilerRun`，
 * 断言它返回的 md 里没有凭据、且仍带 [REDACTED]。
 * 三条用例互相证伪：夹具本身必须含凭据（否则"没查到"是量具坏）、正文不能被整段吞掉
 * （否则 not.toContain 是假绿）、脱敏痕迹必须在。
 */
import { describe, it, expect, vi } from 'vitest'
import type { ProfilerItem, ProfilerResult } from '../../src/main/services/profiler/types'

// 拆成相邻字面量：整串会被密钥扫描闸当成真凭据（项目规矩，见 AGENTS.md）
const SECRET = ['Sup3r', 'Secret', 'Pw'].join('')

/** 让 runProfiler 返回"探查输出里带口令"的那一轮真实形状（不碰 SSH，也不加载 command-probe） */
vi.mock('../../src/main/services/profiler/system-profiler', () => ({
  GROUP_LABELS: {
    system: '系统标识',
    'cpu-memory': 'CPU 与内存',
    storage: '存储',
    network: '网络',
    users: '用户',
    services: '服务',
    tools: '开发工具',
    virt: '虚拟化',
    web: 'Web 应用',
    ops: '运维',
  },
  runProfiler: async (): Promise<ProfilerResult> => makeResult([
    // 真实里最常见的形状：crontab 里带数据库口令的备份任务
    makeItem(
      'ops',
      'crontab -l 2>/dev/null; ls /etc/cron.d/ 2>/dev/null',
      `0 2 * * * PGPASSWORD=${SECRET} pg_dump appdb > /backup/appdb.sql\n`
    ),
    makeItem('users', 'whoami; id', 'web-01\nuid=1000(web-01) gid=1000(web-01)\n'),
  ]),
}))

import { executeProfilerRun } from '../../src/main/services/llm/tools/profiler-run'

function makeItem(group: ProfilerItem['group'], cmd: string, stdout: string): ProfilerItem {
  return {
    group,
    groupLabel: group,
    cmd,
    stdout,
    stderr: '',
    exitCode: 0,
    durationMs: 10,
    ok: true,
  }
}

function makeResult(items: ProfilerItem[]): ProfilerResult {
  return {
    host: '192.0.2.10',
    sessionId: 'sess-1',
    generatedAt: new Date(2026, 6, 16, 13, 30, 0).getTime(),
    totalDurationMs: 2500,
    items,
    errors: [],
  }
}

describe('profiler_run 返回的 md 不带凭据（#208）', () => {
  it('夹具本身确实带着口令（否则下面的"没有凭据"是量具坏了）', async () => {
    const probe = makeResult([makeItem('users', 'ps', `mysqld -uroot -p${SECRET}`)])
    expect(probe.items[0].stdout).toContain(SECRET)
  })

  it('走真工具链路：返回的 md 里没有口令，但正文照常存在', async () => {
    const out = await executeProfilerRun({ sessionId: 'sess-1', host: '192.0.2.10' })
    expect(out.success, out.error ?? '工具执行失败').toBe(true)
    const md = (out.data as { md: string }).md
    expect(md, '凭据原样进了 AI 出口：模型上下文与界面卡片都会拿到它').not.toContain(SECRET)
    // 正文不能被整段吞掉——否则 not.toContain 是假绿
    expect(md).toContain('web-01')
    expect(md).toContain('[REDACTED]')
  })
})
