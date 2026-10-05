/**
 * ChmodDialog — 修改远程文件/目录权限对话框
 *
 * 输入 3 位八进制权限（如 755 / 644）
 * 实时预览符号表示（rwxr-xr-x）
 */
import { useEffect, useState, type FC } from 'react'
import { Button, Dialog, DialogContent, Field, TextInput } from '@/ui'

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
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        title="修改权限"
        footer={
          <>
            <Button onClick={onCancel}>取消</Button>
            <Button variant="solid" disabled={!valid || loading} onClick={() => void handleOk()}>
              {loading ? '提交中…' : '确认修改'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline gap-1 text-caption">
            <span className="shrink-0 text-ink-dim">路径：</span>
            <code className="min-w-0 truncate font-mono text-ink" title={path}>
              {path}
            </code>
          </div>

          <Field
            label="权限（八进制）"
            required
            hint={
              symbol ? (
                <span className="text-ink-dim">
                  符号表示：<code className="font-mono text-ink">{symbol}</code>
                </span>
              ) : undefined
            }
          >
            {(id) => (
              <TextInput
                id={id}
                autoFocus
                maxLength={3}
                value={mode}
                placeholder="如 755 / 644"
                className="w-24 font-mono"
                invalid={mode.length > 0 && !valid}
                onChange={(e) => setMode(e.target.value.slice(0, 3))}
                onKeyDown={(e) => e.key === 'Enter' && void handleOk()}
              />
            )}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ChmodDialog
