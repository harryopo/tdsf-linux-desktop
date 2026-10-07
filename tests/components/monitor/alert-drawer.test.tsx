// @vitest-environment jsdom
/**
 * 告警详情抽屉（Sheet 版）
 *
 * 2026-10-07 从 antd Drawer 换成自研 Sheet，这条测试补的是换完之后的四件事：
 * 1. 没告警时什么都不画（不是一层空遮罩）
 * 2. 级别 / 状态 / 字段 / 处置建议都来自传入的记录，不是写死的示例
 * 3. 主进程 IPC 不可用时「标记已处理」禁用——确认掉一条其实没确认的告警比不确认更糟
 * 4. IPC 可用时点一下真的走 alert:ack，成功后关抽屉
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AlertDrawer } from '@/components/monitor/AlertDrawer'
import { TooltipProvider } from '@/ui'
import type { AlertRecord } from '@/components/monitor/monitor-model'

const ALERT: AlertRecord = {
  time: '10:24:31',
  level: 'high',
  server: 'web-01',
  desc: 'CPU 连续 5 分钟超过 90%',
  status: '未处理',
  source: '/proc/stat',
  impact: '接口响应变慢',
  suggestions: ['先看 top 里占 CPU 的进程', '确认是否异常任务'],
}

/** App 根节点挂着 TooltipProvider，组件测试自己包一层才和真机一致 */
function draw(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

function setElectron(alertAck: unknown) {
  const w = window as unknown as { electronAPI?: Record<string, unknown> }
  w.electronAPI = { alertAck }
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
})

describe('AlertDrawer', () => {
  it('没有告警时不渲染任何浮层', () => {
    const { container } = draw(<AlertDrawer open alert={null} onClose={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('级别、状态、字段与处置建议都来自传入记录', () => {
    setElectron(vi.fn().mockResolvedValue(true))
    draw(<AlertDrawer open alert={ALERT} onClose={() => {}} />)
    expect(screen.getByText(ALERT.desc)).toBeTruthy()
    expect(screen.getByText('高')).toBeTruthy()
    expect(screen.getByText('未处理')).toBeTruthy()
    expect(screen.getByText('10:24:31')).toBeTruthy()
    expect(screen.getByText('web-01')).toBeTruthy()
    expect(screen.getByText('接口响应变慢')).toBeTruthy()
    expect(screen.getByText('先看 top 里占 CPU 的进程')).toBeTruthy()
  })

  it('主进程 IPC 不可用时「标记已处理」禁用（不能假装确认了）', () => {
    draw(<AlertDrawer open alert={ALERT} onClose={() => {}} />)
    const btn = screen.getByRole('button', { name: '标记已处理' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('IPC 可用时点击走 alert:ack，成功后关抽屉', async () => {
    const alertAck = vi.fn().mockResolvedValue(true)
    setElectron(alertAck)
    const onClose = vi.fn()
    draw(<AlertDrawer open alert={ALERT} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '标记已处理' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    // alertId 由 time|server|desc 前 30 字拼出，主进程按同一个 key 记 ack
    expect(alertAck).toHaveBeenCalledWith('10:24:31|web-01|CPU 连续 5 分钟超过 90%')
  })

  it('ack 失败时留下错误说明，不静默关抽屉', async () => {
    setElectron(vi.fn().mockResolvedValue(false))
    const onClose = vi.fn()
    draw(<AlertDrawer open alert={ALERT} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '标记已处理' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('确认失败')
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})
