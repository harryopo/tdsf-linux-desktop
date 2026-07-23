/**
 * SettingsPage — 设置主页（9 卡片快捷入口）
 *
 * 路由：/settings（index，渲染在 SettingsLayout 的 Outlet 中）
 * 设计稿：settings.html 的 ds-panel 卡片网格部分（ds-card ds-card-setting）
 *
 * 结构：
 *   - 9 个概览卡片（对应 9 个功能模块），grid 布局（md:2 列 / lg:3 列）
 *   - 每个卡片含图标 + 标题 + 描述 + 跳转箭头 + 控件预览（toggle/slider/select/input/num）
 *   - 点击卡片跳转对应页面；控件为静态预览（不绑定交互）
 *
 * 视觉：全部 var(--trae-*) token，无硬编码颜色
 * 无障碍：Link(<a>) 键盘可访问 + aria-label；prefers-reduced-motion 禁用按压动画
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Terminal, Shield, ShieldAlert, BookOpen, GraduationCap, Clock,
  Activity, FileText, Power, ChevronRight, type LucideIcon,
} from 'lucide-react'
import './Settings.css'

type PreviewType = 'toggle' | 'slider' | 'select' | 'input' | 'num'

interface PreviewControl {
  type: PreviewType
  label: string
  desc: string
  /** 后端 config schema 点分路径；存在则通过 configGet 拉取真实值覆盖默认展示 */
  configKey?: string
  defaultChecked?: boolean
  defaultFill?: number
  defaultVal?: string
  sliderVal?: string
  min?: number
  max?: number
}

interface QuickEntry {
  domId: string
  to: string
  icon: LucideIcon
  title: string
  desc: string
  tag: string
  previews: PreviewControl[]
}

