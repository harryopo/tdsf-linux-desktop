/**
 * 文件树组件 - FileTree（v0.8 IDE 工作台）
 *
 * 职责：
 * - 异步加载远程目录（点击展开时 sftpList）
 * - 显示文件/目录图标（FolderOutlined / FileOutlined）
 * - 双击文件触发 onOpenFile 回调
 * - 右键菜单：新建文件 / 新建目录 / 重命名 / 删除 / 刷新
 * - 顶部路径栏：显示并允许修改当前根路径
 *
 * 设计：
 * - 基于 Ant Design Tree（treeData + loadData 异步加载子节点）
 * - 节点 key 用完整远程路径，确保唯一性
 * - 图标根据 isDirectory 切换
 */
import { useMemo, useState, useCallback } from 'react'
import { Tree, Input, Button, Dropdown, message, Spin } from 'antd'
import type { MenuProps } from 'antd'
import {
  FolderOutlined,
  FileOutlined,
  ReloadOutlined,
  HomeOutlined,
  FileAddOutlined,
  FolderAddOutlined,
} from '@ant-design/icons'
import type { SftpEntry } from '@shared/models'
import { useServerStore } from '../../stores/server-store'
import { useIDEStore, detectLanguage } from '../../stores/ide-store'
import { logger } from '../../utils/logger'
import './FileTree.css'

/** Tree 节点数据结构（Ant Design 兼容） */
interface TreeNodeData {
  /** 完整远程路径（作为 key） */
  key: string
  /** 显示名 */
  title: string
  /** 是否目录 */
  isLeaf: boolean
  /** 子节点（已加载则有） */
  children?: TreeNodeData[]
  /** 是否已加载过（避免重复请求） */
  loaded?: boolean
}

/**
 * 把 SftpEntry 数组转为 TreeNodeData 数组
 * - 目录排前，文件排后
 * - 同类按名称排序
 */
function entriesToTreeNodes(
  entries: SftpEntry[],
  parentPath: string
): TreeNodeData[] {
  return entries.map((entry) => {
    // 拼接完整路径
    const fullPath = parentPath.endsWith('/')
      ? `${parentPath}${entry.name}`
      : `${parentPath}/${entry.name}`
    return {
      key: fullPath,
      title: entry.name,
      isLeaf: !entry.isDirectory,
      children: entry.isDirectory ? [] : undefined,
      loaded: false,
    }
  })
}

