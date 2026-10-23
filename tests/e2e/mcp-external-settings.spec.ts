/**
 * 外部 MCP 登记面真机验收（任务 #173 第二步）
 *
 * 单测只能证明"validateDraft 会拒这份草稿"，证明不了：
 *   1. 从设置页点"添加"之后，那一行真的出现在列表里、状态列读的是连接池的真实结果；
 *   2. 登记完的外部工具，调用前仍然必须有人点头（写入口开了不能把审批绕过去）；
 *   3. **子进程看不见没点名的环境变量**（这是本批关掉的那个洞，正反两对照都做）；
 *   4. 点"移除"之后那行真的没了——不是只从配置里消失、进程还在跑。
 *
 * 夹具 tests/e2e/fixtures/mcp-env-probe.mjs 是个真 MCP server，只回报"看得见哪些变量名"。
 * skip 不等于通过：没有 out/main/index.js 就先 pnpm build。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { FIXTURE_READY, launchApp } from './ssh-fixture-helpers'

const BUILD_READY = fs.existsSync(path.join(__dirname, '../../out/main/index.js'))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'mcp-env-probe.mjs')
const testOrSkip = FIXTURE_READY && BUILD_READY && fs.existsSync(FIXTURE_PATH) ? test : test.skip

if (!testOrSkip) {
  console.log(
    '[mcp-external-settings] 跳过：需要 out/main/index.js（先 pnpm build）与夹具。skip 不等于通过。'
  )
}

const CARD = 'section[aria-label="命令审批"]'
/** 种在测试进程里的变量：应用继承得到，外部子进程不该看见 */
const PROBE = 'TDSF_E2E_MCP_PROBE'

interface Probe {
  envNames: string[]
  seenProbeVar: boolean
}

