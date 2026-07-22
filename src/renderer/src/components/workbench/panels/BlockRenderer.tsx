import type { FC } from 'react'
import { AlertTriangle, Sparkles } from 'lucide-react'
import { cn } from '@/components/trae/utils'
import type { ChatBlock } from '../mock-data'

/** AI 富文本内容块渲染（表格 / 洞察 / 操作按钮） */
const BlockRenderer: FC<{ blocks: ChatBlock[]; onNavigate?: (path: string) => void }> = ({ blocks, onNavigate }) => {
  return (
    <div className="ai-msg-with-avatar">
      {/* AI 头像 */}
      <div className="ai-avatar">
        <Sparkles />
      </div>
      {/* 内容卡片 */}
      <div className="ai-card-wrap">
        <div className="ai-card">
          {blocks.map((block, i) => {
            if (block.type === 'paragraph') {
              return (
                <p key={i} className="mb-2.5 text-[12px] leading-[1.6] text-[var(--trae-text-default)]">
                  {block.text}
                </p>
              )
            }
            if (block.type === 'table') {
              return (
                <div key={i} className="ai-table">
                  {/* 表头 */}
                  <div className="ai-table-header">
                    {block.headers.map((h, idx) => (
                      <span
                        key={idx}
                        className={cn(
                          'shrink-0',
                          idx === 0 ? 'flex-1' : 'text-right',
                          idx === 1 && 'w-[70px]',
                          idx === 2 && 'w-[70px]',
                          idx === 3 && 'w-[50px]',
                        )}
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                  {/* 数据行 */}
                  {block.rows.map((row, rIdx) => (
                    <div
                      key={rIdx}
                      className="ai-table-row"
                    >
                      {row.cells.map((cell, cIdx) => (
                        <span
                          key={cIdx}
                          className={cn(
                            'shrink-0',
                            cIdx === 0 ? 'flex-1' : 'text-right',
                            cIdx === 1 && 'w-[70px]',
                            cIdx === 2 && 'w-[70px]',
                            cIdx === 3 && 'w-[50px]',
                          )}
                          style={{ color: row.cellColors?.[cIdx] }}
                        >
                          {cell}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              )
            }
            if (block.type === 'insight') {
              return (
                <div
                  key={i}
                  className="ai-insight"
                >
                  <div className="ai-insight-header">
                    <AlertTriangle className="size-3.5 text-[var(--trae-icon-brand)]" />
                    <span className="ai-insight-title">{block.title}</span>
                  </div>
                  <p className="ai-insight-text">{block.text}</p>
                </div>
              )
            }
            if (block.type === 'actions') {
              return (
                <div key={i} className="ai-chips">
                  {block.buttons.map((btn, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onNavigate?.(btn.navigate)}
                      className={cn(
                        'ai-chip btn-press',
                        btn.primary && 'ai-chip-primary',
                      )}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              )
            }
            return null
          })}
        </div>
      </div>
    </div>
  )
}

export default BlockRenderer
