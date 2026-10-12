/**
 * 主进程侧的入参契约闸（P1-3）
 *
 * 方案书说"236 个 handler 几乎无入参校验"，实测口径（2026-10-12 重测）：
 * - 主进程注册点 239 个，其中用 zod 判过入参的只有 1 条通道（ssh:exec）；
 * - `src/shared/ipc-contract.ts` 登记了 28 条 invoke 契约（每条都带 zod schema），
 *   preload 也确实有 28 处 `invokeChecked` 调用点；但 preload 另有 213 处直接
 *   `ipcRenderer.invoke`（`grep -c ipcRenderer.invoke` 得 214，含封装内部那一处）。
 *   更关键的是：**校验发生在跨进程之前**，主进程收到什么并不知道 —— 契约在边界另一侧失效。
 *
 * TS 的 `config: SshConfig` 只是编译期约束：渲染层运行时传什么进来都收。
 * 这条闸把同一张契约表挪到主进程这一侧按**通道**判定，与调用方走不走封装无关，
 * 于是"契约"从"前端自觉"变成"边界强制"。
 *
 * 为什么不在这里做业务校验：闸只管形状（类型/必填/参数个数）。语义判定
 * （命令危不危险、路径在不在笼子里）各域已有自己的闸（command-gate、path confinement），
 * 混进来会让这张表变成第二个真相源。
 */
import { contractByChannel } from '@shared/ipc-contract'
import { IpcError } from '@shared/ipc-errors'
import { logger } from '../services/log/logger'

/**
 * 命中契约就校验，没登记契约的通道原样放行（239 条注册点里今天只有 28 条进了表，
 * 一刀切拒绝等于把应用关掉；覆盖面由 tests/unit/ipc-contract-arity.test.ts 钉住下界，
 * 未纳入契约的调用点数量由 preload 侧的 UNCONTRACTED_CAP 刻度闸管着，只许降不许升）。
 *
 * 失败抛 IpcError(E_INVALID_INPUT)：
 * - 给用户的话术只说"哪个方法的入参不合契约、有几处"，不回显收到的值
 *   （值可能是口令、私钥正文、用户刚打的命令；`api_key` 这类字段名可以出现，值不行）；
 * - 具体的 path + zod code 放进 detail，只有开发态外送，且照样过收口处的脱敏。
 */
export function assertContractArgsAtBoundary(channel: string, args: readonly unknown[]): void {
  const contract = contractByChannel(channel)
  if (!contract || contract.kind !== 'invoke') return

  const paths: string[] = []
  const detail: string[] = []

  if (args.length > contract.args.length) {
    paths.push('参数个数')
    detail.push(`参数个数：契约声明 ${contract.args.length} 个，收到 ${args.length} 个`)
  }
  const n = contract.args.length
  // 逐个**声明位**都判（不是只判传进来的那几个）：少传必填位与传错类型是同一类事故，
  // preload 的 assertContractArgs 本来就是按声明位数循环的，两侧口径必须一致，
  // 否则会出现"前端拦得住、绕过来就漏过去"的那种假防护。
  for (let i = 0; i < n; i++) {
    const parsed = contract.args[i].schema.safeParse(args[i])
    if (parsed.success) continue
    for (const issue of parsed.error.issues) {
      const where = `第 ${i + 1} 个参数 ${contract.args[i].name}`
      paths.push(issue.path.length ? `${where}.${issue.path.join('.')}` : where)
      // 只取 code 不取 message：zod 的 message 里可能带 min/max 等数字（无害），
      // 但自定义 refine 的 message 是写 schema 的人拼的，拼进值就跟着外送了。
      detail.push(`${where}：${issue.code}`)
    }
  }
  if (paths.length === 0) return

  logger.warn('IPC', `${channel} 入参不合契约，已拒绝`, {
    api: contract.api,
    count: paths.length,
    detail: detail.join('；'),
  })
  throw new IpcError(
    'E_INVALID_INPUT',
    `${contract.api} 的入参不符合契约（${paths.length} 处），这次调用没有进入处理逻辑`,
    detail.join('；')
  )
}
