/**
 * HostKeyPromptDialog — SSH 主机密钥确认弹窗（Phase L）
 *
 * 职责：
 * - 监听 onSshHostKeyPrompt 事件（主进程推送）
 * - 首次连接（unknown-host）：提示用户是否保存密钥到 known_hosts
 * - 密钥变更（host-key-changed）：警告用户密钥已变更，可能存在中间人攻击
 * - 三按钮响应：
 *   1. 保存并继续（accept-and-save）：继续连接 + 写入 known_hosts
 *   2. 仅本次继续（accept-once）：继续连接，不写入 known_hosts
 *   3. 拒绝连接（reject）：中断 SSH 握手
 *
 * 挂载位置：App.tsx 根组件（全局监听，任何页面都能收到弹窗）
 *
 * CSS 变量：全部使用 var(--trae-*) 保持设计系统一致
 */
import { useState, useEffect, useCallback } from 'react'
import { Modal, Button } from 'antd'
import {
  SafetyCertificateOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons'
import type { SshHostKeyPromptEvent, SshHostKeyResponseAction } from '@shared/models'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import './HostKeyPromptDialog.css'

/** HostKeyPromptDialog 组件 */
const HostKeyPromptDialog: React.FC = () => {
  const [prompt, setPrompt] = useState<SshHostKeyPromptEvent | null>(null)
  const [responding, setResponding] = useState(false)

  /** 监听主进程的主机密钥确认推送 */
  useEffect(() => {
    if (!isElectronAPIAvailable()) {
      return
    }
    const off = window.electronAPI.onSshHostKeyPrompt((event: SshHostKeyPromptEvent) => {
      setPrompt(event)
    })
    return off
  }, [])

  /** 响应用户选择，发送回主进程 */
  const handleRespond = useCallback(
    async (action: SshHostKeyResponseAction): Promise<void> => {
      if (!prompt || !isElectronAPIAvailable()) {
        return
      }
      setResponding(true)
      try {
        await window.electronAPI.sshRespondHostKey(prompt.requestId, action)
      } catch (err) {
        console.error('[HostKeyPromptDialog] 响应失败:', err)
      } finally {
        setResponding(false)
        setPrompt(null)
      }
    },
    [prompt],
  )

  const isOpen = prompt !== null
  const isWarning = prompt?.scenario === 'host-key-changed'

  /** 弹窗标题图标和文案 */
  const titleIcon = isWarning ? (
    <WarningOutlined className="hkp-title-icon hkp-title-icon--warning" />
  ) : (
    <SafetyCertificateOutlined className="hkp-title-icon hkp-title-icon--info" />
  )
  const titleText = isWarning ? '主机密钥变更警告' : '首次连接确认'

  return (
    <Modal
      open={isOpen}
      title={
        <div className="hkp-title">
          {titleIcon}
          <span>{titleText}</span>
        </div>
      }
      closable={false}
      maskClosable={false}
      width={520}
      destroyOnClose
      className="hkp-dialog"
      footer={
        <div className="hkp-footer">
          <Button
            danger={isWarning}
            type={isWarning ? 'primary' : 'default'}
            loading={responding}
            onClick={() => handleRespond('accept-and-save')}
            className="hkp-btn hkp-btn--save"
          >
            保存并继续
          </Button>
          <Button
            loading={responding}
            onClick={() => handleRespond('accept-once')}
            className="hkp-btn hkp-btn--once"
          >
            仅本次继续
          </Button>
          <Button
            loading={responding}
            onClick={() => handleRespond('reject')}
            className="hkp-btn hkp-btn--reject"
          >
            拒绝连接
          </Button>
        </div>
      }
    >
      {prompt && (
        <div className="hkp-body">
          {/* 提示文案 */}
          <div className="hkp-prompt-message">
            {isWarning ? (
              <ExclamationCircleOutlined className="hkp-alert-icon" />
            ) : null}
            <pre className="hkp-prompt-text">{prompt.promptMessage}</pre>
          </div>

          {/* 当前密钥详情 */}
          <div className="hkp-key-section">
            <div className="hkp-key-section__label">服务器密钥指纹</div>
            <div className="hkp-key-detail">
              <span className="hkp-key-detail__type">
                {prompt.currentKey.keyType}
              </span>
              <code className="hkp-key-detail__fingerprint">
                {prompt.currentKey.sha256}
              </code>
            </div>
          </div>

          {/* 密钥变更时显示旧密钥 */}
          {isWarning && prompt.knownKey && (
            <div className="hkp-key-section hkp-key-section--known">
              <div className="hkp-key-section__label">已记录的旧密钥指纹</div>
              <div className="hkp-key-detail">
                <span className="hkp-key-detail__type">
                  {prompt.knownKey.keyType}
                </span>
                <code className="hkp-key-detail__fingerprint">
                  {prompt.knownKey.sha256}
                </code>
              </div>
            </div>
          )}

          {/* 安全提示 */}
          <div className={`hkp-hint ${isWarning ? 'hkp-hint--warning' : ''}`}>
            {isWarning
              ? '⚠️ 密钥变更可能是中间人攻击，请确认服务器变更合法后再继续。'
              : '💡 选择「保存并继续」后，后续连接此主机将自动校验密钥，无需再次确认。'}
          </div>
        </div>
      )}
    </Modal>
  )
}

export default HostKeyPromptDialog
