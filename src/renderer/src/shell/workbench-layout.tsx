/**
 * 工作台三栏布局（可拖拽）
 *
 * 旧实现是三块写死的宽度：文件树 200px（Workbench.css）、AI 面板 560px
 * （AIPanel.tsx 的 Tailwind 类）、中间吃剩余。用户明确说"终端和 AI 框的大小方位全都可以改"，
 * 所以宽度改由这里统一管，子组件不再自报宽度。
 *
 * 尺寸用像素（react-resizable-panels v4 里数字即 px，字符串才是百分比）。
 */
import { type ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { cn } from '@/components/trae/utils'

export interface WorkbenchLayoutProps {
  /** 左：资源管理器 / 服务器列表 */
  tree: ReactNode
  /** 中：终端与文件编辑器（主视角） */
  editor: ReactNode
  /** 右：AI 停靠格 */
  ai?: ReactNode
  treeOpen?: boolean
  aiOpen?: boolean
  className?: string
}

export function WorkbenchLayout({
  tree,
  editor,
  ai,
  treeOpen = true,
  aiOpen = true,
  className,
}: WorkbenchLayoutProps) {
  return (
    <Group
      orientation="horizontal"
      className={cn('flex min-h-0 flex-1 overflow-hidden', className)}
    >
      {treeOpen ? (
        <>
          <Panel id="wb-tree" defaultSize={220} minSize={160} maxSize={420} className="min-w-0">
            {tree}
          </Panel>
          <ResizeBar />
        </>
      ) : null}

      <Panel id="wb-editor" minSize={360} className="min-w-0">
        {editor}
      </Panel>

      {ai && aiOpen ? (
        <>
          <ResizeBar />
          <Panel id="wb-ai" defaultSize={440} minSize={300} maxSize={760} className="min-w-0">
            {ai}
          </Panel>
        </>
      ) : null}
    </Group>
  )
}

/**
 * 拖拽把手：平时隐形（只留 4px 命中区），悬停/聚焦才亮出中线。
 * IDE 的分隔线是结构线不是装饰，不该抢内容的视觉重量。
 */
function ResizeBar() {
  return (
    <Separator
      className={cn(
        'relative w-1 shrink-0 bg-transparent outline-none',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-line',
        'after:transition-colors after:duration-[var(--ui-dur-fast)]',
        'hover:after:bg-accent focus-visible:after:bg-accent'
      )}
    />
  )
}
