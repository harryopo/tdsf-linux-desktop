/**
 * FileChangeNotice — 远程文件外部变更提示条
 *
 * 当 FileWatcher 检测到当前打开的远程文件被外部修改时，
 * 在编辑器顶部显示提示条，用户可选择"重新加载"或"忽略"。
 *
 * 颜色走 --notice-warning-* 三件套（浅色主题下按对比度校准过），
 * 不自带色值：提示条要跟编辑器顶部对齐，横幅式无圆角。
 */
import { type FC } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/ui'

export interface FileChangeNoticeProps {
  /** 变更的文件路径 */
  path: string
  /** 重新加载回调 */
  onReload: () => void
  /** 忽略回调 */
  onDismiss: () => void
}

const FileChangeNotice: FC<FileChangeNoticeProps> = ({ path, onReload, onDismiss }) => {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-(--notice-warning-border) bg-(--notice-warning-bg) px-3 py-1.5">
      <AlertTriangle className="size-3.5 shrink-0 text-(--notice-warning-text)" />
      <p className="min-w-0 flex-1 truncate text-caption text-(--notice-warning-text)">
        文件已被外部修改：<code className="font-mono">{path}</code>
      </p>
      <Button size="sm" variant="solid" onClick={onReload}>
        重新加载
      </Button>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        忽略
      </Button>
    </div>
  )
}

export default FileChangeNotice
