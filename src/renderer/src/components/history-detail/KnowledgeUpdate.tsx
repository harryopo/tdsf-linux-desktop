/**
 * KnowledgeUpdate — 知识库更新卡片
 *
 * 设计稿：history-detail.html Card 4 知识库更新
 *
 * - 左侧：check-circle 图标 + 描述 + 知识 ID 链接（点击跳转知识详情）
 * - 右侧：查看知识详情按钮（点击跳转知识详情）
 *
 * JS 交互：
 * - 知识 ID 链接 onClick → navigate('/knowledge/{id}')
 * - 查看知识详情按钮 onClick → navigate('/knowledge/{id}')
 */
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle } from 'lucide-react'
import type { DecisionCard } from '@shared/models'

export interface KnowledgeUpdateProps {
  card: DecisionCard
}

/**
 * KnowledgeUpdate 主组件
 */
export function KnowledgeUpdate({ card }: KnowledgeUpdateProps) {
  const navigate = useNavigate()

  /** 从 sessionId 或 id 派生知识 ID */
  const knowledgeId = card.sessionId || `KB-${card.id}`
  const knowledgeDesc = '本次决策已更新至知识库'

  /** 跳转到对应的知识详情页 */
  const handleGotoKnowledgeDetail = () => {
    navigate(`/knowledge/${knowledgeId}`)
  }

  return (
    <section
      className="bg-[var(--trae-bg-base-secondary)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-8)]"
      style={{ padding: '24px' }}
    >
      {/* 头部条 */}
      <div
        className="flex items-center gap-2 px-4 py-3 -mx-6 -mt-6 mb-4 bg-[#252629] border-b border-[var(--trae-border-neutral-l1)] rounded-t-[var(--trae-radius-8)]"
        style={{ padding: '12px 16px' }}
      >
        <BookIcon />
        <span className="text-[13px] font-semibold text-[var(--trae-text-default)]">
          知识库更新
        </span>
      </div>

      {/* 内容行 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle
            className="w-4 h-4"
            style={{ color: 'var(--trae-status-success-default)' }}
          />
          <span className="text-[11px] text-[var(--trae-text-default)]">
            {knowledgeDesc}
          </span>
          <button
            type="button"
            onClick={handleGotoKnowledgeDetail}
            className="font-mono text-[11px] cursor-pointer bg-transparent border-none p-0 hover:underline transition-colors duration-150"
            style={{ color: 'var(--trae-text-brand)' }}
          >
            {knowledgeId}
          </button>
        </div>
        <button
          type="button"
          onClick={handleGotoKnowledgeDetail}
          className="inline-flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium text-[var(--trae-text-default)] bg-[var(--trae-bg-overlay-l2)] border border-[var(--trae-border-neutral-l1)] rounded-[var(--trae-radius-4)] cursor-pointer hover:bg-[var(--trae-bg-overlay-l3)] transition-colors duration-150"
        >
          查看知识详情
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </section>
  )
}

/** 章节标题图标（book） */
function BookIcon() {
  return (
    <span
      className="shrink-0 inline-block"
      style={{
        width: '16px',
        height: '16px',
        backgroundColor: 'var(--trae-icon-default)',
        maskImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20'/></svg>\")",
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20'/></svg>\")",
        WebkitMaskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
      }}
    />
  )
}
