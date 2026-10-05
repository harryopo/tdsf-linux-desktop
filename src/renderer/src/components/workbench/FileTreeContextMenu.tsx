/**
 * FileTreeContextMenu — FileTree 右键菜单
 *
 * 设计稿：参考 electerm 的 src/client/components/sftp-file-manager 右键菜单
 * 菜单项：新建目录 / 上传 / 下载 / 重命名 / 修改权限 / 删除 / 刷新
 *
 * 用法：
 *   <FileTreeContextMenu node={node} rootPath={rootPath} onAction={handleAction}>
 *     <NodeRow ... />
 *   </FileTreeContextMenu>
 */
import { type FC, type ReactNode, useMemo } from 'react'
import {
  FolderPlus,
  Upload,
  Download,
  Pencil,
  KeyRound,
  Trash2,
  RefreshCw,
} from 'lucide-react'
import { ContextMenu, type ContextMenuEntry } from '@/ui'
import type { TreeNode } from './FileTree'

/** 右键菜单动作类型 */
export type MenuAction =
  | 'mkdir'
  | 'upload'
  | 'download'
  | 'rename'
  | 'chmod'
  | 'delete'
  | 'refresh'

export interface FileTreeContextMenuProps {
  /** 当前右键节点（null 表示在空白处右键） */
  node: TreeNode | null
  /** 根路径（用于 mkdir/upload 到当前目录） */
  rootPath: string
  /** 菜单动作回调 */
  onAction: (action: MenuAction, node: TreeNode | null) => void
  /** 子元素（NodeRow 或文件树容器） */
  children: ReactNode
}

/** 按节点类型给菜单项（node=null 是空白处右键，只给目录级动作） */
function buildMenuItems(
  node: TreeNode | null,
  onAction: FileTreeContextMenuProps['onAction']
): ContextMenuEntry[] {
  const act = (action: MenuAction) => () => onAction(action, node)
  const item = (
    key: MenuAction,
    label: string,
    icon: ReactNode,
    danger?: boolean
  ): ContextMenuEntry => ({ key, label, icon, danger, onSelect: act(key) })

  if (!node) {
    return [
      item('mkdir', '新建目录', <FolderPlus size={14} />),
      item('upload', '上传文件', <Upload size={14} />),
      { key: 'after-upload', divider: true },
      item('refresh', '刷新', <RefreshCw size={14} />),
    ]
  }
  if (node.isDirectory) {
    return [
      item('mkdir', '新建子目录', <FolderPlus size={14} />),
      item('upload', '上传到此目录', <Upload size={14} />),
      item('download', '下载目录', <Download size={14} />),
      { key: 'after-download', divider: true },
      item('rename', '重命名', <Pencil size={14} />),
      item('chmod', '修改权限', <KeyRound size={14} />),
      { key: 'after-chmod', divider: true },
      item('delete', '删除', <Trash2 size={14} />, true),
      item('refresh', '刷新', <RefreshCw size={14} />),
    ]
  }
  return [
    item('download', '下载文件', <Download size={14} />),
    { key: 'after-download', divider: true },
    item('rename', '重命名', <Pencil size={14} />),
    item('chmod', '修改权限', <KeyRound size={14} />),
    { key: 'after-chmod', divider: true },
    item('delete', '删除', <Trash2 size={14} />, true),
  ]
}

/** FileTreeContextMenu */
export const FileTreeContextMenu: FC<FileTreeContextMenuProps> = ({
  node,
  onAction,
  children,
}) => {
  const items = useMemo(() => buildMenuItems(node, onAction), [node, onAction])

  return <ContextMenu items={items}>{children}</ContextMenu>
}

export default FileTreeContextMenu