/** 9 个快捷入口（data-dom-id 对齐设计稿 settings.html） */
const QUICK_ENTRIES: QuickEntry[] = [
  {
    domId: 'nav-terminal-settings', to: '/settings/terminal', icon: Terminal,
    title: '终端设置', desc: '命令执行与翻译偏好', tag: 'terminal.settings',
    previews: [
      { type: 'toggle', label: '自动运行终端命令', desc: 'AI 生成命令后自动在终端执行', configKey: 'terminal.autoRun', defaultChecked: true },
      { type: 'toggle', label: '命令中文翻译', desc: '终端命令显示中文注释', configKey: 'terminal.translateCommand', defaultChecked: true },
    ],
  },
  {
    domId: 'nav-decision-control', to: '/settings/decision', icon: Shield,
    title: '决策控制', desc: 'AI 决策阈值与自动执行', tag: 'decision.control',
    previews: [
      { type: 'slider', label: '置信度阈值', desc: '低于此值的决策需人工确认', configKey: 'decision.confidenceThreshold', min: 0, max: 1, defaultFill: 75, sliderVal: '0.75' },
      { type: 'toggle', label: '沙箱预演', desc: '执行前在沙箱环境预验证', defaultChecked: true },
      { type: 'toggle', label: '命令白名单', desc: '仅允许白名单内命令自动执行', defaultChecked: true },
    ],
  },
  {
    domId: 'nav-risk-control', to: '/settings/risk', icon: ShieldAlert,
    title: '风险控制', desc: '高危命令拦截与审计', tag: 'risk.control',
    previews: [
      { type: 'toggle', label: '高危命令拦截', desc: '拦截 rm -rf / mkfs 等高危命令', configKey: 'risk.blockHighRisk', defaultChecked: true },
      { type: 'select', label: '二次确认等级', desc: '命令执行前的确认严格程度', configKey: 'risk.confirmLevel', defaultVal: '高' },
      { type: 'toggle', label: '审计日志', desc: '记录所有 AI 决策和执行操作', defaultChecked: true },
    ],
  },
  {
    domId: 'nav-knowledge-base', to: '/knowledge', icon: BookOpen,
    title: '知识库', desc: '运维知识沉淀与检索', tag: 'knowledge.base',
    previews: [
      { type: 'toggle', label: '自动知识沉淀', desc: '将执行记录自动归纳为知识条目', defaultChecked: true },
      { type: 'input', label: '知识库路径', desc: '本地知识库存储根目录', defaultVal: '/var/lib/tdsf/kb' },
      { type: 'select', label: '更新频率', desc: '知识库索引重建周期', defaultVal: '实时' },
    ],
  },
  {
    domId: 'nav-tutorial', to: '/tutorial', icon: GraduationCap,
    title: '教程', desc: 'Linux 运维学习路径', tag: 'tutorial',
    previews: [
      { type: 'select', label: '难度等级', desc: '教程内容难度筛选', defaultVal: '中级' },
      { type: 'num', label: '已完成', desc: '已完成教程数量', defaultVal: '12' },
      { type: 'toggle', label: '自动播放', desc: '自动播放教程步骤', defaultChecked: false },
    ],
  },
  {
    domId: 'nav-history', to: '/history', icon: Clock,
    title: '历史', desc: '决策与执行历史记录', tag: 'history',
    previews: [
      { type: 'num', label: '保留天数', desc: '历史记录保留天数', configKey: 'history.retainDays', defaultVal: '30' },
      { type: 'toggle', label: '自动清理', desc: '自动清理过期记录', defaultChecked: true },
      { type: 'num', label: '记录总数', desc: '历史记录总数', defaultVal: '128' },
    ],
  },
  {
    domId: 'nav-monitor', to: '/monitor', icon: Activity,
    title: '监控', desc: '系统资源实时监控', tag: 'monitor',
    previews: [
      { type: 'num', label: '采集间隔', desc: '监控数据采集间隔（秒）', defaultVal: '5' },
      { type: 'slider', label: 'CPU 阈值', desc: 'CPU 使用率告警阈值', min: 0, max: 100, defaultFill: 80, sliderVal: '80%' },
      { type: 'toggle', label: '告警通知', desc: '超阈值自动告警', defaultChecked: true },
    ],
  },
  {
    domId: 'nav-logs', to: '/logs', icon: FileText,
    title: '日志', desc: '系统日志查看与筛选', tag: 'logs',
    previews: [
      { type: 'select', label: '日志级别', desc: '日志显示级别', defaultVal: 'INFO' },
      { type: 'toggle', label: '自动滚动', desc: '新日志自动滚动到底部', defaultChecked: true },
      { type: 'num', label: '保留天数', desc: '日志保留天数', defaultVal: '14' },
    ],
  },
  {
    domId: 'nav-boot-config', to: '/boot', icon: Power,
    title: '启动配置', desc: '应用启动与初始化设置', tag: 'boot.config',
    previews: [
      { type: 'select', label: '启动模式', desc: '应用启动时进入的页面', defaultVal: '工作台' },
      { type: 'toggle', label: '自动连接', desc: '启动时自动连接上次会话', defaultChecked: false },
      { type: 'toggle', label: '开机自启', desc: '系统启动时自动运行', defaultChecked: false },
    ],
  },
]

/** slider 填充百分比（configGet 真实值优先，否则 defaultFill） */
function calcSliderFill(ctrl: PreviewControl, value: string | undefined): number {
  if (value != null) {
    const num = Number(value)
    if (!Number.isNaN(num)) {
      const min = ctrl.min ?? 0
      const max = ctrl.max ?? 1
      const range = max - min
      if (range > 0) return Math.round(((num - min) / range) * 100)
    }
  }
  return ctrl.defaultFill ?? 50
}

/** slider 显示文本（百分比或原值，configGet 优先） */
function formatSliderVal(ctrl: PreviewControl, value: string | undefined): string {
  if (value != null) {
    const num = Number(value)
    if (!Number.isNaN(num)) return ctrl.max === 100 ? `${Math.round(num)}%` : String(num)
  }
  return ctrl.sliderVal ?? ''
}

