const fs = require('fs')
const file = 'd:/ai/linux教学一体/tdsf-linux-desktop/src/renderer/src/components/monitor/Charts.tsx'
const buf = fs.readFileSync(file)

console.log('File size:', buf.length)
console.log('First 20 bytes:', buf.slice(0, 20).toString('hex'))

// 找 "sample 数据解析" 的所有位置
const sampleText = Buffer.from('sample 数据解析', 'utf8')
console.log('Search for "sample 数据解析" hex:', sampleText.toString('hex'))

let pos = 0
const positions = []
while ((pos = buf.indexOf(sampleText, pos)) !== -1) {
  positions.push(pos)
  pos += sampleText.length
}
console.log('"sample 数据解析" positions:', positions)

// 找所有 "实时" 位置
const rtText = Buffer.from('实时', 'utf8')
let pos2 = 0
const rtPositions = []
while ((pos2 = buf.indexOf(rtText, pos2)) !== -1) {
  // 找该行位置
  let lineStart = pos2
  while (lineStart > 0 && buf[lineStart - 1] !== 0x0a) lineStart--
  // 输出从 lineStart 到 pos2+30
  const sample = buf.slice(lineStart, Math.min(pos2 + 30, buf.length))
  rtPositions.push({ pos: pos2, line: sample.toString('utf8').replace(/[\r\n]/g, ' ').substring(0, 50) })
  pos2 += rtText.length
}
console.log('"实时" positions and lines:')
rtPositions.forEach((p) => console.log('  pos', p.pos, ':', p.line))
