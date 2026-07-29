/**
 * AlertsSettings — 告警阈值设置（v2.7 真实落地）
 *
 * 路由：/settings/alerts
 *
 * 此前版本是"指引页"，宣称"阈值已集成到监控页"——实际监控页阈值硬编码 85%
 * 且不可配置（假功能）。现改为真实配置页：
 * - CPU / 内存 / 磁盘 三项告警阈值滑块，usePersistentState 持久化
 * - MonitorPage 的 criticalAlert 逻辑读取同一批 key 真实消费
 *
 * 视觉：全部 var(--trae-*) token，无硬编码 hex/rgba
 */
import { Bell, Cpu, HardDrive, ArrowRight, type LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePersistentState } from '@/hooks/usePersistentState'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSlider } from '@/components/settings/SettingsSlider'
import { SettingsActionBar } from '@/components/settings/SettingsActionBar'
import './Settings.css'

/** 阈值默认值（与 MonitorPage 消费端 DEFAULT 保持一致） */
export const ALERT_THRESHOLD_DEFAULTS = { cpu: 90, memory: 90, disk: 85 }

export function AlertsSettings() {
  const navigate = useNavigate()

  // v2.7：真实阈值配置（MonitorPage criticalAlert 消费同一批 key）
  const [cpuThreshold, setCpuThreshold] = usePersistentState(
    'monitor.threshold.cpu', ALERT_THRESHOLD_DEFAULTS.cpu,
  )
  const [memoryThreshold, setMemoryThreshold] = usePersistentState(
    'monitor.threshold.memory', ALERT_THRESHOLD_DEFAULTS.memory,
  )
  const [diskThreshold, setDiskThreshold] = usePersistentState(
    'monitor.threshold.disk', ALERT_THRESHOLD_DEFAULTS.disk,
  )

  return (
    <div>
      <SettingsPageHeader
        icon={Bell as LucideIcon}
        title="告警阈值"
        desc="CPU / 内存 / 磁盘超过阈值时在监控页触发告警横幅"
      />

      <div className="set-panel-content">
        <SettingsCard icon={Cpu} title="资源告警阈值" tag="monitor.threshold">
          <SettingsRow
            label="CPU 使用率"
            desc="持续超过该百分比时触发告警"
            control={
              <SettingsSlider
                value={cpuThreshold} min={50} max={99} step={1} suffix="%"
                onValueChange={setCpuThreshold}
              />
            }
          />
          <SettingsRow
            label="内存使用率"
            desc="超过该百分比时触发告警"
            control={
              <SettingsSlider
                value={memoryThreshold} min={50} max={99} step={1} suffix="%"
                onValueChange={setMemoryThreshold}
              />
            }
          />
          <SettingsRow
            label="磁盘使用率"
            desc="任一挂载点超过该百分比时触发告警"
            control={
              <SettingsSlider
                value={diskThreshold} min={50} max={99} step={1} suffix="%"
                onValueChange={setDiskThreshold}
              />
            }
            isLast
          />
        </SettingsCard>

        <SettingsCard icon={HardDrive} title="生效说明" tag="monitor.alerts">
          <div className="set-alerts-body">
            <p className="set-alerts-text">
              阈值保存后即时生效：<span className="set-alerts-text--strong">监控页</span>
              会在采集数据超过阈值时显示告警横幅（连接 SSH 服务器后每 5 秒采集一次）。
            </p>
            <div className="set-alerts-action">
              <button
                type="button"
                data-dom-id="goto-monitor-alerts"
                aria-label="前往监控页查看告警"
                onClick={() => navigate('/monitor')}
                className="set-alerts-btn btn-press"
              >
                <span>前往监控页</span>
                <ArrowRight className="size-3.5" />
              </button>
            </div>
          </div>
        </SettingsCard>

        <SettingsActionBar
          onReset={() => {
            setCpuThreshold(ALERT_THRESHOLD_DEFAULTS.cpu)
            setMemoryThreshold(ALERT_THRESHOLD_DEFAULTS.memory)
            setDiskThreshold(ALERT_THRESHOLD_DEFAULTS.disk)
          }}
        />
      </div>
    </div>
  )
}
