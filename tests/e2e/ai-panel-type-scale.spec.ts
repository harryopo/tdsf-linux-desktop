/**
 * ai-panel-type-scale.spec.ts —— AI 对话面板的字号层级（2026-10-28，#256）
 *
 * 为什么要有这条：用户原话「AI 对话模块的字体层级不统一，看起来非常难看」。真窗口量下来
 * 不是"感觉"问题——改前是：h1=17 / **h2=15（与正文同号）** / **h3=14（比正文还小）** / h4=13，
 * 行内代码 12、代码块 12、表格 12.5，正文行高 1.7 而用户气泡 1.6。四级标题三级倒挂，
 * 一段回答里能出现 12 / 12.5 / 13 / 14 / 15 五种字号——**层级不是"不统一"，是倒过来的**。
 *
 * 这条判据钉住的是"层级关系"，不是具体像素值：
 *   1. 只允许出现设计令牌里的档位（11/12/13/14/15/17/20）
 *   2. 标题字号只能 ≥ 正文档（不再允许"标题比正文小"）
 *   3. 助手正文、列表、用户气泡行高必须相同（两侧节奏一致）
 *   4. 行内代码与代码块同一档；角色行/时间/用量行在 micro 档
 *
 * 量的是注入一轮真形状问答之后面板里**实际生效的 computed style**，
 * 不是读 CSS 源文件——样式被覆盖、被更高优先级顶掉，源文件看不出来。
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'

const MAIN_ENTRY = path.join(__dirname, '../../out/main/index.js')
const BUILD_READY = fs.existsSync(MAIN_ENTRY)
if (!BUILD_READY) console.log('[ai-type-scale] 跳过：缺 out/main/index.js，先 pnpm build')
const testOrSkip = BUILD_READY ? test : test.skip

/** 设计令牌里允许出现在 AI 面板的字号档位（ui-tokens.css §字阶） */
const ALLOWED_SIZES = [11, 12, 13, 14, 15, 17, 20]

const SAMPLE = [
  '# 一级标题',
  '',
  '## 先看是哪个分区满了',
  '',
  '### 具体做法',
  '',
  '#### 补充说明',
  '',
  '用 **df -h** 看使用率，再用 `du -sh *` 找大目录。',
  '',
  '- 第一步：确认挂载点',
  '- 第二步：找增长最快的目录',
  '',
  '```bash',
  'df -h',
  'du -sh /var/* | sort -h',
  '```',
  '',
  '| 指标 | 含义 |',
  '| --- | --- |',
  '| Use% | 使用率 |',
].join('\n')

interface Reading {
  sel: string
  size: number
  weight: number
  lineHeight: number
  text: string
}

async function readStyles(page: Page): Promise<Reading[]> {
  return page.evaluate(() => {
    const sels = [
      '.ai-msg-role',
      '.ai-msg-prose .md-body',
      // 标题类名是拼出来的（`md-h md-h${level}`），按文字取具体级别
      '.ai-msg-prose .md-h',
      '.ai-msg-prose .md-h',
      '.ai-msg-prose .md-h',
      '.ai-msg-prose .md-h',
      '.ai-msg-prose .md-p',
      '.ai-msg-prose .md-list li',
      '.ai-msg-prose .md-inline-code',
      '.ai-msg-prose .md-code-block code',
      '.ai-msg-prose .md-table',
      '.ai-msg-prose .md-table th',
      '.ai-msg-user-bubble',
      '.ai-token-row',
      '#ai-composer-input',
      '.ai-composer-rail button',
    ]
    const out: Reading[] = []
    let headingIndex = 0
    for (const sel of sels) {
      let el = document.querySelector(sel)
      let label = sel
      // 四级标题共用 .md-h：按出现顺序各取一个，标成 md-h-0..3（顺序与注入的样例一致）
      if (sel === '.ai-msg-prose .md-h') {
        el = document.querySelectorAll(sel)[headingIndex] ?? null
        label = 'md-h-' + headingIndex
        headingIndex += 1
      }
      if (!el) continue
      const cs = getComputedStyle(el)
      out.push({
        sel: label,
        size: parseFloat(cs.fontSize),
        weight: Number(cs.fontWeight),
        lineHeight: parseFloat(cs.lineHeight),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20),
      })
    }
    return out
  })
}

