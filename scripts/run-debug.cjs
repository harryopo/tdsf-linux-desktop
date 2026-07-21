/**
 * 编译并运行调试脚本
 */
const esbuild = require('esbuild')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const scriptName = process.argv[2] || 'debug-aoc'
const outName = process.argv[3] || scriptName

const scriptPath = path.join(__dirname, `${scriptName}.cjs`)
const outPath = path.join(__dirname, '.cjs', `${outName}.cjs`)

fs.mkdirSync(path.dirname(outPath), { recursive: true })
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

const electronExe = path.join(
  __dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'
)
const args = process.argv.slice(4)
try {
  execFileSync(electronExe, [outPath, ...args], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
} catch (err) {
  process.exit(err.status || 1)
}
