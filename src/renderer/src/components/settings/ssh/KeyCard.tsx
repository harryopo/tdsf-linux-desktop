/**
 * KeyCard — SSH 密钥管理 Card（M5 Task 7 拆分）
 *
 * 从 SshSettings.tsx 抽取，负责：
 * - 密钥列表渲染（名称 + 类型 + 私钥路径）
 * - 删除密钥按钮（Modal.confirm + sshDeleteKeyring + refreshKeys）
 * - 上传私钥按钮（sshUploadKeypair + refreshKeys）
 * - 生成新密钥按钮（触发父级打开生成 Modal）
 * - IPC 不可用 / 空列表时的 Empty 提示
 *
 * 实际 IPC 调用（sshDeleteKeyring / sshUploadKeypair）通过回调注入；
 * 生成密钥 Modal 留在 SshSettings.tsx 顶层（需 genForm 状态），通过 onGenerate 触发。
 */
import { KeyRound, Trash2, Upload, Plus } from 'lucide-react'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { Empty } from '@/components/trae/Empty'
import { cn } from '@/components/trae/utils'
import type { SshKeyPair } from '@shared/models'

export interface KeyCardProps {
  /** 密钥列表（来自主进程 sshListKeypairs 扫描 ~/.ssh/） */
  keyPairs: SshKeyPair[]
  /** Electron IPC 是否可用 */
  ipcAvailable: boolean
  /** 删除密钥（已包含 Modal.confirm + sshDeleteKeyring + refreshKeys） */
  onDelete: (keyPair: SshKeyPair) => void
  /** 上传密钥（已包含 sshUploadKeypair + refreshKeys，用户取消静默处理） */
  onUpload: () => void
  /** 生成新密钥（触发父级 genForm.resetFields() + setGenModalOpen(true)） */
  onGenerate: () => void
}

export function KeyCard(props: KeyCardProps) {
  const { keyPairs, ipcAvailable, onDelete, onUpload, onGenerate } = props

  return (
    <SettingsCard
      icon={KeyRound}
      title="SSH 密钥管理"
      tag={`${keyPairs.length} keys`}
    >
      {!ipcAvailable ? (
        <Empty
          icon={KeyRound}
          title="无法加载密钥"
          description="Electron IPC 不可用，请在桌面端运行以管理 SSH 密钥。"
        />
      ) : keyPairs.length === 0 ? (
        <Empty
          icon={KeyRound}
          title="暂无 SSH 密钥"
          description="点击下方「上传密钥」或「生成新密钥」来管理 ~/.ssh/ 目录下的 SSH 密钥。"
        />
      ) : (
        keyPairs.map((k, idx) => (
          <div
            key={k.name}
            className={cn(
              'ssh-key-row',
              idx === keyPairs.length - 1 && 'ssh-key-row--last',
            )}
          >
            <div className="ssh-key-row__icon">
              <KeyRound className="size-4" />
            </div>
            <div className="ssh-key-row__main">
              <div className="ssh-key-row__name">
                {k.name}
              </div>
              <div className="ssh-key-row__meta">
                {k.type.toUpperCase()} · {k.privateKeyPath}
              </div>
            </div>
            {/* M.2：删除密钥按钮（Modal.confirm + sshDeleteKeyring + refreshKeys） */}
            <button
              type="button"
              onClick={() => onDelete(k)}
              aria-label={`删除密钥 ${k.name}`}
              className="ssh-btn-danger ssh-btn-press"
            >
              <Trash2 className="size-3" />
              删除
            </button>
          </div>
        ))
      )}

      {/* 上传 / 生成按钮 */}
      <div className="ssh-card-footer-row">
        {/* M.3：上传私钥按钮（sshUploadKeypair，用户取消静默处理） */}
        <button
          type="button"
          onClick={onUpload}
          className="ssh-btn-secondary ssh-btn-press"
        >
          <Upload className="size-3.5" />
          上传密钥
        </button>
        {/* M.4：生成新密钥按钮（打开 Form Modal → sshGenerateKeypair） */}
        <button
          type="button"
          onClick={onGenerate}
          className="ssh-btn-primary ssh-btn-press"
        >
          <Plus className="size-3.5" />
          生成新密钥
        </button>
      </div>
    </SettingsCard>
  )
}

export default KeyCard
