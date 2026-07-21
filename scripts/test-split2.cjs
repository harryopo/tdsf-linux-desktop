const fs = require('node:fs')
const md = fs.readFileSync('C:/Users/Lenovo/AppData/Local/Temp/test-aoc/README.md', 'utf-8')

console.log('First 50 bytes hex:')
const buf = fs.readFileSync('C:/Users/Lenovo/AppData/Local/Temp/test-aoc/README.md')
for (let i = 0; i < Math.min(50, buf.length); i++) {
  process.stdout.write(buf[i].toString(16).padStart(2, '0') + ' ')
  if ((i + 1) % 16 === 0) process.stdout.write('\n')
}
process.stdout.write('\n\n')

console.log('First 200 chars:')
console.log(JSON.stringify(md.slice(0, 200)))

// 找前 10 个 '## ' 子串
const matches = md.match(/^## .*$/gm) || []
console.log(`\n## count (multiline): ${matches.length}`)
for (const m of matches.slice(0, 15)) {
  console.log(`  match: ${m}`)
}