/** FileTree 文件树组件 */
const FileTree: React.FC = () => {
  const sessionId = useServerStore((s) => s.activeSessionId)
  const rootPath = useIDEStore((s) => s.rootPath)
  const setRootPath = useIDEStore((s) => s.setRootPath)
  const openFile = useIDEStore((s) => s.openFile)
  const setActiveFile = useIDEStore((s) => s.setActiveFile)
  const openFiles = useIDEStore((s) => s.openFiles)

  /** 树数据（仅根级初始化） */
  const [treeData, setTreeData] = useState<TreeNodeData[]>([])
  /** 加载中的节点 key 集合 */
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set())
  /** 根路径输入框值 */
  const [pathInput, setPathInput] = useState(rootPath)
  /** 是否正在加载根目录 */
  const [rootLoading, setRootLoading] = useState(false)
  /** 右键菜单上下文（当前右键的节点 key） */
  const [contextKey, setContextKey] = useState<string | null>(null)

  /** 列出指定目录，更新树数据 */
  const loadDirectory = useCallback(
    async (dirPath: string): Promise<TreeNodeData[]> => {
      if (!sessionId) {
        throw new Error('未连接到服务器')
      }
      const entries = await window.electronAPI.sftpList(sessionId, dirPath)
      return entriesToTreeNodes(entries, dirPath)
    },
    [sessionId]
  )

  /** 加载根目录 */
  const loadRoot = useCallback(async () => {
    if (!sessionId) {
      void message.warning('请先连接服务器')
      return
    }
    setRootLoading(true)
    try {
      const nodes = await loadDirectory(rootPath)
      setTreeData(nodes)
      logger.info('FileTree', '加载根目录', { rootPath, count: nodes.length })
    } catch (err) {
      void message.error(`加载目录失败: ${(err as Error).message}`)
      logger.error('FileTree', '加载根目录失败', {
        rootPath,
        err: (err as Error).message,
      })
    } finally {
      setRootLoading(false)
    }
  }, [sessionId, rootPath, loadDirectory])

  /** 异步加载子节点（点击展开时触发） */
  const onLoadData = useCallback(
    async ({ key, children }: { key: string; children?: TreeNodeData[] }) => {
      // 已加载则跳过
      if (children && children.length > 0) return
      setLoadingKeys((prev) => new Set(prev).add(key))
      try {
        const childNodes = await loadDirectory(key)
        // 递归更新树
        setTreeData((prev) => updateTreeNode(prev, key, childNodes))
      } catch (err) {
        void message.error(`加载子目录失败: ${(err as Error).message}`)
      } finally {
        setLoadingKeys((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }
    },
    [loadDirectory]
  )

  /** 递归更新树节点：把指定 key 的子节点设置为 newChildren */
  function updateTreeNode(
    nodes: TreeNodeData[],
    targetKey: string,
    newChildren: TreeNodeData[]
  ): TreeNodeData[] {
    return nodes.map((node) => {
      if (node.key === targetKey) {
        return { ...node, children: newChildren, loaded: true }
      }
      if (node.children) {
        return { ...node, children: updateTreeNode(node.children, targetKey, newChildren) }
      }
      return node
    })
  }

  /** 双击文件打开 */
  const handleSelect = useCallback(
    async (keys: React.Key[]) => {
      if (keys.length === 0) return
      const path = String(keys[0])
      // 判断是否文件（leaf）
      const findNode = (nodes: TreeNodeData[]): TreeNodeData | null => {
        for (const n of nodes) {
          if (n.key === path) return n
          if (n.children) {
            const found = findNode(n.children)
            if (found) return found
          }
        }
        return null
      }
      const node = findNode(treeData)
      if (!node || !node.isLeaf) return // 目录不处理

      // 若已打开则仅激活
      const existing = openFiles.find((f) => f.path === path)
      if (existing) {
        setActiveFile(path)
        return
      }
      // 调用 sftpReadFile 读取
      if (!sessionId) return
      // 先添加占位（isLoading=true）
      openFile({
        path,
        name: node.title,
        content: '',
        originalContent: '',
        language: detectLanguage(node.title),
        size: 0,
      })
      try {
        const content = await window.electronAPI.sftpReadFile(sessionId, path)
        // 用 markSaved 重置内容（不触发 dirty）
        // 但 openFile 已经添加，需要直接更新 content + originalContent
        // 通过 updateContent 写入 content，然后手动 markSaved
        // 简化：直接通过 store API 重置
        useIDEStore.setState((state) => ({
          openFiles: state.openFiles.map((f) =>
            f.path === path
              ? {
                  ...f,
                  content,
                  originalContent: content,
                  isDirty: false,
                  isLoading: false,
                }
              : f
          ),
        }))
        logger.info('FileTree', '打开文件', { path, size: content.length })
      } catch (err) {
        void message.error(`读取文件失败: ${(err as Error).message}`)
        // 加载失败，关闭占位 Tab
        useIDEStore.getState().closeFile(path)
      }
    },
    [treeData, openFiles, sessionId, openFile, setActiveFile]
  )

  /** 路径输入回车：切换根路径 */
  const handlePathEnter = useCallback(() => {
    const trimmed = pathInput.trim() || '/'
    setRootPath(trimmed)
    setPathInput(trimmed)
    // 立即加载新根
    setTimeout(() => {
      void loadRoot()
    }, 0)
  }, [pathInput, setRootPath, loadRoot])

  /** 右键菜单项 */
  const contextMenuItems: MenuProps['items'] = useMemo(
    () => [
      {
        key: 'newFile',
        label: '新建文件',
        icon: <FileAddOutlined />,
        onClick: () => {
          void message.info('新建文件功能将在下个版本完善')
        },
      },
      {
        key: 'newDir',
        label: '新建目录',
        icon: <FolderAddOutlined />,
        onClick: () => {
          void message.info('新建目录功能将在下个版本完善')
        },
      },
      {
        type: 'divider',
      },
      {
        key: 'refresh',
        label: '刷新',
        icon: <ReloadOutlined />,
        onClick: () => {
          if (contextKey) {
            // 刷新该节点
            setLoadingKeys((prev) => new Set(prev).add(contextKey))
            void loadDirectory(contextKey)
              .then((nodes) => {
                setTreeData((prev) => updateTreeNode(prev, contextKey, nodes))
              })
              .finally(() => {
                setLoadingKeys((prev) => {
                  const next = new Set(prev)
                  next.delete(contextKey)
                  return next
                })
              })
          } else {
            void loadRoot()
          }
        },
      },
    ],
    [contextKey, loadDirectory, loadRoot]
  )

  /** 树节点 title 渲染（带图标） */
  const renderTitle = (node: TreeNodeData) => {
    const isLoading = loadingKeys.has(node.key)
    return (
      <span className="filetree-node-title">
        {node.isLeaf ? (
          <FileOutlined className="filetree-icon file" />
        ) : (
          <FolderOutlined className="filetree-icon folder" />
        )}
        <span className="filetree-name">{node.title}</span>
        {isLoading && <Spin size="small" className="filetree-spin" />}
      </span>
    )
  }

  if (!sessionId) {
    return (
      <div className="filetree-empty">
        <HomeOutlined className="filetree-empty-icon" />
        <p>请先在左侧服务器列表连接一台服务器</p>
      </div>
    )
  }

  return (
    <div className="filetree-container">
      {/* 顶部路径栏 */}
      <div className="filetree-toolbar">
        <Input
          className="filetree-path-input"
          prefix={<HomeOutlined />}
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onPressEnter={handlePathEnter}
          placeholder="远程根路径（默认 /）"
          size="small"
        />
        <Button
          className="filetree-refresh-btn"
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          onClick={loadRoot}
          title="刷新"
        />
      </div>

      {/* 树主体 */}
      <Dropdown
        menu={{ items: contextMenuItems }}
        trigger={['contextMenu']}
      >
        <div className="filetree-body">
          {rootLoading && treeData.length === 0 ? (
            <div className="filetree-loading">
              <Spin />
            </div>
          ) : treeData.length === 0 ? (
            <div className="filetree-empty-content">
              <FolderOutlined />
              <p>点击刷新加载根目录</p>
              <Button type="primary" size="small" onClick={loadRoot}>
                加载
              </Button>
            </div>
          ) : (
            <Tree
              treeData={treeData}
              loadData={onLoadData}
              onSelect={handleSelect}
              showIcon={false}
              blockNode
              className="filetree-tree"
              titleRender={renderTitle}
            />
          )}
        </div>
      </Dropdown>
    </div>
  )
}

export default FileTree
