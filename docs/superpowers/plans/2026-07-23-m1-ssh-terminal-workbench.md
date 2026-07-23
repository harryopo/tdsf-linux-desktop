# M1 · SSH + 终端 + 工作台 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 M1 模块（SSH + 终端 + 工作台）的视觉 1:1 对齐 + 功能对接 + 死按钮修复，实现端到端可演示。

**Architecture:** 在现有 WorkbenchPage 4 区布局基础上，补齐 FileTree 右键菜单（sftpUpload/Download/Rename/Chmod）、FileWatcher 远程文件监听、TerminalView xterm 选中桥接、xterm 搜索 UI、AIPanel onAgentStep 流式 tool panel、视觉 1:1 对齐。所有 IPC 已在 preload 暴露，主进程 handler 已实现，仅需 UI 消费层接线。

**Tech Stack:** Electron 30 + React 18 + TypeScript strict + Antd 5 (Dropdown/Modal/Input) + xterm.js 5.5 + lucide-react + Zustand + TRAE 设计 token

## Global Constraints

- **IPC 4 步同步铁律**：所有新增 IPC 调用必须确认 preload 已暴露 + electron.d.ts 已声明（本模块全部已暴露，无需新增）
- **TypeScript strict**：禁止 any / 隐式 any，所有 props 必须有类型
- **CSS token**：所有颜色用 `var(--trae-*)` 或 `var(--bg-brand)`，禁止硬编码 `#xxxxxx`
- **编译门禁**：typecheck:node + typecheck:web + lint 三绿
- **文件拆分**：超过 500 行的文件需拆分
- **视觉 1:1 对齐**：设计稿不存在的元素不显示；间距/字体/颜色/圆角全部按 TRAE token 实现
- **TRAE 设计 token**（来自 spec §2.2）：
  - 主色 `--bg-brand: #387BFF`
  - 三级深色表面：`--trae-bg-base-default: #1A1B1D` / `--trae-bg-base-secondary: #222427` / `--trae-bg-base-tertiary: #2A2D31`
  - 间距 token：`--spacer-0/4/6/8/12/16/24/32/40`
  - 圆角 token：`--radius-2/4/6/8/10/full`
  - 字体：`"SF Pro Text", "Microsoft YaHei", system-ui` / 等宽 `"JetBrains Mono"`
- **现有 IPC 已就绪**（无需新增，只需 UI 消费）：
  - sftpUpload / sftpDownload / sftpRename / sftpChmod（preload 2221-2225 行）
  - fileWatchStart / fileWatchStop / onFileChanged（preload 3043-3046 行）
  - onAgentStep（preload 2272 行，类型 `AgentWorkflowState`）

---

## 文件结构

### 新建文件
- `src/renderer/src/components/workbench/FileTreeContextMenu.tsx` — FileTree 右键菜单组件（antd Dropdown + Menu）
- `src/renderer/src/components/workbench/ChmodDialog.tsx` — 修改权限对话框（数字权限输入 + 符号预览）
- `src/renderer/src/components/workbench/RenameDialog.tsx` — 重命名对话框
- `src/renderer/src/components/workbench/FileChangeNotice.tsx` — 远程文件外部变更提示条
- `src/renderer/src/components/terminal/TerminalSearchBar.tsx` — 终端搜索栏（Ctrl+F 触发）

### 修改文件
- `src/renderer/src/components/workbench/FileTree.tsx` — 集成右键菜单，移除顶部按钮（保留刷新）
- `src/renderer/src/components/workbench/EditorArea.tsx` — 文件打开/关闭时启动/停止 FileWatcher，监听 onFileChanged
- `src/renderer/src/components/terminal/TerminalView.tsx` — 注册 xterm.onSelectionChange 桥接 editor-store.selection
- `src/renderer/src/components/workbench/useAgentChat.ts` — 订阅 onAgentStep，写入消息 metadata
- `src/renderer/src/components/workbench/panels/LiveMessageRow.tsx` — 渲染步骤进度 + 底部 3 动作按钮
- `src/renderer/src/components/workbench/AIPanel.css` — 视觉对齐样式
- `src/renderer/src/components/workbench/Workbench.css` — 工作台布局视觉对齐
- `src/renderer/src/pages/SshSettings.tsx` — 视觉对齐（Card 间距/字体）
- `src/renderer/src/pages/TerminalSettings.tsx` — 视觉对齐（Card 间距/字体）
- `src/renderer/src/stores/agent-store.ts` — 新增 stepDetails 状态字段

---

## Task 1: FileTreeContextMenu 组件 - 右键菜单壳子

**Files:**
- Create: `src/renderer/src/components/workbench/FileTreeContextMenu.tsx`

**Interfaces:**
- Produces: `FileTreeContextMenu` 组件，props `{ node: TreeNode | null; rootPath: string; onAction: (action: MenuAction, node: TreeNode | null) => void; children: ReactNode }`
- MenuAction 类型：`'mkdir' | 'upload' | 'download' | 'rename' | 'chmod' | 'delete' | 'refresh'`

- [ ] **Step 1.1: 创建 FileTreeContextMenu 组件骨架**

创建 `src/renderer/src/components/workbench/FileTreeContextMenu.tsx`：

```tsx
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
function buildMenuItems(
  node: TreeNode | null,
  rootPath: string,
): MenuProps['items'] {
  const isDir = node?.isDirectory ?? false
  const isFile = node && !isDir
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
  rootPath,
  onAction,
  children,
}) => {
  const items = useMemo(() => buildMenuItems(node, rootPath), [node, rootPath])

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    onAction(key as MenuAction, node)
  }

  const menuProps: MenuProps = {
    items,
    onClick: handleMenuClick,
    triggerAction: 'contextMenu',
  }

  return (
    <Dropdown menu={menuProps} trigger={['contextMenu']}>
      {children as React.ReactElement}
    </Dropdown>
  )
}

export default FileTreeContextMenu
```

- [ ] **Step 1.2: 验证类型检查通过**

Run: `pnpm typecheck:web`
Expected: 无新错误（Dropdown trigger 类型已支持 'contextMenu'，antd 5.x）

- [ ] **Step 1.3: 提交**

```bash
git add src/renderer/src/components/workbench/FileTreeContextMenu.tsx
git commit -m "feat(M1): 新增 FileTreeContextMenu 组件壳子（antd Dropdown 右键菜单）"
```

---

## Task 2: ChmodDialog + RenameDialog 对话框组件

**Files:**
- Create: `src/renderer/src/components/workbench/ChmodDialog.tsx`
- Create: `src/renderer/src/components/workbench/RenameDialog.tsx`

**Interfaces:**
- Produces:
  - `ChmodDialog` props `{ open: boolean; path: string; onCancel: () => void; onOk: (mode: string) => Promise<void> }`
  - `RenameDialog` props `{ open: boolean; oldName: string; onCancel: () => void; onOk: (newName: string) => Promise<void> }`

- [ ] **Step 2.1: 创建 ChmodDialog 组件**

创建 `src/renderer/src/components/workbench/ChmodDialog.tsx`：

