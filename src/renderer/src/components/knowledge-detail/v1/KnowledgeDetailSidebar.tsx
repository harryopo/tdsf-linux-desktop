/**
 * KnowledgeDetailSidebar — 知识详情右栏（4 张卡片）
 *
 * 设计稿：tdsf-linux-redesign/pages/knowledge-detail.html 右栏 aside
 *
 * 结构（1:1 对齐设计稿）：
 * 1. 本页目录（6 项，可点击滚动 + 高亮当前）— data-dom-id="goto-section-{N}"
 * 2. 知识置信度（圆环 92% + 6 个证据源）
 * 3. 元信息（6 行 key-val）
 * 4. 关联知识（3 项，可点击跳转 `/knowledge/:id`）
 *
 * 交互：
 * - 目录项 onClick：调用 onTocClick(target)，由父组件滚动到对应 section
 * - 关联知识项 onClick：调用 onNavigate(id)，跳转到对应知识详情
 *
 * Token 规范：全部 var(--trae-*)，shadow 用 var(--trae-shadow-card)
 */
import { FileText, Link2, List, Shield } from 'lucide-react'
import { CardHead } from './detail-parts'
import { META_ROWS, RELATED_ITEMS, TOC_ITEMS } from './detail-data'
import { cn } from '@/components/trae/utils'

interface KnowledgeDetailSidebarProps {
  /** 当前激活的 section ID（用于目录高亮） */
  activeSection: string
  /** 目录项点击回调 */
  onTocClick: (target: string) => void
  /** 关联知识项点击回调（跳转知识详情） */
  onNavigate?: (id: string) => void
  /**
   * 真实数据（v2.6 去假）：传入时置信度/元信息按真实条目渲染，
   * 关联知识（无真实推荐数据）整卡隐藏；不传 = 非 Electron 预览用设计稿示例。
   */
  real?: {
    /** 置信度百分比（0-100，来自 successRate）；缺省 = 隐藏置信度卡（如教程类无此语义） */
    confidencePct?: number
    /** 元信息行（真实 id/分类/时间等） */
    metaRows: Array<{ key: string; val: string; mono?: boolean; alert?: boolean }>
  }
}

/** 知识置信度圆环参数（设计稿示例默认 92%；真实数据按 successRate 动态计算） */
const CONF_RADIUS = 24
const CONF_CIRCUMFERENCE = 2 * Math.PI * CONF_RADIUS

/** 知识详情右栏组件 */
export function KnowledgeDetailSidebar({
  activeSection,
  onTocClick,
  onNavigate,
  real,
}: KnowledgeDetailSidebarProps) {
  const confidencePct = real ? Math.max(0, Math.min(100, Math.round(real.confidencePct ?? 0))) : 92
  const confOffset = CONF_CIRCUMFERENCE * (1 - confidencePct / 100)
  const metaRows = real ? real.metaRows : META_ROWS
  /** 真实数据未提供置信度（如教程）时隐藏整张置信度卡 */
  const showConfidence = !real || typeof real.confidencePct === 'number'
  return (
    <aside className="kb-detail-sidebar">
      {/* 1. 本页目录 */}
      <div className="kb-detail-card">
        <CardHead icon={<List className="h-3.5 w-3.5" />} title="本页目录" />
        <div className="kb-detail-card__body">
          <div className="kb-toc">
            {TOC_ITEMS.map((item, idx) => {
              const isActive = activeSection === item.target
              return (
                <button
                  key={item.num}
                  type="button"
                  data-dom-id={`goto-section-${idx + 1}`}
                  onClick={() => onTocClick(item.target)}
                  className={cn('kb-toc__item', isActive && 'is-active')}
                  aria-current={isActive ? 'location' : undefined}
                >
                  <span className="kb-toc__num">
                    {item.num}
                  </span>
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 2. 知识置信度（教程等无成功率语义的类型隐藏） */}
      {showConfidence && (
      <div className="kb-detail-card">
        <CardHead icon={<Shield className="h-3.5 w-3.5" />} title="知识置信度" />
        <div className="kb-detail-card__body">
          <div className="kb-conf">
            <div className="kb-conf__ring">
              <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
                <circle
                  cx="28"
                  cy="28"
                  r={CONF_RADIUS}
                  fill="none"
                  stroke="var(--trae-border-neutral-l1)"
                  strokeWidth="4"
                />
                <circle
                  cx="28"
                  cy="28"
                  r={CONF_RADIUS}
                  fill="none"
                  stroke="var(--trae-status-success-default)"
                  strokeWidth="4"
                  strokeDasharray={CONF_CIRCUMFERENCE}
                  strokeDashoffset={confOffset}
                  strokeLinecap="round"
                  transform="rotate(-90 28 28)"
                />
              </svg>
              <span className="kb-conf__value">
                {confidencePct}%
              </span>
            </div>
            <div className="kb-conf__info">
              <div className="kb-conf__label">综合置信度评分</div>
              <div className="kb-conf__sources">
                {real ? (
                  <>基于真实使用成功率</>
                ) : (
                  <>
                    <strong>6</strong>{' '}
                    个证据源支持
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* 3. 元信息 */}
      <div className="kb-detail-card">
        <CardHead icon={<FileText className="h-3.5 w-3.5" />} title="元信息" />
        <div className="kb-detail-card__body">
          <div className="kb-metalist">
            {metaRows.map((row) => (
              <div
                key={row.key}
                className="kb-metalist__row"
              >
                <span className="kb-metalist__key">{row.key}</span>
                <span
                  className={cn(
                    'kb-metalist__val',
                    row.mono && 'kb-metalist__val--mono',
                    row.alert && 'kb-metalist__val--alert',
                  )}
                >
                  {row.val}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. 关联知识（仅设计稿预览；真实数据无推荐源，v2.6 去假整卡隐藏） */}
      {!real && (
      <div className="kb-detail-card">
        <CardHead icon={<Link2 className="h-3.5 w-3.5" />} title="关联知识" />
        <div className="kb-detail-card__body">
          <div className="kb-related">
            {RELATED_ITEMS.map((item, idx) => (
              <div
                key={item.id}
                data-dom-id={`goto-related-${idx + 1}`}
                role="button"
                tabIndex={0}
                onClick={() => onNavigate?.(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onNavigate?.(item.id)
                  }
                }}
                className="kb-related__item"
                title={`查看「${item.title}」详情`}
              >
                <span className="kb-related__dot" />
                <div className="kb-related__body">
                  <div className="kb-related__title">
                    {item.title}
                  </div>
                  <div className="kb-related__meta">
                    {item.meta}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}
    </aside>
  )
}
