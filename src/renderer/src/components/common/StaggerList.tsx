/**
 * StaggerList 列表错位进入（v2.0 极致美学）
 *
 * 设计原理（WHY）：
 * - 列表项按 30ms 递增延迟，形成"瀑布"式的视觉冲击
 * - 对标 Linear / Notion / Raycast 等顶级产品的列表进入效果
 * - 30ms 是经过测试的"恰到好处"的间隔（< 20ms 不明显，> 50ms 太慢）
 * - 使用 GPU 加速（transform + opacity）
 *
 * 使用场景：
 * - 服务器列表
 * - 教程卡片网格
 * - 部署模板列表
 * - 任意需要"批量进入"效果的列表
 *
 * @example
 *   <StaggerList stagger={30}>
 *     {servers.map(s => <ServerItem key={s.id} server={s} />)}
 *   </StaggerList>
 */
import React from 'react'

export interface StaggerListProps {
  /** 子元素（推荐为列表项） */
  children: React.ReactNode
  /** 每项之间的延迟（毫秒），默认 30 */
  stagger?: number
  /** 首次延迟（毫秒），默认 0 */
  initialDelay?: number
  /** 单项动画时长（毫秒），默认 200 */
  duration?: number
  /** Y 轴起始位移（像素），默认 12 */
  offset?: number
  /** 自定义类名 */
  className?: string
  /** 自定义内联样式 */
  style?: React.CSSProperties
  /** 作为哪个 HTML 元素渲染，默认 div */
  as?: keyof JSX.IntrinsicElements
}

const StaggerList: React.FC<StaggerListProps> = ({
  children,
  stagger = 30,
  initialDelay = 0,
  duration = 200,
  offset = 12,
  className = '',
  style,
  as: Tag = 'div',
}) => {
  // 将 children 转为数组以便遍历
  const childrenArray = React.Children.toArray(children)

  // 注入 keyframes 样式
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    const styleId = 'stagger-list-keyframes'
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement('style')
      styleEl.id = styleId
      styleEl.textContent = `
        @keyframes fadeInUpStagger {
          from {
            opacity: 0;
            transform: translateY(var(--stagger-offset, 12px));
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes fadeInUpStagger {
            from { opacity: 0; transform: none; }
            to   { opacity: 1; transform: none; }
          }
        }
      `
      document.head.appendChild(styleEl)
    }
  }, [])

  return React.createElement(
    Tag,
    {
      className,
      style: {
        // 容器本身保持默认渲染，不做动画
        ...style,
      },
    },
    childrenArray.map((child, index) => {
      const delay = initialDelay + index * stagger
      // 包装每个子项，添加错位动画
      return React.createElement(
        'div',
        {
          key: (child as React.ReactElement)?.key ?? index,
          style: {
            animation: `fadeInUpStagger ${duration}ms cubic-bezier(0.19, 1, 0.22, 1) ${delay}ms both`,
            ['--stagger-offset' as string]: `${offset}px`,
            willChange: 'transform, opacity',
          },
        },
        child
      )
    })
  )
}

export default StaggerList
