/**
 * RiskSettings — 风险控制设置
 *
 * 路由：/settings/risk
 *
 * 设计稿：settings-risk.html（1:1 复刻）
 * - Card 1: 安全防护等级（3 级单选卡片 + 自动拦截 + 脱敏 + 录像保留）
 * - Card 2: 命令风险评级规则表（6 条规则 + 编辑/删除按钮 + 新增规则按钮）
 * - Card 3: 审计日志（4 个开关 + 保留天数 + 存储路径，共 6 行）
 * - Card 4: 应急响应（紧急快捷键 + 自动回滚 + 回滚超时 + 联系人 + 故障通知，共 5 行）
 * - ActionBar: 保存 / 恢复默认
 *
 * 设置项通过 usePersistentState 接入主进程 IPC（configGet/configSet）持久化，
 * electronAPI 不可用时退化为内存默认值，UI 正常渲染。
 * （规则操作反馈为瞬时 UI 状态，不持久化。）
 */
import { useState, useEffect, useRef } from 'react'
import {
  Shield,
  AlertTriangle,
  ScrollText,
  Zap,
  Edit3,
  Trash2,
  Plus,
  type LucideIcon,
} from 'lucide-react'
import { usePersistentState } from '@/hooks/usePersistentState'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsActionBar } from '@/components/settings/SettingsActionBar'
import { Switch } from '@/components/trae/Switch'
import { Input } from '@/components/trae/Input'
import { cn } from '@/components/trae/utils'

type ProtectionLevel = 'standard' | 'strict' | 'extreme'

interface ProtectionOption {
  value: ProtectionLevel
  label: string
  desc: string
}

const PROTECTION_LEVELS: ProtectionOption[] = [
  { value: 'standard', label: '标准', desc: '基础命令校验，快速执行' },
  { value: 'strict', label: '严格', desc: '命令校验+人工审批，平衡安全与效率' },
  { value: 'extreme', label: '极限', desc: '全量审计+双人审批+沙箱预演' },
]

type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical' | 'custom'
type RiskAction = 'allow' | 'notify' | 'confirm' | 'block' | 'custom'

interface RiskRule {
  id: string
  pattern: string
  level: RiskLevel
  action: RiskAction
}

const INITIAL_RULES: RiskRule[] = [
  { id: 'r1', pattern: 'rm -rf *', level: 'critical', action: 'block' },
  { id: 'r2', pattern: 'chmod 777', level: 'high', action: 'confirm' },
  { id: 'r3', pattern: 'systemctl restart', level: 'medium', action: 'notify' },
  { id: 'r4', pattern: 'cat /var/log/*', level: 'low', action: 'allow' },
  { id: 'r5', pattern: 'grep / ps / ls', level: 'none', action: 'allow' },
  { id: 'r6', pattern: '自定义正则', level: 'custom', action: 'custom' },
]

const LEVEL_LABEL: Record<RiskLevel, string> = {
  none: '无',
  low: '低',
  medium: '中',
  high: '高',
  critical: '极高',
  custom: '可配置',
}

const ACTION_LABEL: Record<RiskAction, string> = {
  allow: '放行',
  notify: '通知',
  confirm: '确认',
  block: '拦截',
  custom: '可配置',
}

/** 风险等级标签样式（彩色背景 + 白字，对应设计稿 ds-risk-tag--*） */
const LEVEL_TAG_CLASS: Record<RiskLevel, string> = {
  critical: 'bg-[var(--trae-status-error-default)] text-white',
  high: 'bg-[var(--trae-status-warning-default)] text-white',
  medium: 'bg-[var(--trae-status-primary-default)] text-white',
  low: 'bg-[var(--trae-status-success-default)] text-white',
  none: 'bg-[var(--trae-text-tertiary)] text-white',
  custom: '',
}

/** 动作标签样式（灰底 + 边框，对应设计稿 ds-action-tag） */
const ACTION_TAG_CLASS =
  'inline-flex h-5 items-center justify-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l2)] px-2 text-[10px] font-medium text-[var(--trae-text-secondary)]'

