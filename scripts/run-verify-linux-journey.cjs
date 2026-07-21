/**
 * 编译并运行 verify-linux-journey 脚本，输出到日志文件
 */
const esbuild = require('esbuild')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const scriptName = 'verify-linux-journey'
const outPath = path.join(__dirname, '.cjs', `${scriptName}.cjs`)

fs.mkdirSync(path.dirname(outPath), { recursive: true })
esbuild.buildSync({
  entryPoints: [path.join(__dirname, `${scriptName}.ts`)],
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
