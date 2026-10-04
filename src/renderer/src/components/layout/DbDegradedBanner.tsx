/**
 * DbDegradedBanner — 数据库降级全局横幅（A4）
 *
 * 为什么需要它：主进程的 better-sqlite3 加载失败、库文件打不开、schema 迁移中断，
 * 过去只写进主进程日志，界面照常显示"已保存"，用户是在事后才发现数据没了。
 * 本横幅把 db:status 的事实直接摊到所有业务页面顶部。
 *
 * 显示规则：
 * - status 为 null（非 Electron 环境 / 查询失败）→ 不显示。宁可不提醒，也不误报"数据没保存"。
 * - available=false → 红色"数据不会持久化"
 * - available=true 但迁移未到位 → 黄色"结构迁移未完成"
 * - available=true 且迁移到位 → 不显示
 * - 关闭后本次会话不再显示（重启会重新提醒）
 */
import { type FC, useEffect } from 'react'
import { useDbStatusStore } from '@/stores/db-status-store'
import './DbDegradedBanner.css'

/** 全局数据库降级横幅 */
export const DbDegradedBanner: FC = () => {
  const status = useDbStatusStore((s) => s.status)
  const dismissed = useDbStatusStore((s) => s.dismissed)
  const hydrateFromMain = useDbStatusStore((s) => s.hydrateFromMain)
  const dismiss = useDbStatusStore((s) => s.dismiss)

  useEffect(() => {
    void hydrateFromMain()
  }, [hydrateFromMain])

  if (dismissed || !status) return null
  if (status.available && !status.migrationPending) return null

  const isCritical = !status.available
  const title = isCritical
    ? '数据库不可用，本次会话的记录不会被保存'
    : '数据库结构迁移未完成，部分功能可能异常'
  const detail = isCritical
    ? status.degradedReason ?? '未知原因'
    : status.migrationError ??
      `当前 v${status.schemaVersion ?? '?'}，目标 v${status.targetSchemaVersion}`
  const classes = ['db-degraded-banner', isCritical ? 'is-critical' : 'is-warning']

  return (
    <div className={classes.join(' ')}>
      <span className="db-degraded-banner__mark">!</span>
      <span className="db-degraded-banner__text">
        <strong>{title}</strong>
        <span className="db-degraded-banner__detail">{detail}</span>
      </span>
      <button type="button" className="db-degraded-banner__close" onClick={dismiss}>
        知道了
      </button>
    </div>
  )
}

export default DbDegradedBanner
