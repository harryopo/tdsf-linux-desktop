const fs = require('fs')
const file = 'd:/ai/linux教学一体/tdsf-linux-desktop/src/renderer/src/components/monitor/Charts.tsx'
const buf = fs.readFileSync(file)

// 删除从 "// ===== sample 数据解析" 整行到 "// ===== 实时数据格式化" 整行
// 包含这两个 marker 行
const startText = Buffer.from('// ===== sample 数据解析', 'utf8')
const endText = Buffer.from('// ===== 实时数据格式化', 'utf8')

// 找前一个换行符（即 marker 行的开始）
const startIdx = buf.indexOf(startText)
let lineStart = startIdx
while (lineStart > 0 && buf[lineStart - 1] !== 0x0a) lineStart--
console.log('lineStart (前一个换行+1):', lineStart)

// 找后一个换行符（marker 行的结束）
const endIdx = buf.indexOf(endText)
let lineEnd = endIdx
while (lineEnd < buf.length && buf[lineEnd] !== 0x0a) lineEnd++
lineEnd++  // 包含换行符
console.log('lineEnd (后一个换行+1):', lineEnd)

if (lineStart >= 0 && lineEnd > lineStart) {
  const newBuf = Buffer.concat([buf.slice(0, lineStart), buf.slice(lineEnd)])
  fs.writeFileSync(file, newBuf)
  console.log(`Original: ${buf.length}, New: ${newBuf.length}, Removed: ${buf.length - newBuf.length}`)
} else {
  console.log('Cannot find valid range')
}
