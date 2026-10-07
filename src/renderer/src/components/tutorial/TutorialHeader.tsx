/**
 * TutorialHeader — 运维教程页顶部：全站唯一 PageHeader + RAG 混合检索搜索框（M4 Task 5）
 *
 * 搜索状态由父组件 TutorialPage 管理，这里只管外观。
 */
import type { ChangeEvent, KeyboardEvent } from 'react'
import { ScrollText, Search } from 'lucide-react'
import { Button, PageHeader, TextInput } from '@/ui'

interface TutorialHeaderProps {
  searchQuery: string
  onSearchInputChange: (e: ChangeEvent<HTMLInputElement>) => void
  onSearch: () => void
  searching: boolean
}

export function TutorialHeader({
  searchQuery,
  onSearchInputChange,
  onSearch,
  searching,
}: TutorialHeaderProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onSearch()
  }

  return (
    <PageHeader
      icon={ScrollText}
      title="运维教程"
      subtitle="从入门到精通的 Linux 运维实战课程"
      actions={
        <>
          <span className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-mute"
            />
            <TextInput
              aria-label="搜索教程"
              value={searchQuery}
              onChange={onSearchInputChange}
              onKeyDown={onKeyDown}
              placeholder="搜索教程（支持 RAG 语义检索）…"
              className="w-[280px] pl-8"
            />
          </span>
          {/* 空检索词时按下只会「什么都不发生」，所以直接禁用而不是假装能搜 */}
          <Button
            variant="solid"
            size="lg"
            disabled={searching || searchQuery.trim() === ''}
            onClick={onSearch}
          >
            {searching ? '搜索中…' : '搜索'}
          </Button>
        </>
      }
    />
  )
}
