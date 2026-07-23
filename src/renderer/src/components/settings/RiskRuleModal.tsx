/**
 * RiskRuleModal — 规则编辑弹窗（新增/编辑模式共用）
 *
 * 从 RiskSettings.tsx 提取。父组件控制 open/editingRule 状态，
 * Modal 内部管理 Form 实例与字段值同步。
 */
import { useEffect } from 'react'
import { Modal, Form, Input as AntInput, Select } from 'antd'
import type { RiskRule, RiskLevel, RiskAction } from '@/components/settings/risk-types'

/** 规则编辑表单值 */
interface RuleFormValues {
  pattern: string
  level: RiskLevel
  action: RiskAction
}

/** 规则编辑弹窗 - 风险等级 Select 选项（5 个，不含 custom；value 类型与 RiskLevel 兼容） */
const LEVEL_OPTIONS: { value: RiskLevel; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'critical', label: '极高' },
]

/** 规则编辑弹窗 - 动作 Select 选项（5 个） */
const ACTION_OPTIONS: { value: RiskAction; label: string }[] = [
  { value: 'allow', label: '放行' },
  { value: 'notify', label: '通知' },
  { value: 'confirm', label: '确认' },
  { value: 'block', label: '拦截' },
  { value: 'custom', label: '可配置' },
]

export interface RiskRuleModalProps {
  open: boolean
  editingRule: RiskRule | null
  onSave: (rule: RiskRule) => void
  onCancel: () => void
}

export function RiskRuleModal({ open, editingRule, onSave, onCancel }: RiskRuleModalProps) {
  const [ruleForm] = Form.useForm<RuleFormValues>()

  // Modal 打开时同步表单初始值（编辑模式回填，新增模式用默认值）
  useEffect(() => {
    if (open) {
      ruleForm.setFieldsValue({
        pattern: editingRule?.pattern ?? '',
        level: editingRule?.level ?? 'medium',
        action: editingRule?.action ?? 'notify',
      })
    }
  }, [open, editingRule, ruleForm])

  // 保存规则：验证表单后构建 RiskRule 并回调 onSave
  const handleOk = async () => {
    try {
      const values = await ruleForm.validateFields()
      const newRule: RiskRule = {
        id: editingRule?.id ?? `r${Date.now()}`,
        pattern: values.pattern,
        level: values.level,
        action: values.action,
      }
      onSave(newRule)
    } catch {
      // 表单验证失败，保持 Modal 打开等待用户修正
    }
  }

  return (
    <Modal
      title={editingRule === null ? '新增规则' : '编辑规则'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
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
  )
}
