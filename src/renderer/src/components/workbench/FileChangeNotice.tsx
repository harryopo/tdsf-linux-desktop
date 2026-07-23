/**
 * FileChangeNotice — 远程文件外部变更提示条
 *
 * 当 FileWatcher 检测到当前打开的远程文件被外部修改时，
 * 在编辑器顶部显示提示条，用户可选择"重新加载"或"忽略"。
 */
import { type FC } from 'react'
import { Alert } from 'antd'

export interface FileChangeNoticeProps {
  /** 变更的文件路径 */
  path: string
  /** 重新加载回调 */
  onReload: () => void
  /** 忽略回调 */
  onDismiss: () => void
}

const FileChangeNotice: FC<FileChangeNoticeProps> = ({
  path,
  onReload,
  onDismiss,
}) => {
  return (
    <Alert
      type="warning"
      showIcon
      banner
      message={
        <span style={{ fontSize: 12 }}>
          文件已被外部修改：<code style={{ fontFamily: "'JetBrains Mono', monospace" }}>{path}</code>
        </span>
      }
      action={
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <button
            type="button"
            onClick={onReload}
            style={{
              padding: '2px 10px',
              fontSize: 12,
              border: '1px solid var(--trae-bg-brand)',
              background: 'var(--trae-bg-brand)',
              color: 'var(--trae-text-onbrand)',
              borderRadius: 'var(--trae-radius-4)',
              cursor: 'pointer',
            }}
          >
            重新加载
          </button>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              padding: '2px 10px',
              fontSize: 12,
              border: '1px solid var(--trae-border-neutral-l1)',
              background: 'transparent',
              color: 'var(--trae-text-secondary)',
              borderRadius: 'var(--trae-radius-4)',
              cursor: 'pointer',
            }}
          >
            忽略
          </button>
        </span>
      }
      style={{
        borderRadius: 0,
        margin: 0,
      }}
    />
  )
}

export default FileChangeNotice
