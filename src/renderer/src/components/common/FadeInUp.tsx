/**
 * FadeInUp 渐入动画容器（v2.0 极致美学）
 *
 * 设计原理（WHY）：
 * - 黄金比例 200ms 时长 + ease-out-expo 曲线，最符合人眼视觉习惯
 * - translateY(8px) 微小位移，避免过度移动
 * - GPU 加速：使用 transform + opacity（不触发重排）
 * - 支持 prefers-reduced-motion 媒体查询（无障碍）
 *
 * 使用场景：
 * - 列表项进入（搭配 StaggerList）
 * - 模态框 / 抽屉
 * - 消息气泡
 * - 任意首次出现的元素
 *
 * @example
 *   <FadeInUp delay={100}>
 *     <Card>...</Card>
 *   </FadeInUp>
 */
import React from 'react'

export interface FadeInUpProps {
  /** 子元素 */
  children: React.ReactNode
  /** 延迟时间（毫秒），默认 0 */
  delay?: number
  /** 动画时长（毫秒），默认 200 */
  duration?: number
  /** Y 轴起始位移（像素），默认 8 */
  offset?: number
  /** 自定义类名 */
  className?: string
  /** 自定义内联样式 */
  style?: React.CSSProperties
  /** 作为哪个 HTML 元素渲染，默认 div */
  as?: keyof JSX.IntrinsicElements
}

const FadeInUp: React.FC<FadeInUpProps> = ({
  children,
  delay = 0,
  duration = 200,
  offset = 8,
  className = '',
  style,
  as: Tag = 'div',
}) => {
  const animationStyle: React.CSSProperties = {
    animation: `fadeInUp ${duration}ms cubic-bezier(0.19, 1, 0.22, 1) ${delay}ms both`,
    // 关键：使用 CSS 变量定义起始位移（通过自定义属性）
    ['--fade-in-up-offset' as string]: `${offset}px`,
    willChange: 'transform, opacity',
    ...style,
  }

  // 使用动态 keyframes 注入（在客户端首次渲染时插入一次）
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    const styleId = 'fade-in-up-keyframes'
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement('style')
      styleEl.id = styleId
      styleEl.textContent = `
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(var(--fade-in-up-offset, 8px));
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes fadeInUp {
            from { opacity: 0; transform: none; }
            to   { opacity: 1; transform: none; }
          }
        }
      `
      document.head.appendChild(styleEl)
    }
  }, [])

  return React.createElement(Tag, { className, style: animationStyle }, children)
}

export default FadeInUp
