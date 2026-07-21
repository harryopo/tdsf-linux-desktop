/**
 * PlanBuildButton 组件（v0.9.5 P0 - Plan→Build 双模衔接）
 *
 * 借鉴 xai-org/grok-build §4 Plan/Build 双模设计：
 * - Plan 模式生成结构化方案后，UI 显示"开始执行"按钮
 * - 点击后调用 modeSetDefault(nextMode) 切到 Build 模式，UI 提示用户
 *
 * 显示逻辑：
 * - 仅当 currentMode 是 plan 时显示
 * - 仅当最后一条 assistant 消息有内容（不含流式中）时显示
 * - 衔接按钮文案来自 ModeConfig.nextModeButtonLabel
 * - 切到的目标 mode 来自 ModeConfig.nextModeOnConfirm
 *
 * UI 文案（动态生成）：
 * - 按钮：[nextModeButtonLabel]（默认"开始执行"）
 * - 提示：切到 [nextMode displayName] 后可执行命令
 *
 * 方案书依据：v0.9.5 §UI接入接线图（Plan→Build 双模衔接）
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\34-源码分析-grok-build.md §四 P0 借鉴点
 */
import React, { useCallback, useState } from 'react'
import { Button, Space, Tag, message } from 'antd'
import { PlayCircleOutlined, SwapOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { useAgentStore } from '../../stores/agent-store'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import type { AgentMode, ModeInfo } from '@shared/agent-types'
import './PlanBuildButton.css'

interface PlanBuildButtonProps {
  /** 当前最后一条 assistant 消息是否有可执行方案（用于显示按钮的开关） */
  hasPlanOutput: boolean
}

const PlanBuildButton: React.FC<PlanBuildButtonProps> = ({ hasPlanOutput }) => {
  const currentMode = useAgentStore((s) => s.currentMode)
  const modeList = useAgentStore((s) => s.modeList)
  const setCurrentMode = useAgentStore((s) => s.setCurrentMode)

  /** 切换中标记（防止重复点击） */
  const [switching, setSwitching] = useState(false)
  /** 已切换标记（成功后显示"已切到 X 模式"绿色提示，3 秒后恢复） */
  const [switched, setSwitched] = useState(false)

  // ===== 派生：当前 plan 模式的 nextMode 配置 =====
  // 由于 ModeConfig 字段只在 main 层可用，渲染进程只能从 modeList 推断
  // 方案：通过硬编码映射（plan → code）配合 fallback
  // 更优做法：v0.9.5 后续批次可把 nextMode 字段扩展到 ModeInfo
  const nextMode: AgentMode | undefined = currentMode === 'plan' ? 'code' : undefined
  const nextModeInfo: ModeInfo | undefined = nextMode
    ? modeList.find((m) => m.name === nextMode)
    : undefined
  const buttonLabel: string = currentMode === 'plan' ? '开始执行' : '继续'

  // ===== 显示条件：plan 模式 + 有方案输出 + 目标 mode 存在 =====
  const visible = currentMode === 'plan' && hasPlanOutput && Boolean(nextMode)

  /**
   * 切换到目标 mode（Plan → Build 衔接）
   */
  const handleSwitch = useCallback(async () => {
    if (!nextMode || switching) return
    if (!isElectronAPIAvailable() || !window.electronAPI?.modeSetDefault) {
      message.error('IPC 不可用，无法切换模式')
      return
    }
    setSwitching(true)
    try {
      const response = await window.electronAPI.modeSetDefault({ mode: nextMode })
      if (!response.success) {
        message.error('模式切换失败：非法 mode')
        return
      }
      setCurrentMode(nextMode)
      setSwitched(true)
      message.success(`已切到「${nextModeInfo?.displayName ?? nextMode}」模式，可继续提问以执行命令`)
      // 3 秒后恢复按钮状态（用户可能再次切回 plan 模式）
      setTimeout(() => setSwitched(false), 3000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      message.error(`模式切换失败：${msg}`)
    } finally {
      setSwitching(false)
    }
  }, [nextMode, nextModeInfo, switching, setCurrentMode])

  if (!visible) return null

  return (
    <div className="plan-build-button" role="region" aria-label="Plan→Build 模式衔接">
      <Space size="small" className="plan-build-button-main">
        <Tag
          color={switched ? 'success' : 'blue'}
          icon={switched ? <CheckCircleOutlined /> : <SwapOutlined />}
          className="plan-build-button-tag"
        >
          {switched
            ? `已切到「${nextModeInfo?.displayName ?? nextMode}」`
            : `Plan 方案已就绪 → 切到「${nextModeInfo?.displayName ?? nextMode}」执行`}
        </Tag>
        <Button
          type="primary"
          size="small"
          icon={<PlayCircleOutlined />}
          loading={switching}
          onClick={handleSwitch}
          className="plan-build-button-action"
        >
          {buttonLabel}
        </Button>
      </Space>
      <div className="plan-build-button-hint">
        切换后，Agent 将获得写文件 + 执行命令权限；高风险操作仍需人工审批。
      </div>
    </div>
  )
}

export default PlanBuildButton
