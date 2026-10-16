/**
 * HashRouter 下 `navigate('#/x')` 为什么点了没反应（用户 2026-10-16 实测："连接新主机点击没反应"）
 *
 * 这条不测我们的组件，只把 react-router 的因果钉死，免得下一次又有人以为
 * "路由地址就该带 #"（应用用 HashRouter，`#` 是它替浏览器写的，不是给参数的）。
 *
 * 三条一起看才成立：
 *   1. navigate('#/settings/ssh') 停在原页 —— 复现用户看到的"死按钮"
 *   2. 同一路径写成 navigate('/settings/ssh') 真的换页 —— 证明修复方向对
 *   3. 错写法并非"什么都没发生"：它把 `#/settings/ssh` 塞进了 location.hash。
 *      这条把现象说准（地址被写坏），也证明第 1 条不是测试自己没等到位——
 *      跳转确实执行了，只是落点不对
 *
 * 用 MemoryRouter 而不是 HashRouter：判据只依赖"以 # 开头的串会被解析成 hash、
 * pathname 保持不动"这一条框架事实，与浏览器地址栏无关，jsdom 里跑得确定。
 */
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

/** 探针：把"此刻所在页"和"此刻的 location.hash"都写进 DOM，判据一律读它 */
function Probe({ label }: { label: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <div>
      <span data-testid="at">{label}</span>
      <span data-testid="hash">{location.hash}</span>
      <button type="button" onClick={() => navigate('#/settings/ssh')}>
        用 # 前缀跳
      </button>
      <button type="button" onClick={() => navigate('/settings/ssh')}>
        用绝对路径跳
      </button>
    </div>
  )
}

function Tree() {
  return (
    <MemoryRouter initialEntries={['/workbench']}>
      <Routes>
        <Route path="/workbench" element={<Probe label="工作台" />} />
        <Route path="/settings/ssh" element={<Probe label="SSH 连接" />} />
        <Route path="*" element={<Probe label="落到了别处" />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('路由跳转参数与 # 前缀', () => {
  afterEach(() => cleanup())

  it('带 # 前缀：停在原页，但 hash 被写坏（这就是"点了没反应"）', () => {
    render(<Tree />)
    expect(screen.getByTestId('at').textContent).toBe('工作台')
    fireEvent.click(screen.getByText('用 # 前缀跳'))
    expect(
      screen.getByTestId('at').textContent,
      '带 # 的跳转不许换页——换了说明这复现没量到真凶',
    ).toBe('工作台')
    expect(
      screen.getByTestId('hash').textContent,
      '它没换页，却把 location.hash 写成了 #/settings/ssh（地址被写坏，不是"没反应"这么简单）',
    ).toBe('#/settings/ssh')
  })

  it('同一目标写成绝对路径：真的换到 SSH 连接页', () => {
    render(<Tree />)
    fireEvent.click(screen.getByText('用绝对路径跳'))
    expect(screen.getByTestId('at').textContent).toBe('SSH 连接')
  })
})
