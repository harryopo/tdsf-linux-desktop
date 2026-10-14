// @vitest-environment jsdom
/**
 * SSH 连接对话框（自研表单版）
 *
 * 2026-10-07 从 antd Form 换成本地表单状态 + ui 原语。这条测试盯的是换完最容易坏的两件事：
 * 1. 校验一条没减（必填、端口 1–65535），不过就不许保存
 * 2. 交给主进程/服务器列表的 payload 形状对：认证方式决定带 password 还是 privateKeyPath，
 *    跳板机开了才带 jumpHost，编辑模式沿用原 id 而不是每次生成新的
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ConnectDialog from '@/components/layout/ConnectDialog'
import type { ServerListItem, SshConfig } from '@shared/models'

function open(props: Partial<React.ComponentProps<typeof ConnectDialog>> = {}) {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(
    <ConnectDialog open server={null} onSave={onSave} onCancel={onCancel} {...props} />
  )
  return { onSave, onCancel }
}

/** Field 的 label 里带一个 aria-hidden 的必填星号，textContent 是"端口*"，所以一律按前缀匹配 */
function field(name: string): HTMLInputElement {
  return screen.getByLabelText(new RegExp(`^${name}`)) as HTMLInputElement
}

function fill(name: string, value: string) {
  fireEvent.change(field(name), { target: { value } })
}

/** Radix Tabs 是"聚焦即选中"（真实点击也会先聚焦），所以要先 focus 再 click */
function pickTab(name: string) {
  const el = screen.getByRole('tab', { name })
  fireEvent.focus(el)
  fireEvent.click(el)
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
})

describe('ConnectDialog', () => {
  it('新建时给出可直接用的默认值：端口 22、用户 root、密码认证', () => {
    open()
    expect((field('端口')).value).toBe('22')
    expect((field('用户名')).value).toBe('root')
    expect(screen.getByRole('tab', { name: '密码认证' }).getAttribute('data-state')).toBe('active')
  })

  it('必填没填时不保存，并说清还有几项要改', () => {
    const { onSave } = open()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).not.toHaveBeenCalled()
    // 用户名与端口有默认值，空着的是名称和主机地址
    expect(screen.getByRole('alert').textContent).toContain('2 项要改')
  })

  it('端口越界拦下来（不给主进程送 70000 这种端口）', () => {
    const { onSave } = open()
    fill('名称', 'web-01')
    fill('主机地址', '10.0.0.8')
    fill('端口', '70000')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('端口得是 1–65535 的整数')).toBeTruthy()
  })

  it('填完基本项就保存出可用的配置（新建会分到 id）', () => {
    const { onSave } = open()
    fill('名称', 'web-01')
    fill('主机地址', '10.0.0.8')
    fill('密码', 'p@ss')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const cfg = onSave.mock.calls[0][0] as SshConfig
    expect(cfg).toMatchObject({
      name: 'web-01',
      host: '10.0.0.8',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'p@ss',
    })
    expect(cfg.id).toMatch(/^server_/)
    // 密码认证不该顺手带上密钥路径字段
    expect(cfg.privateKeyPath).toBeUndefined()
  })

  it('切到密钥认证后按密钥走，不再带 password', () => {
    const { onSave } = open()
    fill('名称', 'web-02')
    fill('主机地址', '10.0.0.9')
    pickTab('密钥文件认证')
    fill('密钥文件路径', '/home/me/.ssh/id_ed25519')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    const cfg = onSave.mock.calls[0][0] as SshConfig
    expect(cfg.authType).toBe('privateKey')
    expect(cfg.privateKeyPath).toBe('/home/me/.ssh/id_ed25519')
    expect(cfg.password).toBeUndefined()
  })

  it('编辑模式回填并沿用原 id；勾了跳板机才带 jumpHost', () => {
    // 夹具按契约类型造：ServerListItem 有意 Omit 掉 password/privateKey/passphrase
    // （凭据不进渲染层，见 shared/models.ts:63），原先这里塞 password: 'old'
    // 测的是产品根本拿不到的形状；本用例也没断言口令回填。
    const server: ServerListItem = {
      id: 'server_existing',
      name: '老机器',
      host: '10.0.0.1',
      port: 2222,
      username: 'ops',
      authType: 'password',
      hasCredential: true,
    }
    const { onSave } = open({ server })
    expect((field('端口')).value).toBe('2222')
    fireEvent.click(screen.getByRole('button', { name: /高级选项/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /通过跳板机连接/ }))
    fill('跳板机地址', '10.0.0.2')
    fill('跳板机用户名', 'jump')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    const cfg = onSave.mock.calls[0][0] as SshConfig
    expect(cfg.id).toBe('server_existing')
    expect(cfg.jumpHost).toMatchObject({ host: '10.0.0.2', port: 22, username: 'jump' })
  })
})
