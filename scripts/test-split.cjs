// 直接测试拆分函数
const fs = require('node:fs')
const md = fs.readFileSync('C:/Users/Lenovo/AppData/Local/Temp/test-aoc/README.md', 'utf-8')

function splitMarkdownBySections(md) {
  const lines = md.split('\n')
  const sections = []
  let current = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.match(/^##\s+(.+)$/)) {
      if (current) {
        sections.push({
          title: current.title,
          body: current.lines.join('\n').trim(),
          slug: current.title
        })
      }
      const title = line.replace(/^##\s+/, '').trim()
      current = { title, body: '', lines: [] }
      console.log(`[line ${i+1}] H2 matched: ${title}`)
    } else {
      if (line.match(/^#\s+/) && !current) {
        continue
      }
      if (current) {
        current.lines.push(line)
      }
    }
  }
  if (current) {
    sections.push({
      title: current.title,
      body: current.lines.join('\n').trim(),
      slug: current.title
    })
  }
  return sections.filter((s) => s.body.length > 50)
}

const result = splitMarkdownBySections(md)
console.log(`\nResult: ${result.length} sections`)
for (const s of result) {
  console.log(`  - ${s.title} (${s.body.length} chars)`)
}
