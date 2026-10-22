/**
 * @ssh/config 导入对话框（2026-10-22 开源对标）
 *
 * 只做选择与展示：解析在主进程（固定读 ~/.ssh/config），凭据一个都不带。
 * 已存在的同一台机器（host+port+username）不允许重复导入。
 */
import { useEffect, useMemo, useState } from 'react'
import { FileCode2, AlertTriangle } from 'lucide-react'
import { Button, Dialog, DialogContent } from '@/ui'
import { Checkbox } from '@/components/trae/Checkbox'
import type { SshConfigHost } from '@shared/ssh-config-types'

export interface SshConfigImportDialogProps {
  open: boolean
  /** 实际读取的配置路径，只用于说明 */
  configPath?: string
  hosts: SshConfigHost[]
  warnings: string[]
  /** 已存在的机器键：host|port|username */
  existingKeys: Set<string>
  busy?: boolean
  onImport: (hosts: SshConfigHost[]) => void
  onCancel: () => void
}

function hostKey(h: SshConfigHost): string {
  return `${h.host}|${h.port}|${h.username}`
}

export function SshConfigImportDialog({
  open,
  configPath,
  hosts,
  warnings,
  existingKeys,
  busy = false,
  onImport,
  onCancel,
}: SshConfigImportDialogProps) {
  const selectable = useMemo(() => hosts.filter((h) => !existingKeys.has(hostKey(h))), [hosts, existingKeys])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) setSelected(new Set(selectable.map((h) => h.alias)))
  }, [open, selectable])

  const toggle = (alias: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(alias)) next.delete(alias)
      else next.add(alias)
      return next
    })
  }

  const chosen = selectable.filter((h) => selected.has(h.alias))

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent
        title="从 ~/.ssh/config 导入"
        description={configPath ? `读取自 ${configPath}` : '读取本机 SSH 配置里的 Host 别名'}
        className="w-[min(620px,94vw)]"
        closeOnOverlayClick={!busy}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={onCancel}>
              取消
            </Button>
            <Button
              variant="solid"
              disabled={busy || chosen.length === 0}
              onClick={() => onImport(chosen)}
            >
              {busy ? '导入中…' : `导入 ${chosen.length} 台`}
            </Button>
          </>
        }
      >
        {warnings.length > 0 && (
          <div className="mb-3 rounded-(--ui-radius-control) border border-line bg-sunken px-3 py-2 text-caption text-ink-dim">
            <div className="mb-1 flex items-center gap-1.5 text-ink">
              <AlertTriangle className="size-3.5" aria-hidden />
              有 {warnings.length} 条配置未完整导入
            </div>
            <ul className="list-disc space-y-0.5 pl-4">
              {warnings.slice(0, 4).map((w) => (
                <li key={w}>{w}</li>
              ))}
              {warnings.length > 4 && <li>其余 {warnings.length - 4} 条省略</li>}
            </ul>
          </div>
        )}

        {hosts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-ink-dim">
            <FileCode2 className="size-6" aria-hidden />
            <p className="text-md">配置里没有可导入的具体 Host</p>
            <p className="text-caption">通配 Host、Match 与 Include 不会被展开。</p>
          </div>
        ) : (
          <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
            {hosts.map((h) => {
              const duplicate = existingKeys.has(hostKey(h))
              return (
                <label
                  key={h.alias}
                  className="flex cursor-pointer items-center gap-2.5 rounded-(--ui-radius-control) px-2 py-1.5 hover:bg-hover"
                >
                  <Checkbox
                    checked={selected.has(h.alias)}
                    disabled={duplicate || busy}
                    onCheckedChange={() => toggle(h.alias)}
                    aria-label={`选择 ${h.alias}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-md text-ink">{h.alias}</span>
                    <span className="block truncate text-caption text-ink-dim">
                      {h.host}:{h.port} · {h.username}
                      {h.identityFile ? ' · 密钥' : ''}
                      {h.proxyJump ? ` · ProxyJump ${h.proxyJump}（不导入）` : ''}
                    </span>
                  </span>
                  {duplicate && <span className="shrink-0 text-caption text-ink-mute">已存在</span>}
                </label>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
