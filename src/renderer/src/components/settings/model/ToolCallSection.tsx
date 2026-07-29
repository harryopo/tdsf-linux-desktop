/**
 * ToolCallSection — 功能调用统计 Section（M5 Task 6 拆分）
 *
 * 从 ModelSettings.tsx 抽取，负责渲染工具调用排行（水平条形图）+ 总览统计行。
 *
 * 原 Section 5：功能调用统计 SettingsCard。
 */
import { Layers } from 'lucide-react'
import { SettingsCard } from '@/components/settings/SettingsCard'
import type { ToolCallStat } from '@shared/models'

export interface ToolCallSectionProps {
  /** 工具调用统计列表（来自 modelToolCalls IPC） */
  toolCallStats: ToolCallStat[]
}

export function ToolCallSection(props: ToolCallSectionProps) {
  const { toolCallStats } = props

  return (
    <SettingsCard
      icon={Layers}
      title="功能调用统计"
      tag="usage.tools"
      className="p-5"
      hideTag
      noHeadBorder
      headMb="lg"
    >
      {/* 功能调用排行（水平条形图） */}
      <div className="set-tool-stats">
        {toolCallStats.length === 0 ? (
          <div className="set-tool-stats__empty">
            暂无工具调用数据
          </div>
        ) : (
          toolCallStats.map((s) => (
          <div key={s.name} className="set-tool-row">
            <span className="set-tool-row__name">
              {s.name}
            </span>
            <div className="set-tool-row__bar">
              <div
                className="set-tool-row__fill"
                style={{ width: `${s.percent}%` }}
              >
                <span className="set-tool-row__count">
                  {s.count}
                </span>
              </div>
            </div>
            <span className="set-tool-row__percent">
              {s.percent}%
            </span>
          </div>
        ))
        )}
      </div>

      {/* 底部统计行（v2.11 去假：ToolCallStat 仅有 count/percent，
          无成功率/耗时数据来源，移除原硬编码的 94.3%/2.1s。
          仅保留真实可算的“总调用”） */}
      <div className="set-tool-summary">
        <span className="set-tool-summary__item">
          总调用{' '}
          <span className="set-tool-summary__val set-tool-summary__val--default">
            {toolCallStats.reduce((sum, s) => sum + s.count, 0)}
          </span>{' '}
          次
        </span>
      </div>
    </SettingsCard>
  )
}
