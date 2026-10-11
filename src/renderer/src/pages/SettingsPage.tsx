/**
 * SettingsPage — 设置目录页（/settings index）
 *
 * 与左栏同源：章节数据只在 settings-sections.ts 写一份，这里和 SettingsLayout 都读它，
 * 所以"目录页有、左栏没有"这类两边各写一份导致的漂移不会再出现。
 *
 * 只列设置区的子页，不再列知识库/教程/监控/日志/启动配置——那些是主功能页，
 * 入口在左侧 ActivityRail，出现在设置里只会让人以为它们是可配置项。
 *
 * 以前每张卡下面画着 toggle / slider / 输入框的"预览"，值是写死的常量
 * （"已完成 12"、"记录总数 128"、"/var/lib/tdsf/kb"），既不能点也不反映真实配置，
 * 属于 DESIGN.md §10 禁止的"展示没实现的能力"，整块删掉。
 */
import { Link } from 'react-router-dom'
import { ChevronRight, Settings } from 'lucide-react'
import { PageHeader } from '@/ui'
import { SETTINGS_SECTIONS } from './settings-sections'

export function SettingsPage() {
  return (
    <div className="set-subpage">
      <PageHeader
        icon={Settings}
        title="设置"
        subtitle={`共 ${SETTINGS_SECTIONS.length} 项配置，左栏可直接跳转`}
      />

      <div className="set-subpage__body">
        <div className="max-w-[680px] overflow-hidden rounded-(--ui-radius-card) border border-line bg-panel shadow-md">
          <ul>
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon
              return (
                <li key={section.to} className="border-b border-line last:border-b-0">
                  <Link
                    to={section.to}
                    data-dom-id={`set-entry-${section.to.split('/').pop()}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-hover"
                  >
                    <span
                      aria-hidden
                      className="flex size-8 shrink-0 items-center justify-center rounded-(--ui-radius-control) bg-accent/12 text-accent-ink"
                    >
                      {/* 描边跟全站图标一致用 lucide 默认 2（原来单写 1.8，和同排图标粗细不一） */}
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-md font-medium text-ink">
                        {section.label}
                      </span>
                      <span className="block truncate text-caption text-ink-mute">
                        {section.desc}
                      </span>
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-mute" />
                    <span className="sr-only">进入{section.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
