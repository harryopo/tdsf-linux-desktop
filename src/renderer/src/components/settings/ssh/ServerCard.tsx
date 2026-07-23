/**
 * ServerCard — SSH 服务器管理 Card（M5 Task 7 拆分）
 *
 * 从 SshSettings.tsx 抽取，负责：
 * - 服务器列表渲染（含状态点 + 名称 + IP + 认证类型标签）
 * - 连接 / 断开按钮
 * - 编辑 / 删除按钮（删除走 Modal.confirm）
 * - 添加服务器按钮
 * - IPC 不可用时的 Empty 提示
 *
 * 状态与回调全部通过 props 注入；本组件无自身状态。
 */
import {
  Server,
  Plus,
  Pencil,
  Trash2,
  Link2,
  Unplug,
  Loader2,
  Lock,
  KeyRound,
} from 'lucide-react'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { Empty } from '@/components/trae/Empty'
import { cn } from '@/components/trae/utils'
import type { SshConfig } from '@shared/models'

/** 服务器连接状态 → 状态点颜色 + 中文标签 */
type ServerStatus = 'online' | 'connecting' | 'warning' | 'error' | 'offline'

function statusOf(
  serverId: string,
  connectionStates: Record<string, string>,
): ServerStatus {
  const st = connectionStates[serverId]
  if (st === 'connected') return 'online'
  if (st === 'connecting') return 'connecting'
  if (st === 'error') return 'error'
  return 'offline'
}

const STATUS_DOT_CLASS: Record<ServerStatus, string> = {
  online: 'ssh-dot-online',
  connecting: 'ssh-dot-connecting',
  warning: 'ssh-dot-warning',
  error: 'ssh-dot-error',
  offline: 'ssh-dot-offline',
}

const STATUS_LABEL: Record<ServerStatus, string> = {
  online: '已连接',
  connecting: '连接中',
  warning: '告警',
  error: '错误',
  offline: '未连接',
}

export interface ServerCardProps {
  /** 按名称排序后的服务器列表 */
  servers: SshConfig[]
  /** 服务器连接状态映射（id → 'connected' | 'connecting' | 'error' | ...） */
  connectionStates: Record<string, string>
  /** 当前 busy 的服务器 ID（连接/断开中），用于禁用按钮 + 显示 Loader2 */
  busyId: string | null
  /** 顶部 footer 反馈消息（操作后短暂提示，2.5s 后清空） */
  feedback: string | null
  /** Electron IPC 是否可用 */
  ipcAvailable: boolean
  /** 连接服务器 */
  onConnect: (server: SshConfig) => void
  /** 断开服务器 */
  onDisconnect: (server: SshConfig) => void
  /** 编辑服务器（打开 ConnectDialog，server 为已存在配置） */
  onEdit: (server: SshConfig) => void
  /** 添加服务器（打开 ConnectDialog，server 为 null） */
  onAdd: () => void
  /** 删除服务器（已包含 Modal.confirm 流程） */
  onDelete: (server: SshConfig) => void
}

export function ServerCard(props: ServerCardProps) {
  const {
    servers,
    connectionStates,
    busyId,
    feedback,
    ipcAvailable,
    onConnect,
    onDisconnect,
    onEdit,
    onAdd,
    onDelete,
  } = props

  return (
    <SettingsCard
      icon={Server}
      title="已连接服务器"
      tag={`${servers.length} servers`}
    >
      {!ipcAvailable ? (
        <Empty
          icon={Server}
          title="无法访问服务器列表"
          description="Electron IPC 不可用，请在桌面端运行以管理 SSH 连接。"
        />
      ) : servers.length === 0 ? (
        <Empty
          icon={Server}
          title="暂无服务器"
          description="点击下方「添加服务器」开始配置 SSH 连接。"
        />
      ) : (
        servers.map((s, idx) => {
          const st = statusOf(s.id, connectionStates)
          const busy = busyId === s.id
          const isKeyAuth = s.authType === 'privateKey'
          return (
            <div
              key={s.id}
              className={cn(
                'ssh-server-row',
                idx === servers.length - 1 && 'ssh-server-row--last',
              )}
            >
              <span
                className={cn('ssh-server-row__dot', STATUS_DOT_CLASS[st])}
                aria-label={STATUS_LABEL[st]}
              />
              <div className="ssh-server-row__main">
                <div className="ssh-server-row__name">
                  {s.name || s.host}
                </div>
                <div className="ssh-server-row__ip">
                  {s.host}
                  <span className="ssh-server-row__ip-status">
                    {STATUS_LABEL[st]}
                  </span>
                </div>
              </div>
              <span className="ssh-server-row__type">
                {isKeyAuth ? (
                  <KeyRound className="size-3" />
                ) : (
                  <Lock className="size-3" />
                )}
                {isKeyAuth ? '密钥' : '密码'}
              </span>
              <div className="ssh-server-row__actions">
                {st === 'online' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onDisconnect(s)}
                    aria-label={`断开 ${s.name || s.host}`}
                    className="ssh-btn-danger ssh-btn-press"
                  >
                    {busy ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Unplug className="size-3" />
                    )}
                    断开
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onConnect(s)}
                    aria-label={`连接 ${s.name || s.host}`}
                    className="ssh-btn-primary ssh-btn-primary-sm ssh-btn-press"
                  >
                    {busy ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Link2 className="size-3" />
                    )}
                    连接
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onEdit(s)}
                  aria-label={`编辑 ${s.name || s.host}`}
                  className="ssh-btn-ghost ssh-btn-press"
                >
                  <Pencil className="size-3" />
                  编辑
                </button>
                {/* M.1：删除服务器按钮（Modal.confirm 确认后调用 removeServer） */}
                <button
                  type="button"
                  onClick={() => onDelete(s)}
                  aria-label={`删除 ${s.name || s.host}`}
                  className="ssh-btn-danger ssh-btn-press"
                >
                  <Trash2 className="size-3" />
                  删除
                </button>
              </div>
            </div>
          )
        })
      )}

      {/* 添加服务器按钮 */}
      <div className="ssh-card-footer">
        <button
          type="button"
          onClick={onAdd}
          className="ssh-btn-primary ssh-btn-press"
        >
          <Plus className="size-3.5" />
          添加服务器
        </button>
        {feedback && (
          <span className="ssh-feedback">
            {feedback}
          </span>
        )}
      </div>
    </SettingsCard>
  )
}

export default ServerCard
