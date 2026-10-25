/**
 * scripts/quality/subprocess-test-timeout.cjs — 给"起子进程跑真脚本"的单测补一条显式超时
 *
 * 为什么要这条：vitest 的全局 testTimeout 是 20 秒（vitest.config.ts 里定的），那个预算是给
 * 纯进程内判据用的。但有一批判据文件不是——它们每条用例都 spawnSync/execFileSync/spawn 起一个
 * 真 node 子进程去跑门禁脚本。现量（2026-10-25 本机）：
 *   - 单跑 `npx vitest run tests/unit/history-env-scan.test.ts tests/unit/promo-readout.test.ts`
 *     ⇒ 两个文件全绿，最慢的一条 2577ms，两条合计 23.90s，整体 16.80s 跑完。
 *   - 全量并行：同一份 history-env-scan 的 8 条跑了 90419ms（平均一条 11s）⇒ **几条一起撞 20 秒**。
 *     10:09 那轮红 history-env-scan 两条 + promo-readout 一条，10:16 那轮红 promo-readout 另一条：
 *     两次红的不是同一条，而单跑这两个文件都是绿的。
 * ⇒ 坏的不是判据，是"CPU 争用时 20 秒不够"。处置不能是全局放宽（那会把真正挂死的进程内判据一起
 * 放掉），只能**给这些会起子进程的文件各设一条自己的超时**。
 *
 * 名单不在这里手抄：现扫 tests/unit 里出现 spawn 三种写法的那些文件——加一个新用例文件也自动被管。
 *
 * 用法（未知参数一律报错退出，默认只打印不改文件）：
 *   node scripts/quality/subprocess-test-timeout.cjs            # 只看计划
 *   node scripts/quality/subprocess-test-timeout.cjs --apply    # 写盘
 *   node scripts/quality/subprocess-test-timeout.cjs --check    # 全都就位才绿（已接进 pnpm gates:ci）
 *   node scripts/quality/subprocess-test-timeout.cjs --self-test # 喂一把坏正则，见证必须报缺（已接进 gates:ci）
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const TIMEOUT_MS = 60_000
const MARK = `vi.setConfig({ testTimeout: ${TIMEOUT_MS} })`
const SPAWN_RE = /\b(spawnSync|execFileSync|spawnSync\.|spawn\(|execFile\()/

/**
 * 形状见证：这两份文件按写法一定会起子进程，所以扫描器必须把它们抽出来。
 * 为什么不用"扫到多少个文件"当哨兵：数量地板会在有人正常删掉几份判据之后一直红，
 * 而它本来要防的是"正则失效 ⇒ 扫到 0 个 ⇒ 每个人都'已就位' ⇒ 假绿"。
 * 见证按形状挑，不按数量挑：这两份里有 `spawnSync('node', …)`。
 */
const SHAPE_WITNESSES = ['tests/unit/promo-readout.test.ts', 'tests/unit/history-env-scan.test.ts']

/** 现扫：tests/unit 下哪些判据文件会起子进程 */
function subprocessFiles(re = SPAWN_RE) {
  const dir = path.join(ROOT, 'tests/unit')
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.test.ts'))
    .map((n) => `tests/unit/${n}`)
    .filter((rel) => re.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')))
    .sort()
}

/**
 * 抽样必须看得见见证，否则等于"扫到 0 个也算全都就位"。
 * 返回缺失的见证文件；空数组代表扫描形状还认得出这一族。
 */
function missingWitnesses(files) {
  return SHAPE_WITNESSES.filter((w) => !files.includes(w))
}

/** 在第一个 vitest import 的花括号里补上 `vi`（已有就原样返回） */
function ensureViImport(src, rel) {
  const re = /(import\s*\{)([^}]*)(\}\s*from\s*'vitest')/
  const m = src.match(re)
  if (!m) throw new Error(`${rel}：找不到 import { … } from 'vitest' 那一行，手工加`)
  const names = m[2]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (names.includes('vi')) return src
  names.unshift('vi')
  return src.replace(re, `$1 ${names.join(', ')} $3`)
}

