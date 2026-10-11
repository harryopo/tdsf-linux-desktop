import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * 源码树普查的唯一取数口。
 *
 * 为什么要有：静态判据类测试会往 src/main 里临时写一个 `__xxx-canary__.ts` 来证明
 * "这条闸真有牙"，用完删掉。而普查是"先列目录、再逐个读文件"，两步之间没有原子性 ——
 * 撞上别人那个窗口就是随机 ENOENT（实测红过两次：能力普查撞权限 canary、
 * 权限普查撞 exec canary）。
 *
 * 修法不是"把探针文件藏起来"（那样探针自己的测试就失效了），而是**读不到就当它不在**：
 * 一个在扫描中途消失的文件，本来也不可能是需要报告的违规。
 */

/** 递归列出目录下的 .ts/.tsx（绝对路径），跳过 node_modules 与点开头目录 */
export function listSourceFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      listSourceFiles(full, acc)
      continue
    }
    if (/\.tsx?$/.test(e.name)) acc.push(full)
  }
  return acc
}

/** 读一个可能正在被别的测试删掉的文件：没了就返回空串，不炸整轮普查 */
export function readSourceFile(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw e
  }
}

/**
 * 在 dir 里跑一次"会临时造文件"的探针，并把 dir 自身的 mtime 原样还回去。
 *
 * 建完再删会把目录 mtime 顶到当下，而 tests/e2e/global-setup.ts 的新鲜度门
 * 按目录递归取最新 mtime —— 下一次 e2e 就会误报"out/ 比 src/ 旧，跑的是改版前的包"。
 */
export async function withCanaryRestoredMtime<T>(dir: string, fn: () => Promise<T> | T): Promise<T> {
  const before = fs.statSync(dir).mtimeMs
  try {
    return await fn()
  } finally {
    fs.utimesSync(dir, new Date(), new Date(before))
  }
}
