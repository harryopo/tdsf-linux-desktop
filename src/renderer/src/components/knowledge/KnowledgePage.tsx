/**
 * 知识库页面组件 - KnowledgePage
 *
 * 职责（知识双轨制）：
 * - command_skills：操作能力知识（命令技能）
 * - incident_cases：故障案例知识（问题→根因→修复→验证）
 *
 * 功能：
 * - Tab 切换两种知识类型
 * - 搜索（通过 kbSearch 检索）
 * - CRUD：添加 / 编辑 / 删除知识条目
 * - 导入 / 导出（JSON 格式）
 *
 * 数据流：
 * - 搜索：window.electronAPI.kbSearch(query, type, limit)
 * - 增删改：kbAdd / kbUpdate / kbDelete
 * - 导入导出：kbImport / kbExport
 *
 * 苹果极简风格：表格 + 弹窗表单，细线条，大量留白
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Tabs,
  Input,
  Button,
  Table,
  Space,
  Modal,
  Form,
  Tag,
  Popconfirm,
  message,
  Tooltip,
  Typography,
} from 'antd'
import {
  SearchOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ImportOutlined,
  ExportOutlined,
  CodeOutlined,
  BugOutlined,
} from '@ant-design/icons'
import type { KnowledgeEntry, KnowledgeType } from '@shared/models'
import './KnowledgePage.css'

const { Text } = Typography

/** 知识类型 Tab 配置 */
const KNOWLEDGE_TABS: Array<{
  key: KnowledgeType
  label: string
  icon: React.ReactNode
  desc: string
}> = [
  {
    key: 'command_skill',
    label: '操作能力',
    icon: <CodeOutlined />,
    desc: '命令技能知识',
  },
  {
    key: 'incident_case',
    label: '故障案例',
    icon: <BugOutlined />,
    desc: '问题→根因→修复→验证',
  },
]

