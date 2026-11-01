/**
 * Sidecar（Python 分析引擎）健康状态的跨进程形状（2026-11-01）
 *
 * 为什么要有这一份：引擎崩溃/自动重启原来只在日志面板里看得见，
 * 用户在工作台只会觉得"AI 日志分析忽然不好使"。主进程把状态推上来，
 * 全局横幅据此说清"崩了 / 正在第几次重启 / 还有多久 / 还是彻底停了"。
 */

/** 与 sidecar-manager 的 SidecarStatus 同一组取值（两边都是联合类型，多一个值就编译报错） */
export type SidecarPhase = 'stopped' | 'starting' | 'ready' | 'degraded' | 'crashed'

export interface SidecarHealthState {
  phase: SidecarPhase
  /** 滚动窗口内第几次自动重启（1 起）；就绪/停止时为 0 */
  restartAttempt: number
  /** 已排定重启时距触发还有多久（毫秒）；没排就是 null */
  nextRetryInMs: number | null
  /** 窗口预算已烧光：不再自动重启，要一直说到有人处理为止 */
  exhausted: boolean
  /** 给用户看的一句话原因（退出码 / 启动失败原因）；正常时为 null */
  detail: string | null
}