/** 找"顶部 import 块"的收尾行（多行 import 也算），在它后面插入 setConfig */
function insertSetConfig(src, rel) {
  const lines = src.split('\n')
  let end = -1
  for (let i = 0; i < lines.length; i++) {
    const isStart = /^\s*import\b/.test(lines[i])
    if (!isStart) continue
    if (/from\s*['"][^'"]+['"]\s*;?\s*$/.test(lines[i]) || /^import\s+['"]/.test(lines[i])) {
      end = i
      continue
    }
    let closed = false
    for (let j = i + 1; j < lines.length; j++) {
      if (/from\s*['"][^'"]+['"]\s*;?\s*$/.test(lines[j])) {
        end = j
        closed = true
        break
      }
    }
    if (!closed) throw new Error(`${rel}：有一条 import 找不到收尾行，手工改这一份`)
  }
  if (end < 0) throw new Error(`${rel}：没找到 import 块`)
  if (lines.slice(end + 1).some((l) => /^\s*import\b/.test(l))) {
    throw new Error(`${rel}：import 块不连续（中间夹了代码），插入位置无法确定，手工改`)
  }
  const out = lines.slice(0, end + 1)
  out.push(
    '',
    '// 本文件的每条用例都要起一个真子进程跑门禁脚本：全量并行时 20 秒全局预算不够（现量见',
    '// scripts/quality/subprocess-test-timeout.cjs 的文件头），所以只给这一份放宽。',
    MARK
  )
  out.push(...lines.slice(end + 1))
  return out.join('\n')
}

function main() {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => a !== '--apply' && a !== '--check' && a !== '--self-test')
  if (unknown.length > 0) {
    console.error(`未知参数：${unknown.join(' ')}（可用：无参=只看计划 / --apply / --check / --self-test）`)
    process.exit(2)
  }

  if (args.includes('--self-test')) {
    // 把一个认不出任何写法的正则喂进去，见证检查必须报缺——报不出来说明这条哨兵是空的。
    const broken = missingWitnesses(subprocessFiles(/\b(spawnSyncDoesNotExist)\(/))
    if (broken.length !== SHAPE_WITNESSES.length) {
      console.error(`FAIL：量具自检没过——坏正则扫出来的见证缺失数是 ${broken.length}，应当是 ${SHAPE_WITNESSES.length}`)
      process.exit(1)
    }
    const real = missingWitnesses(subprocessFiles())
    if (real.length !== 0) {
      console.error(`FAIL：正常正则也抽不到见证 ${real.join(' ')}，这一族已经认不出了`)
      process.exit(1)
    }
    console.log(`PASS：量具自检——坏正则扫到 0 个见证（会报红），正常正则两份见证都抽得到`)
    return
  }

  const files = subprocessFiles()
  const missingWitness = missingWitnesses(files)
  if (missingWitness.length > 0) {
    console.error(
      `FAIL：只扫到 ${files.length} 个起子进程的判据文件，而且见证 ${missingWitness.join(' ')} 不在里面。` +
        '这通常不是"这一族变干净了"，是扫描形状坏了（写法换成了本脚本认不出的样子）——先修形状再来判超时。'
    )
    process.exit(1)
  }
  const missing = []
  for (const rel of files) {
    if (!fs.readFileSync(path.join(ROOT, rel), 'utf8').includes(MARK)) missing.push(rel)
  }
  console.log(`扫到 ${files.length} 个起子进程的判据文件，目标显式超时 ${TIMEOUT_MS}ms；已就位 ${files.length - missing.length} 个`)

  if (args.includes('--check')) {
    if (missing.length > 0) {
      console.error(`FAIL：还有 ${missing.length} 个文件没设显式超时（这些判据在全量并行下会随机撞 20 秒）：`)
      for (const rel of missing) console.error('  - ' + rel)
      process.exit(1)
    }
    console.log('PASS：起子进程的判据文件都带了显式超时')
    return
  }

  if (missing.length === 0) {
    console.log('没有要改的')
    return
  }
  if (!args.includes('--apply')) {
    for (const rel of missing) console.log('  + ' + rel)
    console.log('（只打印计划；要写盘加 --apply）')
    return
  }
  for (const rel of missing) {
    const abs = path.join(ROOT, rel)
    const src = fs.readFileSync(abs, 'utf8')
    let next = insertSetConfig(ensureViImport(src, rel), rel)
    if (next === src) throw new Error(`${rel}：算出来没变化，拒写`)
    const hits = next.split('\n').filter((l) => l.trim() === MARK).length
    if (hits !== 1) throw new Error(`${rel}：setConfig 应恰好 1 行，实为 ${hits}`)
    fs.writeFileSync(abs, next, 'utf8')
    console.log('  写了 ' + rel)
  }
  console.log(`\n共写 ${missing.length} 个文件（每个恰好 1 行 setConfig）`)
}

main()
