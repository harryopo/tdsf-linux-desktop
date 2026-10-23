/**
 * 设置区章节清单（左栏导航与 /settings 目录页的唯一数据源）
 *
 * 为什么要单独一个模块：以前左栏列 6 项、目录页列 10 张卡，两边各写一份，
 * 于是「终端设置」在目录页有、在左栏没有，点过去左栏没有高亮；
 * 目录页还挂着知识库/教程/监控/日志/启动配置这些根本不是设置的入口。
 * 现在两处都从这里读，加一节只改这一处。
 *
 * 规矩（tests/components/settings-nav-ownership.test.ts 锁住）：
 * - to 必须是 router.tsx 里 SettingsLayout 的嵌套子路由，否则点过去会卸掉左栏
 * - label 必须与该子页 PageHeader 的 title 同字
 * - desc 必须写页面里真实存在的配置，不许写没实现的能力（DESIGN.md §10）
 */
import {
  Settings, KeySquare, Sparkles, Bell, Palette, Info, Brain,
  ShieldAlert, ShieldCheck, Terminal, Activity, Plug, type LucideIcon,
} from 'lucide-react'

export interface SettingsSection {
  /** 子路由地址 */
  to: string
  /** 与子页标题同名的标签 */
  label: string
  /** 一句话说明这一节能配什么 */
  desc: string
  icon: LucideIcon
  /** 自动化脚本钩子；目录页另加 set-entry- 前缀，避免与左栏同名 */
  domId: string
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { to: '/settings/general', label: '通用', desc: '数据目录、配置导出与定时任务', icon: Settings, domId: 'nav-general' },
  { to: '/settings/appearance', label: '外观', desc: '主题、颜色与字体偏好', icon: Palette, domId: 'nav-appearance' },
  { to: '/settings/model', label: '模型配置', desc: '模型参数、API 接入与用量统计', icon: Sparkles, domId: 'nav-model-config' },
  { to: '/settings/memory', label: 'AI 记忆', desc: 'AI 记住的偏好与结论：查看、检索、删除', icon: Brain, domId: 'nav-memory' },
  { to: '/settings/calibration', label: '校准设置', desc: '置信度校准与 Temperature Scaling', icon: Activity, domId: 'nav-calibration' },
  { to: '/settings/ssh', label: 'SSH 连接', desc: '远程服务器连接与密钥管理', icon: KeySquare, domId: 'nav-ssh' },
  { to: '/settings/mcp', label: '外部 MCP', desc: '登记自己的 MCP 服务器与查看它提供的工具', icon: Plug, domId: 'nav-mcp' },
  { to: '/settings/terminal', label: '终端设置', desc: 'Shell 环境与终端行为配置', icon: Terminal, domId: 'nav-terminal' },
  { to: '/settings/risk', label: '风险控制', desc: '高危命令拦截与操作审计', icon: ShieldAlert, domId: 'nav-risk' },
  { to: '/settings/decision', label: '决策控制', desc: 'AI 决策阈值与审批策略', icon: ShieldCheck, domId: 'nav-settings-decision' },
  { to: '/settings/alerts', label: '告警阈值', desc: 'CPU / 内存 / 磁盘告警阈值', icon: Bell, domId: 'nav-alerts' },
  { to: '/settings/about', label: '关于', desc: '版本、更新与运行环境', icon: Info, domId: 'nav-about' },
]

/**
 * 子页标题的唯一取法：设置各页的 PageHeader 图标/标题/说明一律从这里取，
 * 不在页面里各写一份——否则会出现同一页左栏叫「AI 引擎」、进去叫「模型配置」，
 * 图标也不一致（导航用 Sparkles、页面用 Plug）。
 *
 * 取不到就抛：新增设置页时忘了在这里登记，开发环境立刻炸给开发者，
 * 比安静地显示一个空标题好（fail-closed，和 CLAUDE.md 的降级原则一致）。
 */
export function settingsHeader(to: string): { icon: LucideIcon; title: string; desc: string } {
  const found = SETTINGS_SECTIONS.find((s) => s.to === to)
  if (!found) {
    throw new Error(`settingsHeader('${to}')：章节清单里没有这一项，请先加进 SETTINGS_SECTIONS`)
  }
  return { icon: found.icon, title: found.label, desc: found.desc }
}