/** 渲染单个控件预览（静态展示，不绑定交互；aria-hidden 避免屏幕阅读器误读） */
function renderPreview(ctrl: PreviewControl, previewValues: Record<string, string>) {
  const value = ctrl.configKey ? previewValues[ctrl.configKey] : undefined

  if (ctrl.type === 'toggle') {
    const checked = value != null ? value === 'true' : (ctrl.defaultChecked ?? false)
    return (
      <div className="ds-preview-row" key={ctrl.label}>
        <div className="ds-preview-text">
          <div className="ds-preview-label">{ctrl.label}</div>
          <div className="ds-preview-desc">{ctrl.desc}</div>
        </div>
        <span className={`ds-toggle-mini${checked ? ' is-on' : ''}`} aria-hidden="true">
          <span className="ds-toggle-mini__thumb" />
        </span>
      </div>
    )
  }

  if (ctrl.type === 'slider') {
    const fill = calcSliderFill(ctrl, value)
    return (
      <div className="ds-preview-row" key={ctrl.label}>
        <div className="ds-preview-text">
          <div className="ds-preview-label">{ctrl.label}</div>
          <div className="ds-preview-desc">{ctrl.desc}</div>
        </div>
        <div className="ds-slider-mini" aria-hidden="true">
          <div className="ds-slider-mini__track">
            <div className="ds-slider-mini__fill" style={{ width: `${fill}%` }} />
            <div className="ds-slider-mini__thumb" style={{ left: `${fill}%` }} />
          </div>
          <span className="ds-slider-mini__val">{formatSliderVal(ctrl, value)}</span>
        </div>
      </div>
    )
  }

  // select / input / num：右侧静态展示控件
  const displayVal = value ?? ctrl.defaultVal ?? ''
  const ctrlClass = ctrl.type === 'select'
    ? 'ds-select-mini'
    : ctrl.type === 'input' ? 'ds-input-mini' : 'ds-num-mini'
  return (
    <div className="ds-preview-row" key={ctrl.label}>
      <div className="ds-preview-text">
        <div className="ds-preview-label">{ctrl.label}</div>
        <div className="ds-preview-desc">{ctrl.desc}</div>
      </div>
      <span className={ctrlClass} aria-hidden="true">{displayVal}</span>
    </div>
  )
}

export function SettingsPage() {
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    const loadPreviews = async () => {
      const values: Record<string, string> = {}
      for (const entry of QUICK_ENTRIES) {
        for (const ctrl of entry.previews) {
          if (!ctrl.configKey) continue
          try {
            const value = await window.electronAPI?.configGet(ctrl.configKey)
            if (value != null) {
              values[ctrl.configKey] = String(value)
            }
          } catch {
            // 降级：字段不可用时静默跳过，不崩溃也不显示错误
          }
        }
      }
      if (!cancelled) setPreviewValues(values)
    }
    loadPreviews()
    return () => {
      cancelled = true
    }
  }, [])

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
              aria-label={`进入${entry.title}`}
              className="ds-card ds-card-setting btn-press"
            >
              {/* 卡片头部：图标 + 标题 + 描述 + 跳转箭头 */}
              <div className="ds-card__head">
                <div className="ds-card__head-left">
                  <span className="ds-card__icon">
                    <Icon size={18} />
                  </span>
                  <div className="ds-card__head-text">
                    <div className="ds-card__title">{entry.title}</div>
                    <div className="ds-card__desc">{entry.desc}</div>
                  </div>
                </div>
                <ChevronRight size={16} className="ds-card__arrow" />
              </div>
              {/* 控件预览：直接铺控件预览，非空入口链接 */}
              <div className="ds-card__previews">
                {entry.previews.map((ctrl) => renderPreview(ctrl, previewValues))}
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
