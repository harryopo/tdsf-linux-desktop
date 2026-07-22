/**
 * 设置页面区块组件集合 - SettingsSections
 *
 * 包含 SettingsPage 的四个配置区块组件：
 * - LlmConfigSection：LLM 配置（API Base URL / Key / 模型 / 温度等）
 * - SshConfigSection：SSH 默认配置（端口 / 用户名 / 认证方式 / 超时）
 * - RiskRulesSection：风险规则管理（列表 / 添加 / 编辑 / 删除 / 启用禁用）
 * - AssetTagsSection：资产标签管理（列表 / 添加 / 删除）
 *
 * 数据流：从 useSettingsStore 读取配置，修改后调用 saveSettings() 持久化。
 * API Key 通过主进程 safeStorage 加密存储，不会明文保存。
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Form,
  Input,
  InputNumber,
  Button,
  Select,
  Switch,
  Table,
  Space,
  Modal,
  Popconfirm,
  Tag,
  message,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  SunOutlined,
  MoonOutlined,
} from '@ant-design/icons'
import { Inbox } from 'lucide-react'
import { Empty } from '@/components/trae/Empty'
import { useSettingsStore, type RiskRule, type AssetTag } from '../../stores/settings-store'
import { useThemeStore } from '../../stores/theme-store'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import type { RiskLevel, SshAuthType } from '@shared/models'

/** 风险等级选项 */
const RISK_LEVEL_OPTIONS: Array<{ value: RiskLevel; label: string; color: string }> = [
  { value: 'SAFE', label: '安全', color: 'green' },
  { value: 'LOW', label: '低风险', color: 'cyan' },
  { value: 'MEDIUM', label: '中风险', color: 'orange' },
  { value: 'HIGH', label: '高风险', color: 'red' },
  { value: 'CRITICAL', label: '极高风险', color: 'magenta' },
]

// ============================================================================
// 外观主题区块
// ============================================================================

/** 外观主题区块 - 亮色/暗黑主题切换 */
export const AppearanceSection: React.FC = () => {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3>外观</h3>
      </div>
      <div className="settings-appearance-row">
        <div className="settings-appearance-label">
          <span className="settings-appearance-icon">
            {theme === 'dark' ? <MoonOutlined /> : <SunOutlined />}
          </span>
          <div>
            <div className="settings-appearance-title">主题模式</div>
            <div className="settings-appearance-desc">
              当前：{theme === 'dark' ? '暗黑模式' : '亮色模式'}
            </div>
          </div>
        </div>
        <Switch
          checked={theme === 'dark'}
          onChange={(checked) => setTheme(checked ? 'dark' : 'light')}
          checkedChildren={<MoonOutlined />}
          unCheckedChildren={<SunOutlined />}
        />
      </div>
    </div>
  )
}

// ============================================================================
// LLM 配置区块
// ============================================================================

/** LLM 配置区块 */
export const LlmConfigSection: React.FC = () => {
  const [form] = Form.useForm()
  const llmConfig = useSettingsStore((s) => s.llmConfig)
  const setLlmConfig = useSettingsStore((s) => s.setLlmConfig)
  const saveSettings = useSettingsStore((s) => s.saveSettings)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    form.setFieldsValue(llmConfig)
  }, [form, llmConfig])

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields()
      setLlmConfig(values)
      await saveSettings()
      message.success('LLM 配置已保存')
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) {
        // 表单校验失败，由 antd 自动展示错误提示
        console.warn('[LlmConfigSection] 表单校验失败', err)
      } else {
        console.warn('[LlmConfigSection] 保存失败', err)
        message.error('保存失败，请重试')
      }
    }
  }, [form, setLlmConfig, saveSettings])

  const handleTest = useCallback(async () => {
    try {
      const values = await form.validateFields()
      if (!isElectronAPIAvailable()) {
        message.error('electronAPI 不可用，无法测试连接')
        return
      }
      setTesting(true)
      const ok = await window.electronAPI.llmTest(values)
      if (ok) {
        message.success('连接测试成功')
      } else {
        message.error('连接测试失败，请检查配置')
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.warn('[LlmConfigSection] LLM 测试失败', err)
      message.error(`测试请求失败：${reason}`)
    } finally {
      setTesting(false)
    }
  }, [form])

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3>LLM 配置</h3>
      </div>
      <Form form={form} layout="vertical" className="settings-form" initialValues={llmConfig}>
        <Form.Item label="API Base URL" name="baseUrl" rules={[{ required: true, message: '请输入 API Base URL' }]}>
          <Input placeholder="https://ark.cn-beijing.volces.com/api/v3" />
        </Form.Item>
        <Form.Item label="API Key" name="apiKey" tooltip="API Key 通过操作系统钥匙串加密存储">
          <Input.Password placeholder="sk-xxxxxxxxxxxxxxxxxxxx" visibilityToggle />
        </Form.Item>
        <Form.Item label="模型名称" name="model" rules={[{ required: true, message: '请输入模型名称' }]}>
          <Input placeholder="doubao-seed-1-6-250615" />
        </Form.Item>
        <div className="settings-form-row">
          <Form.Item label="温度（Temperature）" name="temperature" rules={[{ type: 'number', min: 0, max: 2 }]}>
            <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="最大 Tokens" name="maxTokens" rules={[{ type: 'number', min: 1, max: 32768 }]}>
            <InputNumber min={1} max={32768} step={256} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Form.Item label="请求超时（毫秒）" name="timeout" rules={[{ type: 'number', min: 1000 }]}>
          <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>保存配置</Button>
            <Button icon={<ThunderboltOutlined />} loading={testing} onClick={handleTest}>测试连接</Button>
          </Space>
        </Form.Item>
      </Form>
    </div>
  )
}

