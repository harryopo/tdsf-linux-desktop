/**
 * FileTree — 工作台左侧资源管理器（真 SFTP）
 *
 * // @ai-session: ai-claude-20260720-wb3
 * // @ai-task: overnight-phase-A-sftp-tree
 *
 * 设计稿：workbench-ai.html 资源管理器 200px
 * 数据：useServerStore 会话 + window.electronAPI.sftpList 懒加载
 * 无会话：显示连接引导（不再用 MOCK_FILE_TREE）
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Server,
  Folder,
  FolderOpen,
  FolderX,
  FileText,
  File,
  Loader2,
  Plug,
  FolderPlus,
  Trash2,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { message } from 'antd'
import { cn } from '@/components/trae/utils'
import { useServerStore } from '@/stores/server-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type { SftpEntry } from '@shared/models'
import FileTreeContextMenu, { type MenuAction } from './FileTreeContextMenu'
import ChmodDialog from './ChmodDialog'
import RenameDialog from './RenameDialog'

export interface OpenFileRequest {
  /** 远程绝对路径 */
  path: string
  /** 显示名 */
  name: string
}

export interface FileTreeProps {
  /** 当前打开的远程路径（高亮） */
  activeFilePath?: string
  /** 打开文件 */
  onOpenFile?: (file: OpenFileRequest) => void
}

export interface TreeNode {
  id: string
  name: string
  path: string
  isDirectory: boolean
  children?: TreeNode[]
  loaded?: boolean
  loading?: boolean
}

function joinPath(parent: string, name: string): string {
  if (parent === '/') return `/${name}`
  return parent.endsWith('/') ? `${parent}${name}` : `${parent}/${name}`
}

function sortEntries(entries: SftpEntry[]): SftpEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function entriesToNodes(entries: SftpEntry[], parentPath: string): TreeNode[] {
  return sortEntries(entries).map((e) => {
    const path = joinPath(parentPath, e.name)
    return {
      id: path,
      name: e.name,
      path,
      isDirectory: e.isDirectory,
      children: e.isDirectory ? [] : undefined,
      loaded: false,
    }
  })
}

function updateNode(
  nodes: TreeNode[],
  path: string,
  patch: Partial<TreeNode>,
): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === path) return { ...n, ...patch }
    if (n.children) {
      return { ...n, children: updateNode(n.children, path, patch) }
    }
    return n
  })
}

