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
import { Modal, Form, Input as AntInput, Select } from 'antd'
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
import './Settings.css'

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

/**
 * v2.0 Phase C Task C.6：三态权限模式（与主进程 risk-engine.ts PermissionMode 同构）
 *
 * - 'always'：所有命令都需要人工审批（HC-6 默认，最严格）
 * - 'auto'：SAFE/LOW 自动执行；MEDIUM/HIGH/CRITICAL 需审批（兼顾效率与安全）
 * - 'never'：所有命令自动执行，不弹审批（仅用于演示/沙箱，生产禁用）
 */
type PermissionMode = 'always' | 'auto' | 'never'

interface PermissionOption {
  value: PermissionMode
  label: string
  desc: string
  badge: string
}

const PERMISSION_MODES: PermissionOption[] = [
  { value: 'always', label: '全部审批', desc: '所有命令都需人工确认后才执行', badge: '最严' },
  { value: 'auto', label: '智能自动', desc: 'SAFE/LOW 自动放行，MEDIUM 及以上需审批', badge: '推荐' },
  { value: 'never', label: '自动放行', desc: '所有命令自动执行，无审批弹窗（仅沙箱）', badge: '危险' },
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

/** 风险等级标签样式（彩色背景 + 白字，对应设计稿 set-risk-tag--*） */
const LEVEL_TAG_CLASS: Record<RiskLevel, string> = {
  critical: 'set-risk-tag--critical',
  high: 'set-risk-tag--high',
  medium: 'set-risk-tag--medium',
  low: 'set-risk-tag--low',
  none: 'set-risk-tag--none',
  custom: '',
}

/** 动作标签样式（灰底 + 边框，对应设计稿 set-action-tag） */
const ACTION_TAG_CLASS = 'set-action-tag'

/** 规则编辑弹窗 - 风险等级 Select 选项（5 个，不含 custom；value 类型与 RiskLevel 兼容） */
const LEVEL_OPTIONS: { value: RiskLevel; label: string }[] = [
  { value: 'none', label: LEVEL_LABEL.none },
  { value: 'low', label: LEVEL_LABEL.low },
  { value: 'medium', label: LEVEL_LABEL.medium },
  { value: 'high', label: LEVEL_LABEL.high },
  { value: 'critical', label: LEVEL_LABEL.critical },
]

/** 规则编辑弹窗 - 动作 Select 选项（5 个） */
const ACTION_OPTIONS: { value: RiskAction; label: string }[] = [
  { value: 'allow', label: ACTION_LABEL.allow },
  { value: 'notify', label: ACTION_LABEL.notify },
  { value: 'confirm', label: ACTION_LABEL.confirm },
  { value: 'block', label: ACTION_LABEL.block },
  { value: 'custom', label: ACTION_LABEL.custom },
]

/** 规则编辑表单值 */
interface RuleFormValues {
  pattern: string
  level: RiskLevel
  action: RiskAction
}

/** 只读数值展示框（对应设计稿 set-num） */
function ReadOnlyNum({ value }: { value: number | string }) {
  return (
    <div className="set-num">
      {value}
    </div>
  )
}

export function RiskSettings() {
  // Card 1: 安全防护等级
  const [protectionLevel, setProtectionLevel] = usePersistentState<ProtectionLevel>('risk.protectionLevel', 'strict')
  const [autoBlock, setAutoBlock] = usePersistentState('risk.autoBlock', true)
  const [desensitize, setDesensitize] = usePersistentState('risk.desensitize', true)
  // recordingRetention 为只读展示项，无对应 setter
  const [recordingRetention] = usePersistentState('risk.recordingRetention', 90)

  // Card 1.5: v2.0 Phase C Task C.6 三态权限模式（与主进程 risk-engine.ts PermissionMode 对应）
  // 默认 'always'（HC-6 强制审批），用户可在设置中切换为 'auto' 提升效率
  const [permissionMode, setPermissionMode] = usePersistentState<PermissionMode>('risk.permissionMode', 'always')

  // Card 2: 风险规则
  const [rules, setRules] = usePersistentState<RiskRule[]>('risk.rules', INITIAL_RULES)
  const [ruleFeedback, setRuleFeedback] = useState<string | null>(null)
  const ruleFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 规则编辑弹窗状态：editingRule=null 表示新增模式，否则为编辑模式
  const [editingRule, setEditingRule] = useState<RiskRule | null>(null)
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false)
  const [ruleForm] = Form.useForm<RuleFormValues>()

  // 清理反馈定时器
  useEffect(() => {
    return () => {
      if (ruleFeedbackTimerRef.current != null) clearTimeout(ruleFeedbackTimerRef.current)
    }
  }, [])

  // Modal 打开时同步表单初始值（编辑模式回填，新增模式用默认值）
  useEffect(() => {
    if (isRuleModalOpen) {
      ruleForm.setFieldsValue({
        pattern: editingRule?.pattern ?? '',
        level: editingRule?.level ?? 'medium',
        action: editingRule?.action ?? 'notify',
      })
    }
  }, [isRuleModalOpen, editingRule, ruleForm])

  // 显示规则操作反馈（2s 后自动消失）
  const showRuleFeedback = (msg: string) => {
    setRuleFeedback(msg)
    if (ruleFeedbackTimerRef.current != null) clearTimeout(ruleFeedbackTimerRef.current)
    ruleFeedbackTimerRef.current = setTimeout(() => setRuleFeedback(null), 2000)
  }

  // 编辑规则：设置 editingRule 并打开 Modal
  const handleEditRule = (rule: RiskRule) => {
    setEditingRule(rule)
    setIsRuleModalOpen(true)
  }

  // 删除规则
  const handleDeleteRule = (ruleId: string) => {
    const target = rules.find((r) => r.id === ruleId)
    setRules((prev) => prev.filter((r) => r.id !== ruleId))
    if (target) showRuleFeedback(`已删除规则：${target.pattern}`)
  }

  // 新增规则：editingRule=null 表示新增模式，打开 Modal
  const handleAddRule = () => {
    setEditingRule(null)
    setIsRuleModalOpen(true)
  }

  // 保存规则（Modal 确认按钮）：editingRule=null 时新增，否则替换 id 匹配的规则
  const handleSaveRule = async () => {
    try {
      const values = await ruleForm.validateFields()
      const newRule: RiskRule = {
        id: editingRule?.id ?? `r${Date.now()}`,
        pattern: values.pattern,
        level: values.level,
        action: values.action,
      }
      if (editingRule === null) {
        setRules((prev) => [...prev, newRule])
      } else {
        setRules((prev) => prev.map((r) => (r.id === newRule.id ? newRule : r)))
      }
      setIsRuleModalOpen(false)
      setEditingRule(null)
      showRuleFeedback(`已保存规则：${newRule.pattern}`)
    } catch {
      // 表单验证失败，保持 Modal 打开等待用户修正
    }
  }

  // 取消编辑：关闭 Modal 并清空 editingRule 避免状态泄漏
  const handleCancelEdit = () => {
    setIsRuleModalOpen(false)
    setEditingRule(null)
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

      <div className="set-panel-content">
        {/* Card 1: 安全防护等级 */}
        <SettingsCard icon={Shield} title="安全防护等级" tag="protection.level">
          {/* 3 级单选卡片（带左侧 2px 蓝条 + radio dot） */}
          <div className="set-radiogroup">
            {PROTECTION_LEVELS.map((opt) => {
              const selected = protectionLevel === opt.value
              return (
                <label
                  key={opt.value}
                  className={cn('set-radio-card btn-press', selected && 'is-checked')}
                >
                  <input
                    type="radio"
                    name="protection-level"
                    checked={selected}
                    onChange={() => setProtectionLevel(opt.value)}
                  />
                  <div className="set-radio-card__head">
                    <span className="set-radio-card__title">{opt.label}</span>
                    <span className="set-radio-card__dot" />
                  </div>
                  <span className="set-radio-card__desc">
                    {opt.desc}
                  </span>
                </label>
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
            control={<ReadOnlyNum value={recordingRetention} />}
            isLast
          />
        </SettingsCard>

        {/* Card 1.5: v2.0 Phase C Task C.6 命令审批模式（三态权限） */}
        <SettingsCard icon={Shield} title="命令审批模式" tag={PERMISSION_MODES.find((m) => m.value === permissionMode)?.label ?? '全部审批'}>
          <p className="pb-2 pt-1 text-[11px] leading-[16px] text-[var(--trae-text-secondary)]">
            控制运维 Agent 执行命令时是否需要人工审批。建议生产环境使用「全部审批」或「智能自动」。
          </p>
          <div className="set-radiogroup">
            {PERMISSION_MODES.map((opt) => {
              const selected = permissionMode === opt.value
              const isDanger = opt.value === 'never'
              return (
                <label
                  key={opt.value}
                  className={cn(
                    'set-radio-card btn-press',
                    selected && (isDanger ? 'is-checked is-danger' : 'is-checked'),
                  )}
                >
                  <input
                    type="radio"
                    name="permission-mode"
                    checked={selected}
                    onChange={() => setPermissionMode(opt.value)}
                  />
                  <div className="set-radio-card__head">
                    <span
                      className={cn(
                        'set-radio-card__title',
                        selected && isDanger && 'text-[var(--trae-status-error-default)]',
                      )}
                    >
                      {opt.label}
                    </span>
                    <span
                      className={cn(
                        'inline-flex h-4 items-center justify-center rounded-[var(--trae-radius-4)] px-1.5 text-[9px] font-medium',
                        opt.value === 'never'
                          ? 'bg-[var(--trae-status-error)]/10 text-[var(--trae-status-error)]'
                          : opt.value === 'auto'
                            ? 'bg-[var(--trae-bg-brand)]/15 text-[var(--trae-text-brand)]'
                            : 'bg-[var(--trae-bg-overlay-l3)] text-[var(--trae-text-secondary)]'
                      )}
                    >
                      {opt.badge}
                    </span>
                  </div>
                  <span className="set-radio-card__desc">
                    {opt.desc}
                  </span>
                </label>
              )
            })}
          </div>
          {permissionMode === 'never' && (
            <div className="mb-1 mt-0.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-status-error)]/30 bg-[var(--trae-status-error)]/10 px-3 py-2 text-[11px] text-[var(--trae-status-error)]">
              ⚠️ 自动放行模式存在风险：所有命令将跳过审批直接执行，仅建议在隔离的演示/沙箱环境使用。
            </div>
          )}
        </SettingsCard>

        {/* Card 2: 命令风险评级规则表 */}
        <SettingsCard icon={AlertTriangle} title="命令风险评级规则" tag={`${rules.length} rules`}>
          <table className="set-table">
            <thead>
              <tr>
                <th style={{ width: '34%' }}>命令模式</th>
                <th style={{ width: '18%' }}>风险等级</th>
                <th style={{ width: '18%' }}>动作</th>
                <th className="col-actions" style={{ width: '30%' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td className="col-cmd">{rule.pattern}</td>
                  <td>
                    {rule.level === 'custom' ? (
                      <span className={ACTION_TAG_CLASS}>{LEVEL_LABEL[rule.level]}</span>
                    ) : (
                      <span className={cn('set-risk-tag', LEVEL_TAG_CLASS[rule.level])}>
                        {LEVEL_LABEL[rule.level]}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={ACTION_TAG_CLASS}>{ACTION_LABEL[rule.action]}</span>
                  </td>
                  <td className="col-actions">
                    <button
                      type="button"
                      onClick={() => handleEditRule(rule)}
                      aria-label={`编辑规则 ${rule.pattern}`}
                      className="set-btn-ghost btn-press"
                    >
                      <Edit3 className="di-12" />
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteRule(rule.id)}
                      aria-label={`删除规则 ${rule.pattern}`}
                      className="set-btn-danger btn-press"
                    >
                      <Trash2 className="di-12" />
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 新增规则按钮 + 反馈 */}
          <div className="flex items-center gap-3 pt-3">
            <button
              type="button"
              onClick={handleAddRule}
              aria-label="新增规则"
              className="set-btn-primary btn-press"
            >
              <Plus className="di-14" />
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
            control={<ReadOnlyNum value={auditRetention} />}
          />
          <SettingsRow
            label="审计日志存储路径"
            desc="本地落盘目录，建议挂载独立分区"
            control={
              <Input
                value={auditPath}
                onChange={(e) => setAuditPath(e.target.value)}
                className="set-input"
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
                className="set-input"
                style={{ minWidth: 160 }}
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
            control={<ReadOnlyNum value={rollbackTimeout} />}
          />
          <SettingsRow
            label="紧急联系人"
            desc="高危事件发生时通知的邮箱或 IM 账号"
            control={
              <Input
                value={emergencyContact}
                onChange={(e) => setEmergencyContact(e.target.value)}
                className="set-input"
                style={{ minWidth: 220 }}
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

        {/* 规则编辑弹窗（新增/编辑模式共用） */}
        <Modal
          title={editingRule === null ? '新增规则' : '编辑规则'}
          open={isRuleModalOpen}
          onOk={handleSaveRule}
          onCancel={handleCancelEdit}
          okText="保存"
          cancelText="取消"
          destroyOnClose
        >
          <Form form={ruleForm} layout="vertical" preserve={false}>
            <Form.Item
              name="pattern"
              label="命令模式"
              rules={[{ required: true, message: '请输入命令模式' }]}
            >
              <AntInput placeholder="如：rm -rf *" />
            </Form.Item>
            <Form.Item name="level" label="风险等级">
              <Select options={LEVEL_OPTIONS} />
            </Form.Item>
            <Form.Item name="action" label="动作">
              <Select options={ACTION_OPTIONS} />
            </Form.Item>
          </Form>
        </Modal>

        <SettingsActionBar />
      </div>
    </div>
  )
}
