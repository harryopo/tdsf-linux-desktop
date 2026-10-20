#!/usr/bin/env node
/**
 * doc-links.cjs — 文档可信度闸（断链与过期的代码行号引用，两类都要红）
 *
 * 为什么现在要它：2026-10-18 仓库公开前把 174 份内部文档取消跟踪，
 * 当场量出 docs/INDEX.md 50 条引用里 47 条断、AGENTS.md 5 条全断、CLAUDE.md 4 条全断。
 * 这种断链不是写错的，是**搬完文档没人回头对链接**——每次搬目录都会重演一次，
 * 而公开仓的首页指着 47 个 404 是门面事故。所以钉成常驻闸，不靠下一次记得。
 *
 * 第二道判据（2026-10-20 加）：文档里写的 `某文件.ts:行号` 是给人当现场用的，
 * 搬一次目录、删一次代码它就悄悄变成"指向不存在的东西"。当天整删 Task Protocol 之后
 * 实测抓到两处：`src/shared/approval-types.ts:117`（文件从 130 行缩到 82 行，
 * 那条"记住决策是假的"的欠账还指着早已删掉的字段），
 * 以及 `src/renderer/src/hooks/useAgentChat.ts:210`（文件搬到了 components/workbench/，行号反而还对）。
 * 这类漂移不会让任何测试红，但它会让下一个接手的人按图索骥找不到东西——
 * 而 AGENTS.md 明令"AI 开工必读这几份文档"，等于把错的坐标当事实下发。
 *
 * 用法：
 *   node scripts/quality/doc-links.cjs                扫全部已入库 markdown，有问题 exit 1
 *   node scripts/quality/doc-links.cjs --self-test    阳性对照：注入必断的链接与必错的行号，必须被抓到
 *   node scripts/quality/doc-links.cjs --json         机器可读输出
 *
 * 判定口径（写死在这里，别猜）：
 *   - 链接：只看真正的 markdown 链接 [文本](目标) 与图片 ![alt](目标)；
 *     行内代码里的路径不算（`docs/**` 这种 glob 和示例路径会制造大量假阳性）。
 *   - 链接跳过 http(s)/mailto/data/#锚点/以 / 开头的绝对路径。
 *   - 链接目标解析后必须落在仓库内且在 git 跟踪集里 —— 未跟踪 = 对访客不存在 = 断。
 *   - 指向仓库外（../../ 逃出去）单独一类报出来：本机看得到、访客永远看不到。
 *   - 代码行号引用：`任意路径.扩展名:数字`。路径按**后缀唯一匹配**落到跟踪集里的某个文件
 *     （所以 `providers/llm-error.ts:267` 这种相对模块目录的写法也认），
 *     落不到 = 引用已死，行号超过该文件总行数 = 引用过期，多个候选 = 写法太含糊、要求补全路径。
 *     行号只判"还在不在范围内"，不判"那一行是不是原本说的那个东西"——后者要靠人，
 *     把这条写出来是为了别让它被当成比实际更强的闸。
 *   - EXTERNAL_CODE_REFS 里的名字是指向第三方依赖的引用（node_modules 不在跟踪集，
 *     版本一变行号就漂，判它红没有意义），名单本身会被打印出来，不许悄悄加长；
 *     单测还断言"名单里每个名字必须真被用到过"——空豁免等于提前给将来同名的死引用发许可证。
 *   - 裸路径：反引号里像仓库路径的东西（src/ tests/ scripts/ docs/ packages/ .claude/ .github/ 开头）
 *     必须落得到现场。**判据一律问 git，不问本机盘**（2026-10-20 第一版用 fs.existsSync 判目录，
 *     于是 `docs/archive/`、`scripts/.cjs/` 这种"被忽略、本机有、新克隆没有"的目录在我机器上全绿、
 *     推到 CI 红在三个作业上）：目录 = "跟踪集里有它底下的文件" 或 "被 .gitignore 忽略"；
 *     文件 = "在跟踪集里"。含 * ? {} ... 的示例、glob、模板与命令行的第二段之后都不判。
 *   - 围栏代码块（``` 与 ~~~）内的链接与行号引用都不判：那是示例，不是承诺。
 *   - 未知参数一律 exit 2（fail-closed，不许退到默认分支照样打印 PASS）。
 *
 * 这条闸**不覆盖**什么（写出来是为了别把 PASS 读成"文档全对"）：
 *   - 不带仓库根前缀的裸文件名（`DEV_SKILLS.md`、`hub.js` 这种）不判 —— 太容易撞上第三方同名，误报会逼着人放宽它；
 *   - 行号只判"在不在正本行数范围内"，不判"那一行讲的是不是原本想说的那件事"；
 *   - 正文（反引号外）里写的路径不判；未跟踪的文档（docs/reports、docs/archive 等）整个不在扫描面里。
 *   2026-10-20 现量：42 份已入库 md，行号引用 115 条、裸路径引用约 160 条，豁免 2 条，其余全部对得上现场。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const argv = process.argv.slice(2)
const SELF_TEST = argv.includes('--self-test')
const AS_JSON = argv.includes('--json')
const unknown = argv.filter((a) => a.startsWith('-') && a !== '--self-test' && a !== '--json')
if (unknown.length) {
  console.error('未知参数：' + unknown.join(' ') + '（只支持 --self-test 与 --json）')
  process.exit(2)
}

const repo = (spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout || '').trim()
if (!repo) {
  console.error('取不到仓库根目录（不在 git 仓库里？）')
  process.exit(2)
}

function trackedFiles() {
  // `-c core.quotePath=false` 不是可选的：git 默认把非 ASCII 路径转成八进制转义
  // （"docs/…/\351\241\271…"），本机因为全局配了 quotePath=false 才看不出来。
  // CI 没有这条全局配置 ⇒ 那份中文文件名的文档既进不了跟踪集、也读不到内容，
  // 当场表现是"本地扫 41 份 0 断链、CI 扫 40 份报 1 处死链"。
  const r = spawnSync(
    'git',
    ['-c', 'core.quotePath=false', 'ls-files'],
    { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 }
  )
  if (r.status !== 0) {
    console.error('git ls-files 失败：' + (r.stderr || '').trim())
    process.exit(2)
  }
  return new Set(r.stdout.split(/\r?\n/).filter(Boolean))
}

/**
 * 被引用的扩展名只有一份名单，两处判据共用。
 * 分开写迟早分叉：正则认了而 candidateSources 不收 ⇒ 活引用被报成死的。
 */
