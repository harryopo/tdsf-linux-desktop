/**
 * TutorialHeader — 运维教程页顶部区域
 *
 * 包含：页面 Header（scroll-text 图标 + 标题"运维教程" + 副标题）
 *       与 RAG 混合检索搜索框（M4 Task 5）。
 * 搜索相关状态由父组件 TutorialPage 管理，通过 props 传入。
 */
import type { ChangeEvent } from 'react'
import { ScrollText } from 'lucide-react'
import { Input, Button } from 'antd'
import { SearchOutlined } from '@ant-design/icons'

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
  return (
    <>
      {/* ====== 1. Page Header ====== */}
      <header className="tut-page-header">
        <div className="tut-page-header__left">
          <ScrollText size={26} strokeWidth={2} style={{ color: 'var(--trae-icon-brand)' }} />
          <div className="tut-page-header__title-wrap">
            <span className="tut-page-title">运维教程</span>
            <span className="tut-page-subtitle">从入门到精通的 Linux 运维实战课程</span>
          </div>
        </div>
      </header>

      {/* ====== RAG 混合检索搜索框（M4 Task 5）====== */}
      <div
        className="tut-search-wrap"
        style={{
          padding: '14px 32px',
          borderBottom: '1px solid var(--trae-border-neutral-l1)',
          background: 'var(--trae-bg-base-default)',
        }}
      >
        <div className="tut-search-row">
          <Input
            placeholder="搜索教程（支持 RAG 语义检索）..."
            value={searchQuery}
            onChange={onSearchInputChange}
            onPressEnter={onSearch}
            prefix={<SearchOutlined style={{ color: 'var(--trae-text-tertiary)' }} />}
            allowClear
            style={{
              flex: 1,
              minWidth: 0,
              height: 40,
              fontFamily: 'var(--trae-font-family-mono)',
              background: 'var(--trae-bg-base-secondary)',
              borderColor: 'var(--trae-border-neutral-l1)',
              color: 'var(--trae-text-default)',
            }}
          />
          <Button
            type="primary"
            onClick={onSearch}
            loading={searching}
            style={{ height: 40, flexShrink: 0 }}
          >
            搜索
          </Button>
        </div>
      </div>
    </>
  )
}
