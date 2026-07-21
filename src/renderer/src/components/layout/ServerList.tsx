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
  RocketOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useServerStore } from '../../stores/server-store'
import { useTerminalStore } from '../../stores/terminal-store'
import { useMonitorStore } from '../../stores/monitor-store'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import ConnectDialog from './ConnectDialog'
import ProfilerDialog from '../profiler/ProfilerDialog'
import DeployDialog from '../deploy/DeployDialog'
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
  // 系统架构感知弹窗状态：profilerServer 为 null 时关闭
  const [profilerServer, setProfilerServer] = useState<SshConfig | null>(null)
  // Web 部署助手弹窗状态：deployServer 为 null 时关闭
  const [deployServer, setDeployServer] = useState<SshConfig | null>(null)
  // 记录当前服务器的 sessionId（来自 server-store）
  const sessionMap = useServerStore((s) => s.sessionMap)

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
      if (!isElectronAPIAvailable()) {
        message.error('electronAPI 不可用，无法连接服务器')
        return
      }
      // 调试日志：检查 server 对象中的关键字段
      console.log('[ServerList] handleConnect server:', {
        host: server.host,
        port: server.port,
        username: server.username,
        authType: server.authType,
        hasPassword: !!server.password,
        hasPrivateKey: !!server.privateKey,
        name: server.name,
        id: server.id,
      })
      setConnecting(server.id)
      setConnectionState(server.id, 'connecting')
      try {
        // Step 1: 建立 SSH 连接
        console.log('[ServerList] Step 1: 正在建立 SSH 连接...')
        const sessionId = await window.electronAPI.sshConnect(server)
        console.log('[ServerList] Step 1: SSH 连接成功, sessionId =', sessionId)

        // Step 2: 启动交互式 Shell（独立 try-catch，失败不影响连接状态）
        try {
          console.log('[ServerList] Step 2: 正在启动 Shell...')
          await window.electronAPI.sshShellStart(sessionId)
          console.log('[ServerList] Step 2: Shell 启动成功')
        } catch (shellErr) {
          console.error('[ServerList] 启动 Shell 失败:', shellErr)
          message.warning(`Shell 启动失败: ${shellErr instanceof Error ? shellErr.message : String(shellErr)}`)
        }

        // Step 3: 启动监控（间隔3秒）
        // 系统信息由主进程首次 tick 时自动推送（onMonitorSystemInfo 事件）
        // MonitorPanel 也有启动保障机制，这里失败只是兜底
        try {
          console.log('[ServerList] Step 3: 正在启动监控...')
          await window.electronAPI.monitorStart(sessionId, 3)
          console.log('[ServerList] Step 3: 监控启动成功')
        } catch (monitorErr) {
          console.error('[ServerList] 启动监控失败:', monitorErr)
          // 不弹 message.warning，因为 MonitorPanel 挂载时会重试并显示错误
        }

        // 更新状态
        console.log('[ServerList] 正在更新 UI 状态...')
        setConnectionState(server.id, 'connected')
        setSessionMapping(server.id, sessionId)
        setActiveSession(sessionId)

        // 创建终端 Tab
        console.log('[ServerList] 正在创建终端 Tab...')
        addTab({
          id: sessionId,
          sessionId,
          serverId: server.id,
          title: server.name,
          active: true,
          createdAt: Date.now(),
        })
        console.log('[ServerList] 终端 Tab 创建成功')

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
      if (!isElectronAPIAvailable()) {
        message.error('electronAPI 不可用，无法断开连接')
        return
      }
      try {
        // 先停止监控，再断开 SSH
        await window.electronAPI.monitorStop(sessionId)
        await window.electronAPI.sshDisconnect(sessionId)
        setConnectionState(server.id, 'disconnected')
        clearSessionMapping(server.id)
        // 清理 monitor-store 中该会话的历史数据，避免重连时显示旧数据
        useMonitorStore.getState().clearMonitorData(sessionId)
        useTerminalStore.getState().removeTab(sessionId)
        // 如果断开的是当前活跃会话，清空 activeSessionId
        if (useServerStore.getState().activeSessionId === sessionId) {
          setActiveSession(null)
        }
        message.success(`已断开 ${server.name}`)
      } catch (error) {
        message.error(`断开失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [setConnectionState, clearSessionMapping, setActiveSession]
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

  /** 系统架构感知：弹出 ProfilerDialog */
  const handleProfile = useCallback(
    (server: SshConfig) => {
      const state = connectionStates[server.id] ?? 'disconnected'
      if (state !== 'connected') {
        message.warning('请先连接服务器再进行系统架构感知')
        return
      }
      setProfilerServer(server)
    },
    [connectionStates]
  )

  /** Web 部署：弹出 DeployDialog */
  const handleDeploy = useCallback(
    (server: SshConfig) => {
      const state = connectionStates[server.id] ?? 'disconnected'
      if (state !== 'connected') {
        message.warning('请先连接服务器再使用 Web 部署助手')
        return
      }
      setDeployServer(server)
    },
    [connectionStates]
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
          key: 'profile',
          label: '系统架构感知',
          icon: <RocketOutlined />,
          disabled: !isConnected,
          onClick: () => handleProfile(server),
        },
        {
          key: 'deploy',
          label: 'Web 部署助手',
          icon: <CloudUploadOutlined />,
          disabled: !isConnected,
          onClick: () => handleDeploy(server),
        },
        { type: 'divider' },
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
    [connectionStates, handleConnect, handleDisconnect, handleEdit, handleCopy, handleDelete, handleProfile, handleDeploy]
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

      {/* ===== 系统架构感知对话框 ===== */}
      <ProfilerDialog
        open={profilerServer !== null}
        sessionId={
          profilerServer ? (sessionMap[profilerServer.id] ?? null) : null
        }
        host={profilerServer?.name ?? ''}
        onClose={() => setProfilerServer(null)}
      />

      {/* ===== Web 部署助手对话框 ===== */}
      <DeployDialog
        open={deployServer !== null}
        sessionId={
          deployServer ? (sessionMap[deployServer.id] ?? null) : null
        }
        host={deployServer?.name ?? ''}
        onClose={() => setDeployServer(null)}
      />
    </div>
  )
}

export default ServerList
