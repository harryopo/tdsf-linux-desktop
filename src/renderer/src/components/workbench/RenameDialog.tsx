/**
 * RenameDialog — 重命名远程文件/目录对话框
 */
import { useEffect, useState, type FC } from 'react'
import { Button, Dialog, DialogContent, Field, TextInput } from '@/ui'

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
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        title="重命名"
        description={oldName}
        footer={
          <>
            <Button onClick={onCancel}>取消</Button>
            <Button variant="solid" disabled={!valid || loading} onClick={() => void handleOk()}>
              {loading ? '提交中…' : '确认'}
            </Button>
          </>
        }
      >
        <Field label="新名称" required>
          {(id) => (
            <TextInput
              id={id}
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleOk()}
            />
          )}
        </Field>
      </DialogContent>
    </Dialog>
  )
}

export default RenameDialog