// ============================================================================
// SSH 默认配置区块
// ============================================================================

/** SSH 默认配置区块 */
export const SshConfigSection: React.FC = () => {
  const [form] = Form.useForm()
  const sshDefaults = useSettingsStore((s) => s.sshDefaults)
  const sshTimeout = useSettingsStore((s) => s.sshTimeout)
  const setSshDefaults = useSettingsStore((s) => s.setSshDefaults)
  const setSshTimeout = useSettingsStore((s) => s.setSshTimeout)
  const saveSettings = useSettingsStore((s) => s.saveSettings)

  useEffect(() => {
    form.setFieldsValue({ ...sshDefaults, timeout: sshTimeout })
  }, [form, sshDefaults, sshTimeout])

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields()
      const { timeout, ...defaults } = values
      setSshDefaults(defaults)
      setSshTimeout(timeout)
      await saveSettings()
      message.success('SSH 配置已保存')
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) {
        console.warn('[SshConfigSection] 表单校验失败', err)
      } else {
        console.warn('[SshConfigSection] 保存失败', err)
        message.error('保存失败，请重试')
      }
    }
  }, [form, setSshDefaults, setSshTimeout, saveSettings])

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3>SSH 默认配置</h3>
      </div>
      <Form form={form} layout="vertical" className="settings-form">
        <div className="settings-form-row">
          <Form.Item label="默认端口" name="port" rules={[{ type: 'number', min: 1, max: 65535 }]}>
            <InputNumber min={1} max={65535} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="默认用户名" name="username">
            <Input placeholder="root" />
          </Form.Item>
        </div>
        <Form.Item label="默认认证方式" name="authType">
          <Select
            options={[
              { value: 'password' as SshAuthType, label: '密码认证' },
              { value: 'privateKey' as SshAuthType, label: '密钥文件认证' },
            ]}
          />
        </Form.Item>
        <Form.Item label="连接超时（毫秒）" name="timeout" rules={[{ type: 'number', min: 1000 }]}>
          <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>保存配置</Button>
        </Form.Item>
      </Form>
    </div>
  )
}

// ============================================================================
// 风险规则区块
// ============================================================================

