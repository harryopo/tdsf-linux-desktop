// @vitest-environment jsdom
/**
 * 审批条的 fail-closed 姿态判据
 *
 * 这个文件里的每条断言都对应一个"用户可能误放行"的路径。
 * 判定标准不是"看起来有确认弹窗"，而是：默认动作必须是拒绝，
 * 且任何鼠标扫过、任何一次回车都不能悄悄变成批准。
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PermissionBar } from '@/dock/permission-bar'
import type { PaorApprovalRequest } from '@/types/electron'

const req = (over: Partial<PaorApprovalRequest> = {}): PaorApprovalRequest => ({
  callId: 'call-1',
  command: 'rm -rf /var/log',
  riskLevel: 'CRITICAL',
  riskDescription: '递归删除且覆盖系统日志目录',
  origin: 'paor',
  stepIndex: 0,
  timestamp: Date.now(),
  ...over,
})

function setup(requests: PaorApprovalRequest[] = [req()]) {
  const onRespond = vi.fn()
  render(<PermissionBar requests={requests} onRespond={onRespond} />)
  return { onRespond }
}

describe('PermissionBar', () => {
  it('没有待审批请求时什么都不渲染（不许留空壳）', () => {
    render(<PermissionBar requests={[]} onRespond={vi.fn()} />)
    expect(screen.queryByRole('region', { name: '命令审批' })).not.toBeInTheDocument()
  })

  it('PAOR 那一路显示真步骤号（第 3 步不是第 1 步）', () => {
    setup([req({ origin: 'paor', stepIndex: 2 })])
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('PAOR 请求批准 — 第 3 步')
  })

  it('对话里的写命令不再被说成 PAOR，也不编一个步骤号', () => {
    setup([req({ origin: 'chat', stepIndex: undefined })])
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).toHaveTextContent('AI 请求执行写操作')
    expect(heading.textContent).not.toContain('PAOR')
    expect(heading.textContent).not.toMatch(/第 \d+ 步/)
  })

  it('默认选中"拒绝"，不是"批准"', () => {
    setup()
    expect(screen.getByRole('button', { name: /拒绝/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /批准这一次/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('直接敲回车 = 拒绝（默认动作不能是放行）', () => {
    const { onRespond } = setup()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onRespond).toHaveBeenCalledWith('call-1', false)
  })

  it('Esc = 拒绝', () => {
    const { onRespond } = setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onRespond).toHaveBeenCalledWith('call-1', false)
  })

  it('数字键只改选中，不直接提交', () => {
    const { onRespond } = setup()
    fireEvent.keyDown(window, { key: '1' })
    expect(onRespond).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /批准这一次/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onRespond).toHaveBeenCalledWith('call-1', true)
  })

  it('鼠标扫过批准按钮不会把选中项从"拒绝"挪走', () => {
    const { onRespond } = setup()
    fireEvent.mouseOver(screen.getByRole('button', { name: /批准这一次/ }))
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onRespond).toHaveBeenCalledWith('call-1', false)
  })

  it('提交后两条通道都锁死，不会重复应答', () => {
    const { onRespond } = setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /批准这一次/ }))
    expect(onRespond).toHaveBeenCalledTimes(1)
    // 只锁应答通道；命令折叠钮提交后仍要能点开回看内容
    for (const btn of [screen.getByRole('button', { name: /批准这一次/ }), screen.getByRole('button', { name: /拒绝/ })]) {
      expect(btn).toBeDisabled()
    }
  })

  it('队列里多条时只暴露队首（等待期间不许有第二条通道）', () => {
    render(
      <PermissionBar
        requests={[req({ callId: 'a', command: 'systemctl stop nginx' }), req({ callId: 'b', command: 'reboot' })]}
        onRespond={vi.fn()}
      />
    )
    expect(screen.getByText('systemctl stop nginx')).toBeInTheDocument()
    expect(screen.queryByText('reboot')).not.toBeInTheDocument()
    expect(screen.getByText(/还有 1 条待处理/)).toBeInTheDocument()
  })

  it('不提供主进程不支持的"始终批准"', () => {
    setup()
    expect(screen.queryByText(/始终批准/)).not.toBeInTheDocument()
  })

  it('风险等级与命令原文都要上屏（不能只给一个"是否继续"）', () => {
    setup([req()])
    expect(screen.getByText('CRITICAL')).toBeInTheDocument()
    expect(screen.getByText('递归删除且覆盖系统日志目录')).toBeInTheDocument()
    expect(screen.getByText('rm -rf /var/log')).toBeInTheDocument()
  })
})
