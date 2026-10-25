/**
 * 拦截留痕的真正落点（2026-10-15 全维度系统审查 F1）
 *
 * 判定层（core/command-gate）只留一个可注入的口，这里负责把它接到审计表：
 * 启动时调一次 installCommandBlockTrace()，之后每一条被拦下的高危命令都在
 * audit_log 里留下一行 cmd_exec。
 *
 * 为什么留痕值得单独一个模块：留痕要写库、要脱敏、要读设置页那个"记录命令执行"的开关，
 * 这些都是服务层的依赖。把它们塞进判定层会让纯函数判定不再可单测，
 * 也会让"闸到底拦没拦"这个问题变得要去查数据库才能回答。
 */
import { setCommandBlockSink, type CommandBlockTrace } from './command-gate'
import { AuditRepo } from '../services/db/audit-repo'
import { DatabaseManager } from '../services/db/database'

/** 把一次拦截翻成审计表里的一行 */
export function traceToAuditInput(t: CommandBlockTrace): {
  category: 'cmd_exec'
  action: string
  command: string
  exitCode: null
  riskLevel: string
  details: Record<string, unknown>
} {
  return {
    category: 'cmd_exec',
    // action 里带上来源：用户回头看到"rm -rf /"这行，得知道是 AI 想执行还是他自己敲的
    action: `高危命令拦截（${t.source}）`,
    command: t.command,
    // 被拦下等于没有执行，退出码必须是空的，不能写成 0（那会被读成"跑成功了"）
    exitCode: null,
    riskLevel: t.riskLevel ?? 'block',
    details: { reason: t.reason, ...(t.matched ? { matched: t.matched } : {}) },
  }
}

/**
 * 注册留痕落点。
 * @param repo 审计表写入者（缺省用当前库单例；测试里注入替身）
 */
export function installCommandBlockTrace(repo: AuditRepo = new AuditRepo(DatabaseManager.getInstance())): void {
  setCommandBlockSink((t) => {
    repo.log(traceToAuditInput(t))
  })
}
