/**
 * 生成渲染层的契约类型文件。
 *   pnpm ipc:gen          写文件
 *   pnpm ipc:gen --check  只比对，漂移就非零退出（测试里也跑同一份渲染函数）
 */
import fs from 'node:fs'
import path from 'node:path'
import { renderContractFile } from './render-contract'

const OUT = path.resolve(__dirname, '../../src/renderer/src/types/generated/ipc-contract.ts')
const text = renderContractFile()

if (process.argv.includes('--check')) {
  const onDisk = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  if (onDisk !== text) {
    console.error('[ipc:gen] 生成物与 src/shared/ipc-contract.ts 不一致，请跑 pnpm ipc:gen')
    process.exit(1)
  }
  console.log('[ipc:gen] PASS：生成物与契约一致')
  process.exit(0)
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, text, 'utf8')
console.log(`[ipc:gen] 已写 ${path.relative(process.cwd(), OUT)}（${Buffer.byteLength(text)} 字节 / ${text.split('\n').length} 行）`)