const CODE_EXT = 'ts|tsx|mts|cts|mjs|cjs|js|json|py|sh|css|sql'

/** 跟踪集里"可能被人按行号引用"的源码文件（后缀唯一匹配就拿它当正本） */
function candidateSources(tracked) {
  return [...tracked].filter((f) => new RegExp('\\.(' + CODE_EXT + ')$', 'i').test(f))
}

const LINK_RE = /!?\[[^\]]*\]\(\s*<?([^<>()\s]+)>?(?:\s+["'][^"']*["'])?\s*\)/g

/** 文档里的代码行号引用：路径.扩展名:行号（前面不吃字母数字/斜杠，避免把 URL 尾巴当路径） */
const CODE_REF_RE = new RegExp(
  '(?<![\\w/.-])([\\w./@-]+\\.(?:' + CODE_EXT + ')):(\\d+)',
  'g'
)

/**
 * 指向第三方依赖的引用（node_modules 不在跟踪集，版本一推行号就漂，判红没意义）。
 * 既用于"路径:行号"也用于裸路径；名单会被打印出来，并且有单测断言"名单里的名字必须真被用到过"。
 * 2026-10-20 现量：已入库文档里只有 hub.js（装的 @xenova/transformers 的下载缓存实现）。
 */
const EXTERNAL_CODE_REFS = new Set(['hub.js'])

const lineCountCache = new Map()
function lineCountOf(rel) {
  if (!lineCountCache.has(rel)) {
    lineCountCache.set(rel, fs.readFileSync(path.join(repo, rel), 'utf8').split(/\r?\n/).length)
  }
  return lineCountCache.get(rel)
}

