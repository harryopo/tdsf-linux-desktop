/**
 * RiskSettings — 风险控制设置
 *
 * 路由：/settings/risk
 *
 * 这个页面只剩两块真东西：
 * - 命令风险评级规则：只读，数据来自 risk:rules（主进程 command-rules.json 的快照）
 * - 审计日志：4 个开关 + 保留天数，由 services/db/audit-repo.ts 真正消费
 *
 * 删掉的假设置（全仓零消费者，遵循 DESIGN.md §10「界面不写未实现的能力」）：
 * - 安全防护等级（risk.protectionLevel）、自动拦截（risk.autoBlock）、
 *   脱敏（risk.desensitize）、录像保留（risk.recordingRetention）：
 *   拦截与脱敏都由主进程固定执行，拨动开关不改任何行为。
 * - 三态权限模式（risk.permissionMode）：审批由规则的 requiresConfirm 决定，
 *   不是用户可设的档位；把它接上等于在界面上放一个「跳过所有审批」的开关。
 * - risk.rules 的可编辑表格：页面自己存一份规则、增删改都落库，但判定走的是
 *   随包分发的 command-rules.json，用户改的那张表谁也不读。能随手删掉
 *   rm -rf / 拦截项的"设置"不是安全特性，所以这张表改成只读真值。
 * - 更早删掉的：审计存储路径（risk.auditPath）与整张「应急响应」Card。
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw, ScrollText, ShieldCheck } from 'lucide-react'
import type { RiskRuleView, RiskRulesSnapshot } from '@shared/ipc-channels'
import { usePersistentState } from '@/hooks/usePersistentState'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { settingsHeader } from './settings-sections'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsActionBar } from '@/components/settings/SettingsActionBar'
import { Switch } from '@/components/trae/Switch'
import { cn } from '@/components/trae/utils'
import './Settings.css'

/** 引擎的 5 档级别 -> 界面标签与样式（样式沿用设计稿的 set-risk-tag--*） */
const LEVEL_VIEW: Record<RiskRuleView['level'], { label: string; className: string }> = {
  safe: { label: '安全', className: 'set-risk-tag--none' },
  low: { label: '低', className: 'set-risk-tag--low' },
  medium: { label: '中', className: 'set-risk-tag--medium' },
  high: { label: '高', className: 'set-risk-tag--high' },
  block: { label: '拒绝', className: 'set-risk-tag--critical' },
}

/** 一条规则的处置结论：拒绝 > 需确认 > 放行，与 command-gate 的判定口径一致 */
function verdictOf(rule: RiskRuleView): string {
  if (rule.level === 'block') return '直接拒绝'
  if (rule.requiresConfirm) return '需人工确认'
  return '放行'
}

/** 命令名单展示：超过 5 个收成「rm dd mkfs … +3」，避免一行撑爆表格 */
function commandsLabel(commands: readonly string[]): string {
  const shown = commands.slice(0, 5).join(' ')
  return commands.length > 5 ? `${shown} +${commands.length - 5}` : shown || '—'
}

