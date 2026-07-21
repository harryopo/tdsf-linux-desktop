/**
 * 编译并运行 verify-rag-e2e 脚本（CJS 格式，@xenova/transformers 用 dynamic import 解决 ESM）
 *
 * 关键设计：electron mock 用 esbuild banner 注入到 bundle 顶部
 * - 原因：esbuild 把 `import { app } from 'electron'` 编译为顶层 `require('electron')`
 * - 普通 require 语句会被 hoist 到所有 import 之后执行，太晚
 * - banner 在 bundle 最开头执行，确保 mock 拦截器先注册
 */
const esbuild = require('esbuild')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const scriptName = 'verify-rag-e2e'
const outPath = path.join(__dirname, '.cjs', `${scriptName}.cjs`)

fs.mkdirSync(path.dirname(outPath), { recursive: true })

// electron mock banner：在 bundle 顶部注入，先于任何 require 执行
const electronMockBanner = `
// === Electron Mock Banner (auto-injected by run-verify-rag-e2e.cjs) ===
// ELECTRON_RUN_AS_NODE 模式下 require('electron') 不返回 app export
// 用 Module._load 拦截器返回 mock 对象
(function () {
  const Module = require('node:module')
  const nodePath = require('node:path')
  const nodeOs = require('node:os')
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          getPath: function (name) {
            if (name === 'userData') {
              return nodePath.join(nodeOs.tmpdir(), 'tdsf-test-' + Date.now())
            }
            return ''
          },
          whenReady: function () { return Promise.resolve() },
          isReady: function () { return true }
        },
        safeStorage: {
          isEncryptionAvailable: function () { return false },
          encryptString: function (s) { return Buffer.from(s) },
          decryptString: function (b) { return b.toString('utf-8') }
        }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  process.env.TDSF_E2E_MOCK_ELECTRON = '1'
})()
// === End of Electron Mock Banner ===
`

esbuild.buildSync({
  entryPoints: [path.join(__dirname, `${scriptName}.ts`)],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: outPath,
  banner: { js: electronMockBanner },
  external: [
    'better-sqlite3',
    'electron',
    'fsevents',
    'ssh2',
    '@xenova/transformers',
    'onnxruntime-node',
    'sharp',
    '@photostructure/sqlite-vec'  // bundle 后 getLoadablePath() 会丢失 dist/ 相对路径，必须 external
  ],
  logLevel: 'warning',
})

const electronExe = path.join(
  __dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'
)

const logFile = path.join(process.env.TEMP || '/tmp', `${scriptName}.log`)
const logStream = fs.createWriteStream(logFile, { flags: 'w' })
logStream.write(`[run] log file: ${logFile}\n`)

console.log(`[run] 日志文件: ${logFile}`)

const child = spawn(electronExe, [outPath], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})

child.stdout.on('data', (d) => {
  const s = d.toString('utf-8')
  process.stdout.write(s)
  logStream.write(s)
})
child.stderr.on('data', (d) => {
  const s = d.toString('utf-8')
  process.stderr.write(s)
  logStream.write(s)
})

child.on('exit', (code) => {
  logStream.write(`\n[run] exit code: ${code}\n`)
  logStream.end()
  console.log(`\n[run] exit code: ${code}`)
  console.log(`[run] 日志已保存: ${logFile}`)
  process.exit(code || 0)
})
child.on('error', (err) => {
  logStream.write(`[run] spawn failed: ${err.message}\n`)
  logStream.end()
  console.error('[run] spawn failed:', err)
  process.exit(1)
})