/**
 * 第二种形状：**不带行号**的路径引用（`src/main/ipc/claude-sdk.ts` 这种）。
 * 为什么也要判：2026-10-20 清 `.claude/agents/api.md` 那张幽灵表时，
 * 那一行的"注册位置"写的就是这种形状——**只判 `:行号` 的话，这类幽灵一条都抓不到**。
 * 口径（噪声都在排除项里，别指望它比实际更强）：
 *   - 只看反引号里的内容，且必须像仓库路径（src/ tests/ scripts/ docs/ packages/ .claude/ .github/ 开头）；
 *   - 目录（以 / 结尾或没有扩展名）判"是不是真的目录"；带扩展名判"在不在跟踪集里"；
 *   - 排除 glob 与模板：含 `*`、`?`、`{}`、`...` 的一律不判（`src/.../xxx.ts` 是示例不是坐标）；
 *   - 反引号里是一条命令（带空格）时只取第一个空白前的 token 当路径。
 */
const INLINE_CODE_RE = /`([^`\n]+)`/g
const REPO_PATHISH = /^(?:src|tests|scripts|docs|packages|\.claude|\.github)\//
const GLOB_OR_TEMPLATE = /[*?{}]|(\.\.\.)/

/**
 * @param {{trackedSet:Set<string>, trackedList:string[], isIgnored:(p:string)=>boolean}} ctx
 * @returns {{kind:'ok'|'ghostfile'|'ghostdir'|'external'|'skip', note:string}}
 */
function classifyBarePath(span, ctx) {
  const first = span.trim().split(/\s+/)[0]
  const bare = first.replace(/#.*$/, '')
  // 带行号的那种（`:210`、`:21,164-168`）由上面那条判据管；这里再判一遍会把路径本身报成不存在
  if (/:\d/.test(bare)) return { kind: 'skip', note: bare }
  if (!REPO_PATHISH.test(bare)) return { kind: 'skip', note: bare }
  if (GLOB_OR_TEMPLATE.test(bare)) return { kind: 'skip', note: bare }
  if (bare.endsWith('/')) {
    return dirResolves(bare, ctx.trackedList, ctx.isIgnored)
      ? { kind: 'ok', note: bare }
      : { kind: 'ghostdir', note: bare }
  }
  if (ctx.trackedSet.has(bare)) return { kind: 'ok', note: bare }
  // 同上行号判据：只有"跟踪集里没有这个文件"时豁免才生效，且并入同一类读数，
  // 免得两条判据各存一份豁免、名单和实际用量脱钩。
  if (EXTERNAL_CODE_REFS.has(path.basename(bare))) return { kind: 'external', note: bare }
  // 没有扩展名又不在跟踪集里：当作目录引用问一次（`src/main` 这种漏写斜杠的写法）
  if (!/\.[a-z0-9]+$/i.test(bare) && dirResolves(bare, ctx.trackedList, ctx.isIgnored))
    return { kind: 'ok', note: bare }
  return { kind: 'ghostfile', note: bare }
}

/**
 * 目录引用落不落得到现场 —— **只问 git，绝不问本机盘**。
 * 2026-10-20 两次实测才知道另外两条路都不行：
 * ① 第一版写 fs.existsSync：`docs/archive/`、`scripts/.cjs/` 这类"本机有、新克隆没有"的目录
 *    在我机器上全绿，推到 CI 红在三个作业上（判据依赖本机现场 = 假绿）。
 * ② 改用 git check-ignore 但**带尾斜杠**问：实测连 `src/`、`docs/` 都返回"已忽略"
 *    （命中的是 .gitignore 里一个空行），于是目录判据恒真、整条裸路径判据静默失效——
 *    这次是 --self-test 报"没抓不到不存在的目录"才露出来的。去掉尾斜杠问才正确。
 * 口径：跟踪集里有它底下的文件 → 在克隆里存在；被忽略规则命中 → 文档说的是"这东西别提交"，
 * 那也是正当引用（AGENTS.md §仓库卫生 就靠这类路径列产物名单）。两者都不成立才算幽灵。
 *
 * @param {string} rel 目录路径（约定以 / 结尾）
 * @param {string[]} trackedList 跟踪集
 * @param {(p: string) => boolean} isIgnored 不带尾斜杠问 git
 */
function dirResolves(rel, trackedList, isIgnored) {
  const prefix = rel.endsWith('/') ? rel : rel + '/'
  if (trackedList.some((f) => f.startsWith(prefix))) return true
  // 忽略规则要用**不带尾斜杠**的形式问：实测带斜杠时连 `src/`、`docs/` 都返回"已忽略"
  // （命中的是 .gitignore 里一个空行），那样这条判据会恒真、整块静默失效。
  if (isIgnored(rel.replace(/\/+$/, ''))) return true
  return false
}

/** 逐个问 git 太慢，记忆化；只会在"跟踪集里一个文件都没有"的目录上触发，量很小 */
function makeIgnoreProbe() {
  const cache = new Map()
  return function isIgnored(p) {
    if (cache.has(p)) return cache.get(p)
    const r = spawnSync('git', ['check-ignore', '--no-index', '-q', '--', p], { cwd: repo, encoding: 'utf8' })
    // 0 = 命中忽略规则；1 = 未命中；其它 = git 自己报错，当成"未忽略"保守处理（宁可多报）
    const v = r.status === 0
    cache.set(p, v)
    return v
  }
}

/**
 * 一条 `路径:行号` 引用的归类
 * @returns {{kind:'ok'|'missing'|'beyond'|'ambiguous'|'external', note:string}}
 */
function classifyCodeRef(rawPath, rawLine, sources) {
  const name = rawPath.split('/').pop()
  const line = Number(rawLine)
  const suffix = '/' + rawPath
  const hits = sources.filter((f) => f === rawPath || f.endsWith(suffix))
  // 第三方豁免只在"自己树里根本没有这个文件"时才生效——
  // 否则谁都能在 src 下建一个同名 hub.js，让闸对它永久失明。
  if (hits.length === 0 && EXTERNAL_CODE_REFS.has(name)) return { kind: 'external', note: rawPath + ':' + line }
  if (hits.length === 0) return { kind: 'missing', note: rawPath + ':' + line }
  if (hits.length > 1) {
    return { kind: 'ambiguous', note: rawPath + ':' + line + '（' + hits.join(' | ') + '）' }
  }
  const total = lineCountOf(hits[0])
  if (line > total) return { kind: 'beyond', note: rawPath + ':' + line + '（正本只有 ' + total + ' 行）' }
  return { kind: 'ok', note: rawPath }
}

/**
 * 一个链接目标的归类
 * @returns {{kind:'ok'|'dead'|'outside'|'skip', target:string}}
 */
function classify(fromFile, rawTarget, tracked) {
  const t = rawTarget.trim()
  if (!t) return { kind: 'skip', target: t }
  if (/^(https?:|mailto:|data:|ftp:|#)/i.test(t)) return { kind: 'skip', target: t }
  const clean = t.split('#')[0].split('?')[0]
  if (!clean) return { kind: 'skip', target: t }
  if (clean.startsWith('/')) return { kind: 'outside', target: clean }
  const abs = path.resolve(repo, path.dirname(fromFile), clean)
  const rel = path.relative(repo, abs).split(path.sep).join('/')
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { kind: 'outside', target: rel }
  return tracked.has(rel) ? { kind: 'ok', target: rel } : { kind: 'dead', target: rel }
}

/** 扫一份 markdown：跳过围栏代码块内的链接与行号引用 */
function scanDoc(fromFile, text, tracked, sources, ctx) {
  const out = []
  const lines = text.split(/\r?\n/)
  let fence = null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const m = /^\s*(```+|~~~+)/.exec(line)
    if (m) {
      const mark = m[1][0]
      if (fence === null) fence = mark
      else if (fence === mark) fence = null
      continue
    }
    if (fence !== null) continue
    for (const hit of line.matchAll(LINK_RE)) {
      const c = classify(fromFile, hit[1], tracked)
      if (c.kind === 'dead' || c.kind === 'outside') out.push({ file: fromFile, line: i + 1, kind: c.kind, target: c.target })
    }
    for (const hit of line.matchAll(CODE_REF_RE)) {
      const c = classifyCodeRef(hit[1], hit[2], sources)
      if (c.kind === 'missing' || c.kind === 'beyond' || c.kind === 'ambiguous' || c.kind === 'external') {
        out.push({ file: fromFile, line: i + 1, kind: 'coderef:' + c.kind, target: c.note })
      }
    }
    for (const hit of line.matchAll(INLINE_CODE_RE)) {
      const c = classifyBarePath(hit[1], ctx)
      if (c.kind === 'ghostfile' || c.kind === 'ghostdir') {
        out.push({ file: fromFile, line: i + 1, kind: 'barepath:' + c.kind, target: c.note })
      } else if (c.kind === 'external') {
        out.push({ file: fromFile, line: i + 1, kind: 'coderef:external', target: c.note })
      }
    }
  }
  return out
}

