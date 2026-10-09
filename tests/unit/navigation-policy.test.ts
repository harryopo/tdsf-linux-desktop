/**
 * 窗口导航策略判据（2026-10-09 安全审查 S3 / P1-9）
 *
 * 旧判据是"比 origin"，而 `file://` 文档的 origin 就是字符串 `'null'`，
 * 于是打包态（文档为 file://）下"任意本地 HTML 都算同源"。
 * 这里第一条用例就专门把这个事实钉住：先证明旧规则为什么会放行，再证明新规则拒。
 */
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkNavigation } from '../../src/main/services/security/navigation-policy'

const APP_PATH = join(process.cwd(), 'app-root')
const ENTRY = join(APP_PATH, 'out', 'renderer', 'index.html')
const ENTRY_URL = pathToFileURL(ENTRY).href

describe('will-navigate · file: 目的地', () => {
  it('应用目录内的文档可导航', () => {
    const inside = pathToFileURL(join(APP_PATH, 'out', 'renderer', 'detail.html')).href
    expect(checkNavigation(inside, ENTRY_URL, APP_PATH).ok).toBe(true)
  })

  it('应用目录外的本地 HTML 必拒——而它的 origin 与当前文档"相同"（旧判据的漏法）', () => {
    const outside = pathToFileURL(join(process.cwd(), 'temp-drop', 'evil.html')).href
    // 这条断言钉的是事实本身：两个 file: 地址的 origin 都是 'null'
    expect(new URL(outside).origin).toBe('null')
    expect(new URL(ENTRY_URL).origin).toBe('null')
    // 新判据不看 origin，看目的地在不在应用目录里
    const v = checkNavigation(outside, ENTRY_URL, APP_PATH)
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/应用目录/)
  })

  it('拿不到应用根时 file: 一律拒（宁可白屏也不放开本地）', () => {
    expect(checkNavigation(ENTRY_URL, ENTRY_URL, undefined).ok).toBe(false)
    expect(checkNavigation(ENTRY_URL, ENTRY_URL, '').ok).toBe(false)
  })
})

describe('will-navigate · 开发态 http 同源', () => {
  const current = 'http://localhost:5173/terminal'
  it('同 origin 放行（HMR 整页刷新走这条）', () => {
    expect(checkNavigation('http://localhost:5173/workbench', current, APP_PATH).ok).toBe(true)
  })
  it('换端口拒（本机任意 HTTP 服务不再是"同源"）', () => {
    expect(checkNavigation('http://localhost:5174/', current, APP_PATH).ok).toBe(false)
  })
  it('换主机名拒，哪怕指向同一台机器', () => {
    expect(checkNavigation('http://127.0.0.1:5173/', current, APP_PATH).ok).toBe(false)
  })
  it('协议升级/降级都拒', () => {
    expect(checkNavigation('https://localhost:5173/', current, APP_PATH).ok).toBe(false)
    expect(checkNavigation('http://localhost:5173/', 'https://localhost:5173/', APP_PATH).ok).toBe(false)
  })
  it('从 http 文档跳去 file: 也拒（协议跨面）', () => {
    expect(checkNavigation(ENTRY_URL, current, APP_PATH).ok).toBe(false)
  })
})

describe('will-navigate · 非导航协议与坏输入', () => {
  const current = 'http://localhost:5173/'
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:http://localhost:5173/x',
    'about:blank',
    'file:// Attacker/x',
    'wt-cli://cmd',
    '',
    '   ',
    'not a url',
  ]) {
    it(`拒：${JSON.stringify(bad)}`, () => {
      expect(checkNavigation(bad, current, APP_PATH).ok).toBe(false)
    })
  }
  it('当前地址解析不出来时按最小权限处理', () => {
    expect(checkNavigation('http://localhost:5173/x', 'about:blank', APP_PATH).ok).toBe(false)
  })
  it('非字符串输入不炸', () => {
    expect(checkNavigation(undefined, undefined, APP_PATH).ok).toBe(false)
    expect(checkNavigation(42, {}, APP_PATH).ok).toBe(false)
  })
})