/** 风险规则区块 */
export const RiskRulesSection: React.FC = () => {
  const riskRules = useSettingsStore((s) => s.riskRules)
  const addRiskRule = useSettingsStore((s) => s.addRiskRule)
  const updateRiskRule = useSettingsStore((s) => s.updateRiskRule)
  const removeRiskRule = useSettingsStore((s) => s.removeRiskRule)
  const saveSettings = useSettingsStore((s) => s.saveSettings)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [form] = Form.useForm()

  const handleAdd = useCallback(() => {
    setEditingIndex(null)
    form.resetFields()
    form.setFieldsValue({ level: 'MEDIUM', enabled: true })
    setModalOpen(true)
  }, [form])

  const handleEdit = useCallback(
    (index: number) => {
      setEditingIndex(index)
      form.setFieldsValue(riskRules[index])
      setModalOpen(true)
    },
    [form, riskRules]
  )

  const handleModalOk = useCallback(async () => {
    try {
      const values = (await form.validateFields()) as RiskRule
      if (editingIndex !== null) {
        updateRiskRule(editingIndex, values)
      } else {
        addRiskRule(values)
      }
      await saveSettings()
      message.success(editingIndex !== null ? '规则已更新' : '规则已添加')
      setModalOpen(false)
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) {
        console.warn('[RiskRulesSection] 表单校验失败', err)
      } else {
        console.warn('[RiskRulesSection] 保存规则失败', err)
        message.error('保存规则失败，请重试')
      }
    }
  }, [form, editingIndex, addRiskRule, updateRiskRule, saveSettings])

  const handleDelete = useCallback(
    async (index: number) => {
      removeRiskRule(index)
      await saveSettings()
      message.success('规则已删除')
    },
    [removeRiskRule, saveSettings]
  )

  const handleToggleEnabled = useCallback(
    async (index: number, enabled: boolean) => {
      updateRiskRule(index, { enabled })
      await saveSettings()
    },
    [updateRiskRule, saveSettings]
  )

  /** 表格列定义 */
  const columns = [
    { title: '规则名称', dataIndex: 'name', key: 'name', width: 180 },
    {
      title: '风险等级',
      dataIndex: 'level',
      key: 'level',
      width: 100,
      render: (level: RiskLevel) => {
        const opt = RISK_LEVEL_OPTIONS.find((o) => o.value === level)
        return opt ? <Tag color={opt.color}>{opt.label}</Tag> : level
      },
    },
    { title: '匹配模式（正则）', dataIndex: 'pattern', key: 'pattern', ellipsis: true },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 80,
      render: (enabled: boolean, _: unknown, index: number) => (
        <Switch checked={enabled} onChange={(checked) => void handleToggleEnabled(index, checked)} size="small" />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: unknown, __: unknown, index: number) => (
        <Space size="small">
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(index)} />
          <Popconfirm title="确认删除该规则？" onConfirm={() => void handleDelete(index)} okText="删除" cancelText="取消">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3>风险规则</h3>
      </div>
      <div className="settings-section-toolbar">
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>添加规则</Button>
      </div>
      <Table
        columns={columns}
        dataSource={riskRules}
        rowKey={(_, index) => String(index)}
        pagination={false}
        size="small"
        className="settings-table"
      />
      <Modal
        title={editingIndex !== null ? '编辑规则' : '添加规则'}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={() => {
          setModalOpen(false)
          setEditingIndex(null)
          form.resetFields()
        }}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="规则名称" name="name" rules={[{ required: true, message: '请输入规则名称' }]}>
            <Input placeholder="如：禁止 rm -rf /" />
          </Form.Item>
          <Form.Item label="风险等级" name="level" rules={[{ required: true }]}>
            <Select options={RISK_LEVEL_OPTIONS} />
          </Form.Item>
          <Form.Item label="匹配模式（正则表达式）" name="pattern" rules={[{ required: true, message: '请输入正则表达式' }]}>
            <Input placeholder="rm\\s+-rf?\\s+/?($|\\s)" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="禁止递归删除根目录" />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

// ============================================================================
// 资产标签区块
// ============================================================================

/** 资产标签区块 */
export const AssetTagsSection: React.FC = () => {
  const assetTags = useSettingsStore((s) => s.assetTags)
  const addAssetTag = useSettingsStore((s) => s.addAssetTag)
  const removeAssetTag = useSettingsStore((s) => s.removeAssetTag)
  const saveSettings = useSettingsStore((s) => s.saveSettings)
  const [form] = Form.useForm()

  const handleAdd = useCallback(async () => {
    try {
      const values = (await form.validateFields()) as AssetTag
      addAssetTag({ ...values, id: `tag-${Date.now()}` })
      await saveSettings()
      form.resetFields()
      message.success('标签已添加')
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) {
        console.warn('[AssetTagsSection] 表单校验失败', err)
      } else {
        console.warn('[AssetTagsSection] 添加标签失败', err)
        message.error('添加标签失败，请重试')
      }
    }
  }, [form, addAssetTag, saveSettings])

  const handleDelete = useCallback(
    async (tagId: string) => {
      removeAssetTag(tagId)
      await saveSettings()
      message.success('标签已删除')
    },
    [removeAssetTag, saveSettings]
  )

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3>资产标签</h3>
      </div>
      <Form form={form} layout="inline" className="settings-inline-form">
        <Form.Item label="标签名称" name="name" rules={[{ required: true, message: '请输入标签名称' }]}>
          <Input placeholder="如：生产环境" />
        </Form.Item>
        <Form.Item label="颜色" name="color" rules={[{ required: true, message: '请选择颜色' }]}>
          <Input type="color" style={{ width: 60 }} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>添加</Button>
        </Form.Item>
      </Form>
      {assetTags.length === 0 ? (
        <Empty
          icon={Inbox}
          title="暂无资产标签"
          description="请在上方表单中添加标签，用于对服务器资产进行分类和快速筛选。"
        />
      ) : (
        <div className="settings-tags-list">
          {assetTags.map((tag) => (
            <Tag
              key={tag.id}
              color={tag.color}
              closable
              onClose={() => void handleDelete(tag.id)}
              style={{ padding: '4px 8px', marginBottom: 8 }}
            >
              {tag.name}
            </Tag>
          ))}
        </div>
      )}
    </div>
  )
}