/** 阳性对照：必断的链接 + 必死的行号 + 必越界的行号 + 不许误报的活引用，量具抓不到就说明它自己是死的 */
function selfTest(tracked, sources, ctx) {
  const bad = [
    '[断到仓库里没跟踪的地方](docs/definitely-not-a-real-file-9f3c2a.md)',
    '[逃到仓库外面](../../outside-host-file.md)',
    '[活的](README.md)',
    '不判它：`docs/no-glob-check.md` 与 [锚点](#标题) 与 [外链](https://example.com/a.md)',
    '```',
    '[围栏里的不判](docs/inside-fence-dead.md)',
    '```',
    // —— 代码行号引用四条：两条该抓、一条该抓越界、一条不许误报 ——
    '见 src/renderer/src/probe-file-that-does-not-exist-9c1f.ts:12 应该被点名',
    '见 doc-links.cjs:999999 行号早越过正本末尾了',
    '见 scripts/quality/doc-links.cjs:3 这条是活的，不许报',
    '见 hub.js:391 是第三方依赖里的文件，本闸不判',
    // —— 不带行号的裸路径三条：一条该抓、一条该抓目录、一条不许误报 ——
    '注册位置写 `src/main/ipc/probe-file-that-does-not-exist-9c1f.ts` 就该点名（幽灵表行就是这么来的）',
    '目录写 `src/main/ipc/probe-dir-7d2e/` 也要点名',
    '活的目录 `scripts/quality/` 与活的 `src/shared/ipc-channels.ts` 都不许报',
    '示例与 glob 一律不判：`src/.../xxx.ts`、`src/main/**`、`docs/方案书-v{版本}-{模块名}.md`、`tests/unit/*-gate.test.ts`',
    '是命令不是坐标：`scripts/design/count-important.mjs <上限>` 只取第一段路径',
    '第三方也一样不判：裸路径写法 `src/utils/hub.js` 走同一条豁免',
    // —— 目录判据必须只问 git（跟踪集 + 忽略规则），既不问本机盘也不带尾斜杠问 check-ignore ——
    '有已入库文件的目录不许报：`src/main/ipc/`',
    '被 gitignore 的产物目录不许报（文档写它正是为了说"这东西别提交"）：`scripts/.cjs/`',
    '既没已入库文件、也没被忽略的目录必须报：`docs/probe-dir-not-ignored-9f4e/`',
    '```',
    '围栏里的 src/inside-fence-nope.ts:1 不判',
    '```',
  ].join('\n')
  const hits = scanDoc('PROBE.md', bad, tracked, sources, ctx)
  const dead = hits.filter((h) => h.kind === 'dead').map((h) => h.target)
  const outside = hits.filter((h) => h.kind === 'outside').map((h) => h.target)
  const refMissing = hits.filter((h) => h.kind === 'coderef:missing').map((h) => h.target)
  const refBeyond = hits.filter((h) => h.kind === 'coderef:beyond').map((h) => h.target)
  const refExternal = hits.filter((h) => h.kind === 'coderef:external').map((h) => h.target)
  const allRefHits = hits.filter((h) => h.kind.startsWith('coderef:')).map((h) => h.target)
  const problems = []
  if (!dead.includes('docs/definitely-not-a-real-file-9f3c2a.md')) problems.push('没抓到该抓的断链')
  if (!outside.length) problems.push('没抓到该抓的"指向仓库外"')
  if (dead.includes('README.md')) problems.push('把活链误报成断链')
  if (dead.some((d) => d.includes('no-glob-check') || d.includes('inside-fence') || d.includes('example.com')))
    problems.push('误判了不该判的东西（行内代码/围栏/外链/锚点）')
  if (!refMissing.some((t) => t.includes('probe-file-that-does-not-exist-9c1f.ts')))
    problems.push('没抓到"文件已经不存在"的行号引用（这条闸等于是摆设）')
  if (!refBeyond.some((t) => t.startsWith('doc-links.cjs:999999')))
    problems.push('没抓到"行号越过正本末尾"的引用（删过代码之后就是这种形状）')
  if (allRefHits.some((t) => t.startsWith('scripts/quality/doc-links.cjs:3')))
    problems.push('把活的行号引用误报成坏的')
  if (!refExternal.some((t) => t.startsWith('hub.js:')))
    problems.push('第三方依赖豁免没生效（那说明它被当成死引用，或者豁免名单和判据脱了钩）')
  if (allRefHits.some((t) => t.includes('inside-fence-nope')))
    problems.push('围栏代码块里的示例引用被当成承诺判红了')
  const ghostFile = hits.filter((h) => h.kind === 'barepath:ghostfile').map((h) => h.target)
  const ghostDir = hits.filter((h) => h.kind === 'barepath:ghostdir').map((h) => h.target)
  const bareAll = hits.filter((h) => h.kind.startsWith('barepath:')).map((h) => h.target)
  if (!ghostFile.some((t) => t.includes('probe-file-that-does-not-exist-9c1f.ts')))
    problems.push('没抓到"不存在的路径"（幽灵表行那一类，本闸的第二条判据等于是摆设）')
  if (!ghostDir.some((t) => t.includes('probe-dir-7d2e/')))
    problems.push('没抓到"不存在的目录"')
  if (bareAll.some((t) => t === 'scripts/quality/' || t === 'src/shared/ipc-channels.ts'))
    problems.push('把活的裸路径误报成幽灵')
  if (bareAll.some((t) => t.includes('...') || t.includes('{') || t.includes('*')))
    problems.push('把示例/glob/模板路径当成坐标判红了（排除项失效）')
  if (bareAll.some((t) => t === 'scripts/design/count-important.mjs'))
    problems.push('把一条真实存在的命令误报（取第一段 token 的口径失效）')
  if (bareAll.some((t) => t === 'src/utils/hub.js'))
    problems.push('裸路径写法的第三方豁免没生效（同一个依赖文件，写成 hub.js:391 免了、写成 src/utils/hub.js 却报红）')
  if (!refExternal.some((t) => t === 'src/utils/hub.js'))
    problems.push('裸路径的第三方引用没被计入豁免读数（说明它被当成 ok 静默放过了，名单与用量对不上）')
  // 目录判据必须只读跟踪集。两个反例各守一头：
  // 用 fs.existsSync 会让 docs/archive/ 这种"本机有、克隆没有"的目录蒙过闸（2026-10-20 CI 三个作业红）；
  // 用 git check-ignore 判目录则恒真（尾斜杠连 src/ 都返回"已忽略"），整条裸路径判据静默失效。
  if (ghostDir.some((t) => t === 'src/main/ipc/' || t === 'scripts/.cjs/'))
    problems.push('把"里面有已入库文件"或"被 gitignore 的产物目录"报成了幽灵')
  if (!ghostDir.some((t) => t === 'docs/probe-dir-not-ignored-9f4e/'))
    problems.push('没抓到"既没已入库文件也没被忽略"的目录（判据又在问本机盘，或 check-ignore 带了尾斜杠变成恒真）')
  console.log(
    '[doc-links] 自检：抓到断链 ' + dead.length + ' 条、仓库外 ' + outside.length + ' 条、' +
      '死引用 ' + refMissing.length + ' 条、越界 ' + refBeyond.length + ' 条、' +
      '裸路径幽灵 ' + bareAll.length + ' 条；豁免 ' + refExternal.length + ' 条；误报 0 才算通过'
  )
  if (problems.length) {
    console.error('[doc-links] 量具失效：\n  - ' + problems.join('\n  - '))
    process.exit(1)
  }
  console.log('[doc-links] 自检 OK')
  process.exit(0)
}

