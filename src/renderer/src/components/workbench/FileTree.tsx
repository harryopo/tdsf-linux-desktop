/**
 * FileTree — 工作台左侧资源管理器（真 SFTP + react-arborist 虚拟滚动）
 *
 * // @ai-session: ai-claude-20260720-wb3
 * // @ai-task: overnight-phase-A-sftp-tree
 *
 * 设计稿：workbench-ai.html 资源管理器 200px
 * 数据：useServerStore 会话 + window.electronAPI.sftpList 懒加载
 * 无会话：显示连接引导（不再用 MOCK_FILE_TREE）
 *
 * v0.9.7 升级：
 * - 使用 react-arborist 替换自定义树，支持虚拟滚动（万级目录不卡顿）
 * - 新增 SFTP 传输进度面板（监听 onSftpProgress）
 * - 上传/下载携带 transferId，支持进度关联
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  useContext,
  type FC,
} from 'react'
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
  Plug,
  FolderPlus,
  Trash2,
  PanelLeftClose,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { message } from 'antd'
import { Tree, type NodeApi, type TreeApi } from 'react-arborist'
import { cn } from '@/components/trae/utils'
import { useServerStore } from '@/stores/server-store'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type { SftpEntry, SftpProgressEvent } from '@shared/models'
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
  /** 折叠面板（v2.11：资源管理器可折叠，与 AI 面板对齐） */
  onCollapse?: () => void
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

/** 传输任务 */
interface TransferTask {
  transferId: string
  type: 'upload' | 'download'
  remotePath: string
  localPath: string
  transferred: number
  total: number
  status: 'running' | 'done' | 'error'
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

/** 递归更新树节点 */
function updateNode(nodes: TreeNode[], path: string, patch: Partial<TreeNode>): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === path) return { ...n, ...patch }
    if (n.children) {
      return { ...n, children: updateNode(n.children, path, patch) }
    }
    return n
  })
}

/** NodeRenderer 上下文 */
interface FileTreeRendererContextType {
  activeFilePath?: string
  onContextMenu: (node: TreeNode) => void
}

const FileTreeRendererContext = createContext<FileTreeRendererContextType | null>(null)