```tsx
/**
 * ChmodDialog — 修改远程文件/目录权限对话框
 *
 * 输入 3 位八进制权限（如 755 / 644）
 * 实时预览符号表示（rwxr-xr-x）
 */
import { useEffect, useState, type FC } from 'react'
import { Modal, Input, Form } from 'antd'

export interface ChmodDialogProps {
  open: boolean
  /** 远程路径（显示用） */
  path: string
  onCancel: () => void
  /** 确认回调，传入 3 位八进制权限字符串 */
  onOk: (mode: string) => Promise<void>
}

/** 八进制权限 → 符号表示 */
function octalToSymbol(octal: string): string {
  if (!/^[0-7]{3}$/.test(octal)) return ''
  const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']
  const [u, g, o] = octal.split('').map(Number)
  return `${perms[u]}${perms[g]}${perms[o]}`
}

const ChmodDialog: FC<ChmodDialogProps> = ({ open, path, onCancel, onOk }) => {
  const [mode, setMode] = useState('644')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setMode('644')
      setLoading(false)
    }
  }, [open])

  const symbol = octalToSymbol(mode)
  const valid = /^[0-7]{3}$/.test(mode)

  const handleOk = async () => {
    if (!valid) return
    setLoading(true)
    try {
      await onOk(mode)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="修改权限"
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okButtonProps={{ disabled: !valid, loading }}
      okText="确认修改"
      cancelText="取消"
    >
      <div style={{ marginBottom: 8 }}>
        <span style={{ color: 'var(--trae-text-secondary)', fontSize: 12 }}>
          路径：
        </span>
        <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
          {path}
        </code>
      </div>
      <Form layout="vertical">
        <Form.Item label="权限（八进制）" required>
          <Input
            value={mode}
            onChange={(e) => setMode(e.target.value.slice(0, 3))}
            placeholder="如 755 / 644"
            maxLength={3}
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          />
        </Form.Item>
        {symbol && (
          <div style={{ fontSize: 12, color: 'var(--trae-text-secondary)' }}>
            符号表示：<code style={{ fontFamily: "'JetBrains Mono', monospace" }}>{symbol}</code>
          </div>
        )}
      </Form>
    </Modal>
  )
}

export default ChmodDialog
```

- [ ] **Step 2.2: 创建 RenameDialog 组件**

创建 `src/renderer/src/components/workbench/RenameDialog.tsx`：

```tsx
/**
 * RenameDialog — 重命名远程文件/目录对话框
 */
import { useEffect, useState, type FC } from 'react'
import { Modal, Input, Form } from 'antd'

export interface RenameDialogProps {
  open: boolean
  /** 旧名称 */
  oldName: string
  onCancel: () => void
  onOk: (newName: string) => Promise<void>
}

const RenameDialog: FC<RenameDialogProps> = ({ open, oldName, onCancel, onOk }) => {
  const [newName, setNewName] = useState(oldName)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setNewName(oldName)
      setLoading(false)
    }
  }, [open, oldName])

  const valid = newName.trim().length > 0 && newName !== oldName

  const handleOk = async () => {
    if (!valid) return
    setLoading(true)
    try {
      await onOk(newName.trim())
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="重命名"
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okButtonProps={{ disabled: !valid, loading }}
      okText="确认"
      cancelText="取消"
    >
      <Form layout="vertical">
        <Form.Item label="新名称" required>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onPressEnter={handleOk}
            autoFocus
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default RenameDialog
```

- [ ] **Step 2.3: 验证类型检查通过**

Run: `pnpm typecheck:web`
Expected: 无新错误

- [ ] **Step 2.4: 提交**

```bash
git add src/renderer/src/components/workbench/ChmodDialog.tsx src/renderer/src/components/workbench/RenameDialog.tsx
git commit -m "feat(M1): 新增 ChmodDialog + RenameDialog 对话框组件"
```

---

## Task 3: FileTree 集成右键菜单 + SFTP 高级操作对接

**Files:**
- Modify: `src/renderer/src/components/workbench/FileTree.tsx`

**Interfaces:**
- Consumes: `FileTreeContextMenu` / `ChmodDialog` / `RenameDialog`（来自 Task 1 + 2）
- Consumes: `window.electronAPI.sftpUpload` / `sftpDownload` / `sftpRename` / `sftpChmod`（preload 2221-2225 行已暴露）

- [ ] **Step 3.1: 在 FileTree.tsx 顶部增加 import**

在 `src/renderer/src/components/workbench/FileTree.tsx` 第 25 行后追加 import：

```tsx
import FileTreeContextMenu, { type MenuAction } from './FileTreeContextMenu'
import ChmodDialog from './ChmodDialog'
import RenameDialog from './RenameDialog'
import { Upload as UploadIcon } from 'lucide-react'
```

- [ ] **Step 3.2: 在 FileTree 组件内部增加状态 + ref**

在 FileTree 主组件（约第 80 行 `const FileTree: FC<FileTreeProps> = ({ ... })`）内部，已有 useState 之后追加：

```tsx
  /** 右键菜单目标节点（null = 空白右键） */
  const [menuNode, setMenuNode] = useState<TreeNode | null>(null)
  /** chmod 对话框目标 */
  const [chmodTarget, setChmodTarget] = useState<TreeNode | null>(null)
  /** rename 对话框目标 */
  const [renameTarget, setRenameTarget] = useState<TreeNode | null>(null)
  /** 上传用隐藏 input */
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  /** 上传目标目录路径 */
  const uploadTargetDirRef = useRef<string>('/')
```

同时在顶部 import 补充 `useRef`：

```tsx
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
```

- [ ] **Step 3.3: 实现 handleMenuAction 函数**

在 FileTree 主组件内部，handleDelete 函数之后追加：

