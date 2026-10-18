#!/usr/bin/env node
/**
 * 原生模块必须能在**不重编**的情况下被加载（CI 的 E2E job 用它替掉 electron-rebuild）
 *
 * 为什么不再重编：better-sqlite3 v13 起，npm 包里直接带 `prebuilds/<平台>-<架构>.node`，
 * 而且那是 N-API 模块（二进制里有 `napi_register_module_v1`、没有 `node_module_register`）
 * ⇒ 同一颗 .node 在 Node 与 Electron 里都能加载，不需要按 Electron ABI 重编。
 * node-pty 1.1 同理（也发 prebuilds）。
 *
 * 触发本轮改动的证据：CI 那步 `@electron/rebuild` 从立起那天就在红——它实际用的是
 * 项目 node_modules 里的 node-gyp@9，而 runner 镜像上的新版 VS 它认不出来
 * （`Could not find any Visual Studio installation to use`）。也就是说这道步骤
 * 既没必要、又一直在挡路。
 *
 * 但"没必要"这个判断本身要能被证伪，所以这里不是打印一句话就退出：
 * 真 require 一遍、真开一次库、真建一次伪终端。哪天上游不发 N-API 预编译了，
 * 这一步当场红，而不是让 e2e 以"数据库降级"的样子悄悄跑过去。
 *
 * 用法：node scripts/quality/check-native-prebuild.cjs
 * 未知参数一律 exit 2（默认分支是"读文件"，打错一个字母就等于悄悄放行）。
 */
'use strict'

const path = require('node:path')
const fs = require('node:fs')

const argv = process.argv.slice(2)
if (argv.length > 0) {
  console.error(`[native-prebuild] 未知参数：${argv.join(' ')}（本闸无参数）`)
  process.exit(2)
}

/** 从包名取它自己的 package.json 所在目录（pnpm 的 .pnpm 布局下 realpath 才是真身） */
function pkgDir(name) {
  const pj = require.resolve(name + '/package.json', { paths: [process.cwd()] })
  return path.dirname(require('node:fs').realpathSync(pj))
}

function prebuildOf(dir, file) {
  const target = `${process.platform}-${process.arch}`
  const p = path.join(dir, 'prebuilds', target, file || '')
  const flat = path.join(dir, 'prebuilds', target + '.node')
  if (fs.existsSync(p)) return p
  if (fs.existsSync(flat)) return flat
  return null
}

let failed = 0
const fail = (msg) => {
  failed++
  console.error('  ✗ ' + msg)
}

// 1) better-sqlite3：真开一次库、真写读一行
try {
  const dir = pkgDir('better-sqlite3')
  const pre = prebuildOf(dir)
  if (!pre) fail(`better-sqlite3 没有 ${process.platform}-${process.arch} 的 prebuild，重编这一步又变成必需的了`)
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  db.exec('create table t(a integer)')
  db.prepare('insert into t values (?)').run(42)
  const row = db.prepare('select a from t').get()
  db.close()
  if (!row || row.a !== 42) fail('better-sqlite3 读回来的数不对：' + JSON.stringify(row))
  else console.log(`  ✓ better-sqlite3 ${require('better-sqlite3/package.json').version} 走 ${pre ? 'prebuild' : '本地编译产物'}，建表写入读数 42`)
} catch (e) {
  fail('better-sqlite3 加载/使用失败：' + e.message)
}

// 2) node-pty：真 spawn 一个进程再杀掉（应用里本机终端走 utilityProcess，加载的就是这颗）
try {
  const dir = pkgDir('node-pty')
  const pre = prebuildOf(dir, process.platform === 'win32' ? 'pty.node' : 'pty.node')
  if (!pre) fail(`node-pty 没有 ${process.platform}-${process.arch} 的 prebuild`)
  const pty = require('node-pty')
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
  const proc = pty.spawn(shell, [], { name: 'xterm-color', cols: 80, rows: 24, env: process.env })
  const pid = proc.pid
  proc.kill()
  if (!pid) fail('node-pty 起来了但没有 pid')
  else console.log(`  ✓ node-pty ${require('node-pty/package.json').version} 起停一次（pid ${pid}），prebuild=${pre ? path.basename(pre) : 'n/a'}`)
} catch (e) {
  fail('node-pty 加载/起停失败：' + e.message)
}

if (failed) {
  console.error(`[native-prebuild] FAIL：${failed} 项不成立。这时 CI 需要恢复重编步骤，别把它删了。`)
  process.exit(1)
}
console.log('[native-prebuild] PASS：原生模块按 prebuild 加载即可，无需 node-gyp 重编')
process.exit(0)
