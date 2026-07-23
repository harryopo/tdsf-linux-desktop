/**
 * RenameDialog — 重命名远程文件/目录对话框
 */
import { useEffect, useState, type FC } from 'react'
import { Modal, Input, Form } from 'antd'

export interface RenameDialogProps {
  open: boolean
  /** 旧名称 */
  oldName: string
  onCancel: () => void
  onOk: (newName: string) => Promise<void>
}

const RenameDialog: FC<RenameDialogProps> = ({ open, oldName, onCancel, onOk }) => {
  const [newName, setNewName] = useState(oldName)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setNewName(oldName)
      setLoading(false)
    }
  }, [open, oldName])

  const valid = newName.trim().length > 0 && newName !== oldName

  const handleOk = async () => {
    if (!valid) return
    setLoading(true)
    try {
      await onOk(newName.trim())
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="重命名"
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okButtonProps={{ disabled: !valid, loading }}
      okText="确认"
      cancelText="取消"
    >
      <Form layout="vertical">
        <Form.Item label="新名称" required>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onPressEnter={handleOk}
            autoFocus
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default RenameDialog
