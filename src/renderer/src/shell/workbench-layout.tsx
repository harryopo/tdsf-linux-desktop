/**
 * 工作台三栏布局（可拖拽 + 黄金分割默认 + 记住宽度）
 *
 * 旧实现是三块写死的宽度：文件树 200px（Workbench.css）、AI 面板 560px
 * （AIPanel.tsx 的 Tailwind 类）、中间吃剩余。用户明确说「终端和 AI 框的大小方位全都可以改」，
 * 所以宽度改由这里统一管，子组件不再自报宽度。
 *
 * 默认宽度按黄金分割算（见 workbench-metrics.ts），窗口变大时两侧按像素保持、
 * 增量全给中间——这两条都是照 VS Code / Trae 的手感来的。
 *
 * 宽度存 localStorage：拖完重开应用又回到默认宽度等于没得改。
 * 只存 isUserInteraction 的变化——库在挂载、约束重算时也会回调，
 * 那些不是用户意图，存下去会把用户真正拖出来的值覆盖掉。
 * 双击分隔条 = 恢复默认布局（同时清掉存的宽度，否则刷新又回到拖歪的那份）。
 */
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { Group, Panel, Separator, useGroupRef, type Layout } from 'react-resizable-panels'
import { cn } from '@/components/trae/utils'
import {
  SEPARATOR_PX,
  defaultWidths,
  sanitizeSavedLayout,
  type PanelOpenState,
} from './workbench-metrics'

const LAYOUT_STORAGE_KEY = 'tdsf.workbench.layout'

/** 左侧活动栏宽度兜底值（真值取 .wb-activity-rail 的实测宽，见 availableWidth） */
const RAIL_FALLBACK_PX = 64

/** 读回来的布局必须逐个验过：localStorage 里可能是旧版本残留或手改过的脏值 */
function readSavedLayout(): Layout | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return undefined
    const clean = sanitizeSavedLayout(JSON.parse(raw))
    return Object.keys(clean).length ? clean : undefined
  } catch {
    return undefined
  }
}

/**
 * 当前可分给三栏的宽度。
 *
 * 活动栏宽度是令牌（--ui-size-rail），写死 48 会在令牌改动后悄悄算歪，
 * 所以量真的那一根；量不到（首帧之前）才用兜底值。
 */
function availableWidth(): number {
  if (typeof document === 'undefined') return 1386
  const rail = document.querySelector('.wb-activity-rail')?.getBoundingClientRect().width
  return Math.max(640, document.documentElement.clientWidth - (rail || RAIL_FALLBACK_PX))
}

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
  const groupRef = useGroupRef()
  // 必须 memo：percentLayout 的 useCallback 依赖它，每次渲染新建对象等于让缓存失效。
  // 原来 deps 写的是 [treeOpen, ai, aiOpen] 来绕开对象身份 —— exhaustive-deps 判的就是这种"看着对、其实没钉住"
  const open = useMemo<PanelOpenState>(
    () => ({ tree: treeOpen, ai: Boolean(ai) && aiOpen }),
    [treeOpen, ai, aiOpen],
  )

  /**
   * 默认布局（按百分比）。
   *
   * 库的 Layout 值是**比例**（onLayoutChanged 存回去的也是比例），所以这里显式归一，
   * 不能把 workbench-metrics 算出来的像素值直接塞进去——那样恰好也凑得出黄金分割，
   * 但那是巧合，改一处就悄悄歪。
   */
  const percentLayout = useCallback(
    (): Layout => {
      const widths = defaultWidths(availableWidth(), open)
      const total =
        widths.tree +
        widths.editor +
        widths.ai +
        (open.tree ? SEPARATOR_PX : 0) +
        (open.ai ? SEPARATOR_PX : 0)
      const layout: Layout = { 'wb-editor': (widths.editor / total) * 100 }
      if (open.tree) layout['wb-tree'] = (widths.tree / total) * 100
      if (open.ai) layout['wb-ai'] = (widths.ai / total) * 100
      return layout
    },
    // open 已经 memo 过，直接依赖它
    [open],
  )

  // 只在挂载时定一次：拖拽过程中重读会把用户刚拖出来的值冲掉
  const [defaultLayout] = useState<Layout | undefined>(() => readSavedLayout() ?? percentLayout())

  const handleLayoutChanged = useCallback((layout: Layout, meta: { isUserInteraction: boolean }) => {
    if (!meta.isUserInteraction) return
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout))
    } catch {
      // 隐私模式/配额满：拖拽照样生效，只是下次回到默认宽度
    }
  }, [])

  /** 双击分隔条：回到黄金分割默认，并清掉存过的宽度 */
  const resetToDefault = useCallback(() => {
    try {
      window.localStorage.removeItem(LAYOUT_STORAGE_KEY)
    } catch {
      // 清不掉也要把当前这一屏摆回默认
    }
    groupRef.current?.setLayout(percentLayout())
  }, [groupRef, percentLayout])

  return (
    <Group
      groupRef={groupRef}
      orientation="horizontal"
      data-dom-id="wb-layout"
      defaultLayout={defaultLayout}
      onLayoutChanged={handleLayoutChanged}
      className={cn('flex min-h-0 flex-1 overflow-hidden', className)}
    >
      {open.tree ? (
        <>
          <Panel
            id="wb-tree"
            minSize={200}
            maxSize={480}
            groupResizeBehavior="preserve-pixel-size"
            className="min-w-0"
          >
            {tree}
          </Panel>
          <ResizeBar label="调整资源管理器宽度" onReset={resetToDefault} />
        </>
      ) : null}

      <Panel id="wb-editor" minSize={420} className="min-w-0">
        {editor}
      </Panel>

      {open.ai ? (
        <>
          <ResizeBar label="调整 AI 面板宽度" onReset={resetToDefault} />
          <Panel
            id="wb-ai"
            minSize={320}
            groupResizeBehavior="preserve-pixel-size"
            className="min-w-0"
          >
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
 * 键盘方向键由库自己处理（role=separator + aria 值都在库里给好）。
 */
function ResizeBar({ label, onReset }: { label: string; onReset: () => void }) {
  return (
    <Separator
      aria-label={label}
      title={`${label}（双击恢复默认布局）`}
      onDoubleClick={onReset}
      className={cn(
        'relative w-1 shrink-0 cursor-col-resize bg-transparent outline-none',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-line',
        'after:transition-colors after:duration-[var(--ui-dur-fast)]',
        'hover:after:bg-accent focus-visible:after:bg-accent active:after:bg-accent',
      )}
    />
  )
}
