/**
 * KnowledgeDetailPage v1 — 共享小组件（CodeBlock + CardHead）
 *
 * 设计稿：tdsf-linux-redesign/pages/knowledge-detail.html
 *
 * 组件：
 * - CodeBlock：代码块（带语言标签 + 复制按钮，navigator.clipboard.writeText 真实复制）
 * - CardHead：卡片头（图标 + 标题 + 右侧 tag）
 *
 * Token 规范：全部 var(--trae-*)，shadow 用 var(--trae-shadow-card)
 */
import { useState } from 'react'
import { message } from 'antd'
import { Check, Copy } from 'lucide-react'

interface CodeBlockProps {
  /** 代码内容 */
  code: string
  /** 语言标签（默认 bash） */
  lang?: string
  /** data-dom-id 后缀，用于 copy-cmd-{N} 接入（如 "1" / "2" / "reload" / "verify"） */
  copyId?: string
}

/**
 * 代码块组件：带语言标签 + 复制按钮（navigator.clipboard.writeText 真实复制）。
 * 复制后切换"已复制"提示，1.5s 后恢复。
 */
export function CodeBlock({ code, lang = 'bash', copyId }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      message.success('命令已复制到剪贴板')
    } catch {
      // clipboard 不可用时静默降级（仍切换提示，避免阻塞交互）
      message.error('复制失败，请手动选择文本')
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="kb-code">
      <div className="kb-code__bar">
        <span className="kb-code__lang">
          {lang}
        </span>
        <button
          type="button"
          data-dom-id={copyId ? `copy-cmd-${copyId}` : undefined}
          onClick={handleCopy}
          className="kb-code__copy kb-btn-press"
          aria-label={copied ? '已复制' : '复制代码'}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              <span>已复制</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      <pre className="kb-code__pre">
        {code}
      </pre>
    </div>
  )
}

interface CardHeadProps {
  /** 卡片头图标 */
  icon: React.ReactNode
  /** 卡片标题 */
  title: string
  /** 右侧 tag（如 SYMPTOM / ROOT CAUSE） */
  tag?: string
}

/**
 * 卡片头组件：图标 + 标题 + 右侧 tag。
 * 1:1 对齐设计稿 .kd-card__head（bg #252629 → var(--trae-bg-overlay-l2)）。
 */
export function CardHead({ icon, title, tag }: CardHeadProps) {
  return (
    <div className="kb-detail-card__head">
      <span className="kb-detail-card__head-icon">{icon}</span>
      <span className="kb-detail-card__title">{title}</span>
      {tag && (
        <span className="kb-detail-card__tag">{tag}</span>
      )}
    </div>
  )
}
