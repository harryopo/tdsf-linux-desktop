/**
 * CategoryNav — 课程分类导航
 *
 * 6 个标签（全部/Linux 基础/网络运维/故障排查/安全加固/自动化脚本），
 * 选中态由父组件 TutorialPage 管理（activeCategory），通过 props 传入。
 * 分类数量（_categoryCounts）为 null 时不显示括号。
 */
import type { CourseCategory } from './types'
import { UI_CATEGORIES } from './types'

interface CategoryNavProps {
  activeCategory: CourseCategory
  onSelectCategory: (cat: CourseCategory) => void
  categoryCounts: Record<CourseCategory, number> | null
}

export function CategoryNav({
  activeCategory,
  onSelectCategory,
  categoryCounts,
}: CategoryNavProps) {
  return (
    <nav className="tut-cat-nav" aria-label="课程分类">
      <div className="tut-cat-row tut-no-scrollbar">
        {UI_CATEGORIES.map((cat) => {
          const active = activeCategory === cat.id
          // 分类数量：categoryCounts 为 null（数据未加载）时不显示括号
          const catCount = categoryCounts ? categoryCounts[cat.id] : null
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelectCategory(cat.id)}
              aria-pressed={active}
              className={`tut-cat-label tut-btn-press${active ? ' tut-cat-label--active' : ''}`}
            >
              {cat.label}
              {catCount !== null && (
                <span
                  className="tut-cat-count"
                  style={{
                    marginLeft: 6,
                    fontVariantNumeric: 'tabular-nums',
                    // active 状态下用 onbrand 色保持对比度，否则用 tertiary 弱化
                    color: active ? 'var(--trae-text-onbrand)' : 'var(--trae-text-tertiary)',
                    opacity: 0.85,
                  }}
                >
                  ({catCount})
                </span>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
