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
import { useCallback, useEffect, useMemo, useState, type FC } from 'react'
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Server,
  Folder,
  FolderOpen,
  FileText,
  File,
  Loader2,
  Link2,
  FolderPlus,
  Trash2,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { message } from 'antd'
import { cn } from '@/components/trae/utils'
import { useServerStore } from '@/stores/server-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type { SftpEntry } from '@shared/models'

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

interface TreeNode {
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

  return (
    <div className="wb-filetree flex w-[200px] shrink-0 flex-col border-r border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]">
      {/* 标题栏 */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--trae-border-neutral-l1)] px-2">
        <span className="pl-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--trae-text-secondary)]">
          资源管理器
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="新建目录"
            onClick={() => void handleMkdir()}
            disabled={!connected}
            className="flex size-8 items-center justify-center rounded-[var(--trae-radius-4)] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)] disabled:opacity-40"
          >
            <FolderPlus className="size-3.5" />
          </button>
          <button
            type="button"
            title={activeFilePath ? `删除 ${activeFilePath}` : '删除路径'}
            onClick={() => void handleDelete()}
            disabled={!connected}
            className="flex size-8 items-center justify-center rounded-[var(--trae-radius-4)] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-status-error-surface-l1)] hover:text-[var(--trae-status-error-default)] disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
          </button>
          <button
            type="button"
            title="刷新"
            onClick={() => void loadRoot()}
            disabled={!connected || rootLoading}
            className="flex size-8 items-center justify-center rounded-[var(--trae-radius-4)] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)] disabled:opacity-40"
          >
            {rootLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* 根路径 */}
      {connected && (
        <div className="flex items-center gap-1 border-b border-[var(--trae-border-neutral-l1)] px-2 py-1.5">
          <input
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value || '/')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void loadRoot()
            }}
            className="h-7 min-w-0 flex-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-2 font-mono text-[11px] text-[var(--trae-text-default)] outline-none focus:border-[var(--trae-bg-brand)]"
            spellCheck={false}
          />
        </div>
      )}

      <div role="tree" className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {!connected ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <Link2 className="size-6 text-[var(--trae-text-tertiary)]" />
            <div className="text-[12px] leading-5 text-[var(--trae-text-secondary)]">
              尚未连接 SSH
              <br />
              连接后将列出远程目录
            </div>
            <button
              type="button"
              onClick={() => navigate('/settings/ssh')}
              className="inline-flex h-8 items-center rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-brand)] px-3 text-[12px] font-medium text-[var(--trae-text-onbrand)] hover:bg-[var(--trae-bg-brand-hover)]"
            >
              去连接服务器
            </button>
          </div>
        ) : (
          <>
            {/* 服务器头 */}
            <div className="mb-1 flex items-center gap-2 px-3 py-1.5 text-[12px]">
              <Server className="size-3.5 text-[var(--trae-text-brand)]" />
              <span className="truncate font-medium text-[var(--trae-text-default)]">
                {activeServer?.name || activeServer?.host || 'server'}
              </span>
              <span className="size-1.5 shrink-0 rounded-full bg-[var(--trae-status-success-default)]" />
            </div>

            {error && (
              <div className="mx-2 mb-2 rounded-[var(--trae-radius-4)] border border-[var(--trae-status-error-surface-l2)] bg-[var(--trae-status-error-surface-l1)] px-2 py-1.5 text-[11px] text-[var(--trae-status-error-default)]">
                {error}
              </div>
            )}

            {rootLoading && nodes.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-[var(--trae-text-tertiary)]">
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
                />
              ))
            )}
          </>
        )}
      </div>
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
}

const NodeRow: FC<NodeRowProps> = ({
  node,
  depth,
  expanded,
  activeFilePath,
  onToggle,
  onOpen,
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
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(node)
          }
        }}
        style={{ paddingLeft: pad }}
        className={cn(
          'flex h-7 cursor-pointer items-center gap-1.5 pr-2 text-[12px] transition-colors',
          isActive
            ? 'bg-[var(--trae-bg-overlay-l3)] text-[var(--trae-text-default)]'
            : 'text-[var(--trae-text-default)] hover:bg-[var(--trae-bg-overlay-l2)]',
        )}
      >
        {node.isDirectory ? (
          <span className="flex size-4 shrink-0 items-center justify-center text-[var(--trae-text-tertiary)]">
            {node.loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : isOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </span>
        ) : (
          <span className="size-4 shrink-0" />
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

        <span className="min-w-0 flex-1 truncate">{node.name}</span>
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
            />
          ))}
        </div>
      )}

      {node.isDirectory && isOpen && node.loaded && (node.children?.length ?? 0) === 0 && (
        <div
          className="text-[11px] text-[var(--trae-text-tertiary)]"
          style={{ paddingLeft: pad + 28 }}
        >
          （空目录）
        </div>
      )}
    </>
  )
}

export default FileTree
