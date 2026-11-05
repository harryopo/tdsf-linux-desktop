/**
 * RemoteFilePicker — `@` 远端文件选择器（2026-11-05 C2）
 *
 * 拍板 1：只做远端文件。全部走既有只读 SFTP 通道（`sftpList` / `sftpReadFile`），
 * 不新增 IPC，不读本地文件，不提供任何写操作入口。
 *
 * 体积：主进程 readFile 上限 10 MB；引用本身另有单文件 20,000 字符预算（在 Composer 侧裁剪）。
 */
import { useEffect, useState, type FC } from 'react'
import { ArrowUp, FileText, Folder } from 'lucide-react'
import { Button, Dialog, DialogContent, Notice, Spinner, TextInput } from '@/ui'
import type { SftpEntry } from '@shared/models'
import type { RawRemoteFile } from './composer-references'

/** 与主进程 sftpReadFile 的 10 MB 上限保持一致；超限在读取前就挡下，不把大文件拉回本地 */
const MAX_READ_BYTES = 10 * 1024 * 1024

function joinRemote(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`
}

function parentRemote(path: string): string {
  if (path === '/' || path === '') return '/'
  const idx = path.lastIndexOf('/')
  return idx <= 0 ? '/' : path.slice(0, idx)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export interface RemoteFilePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 当前 SSH 会话；null 时只提示"未连接 SSH"，不发请求 */
  sessionId: string | null
  /** 选中一个文件：返回路径与原始正文，预算裁剪由 Composer 统一做 */
  onPick: (file: RawRemoteFile) => void
}

const RemoteFilePicker: FC<RemoteFilePickerProps> = ({ open, onOpenChange, sessionId, onPick }) => {
  const [path, setPath] = useState('/')
  const [pathDraft, setPathDraft] = useState('/')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [reading, setReading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 打开时按当前路径拉目录；切路径 / 换会话都重拉。cancelled 防止旧请求回来覆盖新目录
  useEffect(() => {
    if (!open) return
    if (!sessionId) {
      setEntries([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    window.electronAPI
      .sftpList(sessionId, path)
      .then((list) => {
        if (!cancelled) setEntries(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, sessionId, path])

  const go = (next: string): void => {
    setPath(next)
    setPathDraft(next)
  }

  const handleEntry = async (entry: SftpEntry): Promise<void> => {
    const full = joinRemote(path, entry.name)
    if (entry.isDirectory) {
      go(full)
      return
    }
    if (!sessionId) return
    if (entry.size > MAX_READ_BYTES) {
      setError(`文件 ${formatSize(entry.size)} 超过远端读取上限 10 MB，未读取`)
      return
    }
    setReading(full)
    setError(null)
    try {
      const text = await window.electronAPI.sftpReadFile(sessionId, full)
      onPick({ path: full, text })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setReading(null)
    }
  }

  // 目录优先，其次按名称；隐藏 SFTP 自带的 . / .. （. 开头但非 . / .. 的正常显示）
  const visible = entries
    .filter((e) => e.name !== '.' && e.name !== '..')
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="引用远端文件"
        description="只读浏览远端服务器；引用内容会随本条消息发给模型，单文件最多 20,000 字符（超出会标注截断）。"
      >
        {!sessionId ? (
          <Notice tone="warning" title="未连接 SSH">
            先连接一台服务器，才能浏览并引用远端文件。
          </Notice>
        ) : (
          <div className="flex flex-col gap-2">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                go(pathDraft.trim() || '/')
              }}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => go(parentRemote(path))}
                title="上一级"
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <TextInput
                value={pathDraft}
                onChange={(e) => setPathDraft(e.target.value)}
                placeholder="/var/log"
                aria-label="远端目录路径"
                className="flex-1"
              />
              <Button variant="outline" size="sm" type="submit">
                浏览
              </Button>
            </form>

            {error ? (
              <Notice tone="error" title="读取失败">
                {error}
              </Notice>
            ) : null}

            <div className="max-h-[46vh] min-h-[180px] overflow-y-auto rounded-(--ui-radius-control) border border-line">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner label="正在读取目录…" />
                </div>
              ) : visible.length === 0 ? (
                <div className="px-3 py-8 text-center text-caption text-ink-mute">
                  这个目录下没有可引用的文件
                </div>
              ) : (
                visible.map((entry) => {
                  const full = joinRemote(path, entry.name)
                  const busy = reading === full
                  return (
                    <button
                      key={entry.name}
                      type="button"
                      onClick={() => void handleEntry(entry)}
                      disabled={reading !== null}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:bg-hover disabled:opacity-60"
                    >
                      {entry.isDirectory ? (
                        <Folder className="size-3.5 shrink-0 text-ink-dim" />
                      ) : (
                        <FileText className="size-3.5 shrink-0 text-ink-mute" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-md text-ink">{entry.name}</span>
                      {busy ? (
                        <Spinner />
                      ) : entry.isDirectory ? null : (
                        <span className="shrink-0 text-caption tabular-nums text-ink-mute">
                          {formatSize(entry.size)}
                        </span>
                      )}
                    </button>
                  )
                })
              )}
            </div>

            <p className="text-caption text-ink-mute">
              当前：{path} · 只读浏览，不提供上传/写入
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default RemoteFilePicker
