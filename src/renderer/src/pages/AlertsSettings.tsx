/**
 * AlertsSettings — 告警阈值设置（指引页）
 *
 * 路由：/settings/alerts
 *
 * 设计稿：settings.html 第 1966-1969 行 nav-alerts 是 div.ds-nav__item，
 * 仅 data-dom-id="nav-alerts" + 文本"告警阈值"，无对应独立 settings-alerts.html。
 *
 * Spec DEC-4：9 项 nav 统一，nav-alerts 路由指向 /settings/alerts。
 * 由于告警阈值配置已集成到监控页（MonitorPage），本页作为指引页，
 * 提供说明文本 + 跳转按钮，引导用户前往 /monitor 完成阈值配置。
 *
 * 视觉：全部 var(--trae-*) token，无硬编码 hex/rgba
 * 无障碍：button type="button" + aria-label；prefers-reduced-motion 禁用按压动画
 */
import { Bell, ArrowRight, type LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsCard } from '@/components/settings/SettingsCard'

export function AlertsSettings() {
  const navigate = useNavigate()
  const handleGotoMonitor = () => navigate('/monitor')

  return (
    <div>
      <SettingsPageHeader
        icon={Bell as LucideIcon}
        title="告警阈值"
        desc="告警阈值配置已集成到监控页"
      />

      <div className="flex flex-col gap-4 p-6">
        <SettingsCard icon={Bell} title="功能说明" tag="monitor.alerts">
          <div className="flex flex-col gap-4 py-2">
            <p
              className="text-[12px] leading-[18px] text-[var(--trae-text-secondary)]"
              style={{ margin: 0 }}
            >
              告警阈值（CPU / 内存 / 磁盘 / 网络等指标的告警触发线）已统一在
              <span className="text-[var(--trae-text-default)]"> 监控页 </span>
              中配置与管理。请点击下方按钮前往监控页进行阈值调整。
            </p>

            <div>
              <button
                type="button"
                data-dom-id="goto-monitor-alerts"
                aria-label="前往监控页配置告警阈值"
                onClick={handleGotoMonitor}
                className="btn-press inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand-popup)] px-3 text-[12px] font-medium text-[var(--trae-text-default)] transition-colors hover:bg-[var(--trae-bg-overlay-l1)]"
              >
                <span>前往监控页</span>
                <ArrowRight className="size-3.5" />
              </button>
            </div>
          </div>
        </SettingsCard>
      </div>

      {/* ====== 按压动画 + 无障碍降级 ====== */}
      <style>{`
        .btn-press { transition: transform 80ms ease-out; }
        .btn-press:active { transform: scale(0.92); }
        @media (prefers-reduced-motion: reduce) {
          .btn-press:active { transform: none !important; }
        }
      `}</style>
    </div>
  )
}
