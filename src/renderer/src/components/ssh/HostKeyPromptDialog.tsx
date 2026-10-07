/**
 * HostKeyPromptDialog — SSH 主机密钥确认弹窗（Phase L）
 *
 * 职责：
 * - 监听 onSshHostKeyPrompt 事件（主进程推送）
 * - 首次连接（unknown-host）：提示用户是否保存密钥到 known_hosts
 * - 密钥变更（host-key-changed）：警告用户密钥已变更，可能存在中间人攻击
 * - 三按钮响应：
 *   1. 保存并继续（accept-and-save）：继续连接 + 写入 known_hosts
 *   2. 仅本次继续（accept-once）：继续连接，不写入 known_hosts
 *   3. 拒绝连接（reject）：中断 SSH 握手
 *
 * 挂载位置：App.tsx 根组件（全局监听，任何页面都能收到弹窗）
 *
 * 不可关闭：这是必须做选择的安全闸门，Esc 与点遮罩都不放行（dismissible=false）。
 */
import { useState, useEffect, useCallback, type FC } from 'react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import type { SshHostKeyPromptEvent, SshHostKeyResponseAction } from '@shared/models'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import { Button, Dialog, DialogContent } from '@/ui'

/** 密钥指纹块：算法标签 + 指纹文本 */
function KeyBlock({
  label,
  keyType,
  sha256,
  tone
}: {
  label: string
  keyType: string
  sha256: string
  tone: 'normal' | 'warn'
}) {
  return (
    <div
      className={
        'flex flex-col gap-1.5 rounded-(--ui-radius-control) border p-3 ' +
        (tone === 'warn' ? 'border-error/40 bg-error/10' : 'border-line bg-sunken')
      }
    >
      <span className="text-caption font-medium text-ink-dim">{label}</span>
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 rounded-(--ui-radius-control) border border-line-strong px-2 py-0.5 font-mono text-micro text-ink">
          {keyType}
        </span>
        <code className="min-w-0 break-all font-mono text-sm text-ink">{sha256}</code>
      </div>
    </div>
  )
}

/** HostKeyPromptDialog 组件 */
const HostKeyPromptDialog: FC = () => {
  const [prompt, setPrompt] = useState<SshHostKeyPromptEvent | null>(null)
  const [responding, setResponding] = useState(false)

  /** 监听主进程的主机密钥确认推送 */
  useEffect(() => {
    if (!isElectronAPIAvailable()) {
      return
    }
    const off = window.electronAPI.onSshHostKeyPrompt((event: SshHostKeyPromptEvent) => {
      setPrompt(event)
    })
    return off
  }, [])

  /** 响应用户选择，发送回主进程 */
  const handleRespond = useCallback(
    async (action: SshHostKeyResponseAction): Promise<void> => {
      if (!prompt || !isElectronAPIAvailable()) {
        return
      }
      setResponding(true)
      try {
        await window.electronAPI.sshRespondHostKey(prompt.requestId, action)
      } catch (err) {
        console.error('[HostKeyPromptDialog] 响应失败:', err)
      } finally {
        setResponding(false)
        setPrompt(null)
      }
    },
    [prompt]
  )

  const isOpen = prompt !== null
  const isWarning = prompt?.scenario === 'host-key-changed'
  const TitleIcon = isWarning ? ShieldAlert : ShieldCheck

  return (
    <Dialog open={isOpen}>
      <DialogContent
        dismissible={false}
        className="w-[min(520px,92vw)]"
        title={
          <span className="flex items-center gap-2">
            <TitleIcon
              className={'size-4.5 ' + (isWarning ? 'text-error' : 'text-accent-ink')}
              aria-hidden
            />
            {isWarning ? '主机密钥变更警告' : '首次连接确认'}
          </span>
        }
        footer={
          <>
            <Button disabled={responding} onClick={() => void handleRespond('reject')}>
              拒绝连接
            </Button>
            <Button disabled={responding} onClick={() => void handleRespond('accept-once')}>
              仅本次继续
            </Button>
            <Button
              variant={isWarning ? 'danger' : 'solid'}
              disabled={responding}
              onClick={() => void handleRespond('accept-and-save')}
            >
              保存并继续
            </Button>
          </>
        }
      >
        {prompt && (
          <div className="flex flex-col gap-4">
            <pre className="m-0 whitespace-pre-wrap break-all rounded-(--ui-radius-control) border border-line bg-sunken p-3 text-sm text-ink">
              {prompt.promptMessage}
            </pre>

            <KeyBlock
              label="服务器密钥指纹"
              keyType={prompt.currentKey.keyType}
              sha256={prompt.currentKey.sha256}
              tone="normal"
            />

            {isWarning && prompt.knownKey && (
              <KeyBlock
                label="已记录的旧密钥指纹"
                keyType={prompt.knownKey.keyType}
                sha256={prompt.knownKey.sha256}
                tone="warn"
              />
            )}

            <div
              className={
                'rounded-(--ui-radius-control) px-3 py-2 text-caption ' +
                (isWarning ? 'bg-error/10 text-error-text' : 'bg-hover text-ink-dim')
              }
            >
              {isWarning
                ? '注意：密钥变更可能是中间人攻击，请确认服务器变更合法后再继续。'
                : '提示：选择「保存并继续」后，后续连接此主机将自动校验密钥，无需再次确认。'}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default HostKeyPromptDialog