function RulesTable({ rules }: { rules: readonly RiskRuleView[] }) {
  return (
    <table className="set-table">
      <thead>
        <tr>
          <th style={{ width: '26%' }}>命中命令</th>
          <th style={{ width: '12%' }}>级别</th>
          <th style={{ width: '16%' }}>处置</th>
          <th style={{ width: '46%' }}>为什么要管</th>
        </tr>
      </thead>
      <tbody>
        {rules.map((rule) => {
          const level = LEVEL_VIEW[rule.level]
          return (
            <tr key={rule.id}>
              <td className="col-cmd">
                {commandsLabel(rule.commands)}
                {rule.subcommands?.length ? (
                  <span className="ml-1 text-ink-mute">
                    {`(${rule.subcommands.join(' ')})`}
                  </span>
                ) : null}
              </td>
              <td>
                <span className={cn('set-risk-tag', level.className)}>{level.label}</span>
              </td>
              <td>
                <span className="set-action-tag">{verdictOf(rule)}</span>
              </td>
              <td className="text-caption text-ink-dim">{rule.reason}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function RiskSettings() {
  // 只读规则快照：idle 区分"还没取到"与"取到了但是空的"
  const [rulesState, setRulesState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: RiskRulesSnapshot }
  >({ status: 'loading' })
  // 进页面即拉一次；失败后「重新读取」把 fetchKey +1 触发同一 effect 重跑
  const [fetchKey, setFetchKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!window.electronAPI) {
      setRulesState({ status: 'error', message: '当前环境拿不到主进程规则（非 Electron 运行时）' })
      return
    }
    setRulesState({ status: 'loading' })
    window.electronAPI
      .riskGetRules()
      .then((data) => {
        if (!cancelled) setRulesState({ status: 'ready', data })
      })
      .catch((err: unknown) => {
        if (!cancelled) setRulesState({ status: 'error', message: (err as Error).message })
      })
    return () => {
      cancelled = true
    }
  }, [fetchKey])

  const retry = useCallback(() => setFetchKey((k) => k + 1), [])

  // 审计日志：4 个开关 + 保留天数，全部由 services/db/audit-repo.ts 消费
  const [auditCmdExec, setAuditCmdExec] = usePersistentState('risk.auditCmdExec', true)
  const [auditFileMod, setAuditFileMod] = usePersistentState('risk.auditFileMod', true)
  const [auditAiDecision, setAuditAiDecision] = usePersistentState('risk.auditAiDecision', true)
  const [auditSshConn, setAuditSshConn] = usePersistentState('risk.auditSshConn', true)
  // auditRetention 为只读展示项，无对应 setter
  const [auditRetention] = usePersistentState('risk.auditRetention', 180)

  return (
    <div className="set-subpage">
      <SettingsPageHeader {...settingsHeader('/settings/risk')} />

      <div className="set-subpage__body">
        {/* Card 1: 拦截规则（只读真值） */}
        <SettingsCard
          icon={ShieldCheck}
          title="命令风险评级规则"
          tag={
            rulesState.status === 'ready'
              ? `v${rulesState.data.version} · ${rulesState.data.rules.length} 条`
              : '引擎规则'
          }
        >
          <p className="pb-2 pt-1 text-caption leading-[16px] text-ink-dim">
            下面是主进程真正在用的那份规则：命中「拒绝」的命令一律不执行，标「需人工确认」的先弹审批。
            规则随应用分发、界面上只读——能在设置里随手删掉 rm -rf 拦截项的「安全设置」不是安全设置。
          </p>

          {rulesState.status === 'loading' ? (
            <div className="flex items-center gap-2 py-6 text-caption text-ink-mute">
              <Loader2 className="size-3.5 animate-spin" />
              正在读取引擎规则…
            </div>
          ) : rulesState.status === 'error' ? (
            <div className="flex items-center justify-between gap-3 rounded-(--ui-radius-control) border border-error/30 bg-error/10 px-3 py-2">
              <span className="text-caption text-(--status-error-text)">
                规则读取失败：{rulesState.message}
              </span>
              <button
                type="button"
                onClick={retry}
                aria-label="重新读取规则"
                className="set-btn-ghost btn-press shrink-0"
              >
                <RefreshCw className="di-12" />
                重新读取
              </button>
            </div>
          ) : rulesState.data.rules.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-caption text-ink-mute">
              <AlertTriangle className="di-14" />
              规则表是空的，所有命令都会直接执行。这通常是安装损坏，请重新安装。
            </div>
          ) : (
            <RulesTable rules={rulesState.data.rules} />
          )}
        </SettingsCard>

        {/* Card 2: 审计日志（4 开关 + 保留天数） */}
        <SettingsCard icon={ScrollText} title="审计日志" tag="audit.log">
          <SettingsRow
            label="记录所有命令执行"
            desc="完整记录终端命令的执行与结果"
            control={<Switch checked={auditCmdExec} onCheckedChange={setAuditCmdExec} />}
          />
          <SettingsRow
            label="记录文件修改"
            desc="追踪上传、删除、改名、改权限、写文件、建目录"
            control={<Switch checked={auditFileMod} onCheckedChange={setAuditFileMod} />}
          />
          <SettingsRow
            label="记录 AI 决策过程"
            desc="保存命令解析、风险判定、建议生成链路"
            control={<Switch checked={auditAiDecision} onCheckedChange={setAuditAiDecision} />}
          />
          <SettingsRow
            label="记录 SSH 连接"
            desc="记录登录、断开、认证方式与会话时长"
            control={<Switch checked={auditSshConn} onCheckedChange={setAuditSshConn} />}
          />
          <SettingsRow
            label="审计日志保留天数"
            desc="超过保留期的日志自动归档或清理"
            control={<ReadOnlyNum value={auditRetention} />}
            isLast
          />
        </SettingsCard>

        <SettingsActionBar
          onReset={() => {
            // 只重置本页面真正存在的开关；auditRetention 为只读展示项（无 setter）不参与
            setAuditCmdExec(true)
            setAuditFileMod(true)
            setAuditAiDecision(true)
            setAuditSshConn(true)
          }}
        />
      </div>
    </div>
  )
}

/** 只读数值展示框（对应设计稿 set-num） */
function ReadOnlyNum({ value }: { value: number | string }) {
  return <div className="set-num">{value}</div>
}
