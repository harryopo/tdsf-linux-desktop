/**
 * 通用 esbuild + electron runner
 *
 * 用法：node scripts/run-script.cjs <scriptName>
 *   - 编译 scripts/<scriptName>.ts → scripts/.cjs/<scriptName>.cjs
 *   - 用 ELECTRON_RUN_AS_NODE 模式跑（与 better-sqlite3 ABI 匹配）
 *   - 自动注入 electron mock banner（解决 ELECTRON_RUN_AS_NODE 下 app 不可用问题）
 *
 * 设计要点：
 *   - @xenova/transformers 用 dynamic import（embedding-service.ts 已实现）
 *   - @photostructure/sqlite-vec 必须 external（getLoadablePath 依赖 __dirname）
 *   - better-sqlite3 / electron / onnxruntime-node / sharp 都 external（原生模块）
 *
 * 参考：scripts/run-verify-rag-e2e.cjs（Sprint 7 验证脚本）
 */
const esbuild = require('esbuild')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const scriptName = process.argv[2]
if (!scriptName) {
  console.error('Usage: node scripts/run-script.cjs <scriptName>')
  console.error('  e.g. node scripts/run-script.cjs backfill-embeddings')
  process.exit(1)
}

const scriptTsPath = path.join(__dirname, `${scriptName}.ts`)
if (!fs.existsSync(scriptTsPath)) {
  console.error(`Script not found: ${scriptTsPath}`)
  process.exit(1)
}

const outPath = path.join(__dirname, '.cjs', `${scriptName}.cjs`)
fs.mkdirSync(path.dirname(outPath), { recursive: true })

// === Electron Mock Banner（注入到 bundle 顶部，先于任何 require） ===
const electronMockBanner = `
// === Electron Mock Banner (auto-injected by run-script.cjs) ===
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
              // 用真实 Electron userData 目录（与 pnpm dev 一致，便于复用已下载的模型）
              // fallback 到临时目录
              const homedir = nodeOs.homedir()
              const platform = process.platform
              const appData = platform === 'win32'
                ? nodePath.join(homedir, 'AppData', 'Roaming')
                : platform === 'darwin'
                  ? nodePath.join(homedir, 'Library', 'Application Support')
                  : nodePath.join(homedir, '.config')
              return nodePath.join(appData, 'tdsf-linux-desktop')
            }
            if (name === 'logs') {
              return nodePath.join(nodeOs.homedir(), 'AppData', 'Roaming', 'tdsf-linux-desktop', 'logs')
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

// === esbuild 编译 ===
esbuild.buildSync({
  entryPoints: [scriptTsPath],
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
    '@photostructure/sqlite-vec'
  ],
  logLevel: 'warning'
})

console.log(`[run-script] 编译完成: ${scriptName}.ts → .cjs/${scriptName}.cjs`)

// === 用 ELECTRON_RUN_AS_NODE 跑（同步执行，等子进程结束才返回）===
const electronPath = path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe')
if (!fs.existsSync(electronPath)) {
  console.error(`Electron not found: ${electronPath}`)
  process.exit(1)
}

try {
  const { execFileSync } = require('node:child_process')
  execFileSync(electronPath, [outPath, ...process.argv.slice(3)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1'
    }
  })
} catch (err) {
  // execFileSync 在子进程非零退出时会抛错，但 stderr 已通过 stdio: 'inherit' 显示
  const exitCode = err.status ?? 1
  process.exit(exitCode)
}
