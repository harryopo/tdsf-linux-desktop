// @vitest-environment jsdom
/**
 * 自研 Dialog 的行为契约（替代 antd Modal）
 *
 * 关心三件事：
 * 1. dismissible=false 时 Esc 与遮罩都不放行，也不给关闭按钮——主机密钥确认必须做选择
 * 2. closeOnOverlayClick=false 只挡遮罩，不挡 Esc——两个开关互相独立
 * 3. ChmodDialog 的校验：非法八进制不给提交，回车等同点确认
 *
 * 每条"不放行"的负向断言都配一条默认设置下的正向对照，证明事件确实送到了 Radix，
 * 而不是测试自己没触发。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import type {} from '@testing-library/jest-dom'

import { Dialog, DialogContent } from '@renderer/ui/overlay'
import ChmodDialog from '@renderer/components/workbench/ChmodDialog'
import HostKeyPromptDialog from '@renderer/components/ssh/HostKeyPromptDialog'
import type { SshHostKeyPromptEvent } from '@shared/models'

function Controlled({
  dismissible,
  closeOnOverlayClick,
  onOpenChange = () => {},
}: {
  dismissible?: boolean
  closeOnOverlayClick?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent title="标题" dismissible={dismissible} closeOnOverlayClick={closeOnOverlayClick}>
        正文
      </DialogContent>
    </Dialog>
  )
}

/** 一次真实的遮罩点击 = pointerdown + click（Radix 对遮罩走延迟派发，只有 pointerdown 不算点完） */
function clickOverlay() {
  const target = getOverlay()
  class FakePointerEvent extends Event {
    pointerType = 'mouse'
    button = 0
  }
  const g = globalThis as unknown as { PointerEvent?: unknown }
  const saved = g.PointerEvent
  g.PointerEvent = FakePointerEvent
  try {
    fireEvent(target, new FakePointerEvent('pointerdown', { bubbles: true, cancelable: true }))
  } finally {
    if (saved === undefined) delete g.PointerEvent
    else g.PointerEvent = saved
  }
  fireEvent.click(target)
}

/** Radix 的 outside 监听挂在 setTimeout(0) 里，渲染后要让出一个宏任务才会开始收事件 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 遮罩层：Radix 给它 aria-hidden + data-state，内容层没有 aria-hidden */
function getOverlay(): Element {
  const el = document.querySelector('div[data-state="open"][aria-hidden="true"]')
  if (!el) throw new Error('未找到遮罩层')
  return el
}

describe('DialogContent 关闭开关', () => {
  afterEach(cleanup)

  it('默认可以 Esc 关闭', () => {
    const onOpenChange = vi.fn()
    render(<Controlled onOpenChange={onOpenChange} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('dismissible=false 时 Esc 不放行，也没有关闭按钮', () => {
    const onOpenChange = vi.fn()
    render(<Controlled dismissible={false} onOpenChange={onOpenChange} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '关闭' })).toBeNull()
  })

  it('dismissible=false 时点遮罩也不放行', async () => {
    const onOpenChange = vi.fn()
    render(<Controlled dismissible={false} onOpenChange={onOpenChange} />)
    await tick()
    clickOverlay()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('closeOnOverlayClick=false 只挡遮罩，Esc 仍可退出', async () => {
    const onOpenChange = vi.fn()
    render(<Controlled closeOnOverlayClick={false} onOpenChange={onOpenChange} />)
    await tick()
    clickOverlay()
    expect(onOpenChange).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('默认设置下点遮罩会关闭（上一条负向断言的正对照）', async () => {
    const onOpenChange = vi.fn()
    render(<Controlled onOpenChange={onOpenChange} />)
    await tick()
    clickOverlay()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('ChmodDialog', () => {
  afterEach(cleanup)

  it('非法八进制不给提交，改回合法后回车等同点确认', async () => {
    const onOk = vi.fn(async () => {})
    render(<ChmodDialog open path="/etc/nginx/nginx.conf" onCancel={() => {}} onOk={onOk} />)
    const input = screen.getByRole('textbox')
    expect(screen.getByRole('button', { name: '确认修改' })).toBeEnabled()

    fireEvent.change(input, { target: { value: '7' } })
    expect(screen.getByRole('button', { name: '确认修改' })).toBeDisabled()

    fireEvent.change(input, { target: { value: '755' } })
    expect(screen.getByText('rwxr-xr-x')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onOk).toHaveBeenCalledWith('755'))
  })

  it('取消按钮只关弹窗，不提交', () => {
    const onOk = vi.fn(async () => {})
    const onCancel = vi.fn()
    render(<ChmodDialog open path="/tmp/a" onCancel={onCancel} onOk={onOk} />)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onOk).not.toHaveBeenCalled()
  })
})

const KEY = { keyType: 'ssh-ed25519', keyData: 'AAAAC3', sha256: 'SHA256:aaa' }
const CHANGED: SshHostKeyPromptEvent = {
  requestId: 'req-1',
  sessionId: 's-1',
  serverId: 'srv-1',
  host: '10.0.0.5',
  port: 22,
  scenario: 'host-key-changed',
  currentKey: KEY,
  knownKey: { ...KEY, sha256: 'SHA256:old' },
  promptMessage: 'WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!'
}

function mountHostKey(): { respond: ReturnType<typeof vi.fn>; push: (e: SshHostKeyPromptEvent) => void } {
  let cb: ((e: SshHostKeyPromptEvent) => void) | null = null
  const respond = vi.fn(async () => {})
  const w = window as unknown as { electronAPI: Record<string, unknown> }
  w.electronAPI = {
    onSshHostKeyPrompt: (handler: (e: SshHostKeyPromptEvent) => void) => {
      cb = handler
      return () => {
        cb = null
      }
    },
    sshRespondHostKey: respond
  }
  render(<HostKeyPromptDialog />)
  return { respond, push: (e: SshHostKeyPromptEvent) => act(() => cb?.(e)) }
}

describe('HostKeyPromptDialog', () => {
  afterEach(() => {
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  it('收到推送即弹出，三个选择都在，Esc 关不掉', async () => {
    mountHostKey().push(CHANGED)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByText('主机密钥变更警告')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存并继续' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '仅本次继续' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '拒绝连接' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('拒绝连接把 reject 送回主进程', async () => {
    const { respond, push } = mountHostKey()
    push(CHANGED)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '拒绝连接' }))
    await waitFor(() => expect(respond).toHaveBeenCalledWith('req-1', 'reject'))
  })

  it('密钥变更时同时给出新旧指纹', async () => {
    const { push } = mountHostKey()
    push(CHANGED)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByText('已记录的旧密钥指纹')).toBeInTheDocument()
    expect(screen.getByText('SHA256:old')).toBeInTheDocument()
    expect(screen.getByText('SHA256:aaa')).toBeInTheDocument()
  })
})