/** KnowledgePage 知识库页面 */
const KnowledgePage: React.FC = () => {
  // ===== 状态 =====
  const [activeType, setActiveType] = useState<KnowledgeType>('command_skill')
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  /** 编辑/新增弹窗 */
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form] = Form.useForm()

  // ===== 数据加载 =====
  /** 加载知识条目 */
  const loadEntries = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.electronAPI.kbSearch(searchKeyword, activeType, 100)
      setEntries(list)
    } catch (error) {
      console.error('加载知识库失败:', error)
      message.error('加载知识库失败')
    } finally {
      setLoading(false)
    }
  }, [searchKeyword, activeType])

  /** 初始加载及搜索/Tab 变化时重新加载 */
  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  // ===== CRUD 操作 =====
  /** 打开新增弹窗 */
  const handleAdd = useCallback(() => {
    setEditingId(null)
    form.resetFields()
    form.setFieldsValue({
      type: activeType,
      commands: [],
      keywords: [],
      tags: [],
      successRate: 1.0,
    })
    setModalOpen(true)
  }, [form, activeType])

  /** 打开编辑弹窗 */
  const handleEdit = useCallback(
    (entry: KnowledgeEntry) => {
      setEditingId(entry.id)
      form.setFieldsValue({
        ...entry,
        commandsText: entry.commands.join('\n'),
        rollbackCommandsText: entry.rollbackCommands?.join('\n') ?? '',
        keywordsText: entry.keywords.join(', '),
        tagsText: entry.tags.join(', '),
      })
      setModalOpen(true)
    },
    [form]
  )

  /** 弹窗确认保存 */
  const handleModalOk = useCallback(async () => {
    try {
      const values = await form.validateFields()
      /** 将文本域转换为数组 */
      const commands = (values.commandsText as string)
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      const rollbackCommands = (values.rollbackCommandsText as string)
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      const keywords = (values.keywordsText as string)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const tags = (values.tagsText as string)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      const entry: KnowledgeEntry = {
        id: editingId ?? `kb-${Date.now()}`,
        type: activeType,
        title: values.title,
        problem: values.problem,
        rootCause: values.rootCause,
        commands,
        rollbackCommands: rollbackCommands.length > 0 ? rollbackCommands : undefined,
        verification: values.verification,
        keywords,
        tags,
        successRate: values.successRate ?? 1.0,
        useCount: values.useCount ?? 0,
        createdAt: editingId ? values.createdAt : Date.now(),
        updatedAt: Date.now(),
      }

      if (editingId) {
        await window.electronAPI.kbUpdate(editingId, entry)
        message.success('知识条目已更新')
      } else {
        await window.electronAPI.kbAdd(entry)
        message.success('知识条目已添加')
      }
      setModalOpen(false)
      void loadEntries()
    } catch {
      // 校验失败
    }
  }, [form, editingId, activeType, loadEntries])

  /** 删除条目 */
  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await window.electronAPI.kbDelete(id)
        message.success('已删除')
        void loadEntries()
      } catch {
        message.error('删除失败')
      }
    },
    [loadEntries]
  )

  /** 导出当前类型知识 */
  const handleExport = useCallback(async () => {
    try {
      const list = await window.electronAPI.kbExport(activeType)
      const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${activeType}-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
      message.success(`已导出 ${list.length} 条`)
    } catch {
      message.error('导出失败')
    }
  }, [activeType])

  /** 导入知识（JSON 文件） */
  const handleImport = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text) as KnowledgeEntry[]
        const count = await window.electronAPI.kbImport(data)
        message.success(`已导入 ${count} 条`)
        void loadEntries()
      } catch {
        message.error('导入失败，请检查文件格式')
      }
    }
    input.click()
  }, [loadEntries])

  /** 搜索框变化 */
  const handleSearchChange = useCallback((value: string) => {
    setSearchKeyword(value)
  }, [])

  /** Tab 切换 */
  const handleTabChange = useCallback((key: string) => {
    setActiveType(key as KnowledgeType)
    setSearchKeyword('')
  }, [])

  /** 表格列定义 */
  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      width: 180,
      ellipsis: true,
    },
    {
      title: '问题描述',
      dataIndex: 'problem',
      key: 'problem',
      ellipsis: true,
    },
    {
      title: '修复命令',
      dataIndex: 'commands',
      key: 'commands',
      width: 200,
      ellipsis: true,
      render: (commands: string[]) => commands[0] ?? '-',
    },
    {
      title: '成功率',
      dataIndex: 'successRate',
      key: 'successRate',
      width: 90,
      render: (rate: number) => (
        <span style={{ color: rate >= 0.8 ? '#34c759' : rate >= 0.5 ? '#ff9500' : '#ff3b30' }}>
          {(rate * 100).toFixed(0)}%
        </span>
      ),
    },
    {
      title: '使用次数',
      dataIndex: 'useCount',
      key: 'useCount',
      width: 80,
    },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      width: 150,
      render: (tags: string[]) => (
        <Space size={4} wrap>
          {tags.slice(0, 3).map((tag) => (
            <Tag key={tag} style={{ fontSize: 11 }}>
              {tag}
            </Tag>
          ))}
          {tags.length > 3 && <Text type="secondary">+{tags.length - 3}</Text>}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: KnowledgeEntry) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          </Tooltip>
          <Popconfirm title="确认删除？" onConfirm={() => void handleDelete(record.id)} okText="删除" cancelText="取消">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="knowledge-page">
      {/* ===== Tab 切换 ===== */}
      <div className="knowledge-tabs-bar">
        <Tabs
          activeKey={activeType}
          onChange={handleTabChange}
          items={KNOWLEDGE_TABS.map((tab) => ({
            key: tab.key,
            label: (
              <span className="knowledge-tab-label">
                {tab.icon}
                <span>{tab.label}</span>
              </span>
            ),
          }))}
        />
      </div>

      {/* ===== 工具栏 ===== */}
      <div className="knowledge-toolbar">
        <Input
          placeholder="搜索知识..."
          prefix={<SearchOutlined />}
          value={searchKeyword}
          onChange={(e) => handleSearchChange(e.target.value)}
          allowClear
          className="knowledge-search"
        />
        <Space>
          <Button icon={<ImportOutlined />} onClick={handleImport}>导入</Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>添加</Button>
        </Space>
      </div>

      {/* ===== 知识表格 ===== */}
      <div className="knowledge-table-container">
        <Table
          columns={columns}
          dataSource={entries}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10, size: 'small' }}
          size="small"
          className="knowledge-table"
        />
      </div>

      {/* ===== 新增/编辑弹窗 ===== */}
      <Modal
        title={editingId ? '编辑知识' : '添加知识'}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={560}
        className="knowledge-modal"
      >
        <Form form={form} layout="vertical">
          <Form.Item label="标题" name="title" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="如：OOM 故障修复" />
          </Form.Item>
          <Form.Item label="问题描述" name="problem" rules={[{ required: true, message: '请输入问题描述' }]}>
            <Input.TextArea rows={2} placeholder="系统内存不足导致进程被 kill" />
          </Form.Item>
          {activeType === 'incident_case' && (
            <Form.Item label="根因" name="rootCause">
              <Input.TextArea rows={2} placeholder="应用程序内存泄漏" />
            </Form.Item>
          )}
          <Form.Item
            label="修复命令（每行一条）"
            name="commandsText"
            rules={[{ required: true, message: '请输入至少一条命令' }]}
          >
            <Input.TextArea rows={3} placeholder="systemctl restart myapp" />
          </Form.Item>
          <Form.Item label="回滚命令（可选，每行一条）" name="rollbackCommandsText">
            <Input.TextArea rows={2} placeholder="systemctl start myapp" />
          </Form.Item>
          <Form.Item label="验证方法" name="verification">
            <Input placeholder="systemctl status myapp" />
          </Form.Item>
          <Form.Item label="关键词（逗号分隔）" name="keywordsText">
            <Input placeholder="oom, memory, kill" />
          </Form.Item>
          <Form.Item label="标签（逗号分隔）" name="tagsText">
            <Input placeholder="内存, 进程" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default KnowledgePage
