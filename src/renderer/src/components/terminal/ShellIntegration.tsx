/**
 * 命令块集成的界面入口（#61）
 *
 * 两个入口，一套弹窗：
 * - ShellIntegrationBar：终端上方那条提示条，只在"这台还没装、而且能装"时出现；
 *   装好或用户点了「以后再说」就整条消失，不常驻占高度（终端高度被挤是最烦的坏）。
 * - ShellIntegrationButton：标签条上的工具钮，常驻。已装的人要卸载只能从这里进，
 *   所以它同时是状态显示（tooltip 里如实写当前是什么状态）。
 *
 * "逐台确认"落在弹窗里：写入前把两处原文（rc 追加的那 5 行 + 集成脚本全文）逐字摊开，
 * 用户点头才调 install。原因很实在——这是往别人机器上的 .bashrc 写东西。
 */
import { useCallback, useEffect, useState } from 'react'
import { Blocks, RotateCw, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ShellIntegrationStatus } from '@shared/models'
import { Button, Dialog, DialogContent } from '@/ui'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import './ShellIntegration.css'

/** 用户点「以后再说」之后，这台会话在本次运行里不再被打扰（换会话各有各的开关） */
const DISMISS_PREFIX = 'tdsf-si-dismissed:'

function isDismissed(sessionId: string): boolean {
  try {
    return localStorage.getItem(DISMISS_PREFIX + sessionId) === '1'
  } catch {
    return false
  }
}

function setDismissed(sessionId: string): void {
  try {
    localStorage.setItem(DISMISS_PREFIX + sessionId, '1')
  } catch {
    // 存不进去（隐私模式等）只是提示条会再出现，不该影响功能
  }
}

/** 装完/卸完要回到可再次询问的状态，否则提示条永远不出现了 */
function clearDismissed(sessionId: string): void {
  try {
    localStorage.removeItem(DISMISS_PREFIX + sessionId)
  } catch {
    // 同上
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface IntegrationState {
  status: ShellIntegrationStatus | null
  error: string | null
  busy: boolean
  reload: () => Promise<void>
  install: () => Promise<void>
  uninstall: () => Promise<void>
}

/**
 * 问状态 / 写 / 卸，三个动作共用一份状态。
 *
 * enabled=false 时不开口问（弹窗没打开就别为它开一条 SFTP 通道）。
 */
function useShellIntegration(sessionId: string, enabled: boolean): IntegrationState {
  const [status, setStatus] = useState<ShellIntegrationStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    if (!enabled || !sessionId) return
    if (!isElectronAPIAvailable() || !window.electronAPI?.sshShellIntegrationStatus) {
      setError('当前环境问不到远端 shell（非 Electron 运行时）')
      return
    }
    setError(null)
    try {
      setStatus(await window.electronAPI.sshShellIntegrationStatus(sessionId))
    } catch (err) {
      setStatus(null)
      setError(errText(err))
    }
  }, [enabled, sessionId])

  useEffect(() => {
    void reload()
  }, [reload])

  const act = useCallback(
    async (action: 'install' | 'uninstall') => {
      const api = window.electronAPI
      if (!api?.sshShellIntegrationInstall || !api.sshShellIntegrationUninstall) {
        toast.error('需要在桌面端里才能开启命令记录')
        return
      }
      setBusy(true)
      try {
        const res =
          action === 'install'
            ? await api.sshShellIntegrationInstall(sessionId)
            : await api.sshShellIntegrationUninstall(sessionId)
        clearDismissed(sessionId)
        if (res.ok) toast.success(res.message)
        else toast.error(res.message)
        await reload()
      } catch (err) {
        toast.error(`操作失败：${errText(err)}`)
      } finally {
        setBusy(false)
      }
    },
    [reload, sessionId]
  )

  return {
    status,
    error,
    busy,
    reload,
    install: () => act('install'),
    uninstall: () => act('uninstall'),
  }
}

/** 状态一句话，tooltip 与弹窗头部共用同一份算法 */
function statusLine(st: ShellIntegrationStatus | null, error: string | null, hasSession: boolean): string {
  if (!hasSession) return '先连接一台服务器'
  if (error) return `问不到：${error}`
  if (!st) return '正在问这台机器…'
  return st.message
}

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  hostTitle: string
  /**
   * 提示条把它自己那份状态传进来，弹窗就不再问一次。
   * 不问第二次不是为了省一次 RPC：装完之后提示条要立刻消失，
   * 两套各自 fetch 的状态会让提示条拿着"未安装"的老结果继续挂着。
   */
  state?: IntegrationState
}

