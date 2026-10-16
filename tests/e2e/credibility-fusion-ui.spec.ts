/**
 * 可信度融合在真应用里能跑通（#106 B 的界面侧落锤）
 *
 * 单测覆盖了质量算法与字段契约，这条 spec 覆盖的是"按下按钮真的出数"：
 * 决策设置页那个「测试当前权重对决策的影响」按钮走完整链路
 * 渲染层 → preload → ipcMain → 七个源的 mass 函数 → D-S/PCR5 融合 → 回到界面。
 * 以前这条链断过两次都没人发现：一次是字段名对不上（每次必抛，页面把异常吞成
 * "这张卡没有可信度分析"），一次是源 id 词表分叉（'kb' 与 'knowledge' 各自为政）。
 *
 * 判据拿的是界面文字，不是内部状态：用户看得见什么就断什么。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { FIXTURE_READY, launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const testOrSkip = FIXTURE_READY && BUILD_READY ? test : test.skip

if (!testOrSkip) {
  console.log(
    '[credibility-ui] 跳过：需要 out/main/index.js（先 pnpm build）。skip 不等于通过。',
  )
}

testOrSkip('决策设置页：七源融合按下就出数，且不报评估失败', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launchApp()

  try {
    await page.evaluate(() => {
      window.location.hash = '#/settings/decision'
    })
    const button = page.getByRole('button', { name: '测试当前权重对决策的影响' })
    await expect(button, '决策设置页没渲染出评估按钮').toBeVisible({ timeout: 20_000 })

    await button.click()

    // 界面文字就是结论：这五个数分别来自融合结果，不是页面自己拼的
    const result = page.locator('text=综合可信度:')
    await expect(result, '点完没出可信度（评估失败或 IPC 抛错被吞）').toBeVisible({
      timeout: 30_000,
    })
    expect(await page.locator('text=评估失败').count(), '这条链一抛错就会被写进界面').toBe(0)

    // 七个源位都进了融合（少一个就是有人在半途把源吞掉）
    await expect(page.locator('text=参与源数: 7')).toBeVisible()

    // 数字必须落在合理区间：先验折扣后 7 源全给"好证据"也不会到 100%
    const text = (await result.textContent()) ?? ''
    const confidence = Number(/([\d.]+)%/.exec(text)?.[1] ?? NaN)
    expect(Number.isFinite(confidence), `可信度没解析出数字：${text}`).toBe(true)
    expect(confidence, '可信度为 0 说明质量全被吞了').toBeGreaterThan(0)
    expect(confidence, '可信度 ≥100% 说明先验折扣没生效').toBeLessThan(100)
  } finally {
    await app.close()
  }
})
