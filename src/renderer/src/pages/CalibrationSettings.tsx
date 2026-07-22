/**
 * CalibrationSettings 校准设置页（v0.9.6 P1）
 *
 * 路由：/settings/calibration
 *
 * 职责：嵌入 CalibrationPanel，提供 ECE 校准器（CalibrationTuner）的 UI 控制台
 * - 全局状态摘要
 * - Provider 切换与详情
 * - T 滑块实时调整
 * - 分桶校准误差柱状图 + T 搜索轨迹折线图
 * - 触发校准 / 重置 / 注入测试样本
 *
 * 论文支撑（见 CalibrationPanel 头部注释）：
 * - Guo et al. 2017 (ICML, arXiv:1706.04599) — Temperature Scaling
 * - Kadavath et al. 2022 (Anthropic, arXiv:2207.05221) — LLM 自我评估校准
 * - Shrivastava et al. 2023 (Stanford, arXiv:2311.08877) — Provider 分类校准
 *
 * 方案书依据：v0.9.6 P1 §ECE 校准器
 */
import { useState, useEffect } from 'react'
import { GaugeCircle, Info, BarChart3 } from 'lucide-react'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsCard } from '@/components/settings/SettingsCard'
import CalibrationPanel from '@/components/ai/CalibrationPanel'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import './Settings.css'

/**
 * CalibrationSettings 校准设置页
 */
export function CalibrationSettings() {
  /** 是否处于开发模式（启用测试样本注入） */
  const [devMode, setDevMode] = useState(false)

  useEffect(() => {
    // 自动检测开发模式（Electron + Vite DEV 或本地文件）
    if (typeof window !== 'undefined') {
      const isDev =
        window.location.hostname === 'localhost' ||
        window.location.protocol === 'file:' ||
        (window as unknown as { __DEV__?: boolean }).__DEV__ === true
      setDevMode(isDev)
    }
  }, [])

  return (
    <div>
      <SettingsPageHeader
        icon={GaugeCircle}
        title="可信度校准"
        desc="基于 ECE 评估与 Temperature Scaling 的 LLM 校准器。按 Provider 分类管理 T 值，缓解现代神经网络的过度自信偏置。"
      />

      <div className="set-panel-content">
        {/* 警告条：生产环境慎用测试样本注入 */}
        {!isElectronAPIAvailable() && (
          <SettingsCard icon={Info} title="环境提示">
            <div className="set-calib-notice">
              当前不在 Electron 环境中，校准面板 IPC 不可用。请在 tdsf-linux-desktop 主应用中访问此页面。
            </div>
          </SettingsCard>
        )}

        {/* 主面板 */}
        <SettingsCard icon={BarChart3} title="ECE 校准器" tag="Provider 分类 Temperature Scaling">
          <CalibrationPanel
            enableTestSample={devMode}
          />
        </SettingsCard>
      </div>
    </div>
  )
}

export default CalibrationSettings
