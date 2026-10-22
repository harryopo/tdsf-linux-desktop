/**
 * 外部 MCP 工具调用真机必过人（#173 / 调研报告 P0-4）
 *
 * 单测那份 AST 判据只能证明"`ipc/mcp.ts` 里写了 requestApproval 且顺序对"，
 * 证明不了这张卡真的会在这台机器上画出来、点了拒绝真的不会去调外部程序。
 * 这里走一次完整往返：渲染层直接调 `mcpExternalCall` → 主进程推审批卡 →
 * 用户点拒绝 → IPC 回 `not-approved`。
 *
 * 用一个不存在的 serverId 是有意的：闸在"要不要执行"之前，
 * 所以连"服务器存不存在"都不该先替它做完——先问人，再碰任何外部程序。
 */
import { test, expect } from '@playwright/test'
import { launchApp } from './ssh-fixture-helpers'

const CARD = 'section[aria-label="命令审批"]'

test('外部 MCP 调用没有被批准就不会执行，拒绝要回一个明确的 not-approved', async () => {
  test.setTimeout(90_000)
  const { app, page } = await launchApp()
  try {
    await page.waitForSelector('[data-dom-id="btn-toggle-ai"]', { timeout: 30_000 })

    // ① 渲染层直接发起一次外部工具调用（不经过任何界面按钮——这条通道本来就在 preload 上）
    const pending = page.evaluate(async () => {
      const api = (window as unknown as {
        electronAPI?: {
          mcpExternalCall?: (
            serverId: string,
            toolName: string,
            args: Record<string, unknown>
          ) => Promise<{ success: boolean; error?: string }>
        }
      }).electronAPI
      if (!api?.mcpExternalCall) throw new Error('preload 没暴露 mcpExternalCall')
      return api.mcpExternalCall('e2e-no-such-server', 'e2e_probe_tool', { hint: 'e2e' })
    })

    // ② 主进程必须先问人：审批卡要出现，并且说的是"外部 MCP 工具"
    await page.waitForSelector(CARD, { timeout: 15_000 })
    await expect(page.locator(CARD)).toContainText('外部 MCP 工具请求执行')
    await expect(page.locator(CARD)).toContainText('e2e_probe_tool')

    // ③ 点拒绝 → 这次调用不许落到外部程序，IPC 要回一个看得懂的失败
    await page.click(`${CARD} >> role=button[name=/拒绝/]`)
    const result = await pending
    expect(result.success, '被拒的调用不能报成功').toBe(false)
    expect(result.error).toBe('not-approved')

    // ④ 卡片按主进程的应答结果下卡，不许留一张还能点的空卡
    await page.waitForSelector(CARD, { state: 'detached', timeout: 10_000 })
  } finally {
    await app.close()
  }
})
