/**
 * 运行时加载可选依赖
 *
 * better-sqlite3、sqlite-vec、node-pty 这类原生模块可能没装、也可能 ABI 不匹配。
 * 静态 import 会在模块解析阶段抛错，整个主进程起不来；所以只能在运行时 require，
 * 并把失败原因带回调用方，由调用方决定降级方式和提示文案。
 *
 * 全仓只有这一处 require 豁免，新增可选依赖请走这里。
 */
import { createRequire } from 'node:module'

export interface OptionalModule<T> {
  mod: T | null
  error: string | null
}

// 主进程产物是 CJS（electron-vite 默认），__filename 在运行时存在。
// 用 createRequire 而不是裸 require：eslint 的 no-require-imports 仍能识别后者，
// 而这里唯一的意图就是"运行时解析可选包"，不该靠 disable 注释开洞。
const requireOptional = createRequire(__filename)

export function optionalRequire<T>(specifier: string): OptionalModule<T> {
  if (
    !specifier ||
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.includes('\\') ||
    specifier.includes('..')
  ) {
    // 相对/绝对路径会按本文件所在目录解析，打包后就是 out/main 的解析失败——直接抛，别伪装成"没装"
    throw new Error(`optionalRequire 只接受包名，收到「${specifier}」；内部模块请用静态 import`)
  }
  try {
    return { mod: requireOptional(specifier) as T, error: null }
  } catch (err) {
    return { mod: null, error: (err as Error)?.message ?? String(err) }
  }
}
