/**
 * 从 src/shared/ipc-contract.ts 渲染出渲染层要用的类型文件。
 *
 * CLI（scripts/ipc/gen-contract.ts）与漂移检测测试共用这一个函数：
 * 生成器与校验器各写一遍的话，漂移检查本身就不可信。
 */
import {
  CONTRACT_TYPE_IMPORTS,
  IPC_CONTRACT,
  type EventContract,
  type InvokeContract,
} from '../../src/shared/ipc-contract'

/** 契约里用 `X | undefined` 表示可省略，生成的签名要写成 `name?: X` */
function renderArg(arg: { name: string; ts: string }): string {
  const optional = arg.ts.endsWith('| undefined')
  const type = optional ? arg.ts.replace(/\s*\|\s*undefined$/, '') : arg.ts
  return `${arg.name}${optional ? '?' : ''}: ${type}`
}

function doc(channel: string, text: string): string {
  return `  /** ${text}\n   * 通道 \`${channel}\` */`
}

export function renderContractFile(): string {
  const invokes = IPC_CONTRACT.filter((c): c is InvokeContract => c.kind === 'invoke')
  const events = IPC_CONTRACT.filter((c): c is EventContract => c.kind === 'event')

  const names = new Set<string>()
  for (const c of IPC_CONTRACT) {
    if (c.kind === 'invoke') {
      for (const a of c.args) names.add(a.ts)
      names.add(c.resultTs)
    } else {
      names.add(c.payloadName)
    }
  }
  const byModule = new Map<string, string[]>()
  for (const raw of names) {
    for (const [name, mod] of Object.entries(CONTRACT_TYPE_IMPORTS)) {
      if (!new RegExp(`\\b${name}\\b`).test(raw)) continue
      byModule.set(mod, [...(byModule.get(mod) ?? []), name])
    }
  }
  const imports = [...byModule.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mod, list]) => `import type { ${[...new Set(list)].sort().join(', ')} } from '${mod}'`)

  const invokeMethods = invokes
    .map((c) => `${doc(c.channel, c.doc)}\n  ${c.api}(${c.args.map(renderArg).join(', ')}): Promise<${c.resultTs}>`)
    .join('\n\n')

  const eventMethods = events
    .map(
      (c) =>
        `${doc(c.channel, c.doc)}\n  ${c.api}(callback: (payload: ${c.payloadName}) => void): () => void`
    )
    .join('\n\n')

  return [
    '// 生成物，别手改：来源 src/shared/ipc-contract.ts，重生成 pnpm ipc:gen',
    '// 改了契约没重生成 → tests/unit/ipc-contract.test.ts 会红',
    ...imports,
    '',
    '/** 已纳入契约的 invoke 通道：electronAPI 上这些方法的签名以这里为准 */',
    'export interface ContractedInvokeApi {',
    invokeMethods,
    '}',
    '',
    '/** 已纳入契约的推送通道：订阅函数的负载类型以这里为准 */',
    'export interface ContractedEventApi {',
    eventMethods,
    '}',
    '',
  ].join('\n')
}
