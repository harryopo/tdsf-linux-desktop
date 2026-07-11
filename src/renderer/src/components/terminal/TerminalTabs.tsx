/**
 * 多标签终端组件 - TerminalTabs
 *
 * 职责：
 * - Tab 标签页管理（每个 SSH 会话一个 Tab）
 * - 新建 Tab / 关闭 Tab / 切换 Tab
 * - Tab 标题显示服务器名称
 * - 右键菜单：复制 / 关闭 / 关闭其他
 *
 * 设计：
 * - Tab 栏在顶部（苹果极简风格，细线条分割）
 * - 每个 Tab 渲染一个 TerminalView（非活跃 Tab 隐藏而非卸载）
 * - 无 Tab 时显示空状态提示
 */
import { useCallback } from 'react'
import { Dropdown, message } from 'antd'
import { CloseOutlined, PlusOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useTerminalStore } from '../../stores/terminal-store'
import { useServerStore } from '../../stores/server-store'
import TerminalView from './TerminalView'
import './TerminalTabs.css'

/** TerminalTabs 多标签终端 */
const TerminalTabs: React.FC = () => {
  // ===== Store 状态 =====
  const tabs = useTerminalStore((s) => s.tabs)
  const activeTabId = useTerminalStore((s) => s.activeTabId)
  const setActiveTab = useTerminalStore((s) => s.setActiveTab)
  const removeTab = useTerminalStore((s) => s.removeTab)
  const closeOtherTabs = useTerminalStore((s) => s.closeOtherTabs)
  const clearSessionMapping = useServerStore((s) => s.clearSessionMapping)
  const setConnectionState = useServerStore((s) => s.setConnectionState)

  /** 关闭 Tab */
  const handleCloseTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return
      try {
        // 停止监控并断开 SSH
        await window.electronAPI.monitorStop(tab.sessionId)
        await window.electronAPI.sshDisconnect(tab.sessionId)
        // 更新服务器状态
        setConnectionState(tab.serverId, 'disconnected')
        clearSessionMapping(tab.serverId)
      } catch {
        // 断开失败也继续关闭 Tab
      }
      removeTab(tabId)
    },
    [tabs, removeTab, setConnectionState, clearSessionMapping]
  )

  /** 复制 Tab（创建新连接到同一服务器） */
  const handleCopyTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return
      const server = useServerStore.getState().servers.find((s) => s.id === tab.serverId)
      if (!server) {
        message.warning('找不到对应的服务器配置')
        return
      }
      try {
        const sessionId = await window.electronAPI.sshConnect(server)
        await window.electronAPI.sshShellStart(sessionId)
        await window.electronAPI.monitorStart(sessionId, 2000)
        useTerminalStore.getState().addTab({
          id: sessionId,
          sessionId,
          serverId: server.id,
          title: `${server.name} (2)`,
          active: true,
          createdAt: Date.now(),
        })
        message.success('已创建新连接')
      } catch (error) {
        message.error(`创建连接失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [tabs]
  )

  /** 右键菜单 */
  const getContextMenu = useCallback(
    (tabId: string): MenuProps['items'] => [
      {
        key: 'copy',
        label: '复制连接',
        onClick: () => void handleCopyTab(tabId),
      },
      {
        key: 'close',
        label: '关闭',
        onClick: () => void handleCloseTab(tabId),
      },
      {
        key: 'closeOthers',
        label: '关闭其他',
        onClick: () => closeOtherTabs(tabId),
      },
    ],
    [handleCopyTab, handleCloseTab, closeOtherTabs]
  )

  /** 无 Tab 时显示空状态 */
  if (tabs.length === 0) {
    return (
      <div className="terminal-tabs-empty">
        <div className="terminal-tabs-empty-icon">
          <PlusOutlined />
        </div>
        <p>从左侧服务器列表选择服务器开始连接</p>
      </div>
    )
  }

  return (
    <div className="terminal-tabs">
      {/* ===== Tab 标签栏 ===== */}
      <div className="terminal-tabs-bar">
        <div className="terminal-tabs-list">
          {tabs.map((tab) => (
            <Dropdown
              key={tab.id}
              menu={{ items: getContextMenu(tab.id) }}
              trigger={['contextMenu']}
            >
              <div
                className={`terminal-tab-item ${tab.id === activeTabId ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="terminal-tab-title text-ellipsis">{tab.title}</span>
                <button
                  className="terminal-tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleCloseTab(tab.id)
                  }}
                >
                  <CloseOutlined />
                </button>
              </div>
            </Dropdown>
          ))}
        </div>
      </div>

      {/* ===== 终端内容区 ===== */}
      <div className="terminal-tabs-content">
        {tabs.map((tab) => (
          <TerminalView
            key={tab.id}
            sessionId={tab.sessionId}
            visible={tab.id === activeTabId}
          />
        ))}
      </div>
    </div>
  )
}

export default TerminalTabs
