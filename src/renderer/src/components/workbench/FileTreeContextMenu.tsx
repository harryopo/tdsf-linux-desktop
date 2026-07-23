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
import { Dropdown, type MenuProps } from 'antd'
import {
  FolderPlus,
  Upload,
  Download,
  Pencil,
  KeyRound,
  Trash2,
  RefreshCw,
} from 'lucide-react'
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

/** 构造 antd Menu items */
function buildMenuItems(node: TreeNode | null): MenuProps['items'] {
  const isDir = node?.isDirectory ?? false
  // 空白右键：仅显示新建目录 + 上传 + 刷新
  if (!node) {
    return [
      { key: 'mkdir', icon: <FolderPlus size={14} />, label: '新建目录' },
      { key: 'upload', icon: <Upload size={14} />, label: '上传文件' },
      { type: 'divider' },
      { key: 'refresh', icon: <RefreshCw size={14} />, label: '刷新' },
    ]
  }
  // 目录右键
  if (isDir) {
    return [
      { key: 'mkdir', icon: <FolderPlus size={14} />, label: '新建子目录' },
      { key: 'upload', icon: <Upload size={14} />, label: '上传到此目录' },
      { key: 'download', icon: <Download size={14} />, label: '下载目录' },
      { type: 'divider' },
      { key: 'rename', icon: <Pencil size={14} />, label: '重命名' },
      { key: 'chmod', icon: <KeyRound size={14} />, label: '修改权限' },
      { type: 'divider' },
      { key: 'delete', icon: <Trash2 size={14} />, label: '删除', danger: true },
      { key: 'refresh', icon: <RefreshCw size={14} />, label: '刷新' },
    ]
  }
  // 文件右键
  return [
    { key: 'download', icon: <Download size={14} />, label: '下载文件' },
    { type: 'divider' },
    { key: 'rename', icon: <Pencil size={14} />, label: '重命名' },
    { key: 'chmod', icon: <KeyRound size={14} />, label: '修改权限' },
    { type: 'divider' },
    { key: 'delete', icon: <Trash2 size={14} />, label: '删除', danger: true },
  ]
}

/** FileTreeContextMenu */
export const FileTreeContextMenu: FC<FileTreeContextMenuProps> = ({
  node,
  onAction,
  children,
}) => {
  const items = useMemo(() => buildMenuItems(node), [node])

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    onAction(key as MenuAction, node)
  }

  const menuProps: MenuProps = {
    items,
    onClick: handleMenuClick,
  }

  return (
    <Dropdown menu={menuProps} trigger={['contextMenu']}>
      {children as React.ReactElement}
    </Dropdown>
  )
}

export default FileTreeContextMenu
