/**
 * DefaultsCard — 连接默认设置 Card（M5 Task 7 拆分）
 *
 * 从 SshSettings.tsx 抽取，负责：
 * - 默认端口 / 默认用户 输入
 * - 连接超时滑块（5~120s）
 * - Keep Alive 间隔滑块（0~300s，0=关闭，重启连接后生效）
 * - 压缩传输 / X11 转发 开关
 *
 * 视觉对齐设计稿 ds-row（label + desc + control）。
 * 控件类名统一使用 set-* （set-num / set-input / SettingsSlider / Switch）。
 *
 * 所有状态由父级持有，通过 props 注入；本组件无自身状态。
 */
import { Settings } from 'lucide-react'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSlider } from '@/components/settings/SettingsSlider'
import { Switch } from '@/components/trae/Switch'
import { Input } from '@/components/trae/Input'

export interface DefaultsCardProps {
  /** 默认端口 */
  defaultPort: number
  onPortChange: (port: number) => void
  /** 默认用户名 */
  defaultUser: string
  onUserChange: (user: string) => void
  /** 连接超时（秒） */
  connectTimeoutSec: number
  onTimeoutChange: (sec: number) => void
  /** Keep Alive 间隔（秒，0=关闭） */
  keepAliveIntervalSec: number
  onKeepAliveChange: (sec: number) => void
  /** 压缩传输 */
  compression: boolean
  onCompressionChange: (v: boolean) => void
  /** X11 转发 */
  x11Forward: boolean
  onX11ForwardChange: (v: boolean) => void
}

export function DefaultsCard(props: DefaultsCardProps) {
  const {
    defaultPort,
    onPortChange,
    defaultUser,
    onUserChange,
    connectTimeoutSec,
    onTimeoutChange,
    keepAliveIntervalSec,
    onKeepAliveChange,
    compression,
    onCompressionChange,
    x11Forward,
    onX11ForwardChange,
  } = props

  return (
    <SettingsCard
      icon={Settings}
      title="连接默认设置"
      tag="connection.defaults"
    >
      <SettingsRow
        label="默认端口"
        desc="SSH 连接使用的默认端口号"
        control={
          <Input
            type="number"
            value={defaultPort}
            onChange={(e) => onPortChange(Number(e.target.value) || 22)}
            className="ssh-input-num"
          />
        }
      />
      <SettingsRow
        label="默认用户"
        desc="SSH 连接使用的默认用户名"
        control={
          <Input
            value={defaultUser}
            onChange={(e) => onUserChange(e.target.value)}
            className="ssh-input-user"
          />
        }
      />
      <SettingsRow
        label="连接超时"
        desc="建立连接的超时时间"
        control={
          <SettingsSlider
            value={connectTimeoutSec}
            min={5}
            max={120}
            step={5}
            suffix="s"
            onValueChange={onTimeoutChange}
          />
        }
      />
      <SettingsRow
        label="Keep Alive 间隔"
        desc="心跳包发送间隔（0 = 关闭，重启连接后生效）"
        control={
          <SettingsSlider
            value={keepAliveIntervalSec}
            min={0}
            max={300}
            step={10}
            suffix="s"
            onValueChange={onKeepAliveChange}
          />
        }
      />
      <SettingsRow
        label="压缩传输"
        desc="启用 SSH 连接数据压缩"
        control={<Switch checked={compression} onCheckedChange={onCompressionChange} />}
      />
      <SettingsRow
        label="X11 转发"
        desc="允许 X11 图形界面转发"
        control={<Switch checked={x11Forward} onCheckedChange={onX11ForwardChange} />}
        isLast
      />
    </SettingsCard>
  )
}

export default DefaultsCard