const FileTree: FC<FileTreeProps> = ({ activeFilePath, onOpenFile }) => {
  const navigate = useNavigate()
  const servers = useServerStore((s) => s.servers)
  const activeSessionId = useServerStore((s) => s.activeSessionId)
  const sessionMap = useServerStore((s) => s.sessionMap)
  const connectionStates = useServerStore((s) => s.connectionStates)

  const activeServer = useMemo(() => {
    if (activeSessionId) {
      const entry = Object.entries(sessionMap).find(([, sid]) => sid === activeSessionId)
      if (entry) {
        const found = servers.find((s) => s.id === entry[0])
        if (found) return found
      }
    }
    return servers.find((s) => connectionStates[s.id] === 'connected') ?? null
  }, [activeSessionId, sessionMap, servers, connectionStates])

  const sessionId = activeSessionId
  const connected = Boolean(sessionId && activeServer)

  const [rootPath, setRootPath] = useState('/')
  const [nodes, setNodes] = useState<TreeNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [rootLoading, setRootLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  const loadDir = useCallback(
    async (dirPath: string): Promise<TreeNode[]> => {
      if (!sessionId || !isElectronAPIAvailable() || !window.electronAPI.sftpList) {
        throw new Error('SFTP 不可用：请先连接服务器')
      }
      const entries = await window.electronAPI.sftpList(sessionId, dirPath)
      return entriesToNodes(entries, dirPath)
    },
    [sessionId],
  )

  const loadRoot = useCallback(async () => {
    if (!connected || !sessionId) {
      setNodes([])
      setError(null)
      return
    }
    setRootLoading(true)
    setError(null)
    try {
      const children = await loadDir(rootPath)
      setNodes(children)
      setExpanded(new Set([rootPath]))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setNodes([])
    } finally {
      setRootLoading(false)
    }
  }, [connected, sessionId, rootPath, loadDir])

  useEffect(() => {
    void loadRoot()
  }, [loadRoot])

  const toggleDir = useCallback(
    async (node: TreeNode) => {
      if (!node.isDirectory) return

      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(node.path)) next.delete(node.path)
        else next.add(node.path)
        return next
      })

      // 折叠不卸载；展开时若未加载则拉子目录
      if (!node.loaded && !node.loading) {
        setNodes((prev) => updateNode(prev, node.path, { loading: true }))
        try {
          const children = await loadDir(node.path)
          setNodes((prev) =>
            updateNode(prev, node.path, {
              children,
              loaded: true,
              loading: false,
            }),
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          setError(msg)
          setNodes((prev) => updateNode(prev, node.path, { loading: false }))
        }
      }
    },
    [loadDir],
  )

  const handleFileClick = useCallback(
    (node: TreeNode) => {
      if (node.isDirectory) {
        void toggleDir(node)
        return
      }
      onOpenFile?.({ path: node.path, name: node.name })
    },
    [onOpenFile, toggleDir],
  )

  /** 在当前根路径新建目录 */
  const handleMkdir = useCallback(async () => {
    if (!sessionId || !connected) {
      message.warning('请先连接 SSH')
      return
    }
    if (!isElectronAPIAvailable() || !window.electronAPI.sftpMkdir) {
      message.error('sftpMkdir 不可用')
      return
    }
    const name = window.prompt('新建目录名称', 'new-folder')
    if (!name || !name.trim()) return
    const safe = name.trim().replace(/[\\/]/g, '_')
    const full = joinPath(rootPath, safe)
    try {
      await window.electronAPI.sftpMkdir(sessionId, full)
      message.success(`已创建 ${full}`)
      await loadRoot()
    } catch (err) {
      message.error(`创建失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [sessionId, connected, rootPath, loadRoot])

  /** 删除选中路径（当前高亮文件，或提示输入） */
  const handleDelete = useCallback(async () => {
    if (!sessionId || !connected) {
      message.warning('请先连接 SSH')
      return
    }
    if (!isElectronAPIAvailable() || !window.electronAPI.sftpDelete) {
      message.error('sftpDelete 不可用')
      return
    }
    const target =
      activeFilePath ||
      window.prompt('输入要删除的远程路径（文件或空目录）', rootPath === '/' ? '' : rootPath)
    if (!target || !target.trim()) return
    const path = target.trim()
    if (path === '/' || path === '.' || path === '..') {
      message.error('禁止删除根路径')
      return
    }
    if (!window.confirm(`确认删除远程路径？\n${path}`)) return
    try {
      await window.electronAPI.sftpDelete(sessionId, path)
      message.success(`已删除 ${path}`)
      await loadRoot()
    } catch (err) {
      message.error(`删除失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [sessionId, connected, activeFilePath, rootPath, loadRoot])

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
      // sftpChmod 签名：(sessionId, remotePath, mode: number)
      // 对话框返回 3 位八进制字符串，需解析为十进制数字（如 '755' → 0o755 = 493）
      const modeNum = parseInt(mode, 8)
      if (Number.isNaN(modeNum)) {
        message.error('权限格式无效')
        return
      }
      try {
        await api.sftpChmod(sessionId, chmodTarget.path, modeNum)
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

  return (
    <div className="wb-filetree">
      <div className="wb-filetree-header">
        <span className="wb-filetree-title">
          资源管理器
        </span>
        <div className="wb-filetree-actions">
          <button
            type="button"
            title="新建目录"
            onClick={() => void handleMkdir()}
            disabled={!connected}
            className="wb-filetree-action-btn"
          >
            <FolderPlus className="size-3.5" />
          </button>
          <button
            type="button"
            title={activeFilePath ? `删除 ${activeFilePath}` : '删除路径'}
            onClick={() => void handleDelete()}
            disabled={!connected}
            className="wb-filetree-action-btn is-danger"
          >
            <Trash2 className="size-3.5" />
          </button>
          <button
            type="button"
            title="刷新"
            onClick={() => void loadRoot()}
            disabled={!connected || rootLoading}
            className="wb-filetree-action-btn"
          >
            {rootLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </button>
        </div>
      </div>

      {connected && (
        <div className="wb-filetree-root-input-wrap">
          <input
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value || '/')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void loadRoot()
            }}
            className="wb-filetree-root-input"
            spellCheck={false}
          />
        </div>
      )}

      <div role="tree" className="wb-filetree-scroll">
        <FileTreeContextMenu
          node={menuNode}
          rootPath={rootPath}
          onAction={handleMenuAction}
        >
          <div
            onContextMenu={(e) => {
              // 空白处右键：清除节点选中
              if (e.target === e.currentTarget) setMenuNode(null)
            }}
          >
            {!connected ? (
              // 设计稿空状态(workbench-ai.html 第 2604-2613 行):
              // "服务器" header + plug图标 + "未连接服务器" + "连接"按钮(plug图标)
              <div className="wb-filetree-empty">
                <div className="wb-filetree-server-head">
                  <span className="text-[11px] font-semibold tracking-[0.08em] text-[var(--trae-text-tertiary)]">服务器</span>
                </div>
                <div className="wb-filetree-empty-state">
                  <Plug className="size-5 text-[var(--trae-icon-tertiary)]" />
                  <div className="wb-filetree-empty-text">
                    尚未连接
                    <br />
                    SSH服务器
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/settings/ssh')}
                    className="wb-filetree-empty-btn"
                    data-dom-id="connect-ssh"
                  >
                    <Plug className="size-3" />
                    连接
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="wb-filetree-server-head">
                  <Server className="size-3.5 text-[var(--trae-text-brand)]" />
                  <span className="wb-filetree-server-name">
                    {activeServer?.name || activeServer?.host || 'server'}
                  </span>
                  <span className="wb-filetree-status-dot" style={{ background: 'var(--trae-status-success-default)' }} />
                </div>

                {error && (
                  <div className="wb-filetree-error">
                    {error}
                  </div>
                )}

                {rootLoading && nodes.length === 0 ? (
                  <div className="wb-filetree-loading">
                    <Loader2 className="size-4 animate-spin" />
                    加载目录…
                  </div>
                ) : (
                  nodes.map((node) => (
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
                  ))
                )}
              </>
            )}
          </div>
        </FileTreeContextMenu>
      </div>

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
    </div>
  )
}

interface NodeRowProps {
  node: TreeNode
  depth: number
  expanded: Set<string>
  activeFilePath?: string
  onToggle: (node: TreeNode) => void
  onOpen: (node: TreeNode) => void
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void
}

const NodeRow: FC<NodeRowProps> = ({
  node,
  depth,
  expanded,
  activeFilePath,
  onToggle,
  onOpen,
  onContextMenu,
}) => {
  const isOpen = expanded.has(node.path)
  const isActive = !node.isDirectory && activeFilePath === node.path
  const pad = 10 + depth * 14

  return (
    <>
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
        {node.isDirectory ? (
          <span className="wb-ft-chev">
            {node.loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : isOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </span>
        ) : (
          <span className="wb-ft-ic" />
        )}

        {node.isDirectory ? (
          isOpen ? (
            <FolderOpen className="size-3.5 shrink-0 text-[var(--trae-accent-blue)]" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-[var(--trae-accent-blue)]" />
          )
        ) : node.name.endsWith('.log') || node.name.endsWith('.conf') ? (
          <FileText className="size-3.5 shrink-0 text-[var(--trae-text-secondary)]" />
        ) : (
          <File className="size-3.5 shrink-0 text-[var(--trae-text-secondary)]" />
        )}

        <span className="wb-ft-label">{node.name}</span>
      </div>

      {node.isDirectory && isOpen && node.children && node.children.length > 0 && (
        <div role="group">
          {node.children.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              activeFilePath={activeFilePath}
              onToggle={onToggle}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}

      {node.isDirectory && isOpen && node.loaded && (node.children?.length ?? 0) === 0 && (
        <div
          className="wb-ft-empty-dir"
          style={{ paddingLeft: pad + 28 }}
        >
          （空目录）
        </div>
      )}
    </>
  )
}

export default FileTree