const tracked = trackedFiles()
if (!tracked.size) {
  console.error('[doc-links] git 跟踪集是空的，扫描无意义')
  process.exit(2)
}
const sources = candidateSources(tracked)
const CTX = { trackedSet: tracked, trackedList: [...tracked], isIgnored: makeIgnoreProbe() }
if (SELF_TEST) selfTest(tracked, sources, CTX)

const docs = [...tracked].filter((f) => /\.md$/i.test(f))
if (!docs.length) {
  console.error('[doc-links] 跟踪集里没有一份 markdown，这条闸等于没有')
  process.exit(2)
}

const findings = []
for (const f of docs) {
  let text
  try {
    text = fs.readFileSync(path.join(repo, f), 'utf8')
  } catch {
    continue
  }
  findings.push(...scanDoc(f, text, tracked, sources, CTX))
}

const dead = findings.filter((h) => h.kind === 'dead')
const outside = findings.filter((h) => h.kind === 'outside')
const refMissing = findings.filter((h) => h.kind === 'coderef:missing')
const refBeyond = findings.filter((h) => h.kind === 'coderef:beyond')
const refAmbiguous = findings.filter((h) => h.kind === 'coderef:ambiguous')
const refExternal = findings.filter((h) => h.kind === 'coderef:external')
const bareGhostFile = findings.filter((h) => h.kind === 'barepath:ghostfile')
const bareGhostDir = findings.filter((h) => h.kind === 'barepath:ghostdir')
const blocking = [...dead, ...refMissing, ...refBeyond, ...refAmbiguous, ...bareGhostFile, ...bareGhostDir]

