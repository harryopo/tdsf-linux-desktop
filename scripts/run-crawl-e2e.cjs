/**
 * 编译并运行端到端验证脚本
 * 1. 用 esbuild 把 .ts 编译为 .cjs（platform=node）
 * 2. 用 ELECTRON_RUN_AS_NODE 模式跑（这样 better-sqlite3 能加载）
 */
const esbuild = require('esbuild')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const scriptPath = path.join(__dirname, 'crawl-e2e-verify.ts')
const outPath = path.join(__dirname, '.cjs', 'crawl-e2e-verify.cjs')

// 1. 编译
fs.mkdirSync(path.dirname(outPath), { recursive: true })
console.log('[Build] esbuild 编译中...')
esbuild.buildSync({
  entryPoints: [scriptPath],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: outPath,
  external: ['better-sqlite3', 'electron', 'fsevents', 'ssh2'],
  logLevel: 'warning',
})
console.log(`[Build] 编译完成: ${outPath}`)

// 2. 用 electron 跑
const electronExe = path.join(
  __dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'
)
const args = process.argv.slice(2)
console.log(`[Run] ELECTRON_RUN_AS_NODE=1 ${electronExe} ${outPath} ${args.join(' ')}`)

try {
  execFileSync(electronExe, [outPath, ...args], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
} catch (err) {
  console.error('[Run] 运行失败:', err.message)
  process.exit(1)
}
