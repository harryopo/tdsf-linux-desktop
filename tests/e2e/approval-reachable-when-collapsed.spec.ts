/**
 * 审批卡的可达性（#170 / 调研报告 P0-1）
 *
 * 缺陷形状：AI 面板是 `WorkbenchPage` 按 `aiPanelVisible` **条件渲染**的
 * （`open.ai ? <Panel id="wb-ai"> : null`），而审批订阅以前写在这个面板里。
 * 面板一收起，主进程推来的"要不要执行这条命令"就没有任何界面接手，60 秒后自动拒绝——
 * 用户看到的是"AI 把命令拦下了"，真实情况是"问了，没告诉任何人"。
 *
 * 这份判据管两件事，各自分工清楚：
 * 1. 真窗口 + 真 DOM：收起面板 → 队列进一条 → 面板自己回来、审批卡画出来、开关上有角标；
 *    点"拒绝"走一次【真 IPC】——这个 callId 是测试注入的、主进程根本不认，
 *    所以它必须回 false，卡片于是转成"已过期"而不是消失或装作应答成功。
 *    这一段顺带把"应答通道按主进程返回值定生死"验到了。
 * 2. 主进程 → 渲染进程那条推送本身的接线，由 tests/unit/approval-queue-global.test.ts 钉
 *    （那边演过"把订阅掐掉立刻红"），这里不重复造一个假推送源。
 *
 * 注入用的载荷形状与 @shared/approval-types 逐字段一致（含 expiresAt），
 * 不是随手编的半个对象——信封不同形会让这条判据在真事件到来时失去意义。
 */
import { test, expect } from '@playwright/test'
import type { PaorApprovalRequest } from '@shared/approval-types'
import { launchApp } from './ssh-fixture-helpers'

const AI_TOGGLE = '[data-dom-id="btn-toggle-ai"]'

/** 等面板真正画出来/收干净：整列红多半是没等，不是产品坏了 */
async function panelOpen(page: import('@playwright/test').Page): Promise<boolean> {
  return (await page.locator('#wb-ai').count()) > 0
}

test('AI 面板收起时审批请求不丢：自动展开 + 角标 + 应答走真 IPC', async () => {
  test.setTimeout(90_000)
  const { app, page } = await launchApp()
  try {
    // 起手等到工作台外壳出现（启动页会自动进工作台，见 boot 载荷单源那条）
    await page.waitForSelector(AI_TOGGLE, { timeout: 30_000 })
    expect(await panelOpen(page)).toBe(true)

    // ① 收起面板
    await page.click(AI_TOGGLE)
    await page.waitForFunction(() => !document.querySelector('#wb-ai'), null, { timeout: 10_000 })
    expect(await panelOpen(page)).toBe(false)

    // ② 队列里进一条（形状照 @shared/approval-types，死线给到 60 秒后）
    const callId = `e2e_${Date.now()}`
    const request: PaorApprovalRequest = {
      callId,
      command: 'rm -rf /var/log',
      riskLevel: 'CRITICAL',
      riskDescription: '递归删除系统日志目录',
      origin: 'chat',
      timestamp: Date.now(),
      expiresAt: Date.now() + 60_000,
    }
    await page.evaluate((payload) => {
      const w = window as unknown as {
        __tdsfStores?: { approval?: { getState: () => { receive: (r: PaorApprovalRequest) => void } } }
      }
      w.__tdsfStores?.approval?.getState().receive(payload)
    }, request)

    // ③ 面板自己回来，审批卡画出来，开关上带角标
    await page.waitForSelector('section[aria-label="命令审批"]', { timeout: 10_000 })
    expect(await panelOpen(page)).toBe(true)
    await expect(page.locator('section[aria-label="命令审批"]')).toContainText('rm -rf /var/log')
    await expect(page.locator(AI_TOGGLE)).toHaveAttribute('data-badge', '1')

    // ④ 点"拒绝"：这是一次真 IPC 往返，而这个 callId 主进程不认（测试注入的），
    //    所以它只能回 false——卡片必须转成"已过期"，不许装作应答成功、也不许无声消失。
    await page.click('section[aria-label="命令审批"] >> role=button[name=/拒绝/]')
    await page.waitForSelector('section[aria-label="命令审批"] >> text=这次审批已过期', { timeout: 10_000 })
    await expect(page.locator('section[aria-label="命令审批"]')).toContainText('主进程已自动拒绝')
    // 过期之后不再提供任何应答通道
    await expect(page.locator('section[aria-label="命令审批"] >> role=button[name=/批准这一次/]')).toHaveCount(0)

    // ⑤ 关掉之后队列清空、角标消失
    await page.click('section[aria-label="命令审批"] >> role=button[name="知道了"]')
    await page.waitForSelector('section[aria-label="命令审批"]', { state: 'detached', timeout: 10_000 })
    await expect(page.locator(AI_TOGGLE)).not.toHaveAttribute('data-badge')

    const left = await page.evaluate(() => {
      const w = window as unknown as {
        __tdsfStores?: { approval?: { getState: () => { entries: unknown[] } } }
      }
      return w.__tdsfStores?.approval?.getState().entries.length ?? -1
    })
    expect(left).toBe(0)
  } finally {
    await app.close()
  }
})
