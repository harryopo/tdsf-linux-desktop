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
      {/*
        口径要写在界面上（用户 2026-10-16："知识库调用记录是假的"）。这张表数的是
        tool_call_log，由能力真正执行的那一层各记一笔。三件事要说清：
        - 你在终端里手敲回车的命令走交互 shell 通道，不经执行接口，不计入；
        - 知识库那一笔按"检索调用"计，一次提问可能触发两次（关键词没命中会再兜底查一遍）；
        - 2026-10-16 修正过口径，此前的旧行不再计入（起算点存在 stats.toolCallCutoffAt）。
      */}
      <p className="mb-3 text-caption leading-relaxed text-ink-mute">
        口径：程序与 AI 每真正调用一项能力记一笔（一次提问可能触发多次检索）。
        你在终端里手敲回车的命令走交互通道，不计入这里。
      </p>

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
