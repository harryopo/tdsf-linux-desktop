/**
 * KnowledgeDetailSidebar — 知识详情右栏（目录 / 置信度 / 元信息）
 *
 * 版式沿用 tdsf-linux-redesign/pages/knowledge-detail.html 右栏 aside。
 *
 * 阶段 F4：设计稿自带的示例目录、示例元信息、示例"关联知识"三项全部删除。
 * - 目录改由父组件按正文实际渲染出的节传入，杜绝"点了跳到不存在的锚点"
 * - 置信度只有真实 successRate 才画环；教程类无该语义就不出这张卡
 * - "关联知识"整卡撤掉：本仓库没有推荐算法，示例条目只会让人以为系统真会推荐
 *
 * Token 规范：全部 var(--trae-*)，shadow 用 var(--trae-shadow-card)
 */
import { FileText, List, Shield } from 'lucide-react'
import { CardHead } from './detail-parts'
import { cn } from '@/components/trae/utils'

/** 元信息行（右侧「元信息」卡的一行） */
export interface MetaRow {
  key: string
  val: string
  mono?: boolean
  alert?: boolean
}

interface KnowledgeDetailSidebarProps {
  /** 当前激活的 section ID（用于目录高亮） */
  activeSection: string
  /** 目录项点击回调 */
  onTocClick: (target: string) => void
  /** 正文实际渲染出来的节（与页面同源） */
  sections: Array<{ key: string; label: string }>
  /** 置信度百分比（0-100，来自真实 successRate）；不传 = 隐藏置信度卡（如教程类无此语义） */
  confidencePct?: number
  /** 元信息行（真实 id / 分类 / 时间等） */
  metaRows: MetaRow[]
}

/** 知识置信度圆环参数 */
const CONF_RADIUS = 24
const CONF_CIRCUMFERENCE = 2 * Math.PI * CONF_RADIUS

/** 知识详情右栏组件 */
export function KnowledgeDetailSidebar({
  activeSection,
  onTocClick,
  sections,
  confidencePct,
  metaRows,
}: KnowledgeDetailSidebarProps) {
  const conf = confidencePct == null ? null : Math.max(0, Math.min(100, Math.round(confidencePct)))
  const confOffset = CONF_CIRCUMFERENCE * (1 - (conf ?? 0) / 100)
  return (
    <aside className="kb-detail-sidebar">
      {/* 1. 本页目录 */}
      <div className="kb-detail-card">
        <CardHead icon={<List className="h-3.5 w-3.5" />} title="本页目录" />
        <div className="kb-detail-card__body">
          <div className="kb-toc">
            {sections.map((item, idx) => {
              const isActive = activeSection === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  data-dom-id={`goto-section-${idx + 1}`}
                  onClick={() => onTocClick(item.key)}
                  className={cn('kb-toc__item', isActive && 'is-active')}
                  aria-current={isActive ? 'location' : undefined}
                >
                  <span className="kb-toc__num">
                    {idx + 1}
                  </span>
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 2. 知识置信度（教程等无成功率语义的类型隐藏） */}
      {conf != null && (
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
                {conf}%
              </span>
            </div>
            <div className="kb-conf__info">
              <div className="kb-conf__label">综合置信度评分</div>
              <div className="kb-conf__sources">按案例结果与读者答复（有帮助/没帮助）逐次累积</div>
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

    </aside>
  )
}
