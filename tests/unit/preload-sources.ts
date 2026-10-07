/**
 * 读 preload 源码文本的统一入口
 *
 * 为什么要统一：阶段 D1 把 3400 行的 src/preload/index.ts 按域拆成
 * index.ts + domains/*.ts + ipc-util.ts。几条"源码级接线"断言原本只读 index.ts，
 * 拆完再读它就会把"链路其实是通的"读成"断了"——断言要锁的是接线存在，不是它在哪个文件。
 *
 * - preloadWiring：装配与真正的调用/监听位点（index.ts + domains/*.ts）
 * - preloadAll：再加 ipc-util.ts（createListener、invokeChecked 这类共用工具的定义处）
 */
import fs from 'node:fs'
import path from 'node:path'

export function preloadWiring(root: string): string {
  const dir = path.join(root, 'src/preload')
  const files = [path.join(dir, 'index.ts')]
  const domains = path.join(dir, 'domains')
  if (fs.existsSync(domains)) {
    files.push(
      ...fs
        .readdirSync(domains)
        .filter((f) => f.endsWith('.ts'))
        .sort()
        .map((f) => path.join(domains, f))
    )
  }
  return files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
}

export function preloadAll(root: string): string {
  const util = path.join(root, 'src/preload/ipc-util.ts')
  return preloadWiring(root) + (fs.existsSync(util) ? '\n' + fs.readFileSync(util, 'utf8') : '')
}
