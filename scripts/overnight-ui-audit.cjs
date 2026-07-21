/**
 * overnight-ui-audit.cjs — 静态扫描 mock/死代码/过密 UI 模式
 *
 * 用法: node scripts/overnight-ui-audit.cjs
 * 退出码: 发现 P0 级死代码标记时 exit 1（可选 --strict）
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'src', 'renderer', 'src')
const STRICT = process.argv.includes('--strict')

const PATTERNS = [
  {
    id: 'mock-data-comment',
    re: /mock 数据全部|不接入真实 IPC|功能待接入|\[mock\]/i,
    severity: 'P0',
    hint: '页面/组件仍标注 mock 或未接 IPC',
  },
  {
    id: 'console-mock',
    re: /console\.log\(\s*['`]\[mock\]/i,
    severity: 'P1',
    hint: '交互仍打 mock 日志',
  },
  {
    id: 'tiny-text-9',
    re: /text-\[9px\]/,
    severity: 'P1',
    hint: '字号 9px 过小（设计稿 body-base 13px）',
  },
  {
    id: 'tiny-text-10',
    re: /text-\[10px\]/,
    severity: 'P2',
    hint: '字号 10px 偏小，优先 12–13px',
  },
  {
    id: 'tiny-btn-h5',
    re: /\bh-5\b.*(?:button|btn)|className=.*\bh-5\b/,
    severity: 'P2',
    hint: '高度 h-5(20px) 点击区偏小，建议 ≥28px',
  },
  {
    id: 'tiny-btn-size5',
    re: /size-5\b/,
    severity: 'P2',
    hint: '图标按钮 size-5 偏小',
  },
  {
    id: 'placeholder-todo',
    re: /TODO|FIXME|占位|未实现/,
    severity: 'P2',
    hint: '待办/占位标记',
  },
]

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(tsx|ts|css)$/.test(name)) out.push(p)
  }
  return out
}

const files = walk(ROOT)
const findings = []

for (const file of files) {
  const rel = path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/')
  // skip pure mock-data design assets? still report workbench mock-data
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const pat of PATTERNS) {
      if (pat.re.test(line)) {
        findings.push({
          file: rel,
          line: i + 1,
          id: pat.id,
          severity: pat.severity,
          hint: pat.hint,
          sample: line.trim().slice(0, 120),
        })
      }
    }
  }
}

// Aggregate by severity
const bySev = { P0: [], P1: [], P2: [] }
for (const f of findings) bySev[f.severity].push(f)

console.log('=== Overnight UI Audit ===')
console.log(`Scanned ${files.length} files under src/renderer/src`)
console.log(`P0: ${bySev.P0.length}  P1: ${bySev.P1.length}  P2: ${bySev.P2.length}`)
console.log('')

function printGroup(sev, list, limit = 25) {
  if (!list.length) return
  console.log(`--- ${sev} (${list.length}) ---`)
  list.slice(0, limit).forEach((f) => {
    console.log(`${f.file}:${f.line}  [${f.id}] ${f.hint}`)
    console.log(`  ${f.sample}`)
  })
  if (list.length > limit) console.log(`  ... +${list.length - limit} more`)
  console.log('')
}

printGroup('P0', bySev.P0, 40)
printGroup('P1', bySev.P1, 30)
printGroup('P2', bySev.P2, 15)

// Key pages health
const keyPages = [
  'src/renderer/src/pages/SshSettings.tsx',
  'src/renderer/src/pages/WorkbenchPage.tsx',
  'src/renderer/src/components/workbench/FileTree.tsx',
  'src/renderer/src/components/workbench/AIPanel.tsx',
  'src/renderer/src/components/workbench/WorkbenchTitlebar.tsx',
]
console.log('--- Key page mock markers ---')
for (const kp of keyPages) {
  const hits = findings.filter((f) => f.file === kp && (f.severity === 'P0' || f.id === 'console-mock'))
  console.log(`${hits.length ? '⚠' : '✓'} ${kp}  (${hits.length} P0/mock hits)`)
}

const reportPath = path.join(__dirname, '..', 'docs', 'UI_AUDIT_LATEST.md')
const md = [
  '# UI Audit Latest',
  '',
  `Time: ${new Date().toISOString()}`,
  `P0: ${bySev.P0.length} | P1: ${bySev.P1.length} | P2: ${bySev.P2.length}`,
  '',
  '## P0',
  ...bySev.P0.slice(0, 50).map((f) => `- \`${f.file}:${f.line}\` ${f.hint} — \`${f.sample.replace(/`/g, "'")}\``),
  '',
  '## P1 (top 30)',
  ...bySev.P1.slice(0, 30).map((f) => `- \`${f.file}:${f.line}\` ${f.hint}`),
  '',
].join('\n')
fs.writeFileSync(reportPath, md, 'utf8')
console.log(`\nWrote ${path.relative(path.join(__dirname, '..'), reportPath)}`)

if (STRICT && bySev.P0.length > 0) {
  process.exit(1)
}
