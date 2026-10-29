/**
 * tests/core/confirm-timeout.test.ts — 决策超时的取值与接线
 *
 * 链条：设置页 `decision.decisionTimeout` → 主进程启动时注入的取数口 → 审批等待器
 * （`expiresAt` 与 `setTimeout` 用同一个值）→ 到点自动拒绝（fail-closed，绝不自动放行）。
 *
 * 2026-10-29 #281：这条链原先挂在 `core/agent-workflow.ts` 的 confirm 步上，而那个内核
 * 唯一的入站消费者（桌面里那个 stdio MCP Server）结构上连不上，于是整删。
 * 设置页那条键不能跟着变成摆设，所以消费者搬到真正在跑的审批等待器上。
 *
 * 这一批判据能证明的：取值规则、注入生效、同一次请求两处同源、脏值不抛。
 * 证明不了的："改了设置后真窗口里那张卡真的在 N 秒后自己关掉"——那要假模型回一条写命令，
 * 归 #283（记在 docs/功能实景清单.md，别拿这几条单测当实测过）。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  APPROVAL_TIMEOUT_MS,
  clampApprovalTimeoutSec,
  resolveApprovalTimeoutMs,
  requestApproval,
  setApprovalTimeoutSource,
  type ApprovalTransport,
} from '@main/core/security/approval-request'
import {
  APPROVAL_TIMEOUT_DEFAULT_SEC,
  APPROVAL_TIMEOUT_MAX_SEC,
  APPROVAL_TIMEOUT_MIN_SEC,
  type PaorApprovalRequest,
} from '@shared/approval-types'

const ROOT = path.resolve(__dirname, '../..')

function fakeTransport(): ApprovalTransport & { sent: PaorApprovalRequest[] } {
  const sent: PaorApprovalRequest[] = []
  return {
    sent,
    hasTarget: () => true,
    send: (_channel, payload) => sent.push(payload),
  }
}

afterEach(() => setApprovalTimeoutSource(null))

describe('决策超时的取值规则', () => {
  it('默认就是审批等待器原来硬编码的那一把（60 秒）', () => {
    expect(APPROVAL_TIMEOUT_DEFAULT_SEC).toBe(60)
    expect(APPROVAL_TIMEOUT_MS).toBe(60_000)
    expect(clampApprovalTimeoutSec(undefined)).toBe(60)
  })

  it('正常值按秒换算，小数四舍五入到整秒', () => {
    expect(clampApprovalTimeoutSec(120)).toBe(120)
    expect(clampApprovalTimeoutSec(90.6)).toBe(91)
  })

  it('越界夹到端点：填 0 或负数不等于"永不超时"', () => {
    expect(clampApprovalTimeoutSec(0)).toBe(APPROVAL_TIMEOUT_MIN_SEC)
    expect(clampApprovalTimeoutSec(-500)).toBe(APPROVAL_TIMEOUT_MIN_SEC)
    expect(clampApprovalTimeoutSec(999_999)).toBe(APPROVAL_TIMEOUT_MAX_SEC)
  })

  it('脏值一律回默认，且不抛（一个坏配置不该把审批流程带崩）', () => {
    for (const bad of [null, undefined, {}, [], 'abc', '', '  ', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(clampApprovalTimeoutSec(bad)).toBe(APPROVAL_TIMEOUT_DEFAULT_SEC)
    }
    // 手改 config.json 写成带引号的数字，是现实形状，按数字收
    expect(clampApprovalTimeoutSec('120')).toBe(120)
  })
})

describe('设置页那条键真的接到了审批等待器上', () => {
  it('注入的取数口生效，且 expiresAt 与定时器用的是同一个值', async () => {
    vi.useFakeTimers()
    try {
      setApprovalTimeoutSource(() => 15)
      const transport = fakeTransport()
      const started = Date.now()
      const pending = requestApproval(transport, {
        callId: 'cfg-1',
        command: 'systemctl restart nginx',
        riskLevel: 'HIGH',
        riskDescription: '重启 Web 服务',
        origin: 'paor',
        timestamp: started,
      })

      expect(transport.sent[0].expiresAt - started).toBe(15_000)

      vi.advanceTimersByTime(14_000)
      let settled = 'pending'
      void pending.then((v) => (settled = v ? 'approved' : 'rejected'))
      await Promise.resolve()
      expect(settled, '没到点就自动拒绝是抢跑').toBe('pending')

      vi.advanceTimersByTime(2_000)
      await Promise.resolve()
      await Promise.resolve()
      expect(settled, '到点必须自动拒绝（fail-closed）').toBe('rejected')
    } finally {
      vi.useRealTimers()
    }
  })

  it('没注入取数口时回到默认那一把，而不是 0 或 undefined', () => {
    setApprovalTimeoutSource(null)
    expect(resolveApprovalTimeoutMs()).toBe(APPROVAL_TIMEOUT_DEFAULT_SEC * 1000)
  })

  it('接线核对：主进程启动时确实把配置接进来了', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/main/index.ts'), 'utf8')
    expect(
      src.includes('setApprovalTimeoutSource('),
      '启动时没注入取数口——那设置页那条"决策超时"仍然是摆设'
    ).toBe(true)
    expect(src).toMatch(/setApprovalTimeoutSource\(\(\) => ConfigStore\.get\('decision\.decisionTimeout'\)\)/)
  })

  it('设置页用同一份区间常量，不许自己再抄一套数字', () => {
    const page = fs.readFileSync(
      path.join(ROOT, 'src/renderer/src/pages/DecisionSettings.tsx'),
      'utf8'
    )
    expect(page).toContain('APPROVAL_TIMEOUT_DEFAULT_SEC')
    expect(page).toContain('APPROVAL_TIMEOUT_MIN_SEC')
    expect(page).toContain('APPROVAL_TIMEOUT_MAX_SEC')
    // 反向对照：文案里再出现硬编码的 300 / 1800，就是两份真相开始分叉的第一天
    expect(page, '决策超时那一段还写着抄来的数字').not.toMatch(/30[–-]1800|按 300 秒/)
  })
})
