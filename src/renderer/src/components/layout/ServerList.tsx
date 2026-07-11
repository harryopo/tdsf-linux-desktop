/**
 * 服务器列表面板组件 - ServerList
 *
 * 职责：
 * - 展示服务器列表（按分组显示）
 * - 提供新建连接按钮 → 打开 ConnectDialog
 * - 右键菜单：连接 / 编辑 / 删除 / 复制
 * - 搜索框过滤服务器
 * - 显示连接状态指示灯
 *
 * 苹果极简风格：
 * - 无阴影，细线条分割
 * - 状态指示灯使用小圆点
 * - 搜索框无边框，底部线条样式
 */
import { useState, useMemo, useCallback } from 'react'
import { Input, Dropdown, Modal, message, Tooltip } from 'antd'
import {
  PlusOutlined,
  SearchOutlined,
  DesktopOutlined,
  DeleteOutlined,
  EditOutlined,
  CopyOutlined,
  LinkOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useServerStore } from '../../stores/server-store'
import { useTerminalStore } from '../../stores/terminal-store'
import ConnectDialog from './ConnectDialog'
import type { SshConfig, SshConnectionState } from '@shared/models'
import './ServerList.css'

/** 连接状态指示灯颜色映射 */
const STATE_COLORS: Record<SshConnectionState, string> = {
  disconnected: '#86868b',
  connecting: '#ff9500',
  connected: '#34c759',
  error: '#ff3b30',
}

/** 连接状态中文标签 */
const STATE_LABELS: Record<SshConnectionState, string> = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  error: '连接错误',
}

