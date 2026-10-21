/**
 * 设置写回主进程的唯一出口
 *
 * 病根（2026-10-21 全维度审查 C3）：`configSet` 返回 Promise<boolean>，失败时回 false；
 * 调用方只挂了 `.catch`，把 false 当成功，界面不给任何提示。磁盘满、权限不足、
 * 主进程拒绝写某个键时，用户看到的仍是"设置已生效"。
 *
 * 10 秒节流：设置页一次拖动会连续写很多键，逐条弹 toast 会把屏幕刷满。
 */
import { toast } from 'sonner'

let lastNotifiedAt = 0

export function reportConfigWriteFailure(key: string, err?: unknown): void {
  console.error(`[config] 写入 ${key} 失败`, err)
  const now = Date.now()
  if (now - lastNotifiedAt < 10_000) return
  lastNotifiedAt = now
  toast.error('设置未能保存到磁盘，请检查磁盘权限或重启应用后重试')
}

export function writeConfig(key: string, value: unknown): void {
  const api = window.electronAPI
  if (!api?.configSet) return
  Promise.resolve(api.configSet(key, value)).then(
    (ok) => {
      if (ok === false) reportConfigWriteFailure(key)
    },
    (err: unknown) => reportConfigWriteFailure(key, err)
  )
}