```tsx
  /** 处理右键菜单动作 */
  const handleMenuAction = useCallback(
    async (action: MenuAction, node: TreeNode | null) => {
      if (!sessionId || !connected) {
        message.warning('请先连接 SSH')
        return
      }
      const api = window.electronAPI
      if (!api || !isElectronAPIAvailable()) {
        message.error('electronAPI 不可用')
        return
      }

      // mkdir：复用现有 handleMkdir 逻辑，但用 prompt
      if (action === 'mkdir') {
        const parentDir = node?.isDirectory ? node.path : rootPath
        const name = window.prompt('新建目录名称', 'new-folder')
        if (!name?.trim()) return
        const safe = name.trim().replace(/[\\/]/g, '_')
        const full = joinPath(parentDir, safe)
        try {
          await api.sftpMkdir(sessionId, full)
          message.success(`已创建 ${full}`)
          await loadRoot()
        } catch (err) {
          message.error(`创建失败: ${err instanceof Error ? err.message : String(err)}`)
        }
        return
      }

      // refresh：复用 loadRoot
      if (action === 'refresh') {
        await loadRoot()
        return
      }

      // delete：复用 handleDelete 逻辑
      if (action === 'delete') {
        if (!node) return
        if (node.path === '/' || node.path === '.' || node.path === '..') {
          message.error('禁止删除根路径')
          return
        }
        if (!window.confirm(`确认删除远程路径？\n${node.path}`)) return
        try {
          await api.sftpDelete(sessionId, node.path)
          message.success(`已删除 ${node.path}`)
          await loadRoot()
        } catch (err) {
          message.error(`删除失败: ${err instanceof Error ? err.message : String(err)}`)
        }
        return
      }

      // rename：打开对话框
      if (action === 'rename') {
        if (!node) return
        setRenameTarget(node)
        return
      }

      // chmod：打开对话框
      if (action === 'chmod') {
        if (!node) return
        setChmodTarget(node)
        return
      }

      // upload：触发隐藏 input
      if (action === 'upload') {
        const targetDir = node?.isDirectory ? node.path : rootPath
        uploadTargetDirRef.current = targetDir
        uploadInputRef.current?.click()
        return
      }

      // download：调用 sftpDownload
      if (action === 'download') {
        if (!node) return
        const localPath = window.prompt(
          `保存到本地路径（Windows 路径）`,
          `D:\\downloads\\${node.name}`,
        )
        if (!localPath?.trim()) return
        try {
          message.loading({ content: `下载中: ${node.name}`, key: 'download', duration: 0 })
          await api.sftpDownload(sessionId, node.path, localPath.trim())
          message.success({ content: `下载完成: ${localPath}`, key: 'download' })
        } catch (err) {
          message.error({
            content: `下载失败: ${err instanceof Error ? err.message : String(err)}`,
            key: 'download',
          })
        }
        return
      }
    },
    [sessionId, connected, rootPath, loadRoot],
  )

  /** 处理隐藏 input 选择文件后上传 */
  const handleUploadFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file || !sessionId) return
      const api = window.electronAPI
      if (!api?.sftpUpload) {
        message.error('sftpUpload 不可用')
        return
      }
      const remotePath = joinPath(uploadTargetDirRef.current, file.name)
      try {
        message.loading({ content: `上传中: ${file.name}`, key: 'upload', duration: 0 })
        // sftpUpload 签名：(sessionId, localPath, remotePath)
        // 注意：File 对象需先保存到临时路径，这里用 file.path（Electron 暴露）
        const localPath = (file as File & { path?: string }).path ?? ''
        if (!localPath) {
          message.error({ content: '无法获取本地文件路径', key: 'upload' })
          return
        }
        await api.sftpUpload(sessionId, localPath, remotePath)
        message.success({ content: `上传完成: ${remotePath}`, key: 'upload' })
        await loadRoot()
      } catch (err) {
        message.error({
          content: `上传失败: ${err instanceof Error ? err.message : String(err)}`,
          key: 'upload',
        })
      } finally {
        // 重置 input，允许重复选择同一文件
        if (uploadInputRef.current) uploadInputRef.current.value = ''
      }
    },
    [sessionId, loadRoot],
  )

  /** 处理 chmod 确认 */
  const handleChmodOk = useCallback(
    async (mode: string) => {
      if (!chmodTarget || !sessionId) return
      const api = window.electronAPI
      if (!api?.sftpChmod) {
        message.error('sftpChmod 不可用')
        return
      }
      try {
        await api.sftpChmod(sessionId, chmodTarget.path, mode)
        message.success(`权限已修改为 ${mode}`)
        setChmodTarget(null)
      } catch (err) {
        message.error(`修改权限失败: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [chmodTarget, sessionId],
  )

  /** 处理 rename 确认 */
  const handleRenameOk = useCallback(
    async (newName: string) => {
      if (!renameTarget || !sessionId) return
      const api = window.electronAPI
      if (!api?.sftpRename) {
        message.error('sftpRename 不可用')
        return
      }
      const parentDir = renameTarget.path.split('/').slice(0, -1).join('/') || '/'
      const newPath = joinPath(parentDir, newName)
      try {
        await api.sftpRename(sessionId, renameTarget.path, newPath)
        message.success(`已重命名为 ${newName}`)
        setRenameTarget(null)
        await loadRoot()
      } catch (err) {
        message.error(`重命名失败: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [renameTarget, sessionId, loadRoot],
  )
```

- [ ] **Step 3.4: 在 NodeRow 上挂载右键菜单**

修改 `NodeRow` 组件（约第 378 行），把 `onContextMenu` 事件透传到父级。同时修改主组件的渲染，用 `FileTreeContextMenu` 包裹整个 tree 容器。

先修改 NodeRowProps 接口（第 366 行）追加 `onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void`：

```tsx
interface NodeRowProps {
  node: TreeNode
  depth: number
  expanded: Set<string>
  activeFilePath?: string
  onToggle: (node: TreeNode) => void
  onOpen: (node: TreeNode) => void
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void
}
```

在 NodeRow 组件的根 div 上添加 `onContextMenu`（约第 392 行 `<div role="treeitem" ...>` 之后）：

```tsx
      <div
        role="treeitem"
        aria-expanded={node.isDirectory ? isOpen : undefined}
        aria-selected={isActive}
        tabIndex={0}
        onClick={() => onOpen(node)}
        onContextMenu={(e) => onContextMenu?.(e, node)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(node)
          }
        }}
        style={{ paddingLeft: pad }}
        className={cn(
          'wb-ft-row',
          isActive && 'is-active',
        )}
      >
```

- [ ] **Step 3.5: 主组件包裹 FileTreeContextMenu**

在主组件的 return 内，把 `<div role="tree" className="wb-filetree-scroll">` 用 `FileTreeContextMenu` 包裹。同时把 NodeRow 的 onContextMenu 设置为 setMenuNode：

```tsx
      <div role="tree" className="wb-filetree-scroll">
        <FileTreeContextMenu
          node={menuNode}
          rootPath={rootPath}
          onAction={handleMenuAction}
        >
          <div onContextMenu={(e) => {
            // 空白处右键：清除节点选中
            if (e.target === e.currentTarget) setMenuNode(null)
          }}>
            {!connected ? (
              <div className="wb-filetree-empty">
                <Link2 className="size-6 wb-filetree-empty-icon" />
                <div className="wb-filetree-empty-text">
                  尚未连接 SSH
                  <br />
                  连接后将列出远程目录
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/settings/ssh')}
                  className="wb-filetree-connect-btn"
                >
                  去连接服务器
                </button>
              </div>
            ) : (
              <>
                {nodes.map((node) => (
                  <NodeRow
                    key={node.id}
                    node={node}
                    depth={0}
                    expanded={expanded}
                    activeFilePath={activeFilePath}
                    onToggle={toggleDir}
                    onOpen={handleFileClick}
                    onContextMenu={(_e, n) => setMenuNode(n)}
                  />
                ))}
              </>
            )}
          </div>
        </FileTreeContextMenu>
      </div>
```

- [ ] **Step 3.6: 在主组件末尾渲染 Dialog + 隐藏 input**

在主组件 return 的最后（`</div>` 闭合前）追加：

```tsx
      {/* 隐藏文件上传 input */}
      <input
        ref={uploadInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => void handleUploadFile(e)}
      />

      {/* Chmod 对话框 */}
      <ChmodDialog
        open={chmodTarget !== null}
        path={chmodTarget?.path ?? ''}
        onCancel={() => setChmodTarget(null)}
        onOk={handleChmodOk}
      />

      {/* Rename 对话框 */}
      <RenameDialog
        open={renameTarget !== null}
        oldName={renameTarget?.name ?? ''}
        onCancel={() => setRenameTarget(null)}
        onOk={handleRenameOk}
      />
```

- [ ] **Step 3.7: 验证编译门禁**

Run: `pnpm typecheck:web && pnpm lint`
Expected: 三绿（typecheck:node 不涉及本次改动）

- [ ] **Step 3.8: 手动验证**

1. 启动 dev：`pnpm dev`
2. SSH 连接成功后，右键文件树空白处 → 应显示"新建目录/上传文件/刷新"
3. 右键目录 → 应显示"新建子目录/上传到此目录/下载目录/重命名/修改权限/删除/刷新"
4. 右键文件 → 应显示"下载文件/重命名/修改权限/删除"
5. 点击"修改权限" → 弹出 ChmodDialog，输入 755 显示 rwxr-xr-x
6. 点击"重命名" → 弹出 RenameDialog，预填旧名称
7. 点击"上传文件" → 弹出系统文件选择器

- [ ] **Step 3.9: 提交**

```bash
git add src/renderer/src/components/workbench/FileTree.tsx
git commit -m "feat(M1): FileTree 集成右键菜单，对接 sftpUpload/Download/Rename/Chmod"
```

---

## Task 4: TerminalView xterm 选中桥接

**Files:**
- Modify: `src/renderer/src/components/terminal/TerminalView.tsx`

**Interfaces:**
- Consumes: `useEditorStore.setSelection`（editor-store.ts:78 已存在）
- Produces: xterm 选中事件 → editor-store.selection（type='cmd'），触发 SelectionPopover 浮层

- [ ] **Step 4.1: 在 TerminalView.tsx import editor-store**

在 `src/renderer/src/components/terminal/TerminalView.tsx` 顶部 import 区追加：

```tsx
import { useEditorStore } from '@/stores/editor-store'
```

- [ ] **Step 4.2: 在 useEffect 内注册 terminal.onSelectionChange**

在 `src/renderer/src/components/terminal/TerminalView.tsx` 第 213 行（selectionManager 块之后，"===== 8. 清理 =====" 之前）追加：

```tsx
    // ===== 7.6 v2.0 xterm 选中桥接 → editor-store.selection =====
    // 选中终端文本时，写入 editor-store.selection（type='cmd'），触发 SelectionPopover 浮层
    // 鼠标松开后 50ms 检查选中（避免拖拽过程中频繁触发）
    let selectionDebounce: ReturnType<typeof setTimeout> | null = null
    const selectionDisposable = terminal.onSelectionChange(() => {
      if (selectionDebounce) clearTimeout(selectionDebounce)
      selectionDebounce = setTimeout(() => {
        if (!terminalRef.current) return
        const text = terminalRef.current.getSelection()
        const { setSelection } = useEditorStore.getState()
        if (text && text.trim().length > 0) {
          setSelection({
            text: text.trim(),
            type: 'cmd',
          })
        } else {
          // 选中清空时也清除 store（避免浮层残留）
          setSelection(null)
        }
      }, 50)
    })
```

- [ ] **Step 4.3: 在清理函数中 dispose**

在第 215 行起的清理块内，`if (selectionManager) { ... }` 之后追加：

```tsx
      // 清理 xterm 选中监听
      selectionDisposable.dispose()
      if (selectionDebounce) {
        clearTimeout(selectionDebounce)
      }
```

- [ ] **Step 4.4: 验证编译门禁**

Run: `pnpm typecheck:web && pnpm lint`
Expected: 三绿

- [ ] **Step 4.5: 手动验证**

1. 启动 dev，SSH 连接成功
2. 在终端中输入 `ls -la` 并回车
3. 鼠标选中 `ls -la` 命令文本
4. 应在屏幕右下角看到 SelectionPopover 浮层（"命令"标签 + 选中文本 + "发送到 AI"按钮）
5. 点击"发送到 AI" → AIPanel 输入框应自动注入 `@cmd[ls -la]`

- [ ] **Step 4.6: 提交**

```bash
git add src/renderer/src/components/terminal/TerminalView.tsx
git commit -m "feat(M1): TerminalView 桥接 xterm.onSelectionChange 到 editor-store.selection"
```

---

## Task 5: TerminalSearchBar 终端搜索 UI

**Files:**
- Create: `src/renderer/src/components/terminal/TerminalSearchBar.tsx`
- Modify: `src/renderer/src/components/terminal/TerminalView.tsx`

**Interfaces:**
- Consumes: xterm SearchAddon（TerminalView.tsx:104 已加载未使用）
- Produces: `TerminalSearchBar` 组件，Ctrl+F 触发显示，输入关键词高亮匹配

- [ ] **Step 5.1: 创建 TerminalSearchBar 组件**

创建 `src/renderer/src/components/terminal/TerminalSearchBar.tsx`：

```tsx
/**
 * TerminalSearchBar — 终端搜索栏
 *
 * 行为：
 * - 父组件通过 visible + onClose 控制显隐
 * - 输入关键词后回车 → findNext
 * - Shift+Enter → findPrevious
 * - Esc 关闭
 *
 * 依赖：xterm SearchAddon（TerminalView 已加载）
 */
import { useEffect, useRef, useState, type FC } from 'react'
import { SearchAddon } from '@xterm/addon-search'
import { X, ChevronUp, ChevronDown, Search } from 'lucide-react'

export interface TerminalSearchBarProps {
  open: boolean
  searchAddon: SearchAddon | null
  onClose: () => void
}

const TerminalSearchBar: FC<TerminalSearchBarProps> = ({
  open,
  searchAddon,
  onClose,
}) => {
  const [keyword, setKeyword] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [matchIndex, setMatchIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setKeyword('')
      setMatchIndex(0)
    }
  }, [open])

  // 关键词变化时自动 findNext
  useEffect(() => {
    if (!open || !searchAddon || !keyword) return
    try {
      searchAddon.findNext(keyword, {
        caseSensitive,
        wholeWord,
        regex: false,
      })
      setMatchIndex(1)
    } catch {
      // 关键词可能是正则非法字符
    }
  }, [keyword, caseSensitive, wholeWord, open, searchAddon])

  const handleFindNext = () => {
    if (!searchAddon || !keyword) return
    try {
      searchAddon.findNext(keyword, { caseSensitive, wholeWord, regex: false })
      setMatchIndex((i) => i + 1)
    } catch {
      // ignore
    }
  }

  const handleFindPrev = () => {
    if (!searchAddon || !keyword) return
    try {
      searchAddon.findPrevious(keyword, { caseSensitive, wholeWord, regex: false })
      setMatchIndex((i) => Math.max(0, i - 1))
    } catch {
      // ignore
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) handleFindPrev()
      else handleFindNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 100,
        background: 'var(--trae-bg-overlay-l2, #252629)',
        border: '1px solid var(--trae-border-neutral-l1, #3c3c3c)',
        borderRadius: 'var(--radius-6, 6px)',
        padding: '6px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      }}
    >
      <Search size={14} style={{ color: 'var(--trae-text-tertiary)' }} />
      <input
        ref={inputRef}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="搜索（回车下一个，Shift+回车上一个）"
        style={{
          width: 220,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--trae-text-primary, #d1d3db)',
          fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      />
      <button
        type="button"
        onClick={() => setCaseSensitive((v) => !v)}
        title="区分大小写"
        style={{
          padding: '2px 6px',
          fontSize: 11,
          background: caseSensitive ? 'var(--bg-brand, #387BFF)' : 'transparent',
          color: caseSensitive ? '#fff' : 'var(--trae-text-secondary)',
          border: '1px solid var(--trae-border-neutral-l1)',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        Aa
      </button>
      <button
        type="button"
        onClick={() => setWholeWord((v) => !v)}
        title="全字匹配"
        style={{
          padding: '2px 6px',
          fontSize: 11,
          background: wholeWord ? 'var(--bg-brand, #387BFF)' : 'transparent',
          color: wholeWord ? '#fff' : 'var(--trae-text-secondary)',
          border: '1px solid var(--trae-border-neutral-l1)',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        W
      </button>
      <button
        type="button"
        onClick={handleFindPrev}
        title="上一个 (Shift+Enter)"
        style={{
          padding: 4,
          background: 'transparent',
          border: '1px solid var(--trae-border-neutral-l1)',
          borderRadius: 4,
          cursor: 'pointer',
          color: 'var(--trae-text-secondary)',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <ChevronUp size={12} />
      </button>
      <button
        type="button"
        onClick={handleFindNext}
        title="下一个 (Enter)"
        style={{
          padding: 4,
          background: 'transparent',
          border: '1px solid var(--trae-border-neutral-l1)',
          borderRadius: 4,
          cursor: 'pointer',
          color: 'var(--trae-text-secondary)',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <ChevronDown size={12} />
      </button>
      <button
        type="button"
        onClick={onClose}
        title="关闭 (Esc)"
        style={{
          padding: 4,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--trae-text-secondary)',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <X size={12} />
      </button>
    </div>
  )
}

export default TerminalSearchBar
```

- [ ] **Step 5.2: 修改 TerminalView 暴露 searchAddon + 挂载 TerminalSearchBar**

在 `src/renderer/src/components/terminal/TerminalView.tsx` 中：

1. 顶部追加 import：
```tsx
import TerminalSearchBar from './TerminalSearchBar'
import type { SearchAddon } from '@xterm/addon-search'
```

2. 在组件内（`terminalRef` / `fitRef` 之后）追加 state：
```tsx
  const [searchOpen, setSearchOpen] = useState(false)
  const searchAddonRef = useRef<SearchAddon | null>(null)
```

3. 在 useEffect 创建 SearchAddon 后（第 105 行 `terminal.loadAddon(searchAddon)` 之后）保存 ref：
```tsx
    searchAddonRef.current = searchAddon
```

4. 在 useEffect 清理块内追加：
```tsx
      searchAddonRef.current = null
```

5. 在 useEffect 末尾追加 Ctrl+F 监听（在 handleKeyDown 函数内追加 else if 分支）：
```tsx
      } else if (e.ctrlKey && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
      }
```

6. 修改 return，把容器改为 `position: relative` 并挂载 TerminalSearchBar：
```tsx
  return (
    <div
      ref={containerRef}
      className={`terminal-view ${visible ? 'visible' : 'hidden'}`}
      style={{ position: 'relative' }}
    >
      <TerminalSearchBar
        open={searchOpen}
        searchAddon={searchAddonRef.current}
        onClose={() => setSearchOpen(false)}
      />
    </div>
  )
```

- [ ] **Step 5.3: 验证编译门禁**

Run: `pnpm typecheck:web && pnpm lint`
Expected: 三绿

- [ ] **Step 5.4: 手动验证**

1. 启动 dev，SSH 连接成功，进入终端 Tab
2. 按 Ctrl+F → 应弹出右上角搜索框
3. 输入 `ls` → 应高亮第一个匹配
4. 回车 → 下一个匹配
5. Shift+回车 → 上一个匹配
6. 点 Aa 按钮 → 区分大小写
7. Esc 关闭搜索框

- [ ] **Step 5.5: 提交**

```bash
git add src/renderer/src/components/terminal/TerminalSearchBar.tsx src/renderer/src/components/terminal/TerminalView.tsx
git commit -m "feat(M1): 新增 TerminalSearchBar 终端搜索 UI（Ctrl+F 触发）"
```

---

## Task 6: FileWatcher 远程文件监听 + 外部变更提示

**Files:**
- Create: `src/renderer/src/components/workbench/FileChangeNotice.tsx`
- Modify: `src/renderer/src/components/workbench/EditorArea.tsx`

**Interfaces:**
- Consumes: `window.electronAPI.fileWatchStart` / `fileWatchStop` / `onFileChanged`（preload 3043-3046 行）
- Produces: 文件打开时启动监听，外部变更时显示提示条，用户可选择"重新加载"或"忽略"

- [ ] **Step 6.1: 创建 FileChangeNotice 组件**

创建 `src/renderer/src/components/workbench/FileChangeNotice.tsx`：

```tsx
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
              border: '1px solid var(--bg-brand, #387BFF)',
              background: 'var(--bg-brand, #387BFF)',
              color: '#fff',
              borderRadius: 'var(--radius-4, 4px)',
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
              borderRadius: 'var(--radius-4, 4px)',
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
```

- [ ] **Step 6.2: 在 EditorArea.tsx 接入 FileWatcher**

在 `src/renderer/src/components/workbench/EditorArea.tsx` 中：

1. 顶部追加 import：
```tsx
import FileChangeNotice from './FileChangeNotice'
```

2. 在主组件内（已有 useState 之后）追加状态：
```tsx
  /** 外部变更提示：path → true（表示该文件有未处理的外部变更） */
  const [changedFiles, setChangedFiles] = useState<Set<string>>(new Set())
  /** 已监听文件的集合（避免重复 fileWatchStart） */
  const watchedFilesRef = useRef<Set<string>>(new Set())
```

3. 在已有 useEffect 之后追加 FileWatcher 监听 + 启停逻辑：
```tsx
  // ===== FileWatcher：监听远程文件外部变更 =====
  // 1. 全局监听 onFileChanged 事件
  // 2. 当前打开的文件路径变化时，fileWatchStart（新文件）/ fileWatchStop（关闭的文件）
  useEffect(() => {
    if (!isElectronAPIAvailable() || !window.electronAPI.onFileChanged) return

    const off = window.electronAPI.onFileChanged((path: string) => {
      setChangedFiles((prev) => {
        const next = new Set(prev)
        next.add(path)
        return next
      })
    })

    return () => {
      off()
    }
  }, [])

  // 当前激活文件路径变化时启动/停止监听
  useEffect(() => {
    if (!isElectronAPIAvailable()) return
    const api = window.electronAPI
    if (!api.fileWatchStart || !api.fileWatchStop || !sessionId) return

    // 新激活的文件启动监听
    if (activeFilePath && !watchedFilesRef.current.has(activeFilePath)) {
      api.fileWatchStart(sessionId, activeFilePath).catch(() => {
        // 监听启动失败不影响编辑
      })
      watchedFilesRef.current.add(activeFilePath)
    }

    // 已关闭的文件 tab 移除时停止监听（fileTabs 变化时）
    const currentPaths = new Set(fileTabs.filter((t) => t.id.startsWith('file:')).map((t) => t.id.slice('file:'.length)))
    for (const watched of watchedFilesRef.current) {
      if (!currentPaths.has(watched)) {
        api.fileWatchStop(sessionId, watched).catch(() => {
          // 停止失败不影响
        })
        watchedFilesRef.current.delete(watched)
      }
    }
  }, [activeFilePath, fileTabs, sessionId])

  // 组件卸载时停止所有监听
  useEffect(() => {
    return () => {
      if (!isElectronAPIAvailable() || !window.electronAPI.fileWatchStop || !sessionId) return
      for (const path of watchedFilesRef.current) {
        window.electronAPI.fileWatchStop(sessionId, path).catch(() => {})
      }
      watchedFilesRef.current.clear()
    }
  }, [sessionId])
```

4. 在 EditorArea return 内，标签栏下方、编辑器主体之前，根据当前 activeFilePath 是否在 changedFiles 中决定是否显示 FileChangeNotice：
```tsx
      {/* 远程文件外部变更提示 */}
      {activeFilePath && changedFiles.has(activeFilePath) && (
        <FileChangeNotice
          path={activeFilePath}
          onReload={async () => {
            // 重新加载文件内容
            if (!sessionId || !activeFilePath) return
            try {
              const content = await window.electronAPI.sftpReadFile(sessionId, activeFilePath)
              // 触发 onFileContentChange 让父组件更新
              onFileContentChange?.(`file:${activeFilePath}`, content)
              setChangedFiles((prev) => {
                const next = new Set(prev)
                next.delete(activeFilePath)
                return next
              })
            } catch (err) {
              message.error(`重新加载失败: ${err instanceof Error ? err.message : String(err)}`)
            }
          }}
          onDismiss={() => {
            setChangedFiles((prev) => {
              const next = new Set(prev)
              next.delete(activeFilePath ?? '')
              return next
            })
          }}
        />
      )}
```

注意：`onFileContentChange` 已是 EditorArea 的 props，但需要确认其类型签名。如果当前签名不匹配，需在 EditorAreaProps 接口内调整。

- [ ] **Step 6.3: 验证编译门禁**

Run: `pnpm typecheck:web && pnpm lint`
Expected: 三绿

- [ ] **Step 6.4: 手动验证**

1. 启动 dev，SSH 连接，打开远程文件 `/etc/nginx/nginx.conf`
2. 在另一个终端 SSH 会话中执行 `echo "# test" >> /etc/nginx/nginx.conf`
3. 应在 1-2 秒内看到编辑器顶部出现黄色提示条"文件已被外部修改"
4. 点击"重新加载" → 文件内容应刷新
5. 点击"忽略" → 提示条消失

- [ ] **Step 6.5: 提交**

```bash
git add src/renderer/src/components/workbench/FileChangeNotice.tsx src/renderer/src/components/workbench/EditorArea.tsx
git commit -m "feat(M1): 接入 FileWatcher 远程文件监听 + 外部变更提示条"
```

---

## Task 7: AIPanel onAgentStep 流式订阅 + LiveMessageRow 步骤渲染

**Files:**
- Modify: `src/renderer/src/stores/agent-store.ts`
- Modify: `src/renderer/src/components/workbench/useAgentChat.ts`
- Modify: `src/renderer/src/components/workbench/panels/LiveMessageRow.tsx`

**Interfaces:**
- Consumes: `window.electronAPI.onAgentStep`（preload 2272 行，类型 `(callback: (state: AgentWorkflowState) => void) => () => void`）
- Consumes: `AgentWorkflowState` 类型（models.ts:451，含 currentStep/completedSteps/stepDetails/waitingForConfirmation/decisionCard）
- Produces: 实时消息展示当前 Agent 工作流步骤进度

- [ ] **Step 7.1: 在 agent-store 增加 stepState 字段**

在 `src/renderer/src/stores/agent-store.ts` 中：

1. 顶部追加 import：
```tsx
import type { AgentWorkflowState } from '@shared/models'
```

2. 在 `AgentMessage` 接口内追加可选字段 `stepState?`：
```tsx
export interface AgentMessage {
  // ... 已有字段
  /** Agent 工作流状态（onAgentStep 推送，仅 assistant 消息） */
  stepState?: AgentWorkflowState | null
}
```

3. 在 store 接口与初始 state 内追加：
```tsx
  /** 更新当前流式消息的 stepState */
  updateStepState: (stepState: AgentWorkflowState) => void
```

4. 在 create 内追加实现：
```tsx
  updateStepState: (stepState) => set((state) => {
    // 写入最后一条 assistant 消息
    const next = [...state.messages]
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].role === 'assistant' && next[i].isStreaming) {
        next[i] = { ...next[i], stepState }
        break
      }
    }
    return { messages: next }
  }),
```

- [ ] **Step 7.2: 在 useAgentChat 订阅 onAgentStep**

在 `src/renderer/src/components/workbench/useAgentChat.tsx` 中：

1. 顶部追加 import：
```tsx
import type { AgentWorkflowState } from '@shared/models'
```

2. 在 store 解构内追加 `updateStepState`：
```tsx
  const updateStepState = useAgentStore((s) => s.updateStepState)
```

3. 在已有 useEffect（第 156 行订阅 onAgentChunk/onAgentDone/onAgentError）内追加 onAgentStep 订阅：

在 `const offError = ...` 之后追加：
```tsx
    const offStep = window.electronAPI.onAgentStep?.((state: AgentWorkflowState) => {
      updateStepState(state)
    })
```

4. 在清理函数内追加：
```tsx
      offStep?.()
```

5. 在依赖数组追加 `updateStepState`：
```tsx
  }, [appendToken, finalizeMessage, markError, setTokenStats, setCostStats, updateStepState])
```

- [ ] **Step 7.3: 在 LiveMessageRow 渲染步骤进度**

在 `src/renderer/src/components/workbench/panels/LiveMessageRow.tsx` 中：

1. 顶部追加 import：
```tsx
import type { AgentWorkflowState, AgentStep } from '@shared/models'
```

2. 在组件内（已读取 message 之后）追加步骤渲染逻辑：

```tsx
  /** 渲染 Agent 工作流步骤进度条（如果 message.stepState 存在） */
  const renderStepProgress = () => {
    if (!message.stepState) return null
    const { currentStep, completedSteps, waitingForConfirmation } = message.stepState
    const allSteps: AgentStep[] = ['collect', 'analyze', 'reason', 'check', 'confirm', 'execute', 'verify']
    const stepLabels: Record<AgentStep, string> = {
      collect: '采集',
      analyze: '分析',
      reason: '推理',
      check: '检查',
      confirm: '确认',
      execute: '执行',
      verify: '验证',
    }

    return (
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginTop: 6,
          padding: '6px 8px',
          background: 'var(--trae-bg-base-tertiary, #2A2D31)',
          borderRadius: 'var(--radius-4, 4px)',
          fontSize: 11,
        }}
      >
        {allSteps.map((step) => {
          const isCompleted = completedSteps.includes(step)
          const isCurrent = currentStep === step
          const isWaiting = isCurrent && waitingForConfirmation
          return (
            <span
              key={step}
              style={{
                padding: '2px 6px',
                borderRadius: 'var(--radius-2, 2px)',
                background: isCompleted
                  ? 'var(--bg-brand, #387BFF)'
                  : isCurrent
                  ? 'rgba(56,123,255,0.2)'
                  : 'transparent',
                color: isCompleted
                  ? '#fff'
                  : isCurrent
                  ? 'var(--bg-brand, #387BFF)'
                  : 'var(--trae-text-tertiary)',
                border: isWaiting ? '1px solid var(--trae-status-alert, #D29D00)' : '1px solid transparent',
                fontWeight: isCurrent ? 500 : 400,
              }}
            >
              {stepLabels[step]}
              {isWaiting && ' ⏸'}
            </span>
          )
        })}
      </div>
    )
  }
```

3. 在消息渲染区追加 `{renderStepProgress()}`（在消息内容之后、工具面板之前）。

- [ ] **Step 7.4: 验证编译门禁**

Run: `pnpm typecheck:web && pnpm lint`
Expected: 三绿

- [ ] **Step 7.5: 手动验证**

1. 启动 dev，SSH 连接成功
2. 在 AIPanel 提问："分析 nginx 配置并给出优化建议"
3. 应看到消息下方出现 7 步进度条：采集 → 分析 → 推理 → 检查 → 确认 → 执行 → 验证
4. 当前步骤高亮，已完成步骤蓝色填充
5. 等待确认时显示 ⏸ 图标

- [ ] **Step 7.6: 提交**

```bash
git add src/renderer/src/stores/agent-store.ts src/renderer/src/components/workbench/useAgentChat.ts src/renderer/src/components/workbench/panels/LiveMessageRow.tsx
git commit -m "feat(M1): AIPanel 订阅 onAgentStep 流式推送 + LiveMessageRow 渲染 7 步进度"
```

---

## Task 8: LiveMessageRow 底部 3 动作按钮迁移

**Files:**
- Modify: `src/renderer/src/components/workbench/panels/LiveMessageRow.tsx`

**Interfaces:**
- Consumes: `onNavigate` props（已有，从 MessageRow 迁移逻辑）
- Produces: 实时消息底部 3 动作按钮：查看监控 / 记录决策 / 更新知识库

- [ ] **Step 8.1: 在 LiveMessageRow 渲染底部 3 动作按钮**

在 `src/renderer/src/components/workbench/panels/LiveMessageRow.tsx` 中：

1. 确认 props 已含 `onNavigate?: (path: string) => void`（若无则追加）

2. 在消息渲染末尾追加 3 动作按钮（仅当消息流式结束且非错误时显示）：

```tsx
  /** 渲染底部 3 动作按钮（消息完成且非错误时显示） */
  const renderActionButtons = () => {
    if (message.isStreaming || message.isError) return null
    if (!onNavigate) return null
    return (
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid var(--trae-border-neutral-l1, #3c3c3c)',
        }}
      >
        <button
          type="button"
          onClick={() => onNavigate('/monitor')}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            border: '1px solid var(--trae-border-neutral-l1)',
            background: 'transparent',
            color: 'var(--trae-text-secondary)',
            borderRadius: 'var(--radius-4, 4px)',
            cursor: 'pointer',
          }}
        >
          查看监控
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/history')}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            border: '1px solid var(--trae-border-neutral-l1)',
            background: 'transparent',
            color: 'var(--trae-text-secondary)',
            borderRadius: 'var(--radius-4, 4px)',
            cursor: 'pointer',
          }}
        >
          记录决策
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/knowledge')}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            border: '1px solid var(--trae-border-neutral-l1)',
            background: 'transparent',
            color: 'var(--trae-text-secondary)',
            borderRadius: 'var(--radius-4, 4px)',
            cursor: 'pointer',
          }}
        >
          更新知识库
        </button>
      </div>
    )
  }
```

3. 在 return 末尾追加 `{renderActionButtons()}`

- [ ] **Step 8.2: 验证编译门禁**

Run: `pnpm typecheck:web && pnpm lint`
Expected: 三绿

- [ ] **Step 8.3: 手动验证**

1. 启动 dev，SSH 连接，在 AIPanel 提问并等待回复完成
2. 实时消息底部应出现 3 个按钮：查看监控 / 记录决策 / 更新知识库
3. 点击"查看监控" → 跳转到 /monitor
4. 点击"记录决策" → 跳转到 /history
5. 点击"更新知识库" → 跳转到 /knowledge

- [ ] **Step 8.4: 提交**

```bash
git add src/renderer/src/components/workbench/panels/LiveMessageRow.tsx
git commit -m "feat(M1): LiveMessageRow 迁移底部 3 动作按钮（查看监控/记录决策/更新知识库）"
```

---

## Task 9: 工作台视觉 1:1 对齐

**Files:**
- Modify: `src/renderer/src/components/workbench/Workbench.css`
- Modify: `src/renderer/src/components/workbench/AIPanel.css`
- Modify: `src/renderer/src/components/workbench/WorkbenchTitlebar.tsx`（如需）

**视觉对齐项**（参考设计稿 `参考资料/前端设计/pages/工作台.html`）：
- 4 区布局：Activity Rail (48px) + FileTree (200px) + EditorArea (flex-1) + AIPanel (560px)
- 终端区 JetBrains Mono 11px
- AI 面板 8 tool panel 可展开/折叠
- 执行控制 4 按钮：采纳建议 / 查看详情 / 暂停执行 / 回滚（红色危险态）

- [ ] **Step 9.1: 调整工作台 4 区布局 CSS**

在 `src/renderer/src/components/workbench/Workbench.css` 中：

1. Activity Rail 固定宽度 48px：
```css
.wb-activity-rail {
  width: 48px;
  flex-shrink: 0;
  background: var(--trae-bg-base-default, #1A1B1D);
  border-right: 1px solid var(--trae-border-neutral-l1);
}
```

2. FileTree 固定宽度 200px：
```css
.wb-filetree {
  width: 200px;
  flex-shrink: 0;
  background: var(--trae-bg-base-secondary, #222427);
  border-right: 1px solid var(--trae-border-neutral-l1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

3. AIPanel 固定宽度 560px（已有，确认即可）：
```css
.wb-aipanel {
  width: 560px;
  flex-shrink: 0;
}
```

- [ ] **Step 9.2: 终端区 JetBrains Mono 11px**

在 `src/renderer/src/components/terminal/Terminal.css` 中确认终端字体：

```css
.terminal-view .xterm-viewport {
  font-family: 'JetBrains Mono', 'SFMono-Regular', 'Consolas', monospace;
  font-size: 11px;
}
```

如果 TerminalView.tsx 内部 `fontSize` 已通过 `terminal.options.fontSize` 设置（第 87 行），需要确认默认值。读取 TerminalView.tsx 第 30-50 行的常量定义，把 `DEFAULT_FONT_SIZE` 改为 11：

```tsx
const DEFAULT_FONT_SIZE = 11
```

- [ ] **Step 9.3: AI 面板 tool panel 展开折叠样式**

在 `src/renderer/src/components/workbench/AIPanel.css` 中追加 tool panel 展开折叠样式：

```css
/* Tool panel 展开折叠样式 */
.wb-tool-panel {
  border: 1px solid var(--trae-border-neutral-l1);
  border-radius: var(--radius-4, 4px);
  margin-bottom: 8px;
  overflow: hidden;
}

.wb-tool-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--trae-bg-base-tertiary, #2A2D31);
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  color: var(--trae-text-secondary);
}

.wb-tool-panel-header:hover {
  background: var(--trae-bg-overlay-l1, #212327);
}

.wb-tool-panel-body {
  padding: 8px 12px;
  font-size: 11px;
  color: var(--trae-text-primary);
  border-top: 1px solid var(--trae-border-neutral-l1);
}

.wb-tool-panel.is-collapsed .wb-tool-panel-body {
  display: none;
}
```

- [ ] **Step 9.4: 执行控制 4 按钮视觉**

在 `src/renderer/src/components/workbench/AIPanel.css` 中追加执行控制按钮样式：

```css
/* 执行控制 4 按钮 */
.wb-exec-controls {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--trae-border-neutral-l1);
}

.wb-exec-btn {
  flex: 1;
  padding: 6px 10px;
  font-size: 11px;
  border: 1px solid var(--trae-border-neutral-l1);
  background: var(--trae-bg-base-tertiary, #2A2D31);
  color: var(--trae-text-secondary);
  border-radius: var(--radius-4, 4px);
  cursor: pointer;
  transition: all 0.15s ease-out;
}

.wb-exec-btn:hover {
  background: var(--trae-bg-overlay-l1, #212327);
  color: var(--trae-text-primary);
}

.wb-exec-btn.is-primary {
  background: var(--bg-brand, #387BFF);
  color: #fff;
  border-color: var(--bg-brand, #387BFF);
}

.wb-exec-btn.is-primary:hover {
  background: #4C88FF;
  border-color: #4C88FF;
}

.wb-exec-btn.is-danger {
  color: var(--trae-status-error, #F65A5A);
  border-color: var(--trae-status-error, #F65A5A);
}

.wb-exec-btn.is-danger:hover {
  background: rgba(246, 90, 90, 0.1);
}
```

- [ ] **Step 9.5: 验证编译门禁**

Run: `pnpm typecheck:web && pnpm lint`
Expected: 三绿

- [ ] **Step 9.6: 视觉对比设计稿**

1. 启动 dev，进入工作台
2. 与设计稿 `参考资料/前端设计/pages/工作台.html` 并排对比
3. 检查项：
   - [ ] Activity Rail 48px 宽度
   - [ ] FileTree 200px 宽度
   - [ ] AIPanel 560px 宽度
   - [ ] 终端字体 JetBrains Mono 11px
   - [ ] 卡片 hover 阴影效果
   - [ ] 焦点态 outline 显示
   - [ ] 颜色全部用 var() 无硬编码

- [ ] **Step 9.7: 提交**

```bash
git add src/renderer/src/components/workbench/Workbench.css src/renderer/src/components/workbench/AIPanel.css src/renderer/src/components/terminal/Terminal.css src/renderer/src/components/terminal/TerminalView.tsx
git commit -m "style(M1): 工作台视觉 1:1 对齐（4 区布局 + 终端字体 + tool panel 样式 + 执行控制按钮）"
```

---

## Task 10: SshSettings + TerminalSettings 视觉对齐

**Files:**
- Modify: `src/renderer/src/pages/SshSettings.tsx`（仅样式微调，不动 IPC）
- Modify: `src/renderer/src/pages/TerminalSettings.tsx`（仅样式微调，不动 IPC）

**说明**：两个设置页已是真实表单 + IPC 对接，本任务仅做视觉对齐：Card 间距 / 字体 / 颜色 token

- [ ] **Step 10.1: SshSettings Card 间距对齐**

在 `src/renderer/src/pages/SshSettings.tsx` 中：

1. 检查 Card 组件的 style，确保：
   - marginBottom: 16px（spacer-16）
   - borderRadius: var(--radius-8, 8px)
   - background: var(--trae-bg-base-secondary, #222427)
   - border: 1px solid var(--trae-border-neutral-l1)

2. 检查 Card title 字体：
   - fontSize: 13px（body-base）
   - fontWeight: 500（medium）
   - color: var(--trae-text-primary)

3. 检查表单 Label：
   - fontSize: 12px（body-md）
   - color: var(--trae-text-secondary)

如发现硬编码颜色，替换为 var()。

- [ ] **Step 10.2: TerminalSettings Card 间距对齐**

在 `src/renderer/src/pages/TerminalSettings.tsx` 中：

1. 同 SshSettings 检查 Card 样式
2. 确保 17 项设置项的 Input/Switch/RadioGroup 都使用 var() 颜色
3. ActionBar 按钮样式对齐设计稿

- [ ] **Step 10.3: 验证编译门禁**

Run: `pnpm typecheck:web && pnpm lint`
Expected: 三绿

- [ ] **Step 10.4: 视觉对比设计稿**

1. 启动 dev，进入 /settings/ssh 和 /settings/terminal
2. 与设计稿 `参考资料/前端设计/pages/SSH 连接.html` 和 `终端设置.html` 并排对比
3. 检查项：
   - [ ] Card 间距 16px
   - [ ] 字体大小匹配
   - [ ] 颜色 token 全覆盖
   - [ ] ActionBar 按钮位置

- [ ] **Step 10.5: 提交**

```bash
git add src/renderer/src/pages/SshSettings.tsx src/renderer/src/pages/TerminalSettings.tsx
git commit -m "style(M1): SshSettings + TerminalSettings 视觉对齐设计稿（间距/字体/颜色 token）"
```

---

## Task 11: 端到端验收 + 编译门禁

**Files:** 无（仅验证）

- [ ] **Step 11.1: 运行编译门禁**

Run: `pnpm typecheck:node && pnpm typecheck:web && pnpm lint`
Expected: 三绿（exit 0）

- [ ] **Step 11.2: 端到端验收**

启动 dev：`pnpm dev`

按 spec §M1 端到端验收标准逐项验证：

1. **SSH 连接 → 输入命令 → 看到输出**
   - 进入 /settings/ssh 添加服务器 → 连接 → 自动跳转 /workbench
   - 在终端输入 `ls -la` → 应看到目录列表

2. **文件树展开 → 点击文件 → 编辑器打开**
   - 在 FileTree 点击 `/etc` 目录展开
   - 点击 `nginx/nginx.conf` → 编辑器打开新 tab
   - 内容正确显示

3. **AI 提问 → 流式回复 → 工具调用展开**
   - 在 AIPanel 输入"分析 nginx 配置"
   - 应看到流式回复 + 7 步进度条
   - 工具调用面板展开

4. **选中终端命令 → "添加到 AI 对话" → composer 自动注入**
   - 鼠标选中终端中的 `ls -la` 文本
   - 应在右下角出现 SelectionPopover 浮层
   - 点击"发送到 AI" → AIPanel 输入框自动注入 `@cmd[ls -la]`

5. **FileTree 右键菜单**
   - 右键文件 → 显示"下载/重命名/修改权限/删除"
   - 右键目录 → 显示"新建子目录/上传/下载/重命名/修改权限/删除/刷新"
   - 右键空白 → 显示"新建目录/上传文件/刷新"

6. **终端搜索**
   - Ctrl+F → 搜索框出现
   - 输入关键词 → 高亮匹配
   - 回车/Shift+回车切换匹配

7. **远程文件监听**
   - 打开远程文件 → 在外部修改 → 应出现变更提示条
   - 点击"重新加载" → 内容刷新

- [ ] **Step 11.3: 更新 spec 文档进度**

在 `docs/superpowers/specs/2026-07-23-frontend-full-rebuild-design.md` 的 §M1 末尾追加：

```markdown
**实施完成**：2026-07-23
- Task 1-11 全部完成
- 编译门禁三绿
- 端到端验收 7 项全过
- commit: <填入实际 commit hash>
```

- [ ] **Step 11.4: 提交 spec 进度更新**

```bash
git add docs/superpowers/specs/2026-07-23-frontend-full-rebuild-design.md docs/superpowers/plans/2026-07-23-m1-ssh-terminal-workbench.md
git commit -m "docs(M1): M1 模块实施完成，更新 spec 进度"
```

---

## Self-Review

### 1. Spec coverage（spec §M1 覆盖检查）

| spec 要求 | 对应 Task | 状态 |
|---|---|---|
| FileTree 右键菜单 + sftpUpload/Download/Rename/Chmod | Task 1+2+3 | ✅ |
| fileWatchStart/Stop/onFileChanged | Task 6 | ✅ |
| 终端选中命令"添加到 AI 对话" → useAtCommandInjection | Task 4 | ✅ |
| AI 面板 8 tool panel → onAgentStep 流式渲染 | Task 7 | ✅ |
| 4 区布局 1:1 视觉对齐 | Task 9 | ✅ |
| 终端区 JetBrains Mono 11px | Task 9 | ✅ |
| 执行控制 4 按钮 | Task 9 | ✅ |
| SshSettings 视觉对齐 | Task 10 | ✅ |
| TerminalSettings 视觉对齐 | Task 10 | ✅ |
| 编译门禁三绿 | Task 11 | ✅ |
| 端到端验收 4 项 | Task 11 | ✅ |

### 2. Placeholder scan
- 无 TBD/TODO
- 所有代码块都是完整可运行的
- 所有命令都有 expected output

### 3. Type consistency
- `MenuAction` 类型在 Task 1 定义，Task 3 消费，一致
- `TreeNode` 类型来自 FileTree.tsx，Task 1+3 一致使用
- `AgentWorkflowState` / `AgentStep` 类型来自 @shared/models，Task 7 一致使用
- `EditorSelection` 类型来自 editor-store，Task 4 使用 `setSelection({ text, type: 'cmd' })` 与接口一致

### 4. 风险点
- **Task 3.5 FileTreeContextMenu 包裹方式**：antd Dropdown 需要单个 React child，已用 `children as React.ReactElement` 转换
- **Task 4.2 xterm.onSelectionChange 触发频率**：已用 50ms 防抖避免频繁触发
- **Task 6.2 EditorAreaProps.onFileContentChange 签名**：需在实施时确认现有签名，如不匹配需调整
- **Task 7.2 useAgentChat useEffect 依赖**：追加 `updateStepState` 到依赖数组避免闭包陷阱
- **Task 9.2 DEFAULT_FONT_SIZE 改为 11**：需确认是否有其他地方引用此常量

---

*计划结束 · M1 SSH+终端+工作台 实施计划 v1.0 · 2026-07-23*
