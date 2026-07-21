/**
 * SettingsPage — 设置主页（快捷入口卡片）
 *
 * 路由：/settings（index，渲染在 SettingsLayout 的 Outlet 中）
 * 设计稿：settings.html 的 ds-panel 快捷入口部分
 *
 * 结构：
 *   - 9 个概览卡片（对应 9 个导航项），grid 布局（md:2 列 / lg:3 列）
 *   - 每个卡片含图标 + 标题 + 描述 + 跳转箭头（ChevronRight）
 *   - 点击卡片跳转对应设置子页面
 *
 * 视觉：全部 var(--trae-*) token，无硬编码 hex/rgba
 * 无障碍：Link(<a>) 键盘可访问 + aria-label；prefers-reduced-motion 禁用按压动画
 */
import { Link } from 'react-router-dom'
import {
  Settings, KeySquare, Cpu, Terminal, GitBranch, Shield, Bell,
  Palette, Info, ChevronRight, type LucideIcon,
} from 'lucide-react'

interface QuickEntry {
  domId: string
  to: string
  icon: LucideIcon
  title: string
  desc: string
}

/** 9 个快捷入口（对应 9 个导航项，data-dom-id 统一 goto-settings-* 前缀） */
const QUICK_ENTRIES: QuickEntry[] = [
  { domId: 'goto-settings-general', to: '/settings/general', icon: Settings, title: '通用', desc: '语言、启动与数据偏好' },
  { domId: 'goto-settings-ssh', to: '/settings/ssh', icon: KeySquare, title: 'SSH 连接', desc: '远程主机连接管理' },
  { domId: 'goto-settings-model-config', to: '/settings/model', icon: Cpu, title: 'AI 引擎', desc: 'AI 模型参数与 API 接入' },
  { domId: 'goto-settings-terminal', to: '/settings/terminal', icon: Terminal, title: '终端设置', desc: '命令执行与翻译偏好' },
  { domId: 'goto-settings-decision-control', to: '/settings/decision', icon: GitBranch, title: '决策控制', desc: 'AI 决策阈值与自动执行' },
  { domId: 'goto-settings-risk-control', to: '/settings/risk', icon: Shield, title: '风险控制', desc: '高危命令拦截与审计' },
  { domId: 'goto-settings-alerts', to: '/settings/alerts', icon: Bell, title: '告警阈值', desc: '监控告警触发规则' },
  { domId: 'goto-settings-appearance', to: '/settings/appearance', icon: Palette, title: '外观', desc: '主题与显示偏好' },
  { domId: 'goto-settings-about', to: '/settings/about', icon: Info, title: '关于', desc: '应用版本与许可信息' },
]

export function SettingsPage() {
  return (
    <section className="flex flex-col" style={{ gap: 16 }}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {QUICK_ENTRIES.map((entry) => {
          const Icon = entry.icon
          return (
            <Link
              key={entry.domId}
              to={entry.to}
              data-dom-id={entry.domId}
              aria-label={`进入${entry.title}设置`}
              className="settings-card btn-press flex cursor-pointer flex-col no-underline"
              style={{
                background: 'var(--trae-bg-base-secondary)',
                border: '1px solid var(--trae-border-neutral-l1)',
                borderRadius: 'var(--trae-radius-8)',
                padding: 16,
                transition: 'border-color 160ms ease-out, background 160ms ease-out',
                color: 'inherit',
              }}
            >
              {/* 卡片头部：图标 + 标题 + 跳转箭头 */}
              <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                <div className="flex items-center" style={{ gap: 8 }}>
                  <span
                    className="inline-flex items-center justify-center"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 'var(--trae-radius-8)',
                      background: 'var(--trae-bg-overlay-l2)',
                    }}
                  >
                    <Icon size={18} style={{ color: 'var(--trae-icon-default)' }} />
                  </span>
                  <span
                    style={{
                      fontSize: 'var(--trae-body-base-strong-font-size)',
                      fontWeight: 'var(--trae-font-weight-strong)',
                      lineHeight: 'var(--trae-body-base-strong-line-height)',
                      color: 'var(--trae-text-default)',
                    }}
                  >
                    {entry.title}
                  </span>
                </div>
                <ChevronRight
                  size={16}
                  className="shrink-0 settings-card__arrow"
                  style={{ color: 'var(--trae-icon-tertiary)' }}
                />
              </div>
              {/* 卡片描述 */}
              <p
                style={{
                  fontSize: 'var(--trae-body-sm-font-size)',
                  lineHeight: 'var(--trae-body-sm-line-height)',
                  color: 'var(--trae-text-secondary)',
                  margin: 0,
                }}
              >
                {entry.desc}
              </p>
            </Link>
          )
        })}
      </div>

      {/* ====== 按压动画 + 卡片 hover + 无障碍降级 ====== */}
      <style>{`
        .btn-press { transition: transform 80ms ease-out; }
        .btn-press:active { transform: scale(0.92); }
        .settings-card:hover {
          border-color: var(--trae-border-brand);
          background: var(--trae-bg-overlay-l1);
        }
        .settings-card:hover .settings-card__arrow {
          color: var(--trae-icon-brand);
        }
        @media (prefers-reduced-motion: reduce) {
          .btn-press:active { transform: none !important; }
          .settings-card { transition: none; }
        }
      `}</style>
    </section>
  )
}