testOrSkip('设置页登记外部 MCP：列表、审批、环境隔离、移除，全在真窗口里走一遍', async () => {
  test.setTimeout(180_000)
  process.env[PROBE] = 'planted-for-isolation-check'

  const { app, page } = await launchApp()
  try {
    await page.evaluate(() => {
      window.location.hash = '#/settings/mcp'
    })
    // 档位不是每轮全新的（上一轮登记的服务器还在），所以先把残留清掉，
    // 再给本轮的服务器起一个带一次性后缀的名字——不然"第几行是谁"根本说不清。
    const TAG = `r${Date.now().toString(36)}`
    const NAME = `环境探针 ${TAG}`
    const NAME_NAMED = `环境探针点名 ${TAG}`
    const left = await page.evaluate(async () => {
      const existing = await window.electronAPI.mcpExternalList()
      for (const s of existing) await window.electronAPI.mcpExternalRemove(s.id)
      return existing.length
    })
    if (left > 0) {
      await page.click('[data-dom-id="mcp-reload"]')
    }
    await expect(page.getByText('还没有登记外部 MCP 服务器')).toBeVisible({ timeout: 25_000 })

    // ① 从界面添加一台（command 用当前这台 node/电子二进制的解释器路径，由测试侧递进来）
    const runner = process.execPath
    await page.fill('[data-dom-id="mcp-add-name"]', NAME)
    await page.fill('[data-dom-id="mcp-add-command"]', runner)
    await page.fill('[data-dom-id="mcp-add-args"]', FIXTURE_PATH)
    await page.click('[data-dom-id="mcp-add-submit"]')

    const row = page.locator('tr[data-dom-id^="mcp-server-row-"]')
    await expect(row.first(), '添加后列表里没有那一行').toBeVisible({ timeout: 15_000 })
    await expect(row.first()).toContainText(NAME)

    // ② 工具清单来自那次真连接：读不到工具就说明没连上，状态列也得说同一件事
    await expect(page.locator('[data-dom-id="mcp-tool-row"]').first(), '工具清单里等不到 env_probe').toBeVisible(
      { timeout: 30_000 }
    )
    await expect(page.locator('[data-dom-id="mcp-tool-row"]').first()).toContainText('env_probe')
    await expect(row.first(), '状态列与工具清单说的不是同一件事').toContainText('已连接')
    await expect(row.first()).toContainText('1')

    // ③ 调用前必须有人点头；批准之后才拿到探针回报
    const callByName = (name: string) =>
      page.evaluate(async (target) => {
        const list = await window.electronAPI.mcpExternalList()
        const hit = list.find((s) => s.name === target)
        if (!hit) throw new Error(`列表里没有「${target}」`)
        return window.electronAPI.mcpExternalCall(hit.id, 'env_probe', {})
      }, name)

    const callUnapproved = callByName(NAME)
    await page.waitForSelector(CARD, { timeout: 15_000 })
    // 卡上必须写得出"哪一台的哪个工具"：写内部 id 等于让人对乱码点头
    await expect(page.locator(CARD)).toContainText(NAME)
    await expect(page.locator(CARD)).toContainText('env_probe')
    await page.click(`${CARD} >> role=button[name=/拒绝/]`)
    const rejected = await callUnapproved
    expect(rejected.error, '没批准却执行了').toBe('not-approved')

    const approved = callByName(NAME)
    await page.waitForSelector(CARD, { timeout: 15_000 })
    await page.click(`${CARD} >> role=button[name=/批准这一次/]`)
    const result = await approved
    expect(result.success, `调用失败：${result.error ?? ''}`).toBe(true)

    const probe = JSON.parse(String(result.content[0]?.text ?? '{}')) as Probe
    expect(Array.isArray(probe.envNames), '探针回报的不是清单').toBe(true)
    expect(probe.envNames.length, '探针没回报任何环境变量').toBeGreaterThan(0)
    // 正对照：PATH 这类基础变量在（说明不是"给了个空环境"把断言骗绿）
    expect(probe.envNames.map((k) => k.toUpperCase())).toContain('PATH')
    // 反对照：没点名的那个种进去的变量不该看得见
    expect(probe.seenProbeVar, '外部子进程拿到了整个 process.env，隔离没生效').toBe(false)

    // ④ 点名才给：再登记一台显式要这个变量的，同一条路必须能看见它
    await page.fill('[data-dom-id="mcp-add-name"]', NAME_NAMED)
    await page.fill('[data-dom-id="mcp-add-command"]', runner)
    await page.fill('[data-dom-id="mcp-add-args"]', FIXTURE_PATH)
    await page.fill('[data-dom-id="mcp-add-env-keys"]', PROBE)
    await page.click('[data-dom-id="mcp-add-submit"]')
    await expect(page.locator('tr[data-dom-id^="mcp-server-row-"]')).toHaveCount(2, { timeout: 15_000 })

    const namedPrep = await page.evaluate(
      async ({ name, probeName }) => {
        const list = await window.electronAPI.mcpExternalList()
        const target = list.find((s) => s.name === name)
        if (!target) throw new Error(`没找到「${name}」`)
        // 落库形状里必须带着点名的键（不是值），且不能有任何 env 值这一栏
        if (!target.envKeys?.includes(probeName)) throw new Error('落库的形状里没有 envKeys')
        if ('env' in target) throw new Error('配置里出现了环境变量值')
        return true
      },
      { name: NAME_NAMED, probeName: PROBE }
    )
    expect(namedPrep, '点名继承的那台没有按形状落库').toBe(true)

    const named = callByName(NAME_NAMED)
    await page.waitForSelector(CARD, { timeout: 15_000 })
    await page.click(`${CARD} >> role=button[name=/批准这一次/]`)
    const namedResult = await named
    expect(namedResult.success, `调用失败：${namedResult.error ?? ''}`).toBe(true)
    const namedProbe = JSON.parse(String(namedResult.content[0]?.text ?? '{}')) as Probe
    expect(namedProbe.seenProbeVar, '点名的变量没传下去——那上一条"看不见"是因为根本没给环境').toBe(true)

    // ⑤ 移除：那一行要真的消失，且再读列表少一条（只删配置不断进程的话，这里还会读到已连接）
    await page.click(`tr[data-dom-id^="mcp-server-row-"] >> nth=0 >> role=button[name="移除 ${NAME}"]`)
    await expect(page.locator('tr[data-dom-id^="mcp-server-row-"]')).toHaveCount(1, { timeout: 15_000 })
    const remaining = await page.evaluate(() => window.electronAPI.mcpExternalList())
    expect(remaining.map((s) => s.name), '列表里还剩着被"移除"的那台').toEqual([NAME_NAMED])
  } finally {
    delete process.env[PROBE]
    await app.close()
  }
})
