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
import './Settings.css'

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
  { domId: 'goto-settings-model', to: '/settings/model', icon: Cpu, title: 'AI 引擎', desc: 'AI 模型参数与 API 接入' },
  { domId: 'goto-settings-terminal', to: '/settings/terminal', icon: Terminal, title: '终端设置', desc: '命令执行与翻译偏好' },
  { domId: 'goto-settings-decision', to: '/settings/decision', icon: GitBranch, title: '决策控制', desc: 'AI 决策阈值与自动执行' },
  { domId: 'goto-settings-risk', to: '/settings/risk', icon: Shield, title: '风险控制', desc: '高危命令拦截与审计' },
  { domId: 'goto-settings-alerts', to: '/settings/alerts', icon: Bell, title: '告警阈值', desc: '监控告警触发规则' },
  { domId: 'goto-settings-appearance', to: '/settings/appearance', icon: Palette, title: '外观', desc: '主题与显示偏好' },
  { domId: 'goto-settings-about', to: '/settings/about', icon: Info, title: '关于', desc: '应用版本与许可信息' },
]

export function SettingsPage() {
  return (
    <section className="set-panel-content">
      <div className="set-quickgrid">
        {QUICK_ENTRIES.map((entry) => {
          const Icon = entry.icon
          return (
            <Link
              key={entry.domId}
              to={entry.to}
              data-dom-id={entry.domId}
              aria-label={`进入${entry.title}设置`}
              className="set-quick-card btn-press"
            >
              {/* 卡片头部：图标 + 标题 + 跳转箭头 */}
              <div className="set-quick-card__head">
                <div className="set-quick-card__head-left">
                  <span className="set-quick-card__icon">
                    <Icon size={18} />
                  </span>
                  <span className="set-quick-card__title">
                    {entry.title}
                  </span>
                </div>
                <ChevronRight
                  size={16}
                  className="set-quick-card__arrow"
                />
              </div>
              {/* 卡片描述 */}
              <p className="set-quick-card__desc">
                {entry.desc}
              </p>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
