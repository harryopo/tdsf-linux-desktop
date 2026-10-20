/**
 * 运行时加载可选依赖
 *
 * better-sqlite3、sqlite-vec、node-pty 这类原生模块可能没装、也可能 ABI 不匹配。
 * 静态 import 会在模块解析阶段抛错，整个主进程起不来；所以只能在运行时 require，
 * 并把失败原因带回调用方，由调用方决定降级方式和提示文案。
 *
 * 全仓只有这一处 require 豁免，新增可选依赖请走这里。
 */
export interface OptionalModule<T> {
  mod: T | null
  error: string | null
}

export function optionalRequire<T>(specifier: string): OptionalModule<T> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- 可选依赖只能运行时解析；静态 import 会在模块缺失/ABI 不符时让主进程起不来
    return { mod: require(specifier) as T, error: null }
  } catch (err) {
    return { mod: null, error: (err as Error)?.message ?? String(err) }
  }
}