test.describe('AI 对话面板的字号层级', () => {
  let app: ElectronApplication
  let page: Page
  let profile: string

  test.beforeAll(async () => {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-e2e-typescale-'))
    app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
      env: { ...process.env, NODE_ENV: 'test', TDSF_E2E: '1' },
    })
    page = await app.firstWindow()
    await page.waitForSelector('body', { timeout: 30_000 })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForSelector('.wb-main-layout', { timeout: 30_000 })

    const composer = page.locator('#ai-composer-input')
    if (!(await composer.isVisible().catch(() => false))) {
      await page.locator('[data-dom-id="btn-toggle-ai"]').click()
      await composer.waitFor({ state: 'visible', timeout: 15_000 })
    }

    await page.evaluate((content) => {
      const store = (
        window as unknown as {
          __tdsfStores?: {
            agent?: {
              getState: () => {
                addMessage: (m: Record<string, unknown>) => void
              }
            }
          }
        }
      ).__tdsfStores?.agent
      const s = store?.getState()
      if (!s) throw new Error('__tdsfStores.agent 不可用：判据没法注入消息')
      s.addMessage({
        id: 'type-scale-u',
        role: 'user',
        content: '磁盘满了怎么排查？',
        timestamp: Date.now() - 60_000,
      })
      s.addMessage({
        id: 'type-scale-a',
        role: 'assistant',
        content,
        timestamp: Date.now() - 30_000,
        providerId: 'type-scale',
        model: 'type-scale-model',
        usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 },
        contextTokens: 1200,
      })
    }, SAMPLE)
    await page.waitForSelector('.ai-msg-prose .md-body', { timeout: 10_000 })
    await page.waitForTimeout(300)
  })

  test.afterAll(async () => {
    await app?.close()
    if (profile) fs.rmSync(profile, { recursive: true, force: true })
  })

  testOrSkip('只出现令牌档位，且标题不小于正文', async () => {
    const rows = await readStyles(page)
    const by = (sel: string) => rows.find((r) => r.sel === sel)

    // ① 档位白名单：出现野生字号就是"某处又写死了一个 12.5"
    for (const r of rows) {
      expect(
        ALLOWED_SIZES.includes(r.size),
        `${r.sel} 的字号 ${r.size}px 不在令牌字阶里（允许 ${ALLOWED_SIZES.join('/')}）`
      ).toBe(true)
    }

    // ② 标题不能比正文小：改前 h3=14 < body=15 就是用户说的"层级乱"
    const body = by('.ai-msg-prose .md-body')!.size
    // 样例里标题出现顺序：一级 / 先看… / 具体… / 补充…
    const h1 = by('md-h-0')?.size ?? 0
    const h2 = by('md-h-1')?.size ?? 0
    const h3 = by('md-h-2')?.size ?? 0
    const h4 = by('md-h-3')?.size ?? 0
    expect(h1, 'h1 应大于 h2').toBeGreaterThan(h2)
    expect(h2, 'h2 必须严格大于正文（改前与正文同号）').toBeGreaterThan(body)
    expect(h3, 'h3 不许小于正文').toBeGreaterThanOrEqual(body)
    expect(h4, 'h4 及以下不许小于正文').toBeGreaterThanOrEqual(body)

    // ③ 代码：行内与代码块同一档
    expect(by('.ai-msg-prose .md-inline-code')!.size).toBe(by('.ai-msg-prose .md-code-block code')!.size)

    // ④ 注释档：角色行与用量行同一档
    expect(by('.ai-msg-role')!.size).toBe(by('.ai-token-row')!.size)
  })

  testOrSkip('助手正文 / 列表 / 用户气泡的行高一致', async () => {
    const rows = await readStyles(page)
    const lh = (sel: string) => rows.find((r) => r.sel === sel)!.lineHeight
    const bodyLh = lh('.ai-msg-prose .md-p')
    expect(lh('.ai-msg-prose .md-list li'), '列表与正文行高不同会看出"一段里两种节奏"').toBe(bodyLh)
    expect(lh('.ai-msg-user-bubble'), '用户气泡与助手正文行高不同（改前 1.6 vs 1.7）').toBe(bodyLh)
  })
})