export function RiskSettings() {
  // Card 1: 安全防护等级
  const [protectionLevel, setProtectionLevel] = usePersistentState<ProtectionLevel>('risk.protectionLevel', 'strict')
  const [autoBlock, setAutoBlock] = usePersistentState('risk.autoBlock', true)
  const [desensitize, setDesensitize] = usePersistentState('risk.desensitize', true)
  // recordingRetention 为只读展示项，无对应 setter
  const [recordingRetention] = usePersistentState('risk.recordingRetention', 90)

  // Card 2: 风险规则
  const [rules, setRules] = usePersistentState<RiskRule[]>('risk.rules', INITIAL_RULES)
  const [ruleFeedback, setRuleFeedback] = useState<string | null>(null)
  const ruleFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 清理反馈定时器
  useEffect(() => {
    return () => {
      if (ruleFeedbackTimerRef.current != null) clearTimeout(ruleFeedbackTimerRef.current)
    }
  }, [])

  // 显示规则操作反馈（2s 后自动消失）
  const showRuleFeedback = (msg: string) => {
    setRuleFeedback(msg)
    if (ruleFeedbackTimerRef.current != null) clearTimeout(ruleFeedbackTimerRef.current)
    ruleFeedbackTimerRef.current = setTimeout(() => setRuleFeedback(null), 2000)
  }

  // 编辑规则（mock：仅显示反馈，真实场景应打开编辑弹窗）
  const handleEditRule = (rule: RiskRule) => {
    showRuleFeedback(`编辑规则：${rule.pattern}`)
  }

  // 删除规则
  const handleDeleteRule = (ruleId: string) => {
    const target = rules.find((r) => r.id === ruleId)
    setRules((prev) => prev.filter((r) => r.id !== ruleId))
    if (target) showRuleFeedback(`已删除规则：${target.pattern}`)
  }

  // 新增规则（mock：添加一条默认规则）
  const handleAddRule = () => {
    const newId = `r${Date.now()}`
    const newRule: RiskRule = {
      id: newId,
      pattern: '新规则 (点击编辑)',
      level: 'medium',
      action: 'notify',
    }
    setRules((prev) => [...prev, newRule])
    showRuleFeedback('已添加新规则，请点击编辑配置')
  }

  // Card 3: 审计日志
  const [auditCmdExec, setAuditCmdExec] = usePersistentState('risk.auditCmdExec', true)
  const [auditFileMod, setAuditFileMod] = usePersistentState('risk.auditFileMod', true)
  const [auditAiDecision, setAuditAiDecision] = usePersistentState('risk.auditAiDecision', true)
  const [auditSshConn, setAuditSshConn] = usePersistentState('risk.auditSshConn', true)
  // auditRetention 为只读展示项，无对应 setter
  const [auditRetention] = usePersistentState('risk.auditRetention', 180)
  const [auditPath, setAuditPath] = usePersistentState('risk.auditPath', '/var/log/tdsf/audit')

  // Card 4: 应急响应
  const [emergencyHotkey, setEmergencyHotkey] = usePersistentState('risk.emergencyHotkey', 'Ctrl+Shift+X')
  const [autoRollback, setAutoRollback] = usePersistentState('risk.autoRollback', true)
  // rollbackTimeout 为只读展示项，无对应 setter
  const [rollbackTimeout] = usePersistentState('risk.rollbackTimeout', 30)
  const [emergencyContact, setEmergencyContact] = usePersistentState('risk.emergencyContact', 'security@tdsf.dev')
  const [autoNotify, setAutoNotify] = usePersistentState('risk.autoNotify', true)

  return (
    <div>
      <SettingsPageHeader
        icon={Shield as LucideIcon}
        title="风险控制"
        desc="运维操作安全防护与审计策略"
      />

      <div className="flex flex-col gap-4 p-6">
        {/* Card 1: 安全防护等级 */}
        <SettingsCard icon={Shield} title="安全防护等级" tag="protection.level">
          {/* 3 级单选卡片（带左侧 2px 蓝条 + radio dot） */}
          <div className="grid grid-cols-3 gap-2.5 py-2 pb-2">
            {PROTECTION_LEVELS.map((opt) => {
              const selected = protectionLevel === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setProtectionLevel(opt.value)}
                  className={cn(
                    'relative flex flex-col gap-1.5 rounded-[var(--trae-radius-6)] border px-3 py-3 text-left transition-colors',
                    selected
                      ? 'border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand-popup)]'
                      : 'border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] hover:border-[var(--trae-border-neutral-l3)]',
                  )}
                >
                  {/* 选中态左侧 2px 蓝色指示条 */}
                  {selected && (
                    <span
                      aria-hidden
                      className="absolute -left-px top-2.5 bottom-2.5 w-0.5 rounded-r-[var(--trae-radius-6)] bg-[var(--trae-bg-brand)]"
                    />
                  )}
                  <div className="flex w-full items-center justify-between gap-2">
                    <span
                      className={cn(
                        'text-[11px] font-medium',
                        selected
                          ? 'text-[var(--trae-text-default-hover)]'
                          : 'text-[var(--trae-text-default)]',
                      )}
                    >
                      {opt.label}
                    </span>
                    {/* radio dot */}
                    <span
                      className={cn(
                        'flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-colors',
                        selected
                          ? 'border-[var(--trae-bg-brand)]'
                          : 'border-[var(--trae-border-neutral-l3)]',
                      )}
                    >
                      {selected && (
                        <span className="size-2 rounded-full bg-[var(--trae-bg-brand)]" />
                      )}
                    </span>
                  </div>
                  <span className="text-[10px] leading-[14px] text-[var(--trae-text-secondary)]">
                    {opt.desc}
                  </span>
                </button>
              )
            })}
          </div>

          <SettingsRow
            label="自动拦截危险命令"
            desc="命中风险规则时自动阻断执行"
            control={<Switch checked={autoBlock} onCheckedChange={setAutoBlock} />}
          />
          <SettingsRow
            label="敏感文件自动脱敏"
            desc=".env / .ssh / *_key 发送前自动 redact"
            control={<Switch checked={desensitize} onCheckedChange={setDesensitize} />}
          />
          <SettingsRow
            label="操作录像保留天数"
            desc="终端操作录像的保留周期"
            control={
              <div className="inline-flex h-[30px] min-w-[88px] items-center justify-center rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] px-2.5 font-mono text-[12px] font-medium tabular-nums text-[var(--trae-text-default)]">
                {recordingRetention}
              </div>
            }
            isLast
          />
        </SettingsCard>

        {/* Card 2: 命令风险评级规则表 */}
        <SettingsCard icon={AlertTriangle} title="命令风险评级规则" tag={`${rules.length} rules`}>
          <div className="mt-1.5 overflow-x-auto rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)]">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l2)] text-left text-[11px] font-medium text-[var(--trae-text-secondary)]">
                  <th className="px-3 py-2" style={{ width: '34%' }}>
                    命令模式
                  </th>
                  <th className="px-3 py-2" style={{ width: '18%' }}>
                    风险等级
                  </th>
                  <th className="px-3 py-2" style={{ width: '18%' }}>
                    动作
                  </th>
                  <th className="px-3 py-2 text-right" style={{ width: '30%' }}>
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr
                    key={rule.id}
                    className="border-b border-[var(--trae-border-neutral-l1)] last:border-0 transition-colors hover:bg-[var(--trae-bg-overlay-l1)]"
                  >
                    <td className="px-3 py-2.5 font-mono text-[12px] text-[var(--trae-code-text)]">
                      {rule.pattern}
                    </td>
                    <td className="px-3 py-2.5">
                      {rule.level === 'custom' ? (
                        <span className={ACTION_TAG_CLASS}>{LEVEL_LABEL[rule.level]}</span>
                      ) : (
                        <span
                          className={cn(
                            'inline-flex h-5 items-center justify-center rounded-[var(--trae-radius-4)] px-2 text-[10px] font-semibold tracking-[0.02em] text-white',
                            LEVEL_TAG_CLASS[rule.level],
                          )}
                        >
                          {LEVEL_LABEL[rule.level]}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={ACTION_TAG_CLASS}>{ACTION_LABEL[rule.action]}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleEditRule(rule)}
                        aria-label={`编辑规则 ${rule.pattern}`}
                        className="mr-1 inline-flex h-7 items-center gap-1 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-transparent px-2.5 text-[10px] font-medium text-[var(--trae-text-default)] transition-colors hover:border-[var(--trae-border-neutral-l3)] hover:bg-[var(--trae-bg-overlay-l1)] active:scale-95"
                      >
                        <Edit3 className="size-3" />
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(rule.id)}
                        aria-label={`删除规则 ${rule.pattern}`}
                        className="inline-flex h-7 items-center gap-1 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-transparent px-3 text-[10px] font-medium text-[var(--trae-status-error-default)] transition-colors hover:border-[var(--trae-status-error-default)] hover:bg-[var(--trae-status-error-surface-l1)] active:scale-95"
                      >
                        <Trash2 className="size-3" />
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 新增规则按钮 + 反馈 */}
          <div className="flex items-center gap-3 pt-3">
            <button
              type="button"
              onClick={handleAddRule}
              aria-label="新增规则"
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand)] px-4 text-[12px] font-medium text-[var(--trae-text-onbrand)] transition-colors hover:bg-[var(--trae-bg-brand-hover)] hover:border-[var(--trae-bg-brand-hover)] active:scale-95"
            >
              <Plus className="size-3.5" />
              新增规则
            </button>
            {ruleFeedback && (
              <span className="text-[10px] text-[var(--trae-status-success-default)]">
                {ruleFeedback}
              </span>
            )}
          </div>
        </SettingsCard>

        {/* Card 3: 审计日志（6 行） */}
        <SettingsCard icon={ScrollText} title="审计日志" tag="audit.log">
          <SettingsRow
            label="记录所有命令执行"
            desc="完整记录终端命令的执行与结果"
            control={<Switch checked={auditCmdExec} onCheckedChange={setAuditCmdExec} />}
          />
          <SettingsRow
            label="记录文件修改"
            desc="追踪写入、删除、权限变更等操作"
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
            control={
              <div className="inline-flex h-[30px] min-w-[88px] items-center justify-center rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] px-2.5 font-mono text-[12px] font-medium tabular-nums text-[var(--trae-text-default)]">
                {auditRetention}
              </div>
            }
          />
          <SettingsRow
            label="审计日志存储路径"
            desc="本地落盘目录，建议挂载独立分区"
            control={
              <Input
                value={auditPath}
                onChange={(e) => setAuditPath(e.target.value)}
                className="w-[280px] font-mono"
              />
            }
            isLast
          />
        </SettingsCard>

        {/* Card 4: 应急响应（5 行） */}
        <SettingsCard icon={Zap} title="应急响应" tag="incident.response">
          <SettingsRow
            label="紧急停止快捷键"
            desc="触发后立即中断所有正在执行的命令"
            control={
              <Input
                value={emergencyHotkey}
                onChange={(e) => setEmergencyHotkey(e.target.value)}
                className="w-[160px] font-mono"
              />
            }
          />
          <SettingsRow
            label="自动回滚"
            desc="检测到异常时自动回滚操作"
            control={<Switch checked={autoRollback} onCheckedChange={setAutoRollback} />}
          />
          <SettingsRow
            label="回滚确认超时"
            desc="超时未确认则自动执行回滚"
            control={
              <div className="inline-flex h-[30px] min-w-[88px] items-center justify-center rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] px-2.5 font-mono text-[12px] font-medium tabular-nums text-[var(--trae-text-default)]">
                {rollbackTimeout}
              </div>
            }
          />
          <SettingsRow
            label="紧急联系人"
            desc="高危事件发生时通知的邮箱或 IM 账号"
            control={
              <Input
                value={emergencyContact}
                onChange={(e) => setEmergencyContact(e.target.value)}
                className="w-[220px] font-mono"
              />
            }
          />
          <SettingsRow
            label="故障自动通知"
            desc="服务异常或规则触发时自动推送通知"
            control={<Switch checked={autoNotify} onCheckedChange={setAutoNotify} />}
            isLast
          />
        </SettingsCard>

        <SettingsActionBar />
      </div>
    </div>
  )
}