/** 装/卸共用的确认弹窗：装之前先看原文，卸之前也走同一个入口 */
export function ShellIntegrationDialog({
  open,
  onOpenChange,
  sessionId,
  hostTitle,
  state,
}: DialogProps) {
  const own = useShellIntegration(sessionId, open && !state)
  const { status, error, busy, reload, install, uninstall } = state ?? own
  const installed = status?.installed === true

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`命令记录 · ${hostTitle}`}
        description="让终端把每条命令的输出单独记下来，AI 才能回答「刚才那条命令发生了什么」。"
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            {installed ? (
              <Button
                variant="danger"
                size="md"
                data-dom-id="si-uninstall"
                disabled={busy || !status?.rcFile}
                onClick={() => void uninstall()}
              >
                移除命令记录
              </Button>
            ) : (
              <Button
                variant="solid"
                size="md"
                data-dom-id="si-install"
                disabled={busy || !status || !!error || status.kind === 'other'}
                onClick={() => void install()}
              >
                写入这两处
              </Button>
            )}
          </>
        }
      >
        {error ? (
          <div className="term-si-error">
            <span className="term-si-error-text">{error}</span>
            <Button variant="ghost" size="sm" onClick={() => void reload()}>
              <RotateCw aria-hidden className="size-3" />
              重试
            </Button>
          </div>
        ) : null}

        {!status && !error ? (
          <p className="term-si-note" data-dom-id="si-loading">
            正在问这台机器的登录 shell 与 rc 现状…
          </p>
        ) : null}

        {status ? (
          <>
            <dl className="term-si-facts">
              <div>
                <dt>登录 shell</dt>
                <dd>{status.shellPath || '未知'}</dd>
              </div>
              <div>
                <dt>追加到</dt>
                <dd>{status.rcFile ? `~/${status.rcFile}` : '不支持的 shell'}</dd>
              </div>
              <div>
                <dt>创建文件</dt>
                <dd>{status.installed ? '已有（重复写入不会变长）' : `~/${status.snippetFile}`}</dd>
              </div>
            </dl>
            <p className="term-si-note">{status.message}</p>
            {status.kind === 'other' ? null : (
              <>
                <section className="term-si-section">
                  <h3 className="term-si-section-title">
                    {`~/${status.rcFile ?? ''} 里的那几行`}
                  </h3>
                  <pre className="term-si-code">{status.rcBlockText}</pre>
                </section>
                <section className="term-si-section">
                  <h3 className="term-si-section-title">{`~/${status.snippetFile} 全文`}</h3>
                  <pre className="term-si-code term-si-code-tall">{status.snippetText}</pre>
                </section>
                <p className="term-si-note">
                  只对新开的终端生效。开启后会在这台主机的 bash 启动文件末尾追加一小段脚本；
                  如果这台机器自己也装过同类工具（例如 starship），两者可能冲突；移除后新开的终端恢复原样。
                </p>
              </>
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

interface BarProps {
  sessionId: string | null
  hostTitle: string
}

/** 终端上方的提示条：只在"能装且没装"时出现 */
export function ShellIntegrationBar({ sessionId, hostTitle }: BarProps) {
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissedState] = useState(() =>
    sessionId ? isDismissed(sessionId) : true
  )
  const integration = useShellIntegration(sessionId ?? '', !dismissed && !!sessionId)
  const { status } = integration

  if (!sessionId || dismissed) return null
  // 还没问到 / 已装 / 装不了（fish 等）都不占高度：这条的存在理由只有"有个动作可做"
  if (status?.installed || status?.kind === 'other') return null

  const dismiss = () => {
    setDismissed(sessionId)
    setDismissedState(true)
  }

  return (
    <div className="term-si-bar" data-dom-id="si-bar">
      <Blocks aria-hidden className="term-si-bar-icon size-3" />
      <span className="term-si-bar-text">
        {hostTitle}：这台主机还没开启命令记录，AI 读不到「上一条命令」的输出
      </span>
      <Button variant="outline" size="sm" data-dom-id="si-enable" onClick={() => setOpen(true)}>
        怎么启用
      </Button>
      <button
        type="button"
        className="term-si-bar-close"
        aria-label="以后再说"
        data-dom-id="si-dismiss"
        onClick={dismiss}
      >
        <X aria-hidden className="size-3" />
      </button>
      <ShellIntegrationDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          // 关掉就再问一次：弹窗里可能刚装完也可能刚卸完，提示条不能拿着开前的老结果
          if (!next) void integration.reload()
        }}
        sessionId={sessionId}
        hostTitle={hostTitle}
        state={integration}
      />
    </div>
  )
}

interface ButtonProps {
  sessionId: string
  hostTitle: string
}

/** 标签条上的工具钮：已启用时的唯一退出口，同时也是状态显示 */
export function ShellIntegrationButton({ sessionId, hostTitle }: ButtonProps) {
  const [open, setOpen] = useState(false)
  const integration = useShellIntegration(sessionId, true)
  const { status, error } = integration
  const line = statusLine(status, error, !!sessionId)

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className={`term-tab-tool shrink-0 ${status?.installed === true ? 'term-tab-tool-active' : ''}`}
        aria-pressed={status?.installed === true}
        disabled={!sessionId}
        data-dom-id="si-toolbar"
        title={`命令记录：${line}`}
        aria-label={`命令记录：${line}`}
        onClick={() => setOpen(true)}
      >
        <Blocks aria-hidden className="size-3.5" />
      </Button>
      <ShellIntegrationDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) void integration.reload()
        }}
        sessionId={sessionId}
        hostTitle={hostTitle}
      />
    </>
  )
}
