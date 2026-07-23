/**
 * SecurityCard — 安全设置 Card（M5 Task 7 拆分）
 *
 * 从 SshSettings.tsx 抽取，负责：
 * - 允许密码认证开关（默认 off，更安全）
 * - 允许 Root 登录开关（默认 on）
 * - 严格主机密钥检查开关（默认 on）
 * - Known Hosts 文件路径输入
 *
 * 所有状态由父级持有，通过 props 注入；本组件无自身状态。
 */
import { Shield } from 'lucide-react'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { Switch } from '@/components/trae/Switch'
import { Input } from '@/components/trae/Input'

export interface SecurityCardProps {
  /** 允许密码认证（默认 off） */
  allowPasswordAuth: boolean
  onAllowPasswordAuthChange: (v: boolean) => void
  /** 允许 Root 登录（默认 on） */
  allowRootLogin: boolean
  onAllowRootLoginChange: (v: boolean) => void
  /** 严格主机密钥检查（默认 on） */
  strictHostKeyCheck: boolean
  onStrictHostKeyCheckChange: (v: boolean) => void
  /** Known Hosts 文件路径 */
  knownHostsPath: string
  onKnownHostsPathChange: (v: string) => void
}

export function SecurityCard(props: SecurityCardProps) {
  const {
    allowPasswordAuth,
    onAllowPasswordAuthChange,
    allowRootLogin,
    onAllowRootLoginChange,
    strictHostKeyCheck,
    onStrictHostKeyCheckChange,
    knownHostsPath,
    onKnownHostsPathChange,
  } = props

  return (
    <SettingsCard
      icon={Shield}
      title="安全设置"
      tag="security"
    >
      <SettingsRow
        label="允许密码认证"
        desc="允许使用密码方式登录服务器"
        control={
          <Switch checked={allowPasswordAuth} onCheckedChange={onAllowPasswordAuthChange} />
        }
      />
      <SettingsRow
        label="允许 Root 登录"
        desc="允许以 root 用户身份直接登录"
        control={<Switch checked={allowRootLogin} onCheckedChange={onAllowRootLoginChange} />}
      />
      <SettingsRow
        label="严格主机密钥检查"
        desc="首次连接时严格验证服务器指纹"
        control={
          <Switch
            checked={strictHostKeyCheck}
            onCheckedChange={onStrictHostKeyCheckChange}
          />
        }
      />
      <SettingsRow
        label="Known Hosts 文件路径"
        desc="已知主机指纹存储文件位置"
        control={
          <Input
            value={knownHostsPath}
            onChange={(e) => onKnownHostsPathChange(e.target.value)}
            className="ssh-input-path"
          />
        }
        isLast
      />
    </SettingsCard>
  )
}

export default SecurityCard
