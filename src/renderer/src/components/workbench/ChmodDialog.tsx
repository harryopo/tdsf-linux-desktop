/**
 * ChmodDialog — 修改远程文件/目录权限对话框
 *
 * 输入 3 位八进制权限（如 755 / 644）
 * 实时预览符号表示（rwxr-xr-x）
 */
import { useEffect, useState, type FC } from 'react'
import { Modal, Input, Form } from 'antd'

export interface ChmodDialogProps {
  open: boolean
  /** 远程路径（显示用） */
  path: string
  onCancel: () => void
  /** 确认回调，传入 3 位八进制权限字符串 */
  onOk: (mode: string) => Promise<void>
}

/** 八进制权限 → 符号表示 */
function octalToSymbol(octal: string): string {
  if (!/^[0-7]{3}$/.test(octal)) return ''
  const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']
  const [u, g, o] = octal.split('').map(Number)
  return `${perms[u]}${perms[g]}${perms[o]}`
}

const ChmodDialog: FC<ChmodDialogProps> = ({ open, path, onCancel, onOk }) => {
  const [mode, setMode] = useState('644')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setMode('644')
      setLoading(false)
    }
  }, [open])

  const symbol = octalToSymbol(mode)
  const valid = /^[0-7]{3}$/.test(mode)

  const handleOk = async () => {
    if (!valid) return
    setLoading(true)
    try {
      await onOk(mode)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="修改权限"
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okButtonProps={{ disabled: !valid, loading }}
      okText="确认修改"
      cancelText="取消"
    >
      <div style={{ marginBottom: 8 }}>
        <span style={{ color: 'var(--trae-text-secondary)', fontSize: 12 }}>
          路径：
        </span>
        <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
          {path}
        </code>
      </div>
      <Form layout="vertical">
        <Form.Item label="权限（八进制）" required>
          <Input
            value={mode}
            onChange={(e) => setMode(e.target.value.slice(0, 3))}
            placeholder="如 755 / 644"
            maxLength={3}
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          />
        </Form.Item>
        {symbol && (
          <div style={{ fontSize: 12, color: 'var(--trae-text-secondary)' }}>
            符号表示：<code style={{ fontFamily: "'JetBrains Mono', monospace" }}>{symbol}</code>
          </div>
        )}
      </Form>
    </Modal>
  )
}

export default ChmodDialog
