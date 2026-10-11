/**
 * 端口预览弹窗（W5）
 *
 * 只问端口，不问主机：隧道一律打到**那台服务器**的 127.0.0.1。
 * 让用户填主机名就等于开一个"借用户的 SSH 凭据访问内网任意地址"的口子，
 * 那不是预览服务，是跳板扫描。
 */
import { useEffect, useState } from 'react'
import { Button, Dialog, DialogContent, TextInput } from '@/ui'
import { toast } from 'sonner'
import type { PreviewHandleInfo, PreviewTarget } from '@shared/models'
import { isElectronAPIAvailable } from '@/utils/electron-api'

export interface PreviewPortDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  onOpened: (info: PreviewHandleInfo, target: PreviewTarget) => void
}

const DEFAULT_PORT = 8080

export function PreviewPortDialog({
  open,
  onOpenChange,
  sessionId,
  onOpened,
}: PreviewPortDialogProps) {
  const [port, setPort] = useState(String(DEFAULT_PORT))

  // 每次打开都回到默认值：留着上次的 3000 会让人以为"预览的还是那个服务"
  useEffect(() => {
    if (open) setPort(String(DEFAULT_PORT))
  }, [open])

  const parsed = Number(port)
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535

  const submit = async () => {
    if (!valid) return
    if (!isElectronAPIAvailable() || !window.electronAPI?.previewOpen) {
      toast.error('当前环境不支持预览（非 Electron 运行时）')
      return
    }
    const target: PreviewTarget = { kind: 'port', sessionId, port: parsed }
    try {
      const info = await window.electronAPI.previewOpen(target)
      onOpened(info, target)
      onOpenChange(false)
    } catch (err) {
      toast.error(`开不了预览：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="预览这台主机上的端口"
        description="通过当前 SSH 连接隧道到那台机器的 127.0.0.1，只读地打开它上面的网页。"
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button variant="solid" size="md" disabled={!valid} onClick={() => void submit()}>
              打开预览
            </Button>
          </>
        }
      >
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-body text-ink">端口</span>
          <TextInput
            data-dom-id="preview-port-input"
            inputMode="numeric"
            value={port}
            invalid={!valid}
            onChange={(e) => setPort(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            className="w-32"
          />
        </label>
        {!valid ? <p className="text-caption text-error-text">端口要填 1 到 65535 的整数</p> : null}
      </DialogContent>
    </Dialog>
  )
}
