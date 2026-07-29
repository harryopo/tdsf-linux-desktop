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
import { useCallback, useEffect } from 'react'
import { Dropdown, message, Tooltip } from 'antd'
import { CloseOutlined, PlusOutlined, ThunderboltOutlined, TranslationOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useTerminalStore } from '../../stores/terminal-store'
import { useServerStore } from '../../stores/server-store'
import { useTranslateStore } from '../../stores/translate-store'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import TerminalView from './TerminalView'
import SelectionPopover from './SelectionPopover'
import './TerminalTabs.css'
import './Terminal.css'

/** TerminalTabs 多标签终端 */
const TerminalTabs: React.FC = () => {
  // ===== Store 状态 =====
  const tabs = useTerminalStore((s) => s.tabs)
  const activeTabId = useTerminalStore((s) => s.activeTabId)
  const setActiveTab = useTerminalStore((s) => s.setActiveTab)
  const removeTab = useTerminalStore((s) => s.removeTab)
  const closeOtherTabs = useTerminalStore((s) => s.closeOtherTabs)
  /** v2.5 AI 命令预测回显条 */
  const pendingCommand = useTerminalStore((s) => s.pendingCommand)
  const setPendingCommand = useTerminalStore((s) => s.setPendingCommand)
  const clearSessionMapping = useServerStore((s) => s.clearSessionMapping)
  const setConnectionState = useServerStore((s) => s.setConnectionState)
  /** v0.8.0 翻译模块状态 */
  const translateEnabled = useTranslateStore((s) => s.enabled)
  const toggleTranslate = useTranslateStore((s) => s.toggleEnabled)

  /** v2.5 预测回显条自动消隐（命令发送 12s 后自动收起，避免长驻遮挡） */
  useEffect(() => {
    if (!pendingCommand) return
    const timer = setTimeout(() => setPendingCommand(null), 12_000)
    return () => clearTimeout(timer)
  }, [pendingCommand, setPendingCommand])

  /** 关闭 Tab */
  const handleCloseTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return
      try {
        // 停止监控并断开 SSH
        if (isElectronAPIAvailable()) {
          await window.electronAPI.monitorStop(tab.sessionId)
          await window.electronAPI.sshDisconnect(tab.sessionId)
        }
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
      if (!isElectronAPIAvailable()) {
        message.error('electronAPI 不可用，无法创建连接')
        return
      }
      try {
        const sessionId = await window.electronAPI.sshConnect(server)
        await window.electronAPI.sshShellStart(sessionId)
        await window.electronAPI.monitorStart(sessionId, 2)
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
      <div className="term-tabs-empty">
        <div className="term-tabs-empty-icon">
          <PlusOutlined />
        </div>
        <p className="term-tabs-empty-text">从左侧服务器列表选择服务器开始连接</p>
      </div>
    )
  }

  return (
    <div className="term-tabs">
      {/* ===== Tab 标签栏 ===== */}
      <div className="term-tabs-bar">
        <div className="term-tabs-list">
          {tabs.map((tab) => (
            <Dropdown
              key={tab.id}
              menu={{ items: getContextMenu(tab.id) }}
              trigger={['contextMenu']}
            >
              <div
                className={`term-multi-tab ${tab.id === activeTabId ? 'term-multi-tab-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="term-multi-tab-title">{tab.title}</span>
                <button
                  className="term-multi-tab-close"
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
        {/* v0.8.0 翻译开关按钮 */}
        <div className="term-tabs-actions">
          <Tooltip
            title={translateEnabled ? '关闭终端翻译' : '开启终端翻译（鼠标滑动选词触发）'}
            placement="bottom"
          >
            <button
              className={`term-translate-toggle ${translateEnabled ? 'term-translate-toggle-active' : ''}`}
              onClick={toggleTranslate}
              aria-label="切换翻译功能"
            >
              <TranslationOutlined />
              <span className="term-translate-text">
                {translateEnabled ? '翻译 ON' : '翻译 OFF'}
              </span>
            </button>
          </Tooltip>
        </div>
      </div>

      {/* ===== v2.5 AI 命令预测回显条：AI 注入命令时立即可见，对应终端内的真实回显 ===== */}
      {pendingCommand && (
        <div className="term-pending-cmd">
          <ThunderboltOutlined className="term-pending-cmd-icon" />
          <span className="term-pending-cmd-label">AI 已注入命令</span>
          <code className="term-pending-cmd-text" title={pendingCommand.command}>
            {pendingCommand.command.split('\n')[0]}
            {pendingCommand.command.includes('\n') ? ' …' : ''}
          </code>
          <button
            type="button"
            className="term-pending-cmd-close"
            aria-label="关闭回显提示"
            onClick={() => setPendingCommand(null)}
          >
            <CloseOutlined />
          </button>
        </div>
      )}

      {/* ===== 终端内容区 ===== */}
      <div className="term-tabs-content">
        {tabs.map((tab) => (
          <TerminalView
            key={tab.id}
            sessionId={tab.sessionId}
            visible={tab.id === activeTabId}
          />
        ))}
      </div>

      {/* v0.8.0 翻译浮层：全局唯一实例（避免多 Tab 渲染多份） */}
      <SelectionPopover />
    </div>
  )
}

export default TerminalTabs
