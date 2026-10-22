// @vitest-environment jsdom
/**
 * ~/.ssh/config 导入对话框（2026-10-22）
 *
 * 三件事必须成立：默认全选可导入项；已存在的机器不再勾选；点导入只交选中的那些。
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SshConfigImportDialog } from '@renderer/components/settings/ssh/SshConfigImportDialog'

const HOSTS = [
  { alias: 'web1', host: '192.0.2.10', port: 22, username: 'ops', identityFile: '/home/ops/.ssh/id' },
  { alias: 'db1', host: 'db.internal', port: 2222, username: 'dba' },
]

function open(overrides: Partial<React.ComponentProps<typeof SshConfigImportDialog>> = {}) {
  const onImport = vi.fn()
  const onCancel = vi.fn()
  render(
    <SshConfigImportDialog
      open
      configPath="/home/ops/.ssh/config"
      hosts={HOSTS}
      warnings={['Match 段已跳过（Match exec 可能执行命令，不做静态展开）']}
      existingKeys={new Set()}
      onImport={onImport}
      onCancel={onCancel}
      {...overrides}
    />
  )
  return { onImport, onCancel }
}

describe('SshConfigImportDialog', () => {
  it('默认全选，展示解析警告与目标主机', () => {
    open()
    expect(screen.getByText('web1')).toBeTruthy()
    expect(screen.getByText(/192\.0\.2\.10:22 · ops/)).toBeTruthy()
    expect(screen.getByText(/Match 段已跳过/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '导入 2 台' })).toBeTruthy()
  })

  it('已存在的机器置灰且不参与导入', () => {
    const { onImport } = open({ existingKeys: new Set(['192.0.2.10|22|ops']) })
    expect(screen.getByText('已存在')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '导入 1 台' }))
    expect(onImport).toHaveBeenCalledTimes(1)
    const chosen = onImport.mock.calls[0][0] as typeof HOSTS
    expect(chosen.map((h) => h.alias)).toEqual(['db1'])
  })

  it('取消勾选后按钮数量跟着变', () => {
    const { onImport } = open()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 db1' }))
    fireEvent.click(screen.getByRole('button', { name: '导入 1 台' }))
    const chosen = onImport.mock.calls[0][0] as typeof HOSTS
    expect(chosen.map((h) => h.alias)).toEqual(['web1'])
  })
})
