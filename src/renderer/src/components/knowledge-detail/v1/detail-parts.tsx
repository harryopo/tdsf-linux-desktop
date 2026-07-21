/**
 * KnowledgeDetailPage v1 — 共享小组件（CodeBlock + CardHead）
 *
 * 设计稿：tdsf-linux-redesign/pages/knowledge-detail.html
 *
 * 组件：
 * - CodeBlock：代码块（带语言标签 + 复制按钮，复制后切换"已复制"）
 * - CardHead：卡片头（图标 + 标题 + 右侧 tag）
 */
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/**
 * 代码块组件：带语言标签 + 复制按钮（mock 切换"已复制"）。
 */
export function CodeBlock({ code, lang = 'bash' }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="mt-1.5 overflow-hidden rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-default)]">
      <div className="flex items-center justify-between border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] px-3 py-1.5">
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--trae-text-tertiary)]">
          {lang}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-[var(--trae-text-tertiary)] transition-colors hover:text-[var(--trae-text-default)]"
          aria-label="复制代码"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              <span className="text-[10px]">已复制</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span className="text-[10px]">复制</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12px] leading-[18px] text-[var(--trae-text-default)]">
        {code}
      </pre>
    </div>
  )
}

/**
 * 卡片头组件：图标 + 标题 + 右侧 tag。
 */
export function CardHead({
  icon,
  title,
  tag,
}: {
  icon: React.ReactNode
  title: string
  tag?: string
}) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l2)] px-4 py-2.5">
      <span className="text-[var(--trae-bg-brand)]">{icon}</span>
      <span className="text-[13px] font-semibold text-[var(--trae-text-default)]">{title}</span>
      {tag && (
        <span className="ml-auto font-mono text-[10px] text-[var(--trae-text-tertiary)]">{tag}</span>
      )}
    </div>
  )
}
