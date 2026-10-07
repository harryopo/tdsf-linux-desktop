/**
 * e2e 前置闸：跑之前必须是"刚 build 过的包"，否则不许绿
 *
 * 为什么要它：13 个 spec 各自写着 `BUILD_READY ? test : test.skip`，
 * 于是 `test:e2e:fast` 在没有 out/ 或 out/ 是改版前的旧包时，会把整批用例静默 skip 掉，
 * Playwright 照样 exit 0 —— 这是"看起来验过了"的假绿通道。
 * 为什么现在补：2026-10-07 那次 preload 被外部 require 打穿（sandbox 里 require('zod') 抛，
 * electronAPI 整个 undefined，应用起不来），而这类断链只有"跑真包"才看得出来。
 * 但真包这条链路有个洞：谁要是忘了先 build，或者 out/ 还是上一版的包，
 * 13 个 spec 会整批 skip 并报 exit 0 —— 于是"跑过 e2e"这句话可以是空的。
 *
 * 想绕过：TDSF_E2E_SKIP_BUILD_CHECK=1（会打印警告，别拿它当默认）。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const OUT_MAIN = path.join(ROOT, 'out', 'main', 'index.js')
const WATCH = ['src', 'electron.vite.config.ts', 'package.json']

function newestMtime(rel: string): number {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return 0
  const st = fs.statSync(abs)
  if (!st.isDirectory()) return st.mtimeMs
  let max = st.mtimeMs
  for (const name of fs.readdirSync(abs)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue
    const child = newestMtime(path.join(rel, name))
    if (child > max) max = child
  }
  return max
}

export default async function globalSetup(): Promise<void> {
  if (process.env.TDSF_E2E_SKIP_BUILD_CHECK === '1') {
    console.warn('[e2e-build-gate] 已绕过构建新鲜度检查（TDSF_E2E_SKIP_BUILD_CHECK=1）')
    return
  }
  if (!fs.existsSync(OUT_MAIN)) {
    throw new Error(
      `[e2e-build-gate] 没有 ${path.relative(ROOT, OUT_MAIN)}。` +
        '各 spec 在没有构建产物时会整批静默 skip 并报绿，所以这里直接失败：先跑 pnpm build'
    )
  }
  const built = fs.statSync(OUT_MAIN).mtimeMs
  const src = Math.max(...WATCH.map(newestMtime))
  if (src > built) {
    throw new Error(
      `[e2e-build-gate] out/ 比 src/ 旧 ${(src - built) / 1000}s —— 跑的是改版前的包，结论不可信。先跑 pnpm build`
    )
  }
}