const FileTree: FC<FileTreeProps> = ({ activeFilePath, onOpenFile, onCollapse }) => {
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
  const [rootLoading, setRootLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 右键菜单目标节点（null = 空白处） */
  const [menuNode, setMenuNode] = useState<TreeNode | null>(null)
  /** chmod 对话框目标 */
  const [chmodTarget, setChmodTarget] = useState<TreeNode | null>(null)
  /** rename 对话框目标 */
  const [renameTarget, setRenameTarget] = useState<TreeNode | null>(null)
  /** 传输任务队列 */
  const [transfers, setTransfers] = useState<TransferTask[]>([])
  /** 上传用隐藏 input */
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  /** 上传目标目录路径 */
  const uploadTargetDirRef = useRef<string>('/')
  /** react-arborist Tree ref（用于通过 id 获取 NodeApi，触发手动 toggle） */
  const treeRef = useRef<TreeApi<TreeNode> | null>(null)

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

  /** 预取代数标记：rootPath/session 变化后作废旧的后台预取 */
  const prefetchGenRef = useRef(0)

  /** 后台预取一级子目录（限并发 4，失败静默），消除首次展开的等待 */
  const prefetchChildren = useCallback(
    async (children: TreeNode[]) => {
      const gen = ++prefetchGenRef.current
      const dirs = children.filter((c) => c.isDirectory).slice(0, 30)
      const CONCURRENCY = 4
      for (let i = 0; i < dirs.length; i += CONCURRENCY) {
        if (gen !== prefetchGenRef.current) return
        await Promise.all(
          dirs.slice(i, i + CONCURRENCY).map(async (d) => {
            try {
              const kids = await loadDir(d.path)
              if (gen !== prefetchGenRef.current) return
              setNodes((prev) => updateNode(prev, d.path, { children: kids, loaded: true }))
            } catch {
              // 预取失败静默，用户实际点击时会重试并显示错误
            }
          }),
        )
      }
    },
    [loadDir],
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
      void prefetchChildren(children)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setNodes([])
    } finally {
      setRootLoading(false)
    }
  }, [connected, sessionId, rootPath, loadDir, prefetchChildren])

  useEffect(() => {
    void loadRoot()
  }, [loadRoot])

  /** 监听 SFTP 进度推送 */
  useEffect(() => {
    if (!isElectronAPIAvailable() || !window.electronAPI.onSftpProgress) return
    const off = window.electronAPI.onSftpProgress((event: SftpProgressEvent) => {
      setTransfers((prev) => {
        const exists = prev.find((t) => t.transferId === event.transferId)
        if (!exists) {
          return [
            ...prev,
            {
              transferId: event.transferId,
              type: event.type,
              remotePath: event.remotePath,
              localPath: event.localPath,
              transferred: event.transferred,
              total: event.total,
              status: 'running',
            },
          ]
        }
        return prev.map((t) =>
          t.transferId === event.transferId
            ? { ...t, transferred: event.transferred, total: event.total }
            : t,
        )
      })
    })
    return off
  }, [])

  /** 自动清理已完成任务 */
  useEffect(() => {
    const doneTasks = transfers.filter((t) => t.status === 'done' || t.status === 'error')
    if (doneTasks.length === 0) return
    const timer = setTimeout(() => {
      setTransfers((prev) => prev.filter((t) => t.status !== 'done' && t.status !== 'error'))
    }, 3000)
    return () => clearTimeout(timer)
  }, [transfers])

  /** 展开/折叠目录 + 懒加载子节点 */
  const handleToggle = useCallback(
    async (nodeApi: NodeApi<TreeNode>) => {
      const node = nodeApi.data
      if (!node.isDirectory) return

      // onToggle 触发时 react-arborist 已更新 isOpen（此时展开=true），
      // 不能用 !isOpen 判断"即将展开"——否则首次点击不加载、需点两次。
      // 只要未加载过就拉取子目录（折叠时预取也无害）。
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

  /** 激活节点：文件打开，目录展开 */
  const handleActivate = useCallback(
    (nodeApi: NodeApi<TreeNode>) => {
      const node = nodeApi.data
      if (node.isDirectory) {
        nodeApi.toggle()
        return
      }
      onOpenFile?.({ path: node.path, name: node.name })
    },
    [onOpenFile],
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

  /** 生成唯一 transferId */
  const nextTransferId = useCallback((): string => {
    return `xfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }, [])

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

      // download：调用 sftpDownload（带 transferId + 进度）
      if (action === 'download') {
        if (!node) return
        const localPath = window.prompt(
          `保存到本地路径（Windows 路径）`,
          `D:\\downloads\\${node.name}`,
        )
        if (!localPath?.trim()) return
        const transferId = nextTransferId()
        try {
          setTransfers((prev) => [
            ...prev,
            {
              transferId,
              type: 'download',
              remotePath: node.path,
              localPath: localPath.trim(),
              transferred: 0,
              total: 0,
              status: 'running',
            },
          ])
          await api.sftpDownload(sessionId, node.path, localPath.trim(), transferId)
          setTransfers((prev) =>
            prev.map((t) => (t.transferId === transferId ? { ...t, status: 'done' } : t)),
          )
          message.success(`下载完成: ${localPath}`)
        } catch (err) {
          setTransfers((prev) =>
            prev.map((t) => (t.transferId === transferId ? { ...t, status: 'error' } : t)),
          )
          message.error(`下载失败: ${err instanceof Error ? err.message : String(err)}`)
        }
        return
      }
    },
    [sessionId, connected, rootPath, loadRoot, nextTransferId],
  )

  /** 处理隐藏 input 选择文件后上传（带 transferId + 进度） */
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
      const transferId = nextTransferId()
      try {
        setTransfers((prev) => [
          ...prev,
          {
            transferId,
            type: 'upload',
            remotePath,
            localPath: (file as File & { path?: string }).path ?? file.name,
            transferred: 0,
            total: file.size,
            status: 'running',
          },
        ])
        const localPath = (file as File & { path?: string }).path ?? ''
        if (!localPath) {
          message.error('无法获取本地文件路径')
          return
        }
        await api.sftpUpload(sessionId, localPath, remotePath, transferId)
        setTransfers((prev) =>
          prev.map((t) => (t.transferId === transferId ? { ...t, status: 'done' } : t)),
        )
        message.success(`上传完成: ${remotePath}`)
        await loadRoot()
      } catch (err) {
        setTransfers((prev) =>
          prev.map((t) => (t.transferId === transferId ? { ...t, status: 'error' } : t)),
        )
        message.error(`上传失败: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        if (uploadInputRef.current) uploadInputRef.current.value = ''
      }
    },
    [sessionId, loadRoot, nextTransferId],
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

  const rendererContext = useMemo(
    () => ({
      activeFilePath,
      onContextMenu: setMenuNode,
    }),
    [activeFilePath],
  )

  /**
   * 树容器可用高度（v2.4 修复：不再写死 400px）
   *
   * react-arborist 的 Tree 要求显式像素高度；写死 400 与容器实际高度脱节，
   * 导致面板高于 400 时列表截断+下方空白、低于 400 时双层滚动。
   * 用 ResizeObserver 测量 .wb-filetree-scroll 实际高度，减去服务器信息头+内边距。
   */
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [treeHeight, setTreeHeight] = useState(400)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      // 减去服务器信息头（~28px）+ 容器上下内边距（~12px），最小 120
      setTreeHeight(Math.max(120, el.clientHeight - 40))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [connected])

  return (
    <FileTreeRendererContext.Provider value={rendererContext}>
      <div className="wb-filetree">
        <div className="wb-filetree-header">
          <span className="wb-filetree-title">资源管理器</span>
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
            {/* v2.11：折叠资源管理器（与 AI 面板可折叠对齐，释放水平空间） */}
            {onCollapse && (
              <button
                type="button"
                title="折叠资源管理器"
                onClick={onCollapse}
                className="wb-filetree-action-btn"
              >
                <PanelLeftClose className="size-3.5" />
              </button>
            )}
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

        <div className="wb-filetree-scroll" ref={scrollRef}>
          <FileTreeContextMenu
            node={menuNode}
            rootPath={rootPath}
            onAction={handleMenuAction}
          >
            <div
              className="h-full"
              onContextMenu={(e) => {
                if (e.target === e.currentTarget) setMenuNode(null)
              }}
            >
              {!connected ? (
                <div className="wb-filetree-empty">
                  <div className="wb-filetree-server-head">
                    <span className="text-[11px] font-semibold tracking-[0.08em] text-[var(--trae-text-tertiary)]">
                      服务器
                    </span>
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
                    <span
                      className="wb-filetree-status-dot"
                      style={{ background: 'var(--trae-status-success-default)' }}
                    />
                  </div>

                  {error && <div className="wb-filetree-error">{error}</div>}

                  {rootLoading && nodes.length === 0 ? (
                    <div className="wb-filetree-loading">
                      <Loader2 className="size-4 animate-spin" />
                      加载目录…
                    </div>
                  ) : (
                    <Tree
                      ref={treeRef}
                      data={nodes}
                      width="100%"
                      height={treeHeight}
                      rowHeight={24}
                      indent={14}
                      paddingTop={4}
                      paddingBottom={4}
                      onToggle={(id) => {
                        const nodeApi = treeRef.current?.get(id)
                        if (nodeApi) void handleToggle(nodeApi)
                      }}
                      onActivate={(nodeApi) => handleActivate(nodeApi)}
                      openByDefault={false}
                      selection={activeFilePath}
                    >
                      {ArboristNodeRow}
                    </Tree>
                  )}
                </>
              )}
            </div>
          </FileTreeContextMenu>
        </div>

        {/* SFTP 传输进度面板 */}
        {transfers.length > 0 && (
          <div className="wb-filetree-transfer-panel">
            <div className="wb-filetree-transfer-header">
              <span className="wb-filetree-transfer-title">传输</span>
              <button
                type="button"
                className="wb-filetree-transfer-clear"
                onClick={() => setTransfers([])}
                title="清空"
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="wb-filetree-transfer-list">
              {transfers.slice(0, 5).map((t) => (
                <div key={t.transferId} className="wb-filetree-transfer-item">
                  <div className="wb-filetree-transfer-info">
                    <span className="wb-filetree-transfer-name">
                      {t.type === 'upload' ? '↑' : '↓'} {t.remotePath.split('/').pop()}
                    </span>
                    <span className="wb-filetree-transfer-size">
                      {formatBytes(t.transferred)} / {formatBytes(t.total)}
                    </span>
                  </div>
                  <div className="wb-filetree-transfer-bar">
                    <div
                      className={cn(
                        'wb-filetree-transfer-fill',
                        t.status === 'error' && 'is-error',
                        t.status === 'done' && 'is-done',
                      )}
                      style={{
                        width: `${t.total > 0 ? Math.min(100, (t.transferred / t.total) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
    </FileTreeRendererContext.Provider>
  )
}

/** react-arborist 节点渲染器 */
function ArboristNodeRow({
  node,
  style,
  dragHandle,
}: {
  node: NodeApi<TreeNode>
  style: React.CSSProperties
  dragHandle?: (el: HTMLDivElement | null) => void
}) {
  const ctx = useContext(FileTreeRendererContext)
  if (!ctx) return null

  const data = node.data
  const isOpen = node.isOpen
  const isActive = !data.isDirectory && ctx.activeFilePath === data.path
  const isLoading = data.loading

  return (
    <div
      ref={dragHandle}
      style={style}
      role="treeitem"
      aria-expanded={data.isDirectory ? isOpen : undefined}
      aria-selected={isActive}
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation()
        node.activate()
      }}
      onContextMenu={(e) => {
        e.stopPropagation()
        ctx.onContextMenu(data)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          node.activate()
        }
      }}
      className={cn('wb-ft-row', isActive && 'is-active')}
    >
      {data.isDirectory ? (
        <span className="wb-ft-chev" onClick={(e) => { e.stopPropagation(); node.toggle() }}>
          {isLoading ? (
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

      {data.isDirectory ? (
        isOpen ? (
          <FolderOpen className="size-3.5 shrink-0 text-[var(--trae-accent-blue)]" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-[var(--trae-accent-blue)]" />
        )
      ) : data.name.endsWith('.log') || data.name.endsWith('.conf') ? (
        <FileText className="size-3.5 shrink-0 text-[var(--trae-text-secondary)]" />
      ) : (
        <File className="size-3.5 shrink-0 text-[var(--trae-text-secondary)]" />
      )}

      <span className="wb-ft-label">{data.name}</span>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

export default FileTree
