// @vitest-environment jsdom
/**
 * 崩溃兜底页：出错时必须说清"发生了什么 + 下一步"，且不再依赖 antd
 *
 * 这条测试是退出 antd 第 3 批时补的：错误页原来是 antd Result，
 * 换掉后没人验证它还能不能画出来——而它恰恰是唯一一个在"应用已经坏了"
 * 的情况下才出现的界面，坏了才发现它坏了就太晚了。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '@/components/ErrorBoundary'

function Boom() {
  throw new Error('渲染炸了')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ErrorBoundary 崩溃兜底页', () => {
  it('子组件正常时原样渲染，不加任何壳', () => {
    render(
      <ErrorBoundary>
        <p>正常内容</p>
      </ErrorBoundary>
    )
    expect(screen.getByText('正常内容')).toBeTruthy()
  })

  it('子组件抛错时给出标题、原始错误信息与两条出路', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByText('页面加载出错')).toBeTruthy()
    expect(screen.getAllByText(/渲染炸了/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '重新加载' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '忽略并继续' })).toBeTruthy()
  })

  it('兜底页不再借 antd 的类名', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )
    expect(container.querySelector('[class*="ant-"]')).toBeNull()
  })
})