/** ServerList 服务器列表面板 */
const ServerList: React.FC = () => {
  // ===== Store 状态 =====
  const servers = useServerStore((s) => s.servers)
  const connectionStates = useServerStore((s) => s.connectionStates)
  const addServer = useServerStore((s) => s.addServer)
  const removeServer = useServerStore((s) => s.removeServer)
  const updateServer = useServerStore((s) => s.updateServer)
  const setConnectionState = useServerStore((s) => s.setConnectionState)
  const setSessionMapping = useServerStore((s) => s.setSessionMapping)
  const setActiveSession = useServerStore((s) => s.setActiveSession)
  const clearSessionMapping = useServerStore((s) => s.clearSessionMapping)
  const addTab = useTerminalStore((s) => s.addTab)

  // ===== 本地状态 =====
  const [searchText, setSearchText] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<SshConfig | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)

  /** 过滤后的服务器列表 */
  const filteredServers = useMemo(() => {
    if (!searchText.trim()) return servers
    const keyword = searchText.toLowerCase()
    return servers.filter(
      (s) =>
        s.name.toLowerCase().includes(keyword) ||
        s.host.toLowerCase().includes(keyword) ||
        s.username.toLowerCase().includes(keyword)
    )
  }, [servers, searchText])

  /** 按分组整理服务器（按 name 首字母分组） */
  const groupedServers = useMemo(() => {
    const groups: Record<string, SshConfig[]> = {}
    for (const server of filteredServers) {
      const firstChar = server.name.charAt(0).toUpperCase()
      if (!groups[firstChar]) groups[firstChar] = []
      groups[firstChar].push(server)
    }
    return groups
  }, [filteredServers])

  /** 连接到服务器 */
  const handleConnect = useCallback(
    async (server: SshConfig) => {
      if (connecting) return
      setConnecting(server.id)
      setConnectionState(server.id, 'connecting')
      try {
        const sessionId = await window.electronAPI.sshConnect(server)
        // 启动交互式 Shell
        await window.electronAPI.sshShellStart(sessionId)
        // 启动监控
        await window.electronAPI.monitorStart(sessionId, 2000)
        // 获取系统信息
        const sysInfo = await window.electronAPI.monitorGetSystemInfo(sessionId)

        // 更新状态
        setConnectionState(server.id, 'connected')
        setSessionMapping(server.id, sessionId)
        setActiveSession(sessionId)

        // 创建终端 Tab
        addTab({
          id: sessionId,
          sessionId,
          serverId: server.id,
          title: server.name,
          active: true,
          createdAt: Date.now(),
        })

        // 存储系统信息到 monitor store
        const { useMonitorStore } = await import('../../stores/monitor-store')
        useMonitorStore.getState().setSystemInfo(sessionId, sysInfo)

        message.success(`已连接到 ${server.name}`)
      } catch (error) {
        setConnectionState(server.id, 'error')
        message.error(`连接失败: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setConnecting(null)
      }
    },
    [connecting, setConnectionState, setSessionMapping, setActiveSession, addTab]
  )

  /** 断开连接 */
  const handleDisconnect = useCallback(
    async (server: SshConfig) => {
      const sessionId = useServerStore.getState().sessionMap[server.id]
      if (!sessionId) return
      try {
        await window.electronAPI.monitorStop(sessionId)
        await window.electronAPI.sshDisconnect(sessionId)
        setConnectionState(server.id, 'disconnected')
        clearSessionMapping(server.id)
        useTerminalStore.getState().removeTab(sessionId)
        message.success(`已断开 ${server.name}`)
      } catch (error) {
        message.error(`断开失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [setConnectionState, clearSessionMapping]
  )

  /** 编辑服务器 */
  const handleEdit = useCallback((server: SshConfig) => {
    setEditingServer(server)
    setDialogOpen(true)
  }, [])

  /** 删除服务器 */
  const handleDelete = useCallback(
    (server: SshConfig) => {
      Modal.confirm({
        title: '删除服务器',
        content: `确定要删除「${server.name}」吗？`,
        okText: '删除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => {
          removeServer(server.id)
          message.success('已删除')
        },
      })
    },
    [removeServer]
  )

  /** 复制服务器配置 */
  const handleCopy = useCallback(
    (server: SshConfig) => {
      const newServer: SshConfig = {
        ...server,
        id: `${server.id}_copy_${Date.now()}`,
        name: `${server.name} (副本)`,
      }
      addServer(newServer)
      message.success('已复制')
    },
    [addServer]
  )

  /** 右键菜单项 */
  const getContextMenu = useCallback(
    (server: SshConfig): MenuProps['items'] => {
      const state = connectionStates[server.id] ?? 'disconnected'
      const isConnected = state === 'connected' || state === 'connecting'
      return [
        {
          key: 'connect',
          label: isConnected ? '断开连接' : '连接',
          icon: <LinkOutlined />,
          onClick: () => {
            if (isConnected) {
              void handleDisconnect(server)
            } else {
              void handleConnect(server)
            }
          },
        },
        {
          key: 'edit',
          label: '编辑',
          icon: <EditOutlined />,
          onClick: () => handleEdit(server),
        },
        {
          key: 'copy',
          label: '复制',
          icon: <CopyOutlined />,
          onClick: () => handleCopy(server),
        },
        { type: 'divider' },
        {
          key: 'delete',
          label: '删除',
          icon: <DeleteOutlined />,
          danger: true,
          onClick: () => handleDelete(server),
        },
      ]
    },
    [connectionStates, handleConnect, handleDisconnect, handleEdit, handleCopy, handleDelete]
  )

  /** 新建连接 */
  const handleAdd = useCallback(() => {
    setEditingServer(null)
    setDialogOpen(true)
  }, [])

  /** 保存服务器（新建或编辑） */
  const handleSave = useCallback(
    (config: SshConfig) => {
      if (editingServer) {
        updateServer(editingServer.id, config)
        message.success('已更新')
      } else {
        addServer(config)
        message.success('已添加')
      }
      setDialogOpen(false)
      setEditingServer(null)
    },
    [editingServer, addServer, updateServer]
  )

  return (
    <div className="server-list">
      {/* ===== 头部：标题 + 新建按钮 ===== */}
      <div className="server-list-header">
        <span className="server-list-title">服务器</span>
        <Tooltip title="新建连接">
          <button className="server-list-add-btn" onClick={handleAdd}>
            <PlusOutlined />
          </button>
        </Tooltip>
      </div>

      {/* ===== 搜索框 ===== */}
      <div className="server-list-search">
        <Input
          placeholder="搜索服务器..."
          prefix={<SearchOutlined style={{ color: '#86868b' }} />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          variant="borderless"
          size="small"
        />
      </div>

      {/* ===== 服务器列表 ===== */}
      <div className="server-list-items">
        {filteredServers.length === 0 ? (
          <div className="server-list-empty">
            <DesktopOutlined style={{ fontSize: 32, color: '#86868b' }} />
            <p>{searchText ? '未找到匹配的服务器' : '点击 + 新建连接'}</p>
          </div>
        ) : (
          Object.entries(groupedServers)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([group, items]) => (
              <div key={group} className="server-list-group">
                <div className="server-list-group-header">{group}</div>
                {items.map((server) => {
                  const state = connectionStates[server.id] ?? 'disconnected'
                  return (
                    <Dropdown
                      key={server.id}
                      menu={{ items: getContextMenu(server) }}
                      trigger={['contextMenu']}
                    >
                      <div
                        className={`server-list-item ${state === 'connected' ? 'connected' : ''}`}
                        onClick={() => {
                          if (state === 'disconnected' || state === 'error') {
                            void handleConnect(server)
                          }
                        }}
                      >
                        {/* 连接状态指示灯 */}
                        <span
                          className="server-status-dot"
                          style={{ backgroundColor: STATE_COLORS[state] }}
                        />
                        {/* 服务器信息 */}
                        <div className="server-list-item-info">
                          <div className="server-list-item-name text-ellipsis">
                            {server.name}
                          </div>
                          <div className="server-list-item-host text-ellipsis">
                            {server.username}@{server.host}:{server.port}
                          </div>
                        </div>
                        {/* 状态标签 */}
                        {state !== 'disconnected' && (
                          <span className="server-list-item-state">
                            {STATE_LABELS[state]}
                          </span>
                        )}
                      </div>
                    </Dropdown>
                  )
                })}
              </div>
            ))
        )}
      </div>

      {/* ===== 连接对话框 ===== */}
      <ConnectDialog
        open={dialogOpen}
        server={editingServer}
        onSave={handleSave}
        onCancel={() => {
          setDialogOpen(false)
          setEditingServer(null)
        }}
      />
    </div>
  )
}

export default ServerList
