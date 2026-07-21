/**
 * KnowledgeDetailSidebar — 知识详情右栏（4 张卡片）
 *
 * 设计稿：tdsf-linux-redesign/pages/knowledge-detail.html 右栏 aside
 *
 * 结构：
 * 1. 本页目录（6 项，可点击滚动 + 高亮当前）
 * 2. 知识置信度（圆环 92% + 6 个证据源）
 * 3. 元信息（6 行 key-val）
 * 4. 关联知识（3 项，可点击跳转 `/knowledge/:id`）
 *
 * 交互：
 * - 目录项 onClick：调用 onTocClick(target)，由父组件滚动到对应 section
 * - 关联知识项 onClick：调用 onNavigate(id)，跳转到对应知识详情
 */
import { FileText, Link2, List, Shield } from 'lucide-react'
import { CardHead } from './detail-parts'
import { META_ROWS, RELATED_ITEMS, TOC_ITEMS } from './detail-data'

interface KnowledgeDetailSidebarProps {
  /** 当前激活的 section ID（用于目录高亮） */
  activeSection: string
  /** 目录项点击回调 */
  onTocClick: (target: string) => void
  /** 关联知识项点击回调（跳转知识详情） */
  onNavigate?: (id: string) => void
}

/** 知识置信度圆环参数 */
const CONF_RADIUS = 24
const CONF_CIRCUMFERENCE = 2 * Math.PI * CONF_RADIUS
const CONF_OFFSET = CONF_CIRCUMFERENCE * (1 - 0.92)

/** 知识详情右栏组件 */
export function KnowledgeDetailSidebar({
  activeSection,
  onTocClick,
  onNavigate,
}: KnowledgeDetailSidebarProps) {
  return (
    <aside className="sticky top-5 flex w-[260px] shrink-0 flex-col gap-4">
      {/* 1. 目录 */}
      <div className="overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
        <CardHead icon={<List className="h-3.5 w-3.5" />} title="本页目录" />
        <div className="px-4 py-3">
          {TOC_ITEMS.map((item) => {
            const isActive = activeSection === item.target
            return (
              <button
                key={item.num}
                type="button"
                onClick={() => onTocClick(item.target)}
                className={`flex w-full items-center gap-2 rounded-[var(--trae-radius-4)] px-2 py-1.5 text-left text-[12px] transition-colors ${
                  isActive
                    ? 'bg-[var(--trae-bg-brand-popup)] font-medium text-[var(--trae-text-brand)]'
                    : 'text-[var(--trae-text-secondary)] hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]'
                }`}
              >
                <span className={`font-mono text-[10px] ${isActive ? 'text-[var(--trae-text-brand)]' : 'text-[var(--trae-text-tertiary)]'}`}>
                  {item.num}
                </span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 2. 知识置信度 */}
      <div className="overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
        <CardHead icon={<Shield className="h-3.5 w-3.5" />} title="知识置信度" />
        <div className="px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="relative h-14 w-14">
              <svg width="56" height="56" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r={CONF_RADIUS} fill="none" stroke="var(--trae-border-neutral-l1)" strokeWidth="4" />
                <circle
                  cx="28"
                  cy="28"
                  r={CONF_RADIUS}
                  fill="none"
                  stroke="var(--trae-status-success-default)"
                  strokeWidth="4"
                  strokeDasharray={CONF_CIRCUMFERENCE}
                  strokeDashoffset={CONF_OFFSET}
                  strokeLinecap="round"
                  transform="rotate(-90 28 28)"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center font-mono text-[12px] font-semibold text-[var(--trae-text-default)]">
                92%
              </span>
            </div>
            <div>
              <div className="text-[11px] text-[var(--trae-text-tertiary)]">综合置信度评分</div>
              <div className="mt-1 text-[12px] text-[var(--trae-text-secondary)]">
                <strong className="font-medium text-[var(--trae-text-default)]">6</strong> 个证据源支持
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. 元信息 */}
      <div className="overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
        <CardHead icon={<FileText className="h-3.5 w-3.5" />} title="元信息" />
        <div className="px-4 py-3">
          {META_ROWS.map((row) => (
            <div key={row.key} className="flex items-center justify-between py-1.5 text-[12px]">
              <span className="text-[var(--trae-text-tertiary)]">{row.key}</span>
              <span
                className={`${row.mono ? 'font-mono' : ''} ${row.alert ? 'text-[var(--trae-status-alert-default)]' : 'text-[var(--trae-text-default)]'}`}
              >
                {row.val}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 4. 关联知识（按设计稿 .kd-related__item 1:1 还原：padding 8px 10px + 背景 + 边框 + hover 变蓝） */}
      <div className="overflow-hidden rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
        <CardHead icon={<Link2 className="h-3.5 w-3.5" />} title="关联知识" />
        <div className="px-4 py-3">
          <div className="flex flex-col gap-1.5">
            {RELATED_ITEMS.map((item) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => onNavigate?.(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onNavigate?.(item.id)
                  }
                }}
                className="flex cursor-pointer items-start gap-2 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-2.5 py-2 transition-colors hover:border-[var(--trae-border-brand)] hover:bg-[var(--trae-bg-brand-popup)]"
                title={`查看「${item.title}」详情`}
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--trae-bg-brand)]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-[var(--trae-text-default)]">{item.title}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-[var(--trae-text-tertiary)]">{item.meta}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}