if (AS_JSON) {
  // 机器可读模式只打印 JSON：尾巴上挂一句"结论: PASS"会让调用方的 JSON.parse 当场炸
  // （第一次给这条闸写单测时就是这样红的——红的是量具的输出格式，不是文档）。
  // 结论由退出码表达：0 = 干净，1 = 有问题，2 = 量具自己跑不起来。
  console.log(
    JSON.stringify(
      {
        docs: docs.length,
        dead,
        outside,
        refMissing,
        refBeyond,
        refAmbiguous,
        refExternal,
        bareGhostFile,
        bareGhostDir,
      },
      null,
      2
    )
  )
  if (blocking.length) process.exit(1)
  process.exit(0)
}

if (!AS_JSON) {
  const byTarget = new Map()
  for (const h of findings) {
    const k = h.kind + ' ' + h.target
    if (!byTarget.has(k)) byTarget.set(k, [])
    byTarget.get(k).push(h.file + ':' + h.line)
  }
  for (const [k, where] of [...byTarget].sort()) {
    console.log('  ' + k + '   ← ' + where.slice(0, 4).join(', ') + (where.length > 4 ? ' 等 ' + where.length + ' 处' : ''))
  }
  console.log(
    '[doc-links] 扫了 ' + docs.length + ' 份已入库 markdown：断链 ' + dead.length + ' 处、指向仓库外 ' + outside.length +
      ' 处、代码引用（死 ' + refMissing.length + ' / 行号越界 ' + refBeyond.length + ' / 歧义 ' + refAmbiguous.length +
      '）、裸路径幽灵（文件 ' + bareGhostFile.length + ' / 目录 ' + bareGhostDir.length + '）' +
      '，另有第三方引用豁免 ' + refExternal.length + ' 处'
  )
  console.log(
    '  口径提醒：行号只判"在不在正本行数范围内"，不判"那一行讲的是不是原话"；' +
      '裸路径只判"在不在跟踪集/是不是真目录"，含 * ? {} ... 的示例与命令行的第一段之外的部分都不判；' +
      '扫描面 = git 跟踪集里的 *.md，围栏代码块内的引用不判'
  )
}

if (blocking.length) {
  console.error(
    '\n结论: FAIL —— 断链 ' + dead.length + ' 处、代码引用文件已不存在 ' + refMissing.length +
      ' 处、行号越过正本末尾 ' + refBeyond.length + ' 处、写法歧义 ' + refAmbiguous.length +
      ' 处、裸路径幽灵 ' + (bareGhostFile.length + bareGhostDir.length) +
      ' 处（访客点开就是 404，接手的人按图找不到东西）'
  )
  process.exit(1)
}
console.log('结论: PASS —— 全部已入库 markdown 的相对链接、代码行号引用与裸路径引用都对得上现场')
