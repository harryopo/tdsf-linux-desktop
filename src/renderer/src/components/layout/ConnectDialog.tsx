/**
 * SSH 连接对话框组件 - ConnectDialog
 *
 * 职责：
 * - 表单：名称 / 主机 / 端口 / 用户名 / 认证方式
 * - 认证方式切换：密码 / 密钥文件
 * - 密钥文件：文件路径输入 + 口令输入
 * - 高级选项：跳板机配置（可折叠）
 * - 连接测试按钮
 *
 * 苹果极简风格表单设计：
 * - 大量留白
 * - 细线条输入框
 * - 分组清晰
 */
import { useState, useEffect, useCallback } from 'react'
import { Modal, Input, Form, Select, Button, Collapse, message } from 'antd'
import { FolderOpenOutlined, ApiOutlined } from '@ant-design/icons'
import type { SshConfig, SshAuthType } from '@shared/models'

/** ConnectDialog 组件 Props */
interface ConnectDialogProps {
  /** 对话框是否打开 */
  open: boolean
  /** 编辑模式时的服务器配置（null 表示新建模式） */
  server: SshConfig | null
  /** 保存回调 */
  onSave: (config: SshConfig) => void
  /** 取消回调 */
  onCancel: () => void
}

/** 生成唯一 ID */
const generateId = (): string => `server_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

/** ConnectDialog SSH 连接对话框 */
const ConnectDialog: React.FC<ConnectDialogProps> = ({ open, server, onSave, onCancel }) => {
  const [form] = Form.useForm()
  const [testing, setTesting] = useState(false)

  /** 表单初始值 */
  const initialValues: Partial<SshConfig> = server ?? {
    name: '',
    host: '',
    port: 22,
    username: 'root',
    authType: 'password',
    password: '',
    privateKeyPath: '',
    passphrase: '',
  }

  /** 对话框打开时重置表单 */
  useEffect(() => {
    if (open) {
      form.resetFields()
      form.setFieldsValue(initialValues)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, server])

  /** 认证方式切换 */
  const authType = Form.useWatch('authType', form)

  /** 选择密钥文件（通过 Electron 文件选择对话框） */
  const handleSelectKeyFile = useCallback(async () => {
    // 通过主进程的文件选择对话框选择密钥文件
    // 这里使用简化的方式，实际可扩展 IPC 通道
    const currentPath = form.getFieldValue('privateKeyPath') as string
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pem,.key,.id_rsa,.id_ed25519,*'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        // Electron 环境下 file.path 包含完整路径
        const filePath = (file as File & { path: string }).path || file.name
        form.setFieldValue('privateKeyPath', filePath)
      }
    }
    // 如果已有路径，暂不处理预填充
    void currentPath
    input.click()
  }, [form])

  /** 连接测试 */
  const handleTest = useCallback(async () => {
    try {
      const values = await form.validateFields()
      setTesting(true)
      const config: SshConfig = {
        id: server?.id ?? generateId(),
        ...values,
      }
      const sessionId = await window.electronAPI.sshConnect(config)
      await window.electronAPI.sshDisconnect(sessionId)
      message.success('连接测试成功')
    } catch (error) {
      if (error instanceof Error && error.message) {
        message.error(`连接测试失败: ${error.message}`)
      }
    } finally {
      setTesting(false)
    }
  }, [form, server])

  /** 保存（提交表单） */
  const handleOk = useCallback(async () => {
    try {
      const values = await form.validateFields()
      const config: SshConfig = {
        id: server?.id ?? generateId(),
        ...values,
      }
      onSave(config)
    } catch {
      // 表单校验失败，不关闭对话框
    }
  }, [form, server, onSave])

  return (
    <Modal
      title={server ? '编辑服务器' : '新建连接'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      width={480}
      destroyOnClose
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button
            icon={<ApiOutlined />}
            onClick={handleTest}
            loading={testing}
          >
            测试连接
          </Button>
          <div>
            <Button onClick={onCancel} style={{ marginRight: 8 }}>
              取消
            </Button>
            <Button type="primary" onClick={handleOk}>
              保存
            </Button>
          </div>
        </div>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        requiredMark={false}
      >
        {/* ===== 基本信息 ===== */}
        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: '请输入服务器名称' }]}
        >
          <Input placeholder="如：生产服务器-01" />
        </Form.Item>

        <Form.Item
          name="host"
          label="主机地址"
          rules={[{ required: true, message: '请输入主机地址' }]}
        >
          <Input placeholder="如：192.168.1.100 或 example.com" />
        </Form.Item>

        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item
            name="port"
            label="端口"
            rules={[{ required: true, message: '请输入端口' }]}
            style={{ width: 120 }}
          >
            <Input type="number" min={1} max={65535} />
          </Form.Item>

          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
            style={{ flex: 1 }}
          >
            <Input placeholder="如：root" />
          </Form.Item>
        </div>

        {/* ===== 认证方式 ===== */}
        <Form.Item
          name="authType"
          label="认证方式"
          rules={[{ required: true }]}
        >
          <Select
            options={[
              { value: 'password', label: '密码认证' },
              { value: 'privateKey', label: '密钥文件认证' },
            ]}
          />
        </Form.Item>

        {/* 密码认证表单 */}
        {authType === 'password' && (
          <Form.Item name="password" label="密码">
            <Input.Password placeholder="输入登录密码" />
          </Form.Item>
        )}

        {/* 密钥文件认证表单 */}
        {authType === 'privateKey' && (
          <>
            <Form.Item name="privateKeyPath" label="密钥文件路径">
              <Input
                placeholder="如：~/.ssh/id_rsa"
                suffix={
                  <Button
                    type="text"
                    size="small"
                    icon={<FolderOpenOutlined />}
                    onClick={handleSelectKeyFile}
                  />
                }
              />
            </Form.Item>
            <Form.Item name="passphrase" label="密钥口令（可选）">
              <Input.Password placeholder="如果密钥有口令则输入" />
            </Form.Item>
          </>
        )}

        {/* ===== 高级选项：跳板机 ===== */}
        <Collapse
          ghost
          items={[
            {
              key: 'advanced',
              label: '高级选项',
              children: (
                <>
                  <Form.Item name={['jumpHost', 'host']} label="跳板机地址">
                    <Input placeholder="跳板机主机地址（可选）" />
                  </Form.Item>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <Form.Item
                      name={['jumpHost', 'port']}
                      label="跳板机端口"
                      style={{ width: 120 }}
                    >
                      <Input type="number" min={1} max={65535} placeholder="22" />
                    </Form.Item>
                    <Form.Item
                      name={['jumpHost', 'username']}
                      label="跳板机用户名"
                      style={{ flex: 1 }}
                    >
                      <Input placeholder="跳板机用户名" />
                    </Form.Item>
                  </div>
                  <Form.Item name={['jumpHost', 'password']} label="跳板机密码">
                    <Input.Password placeholder="跳板机登录密码" />
                  </Form.Item>
                </>
              ),
            },
          ]}
        />

        {/* 保持连接选项 */}
        <Form.Item name="keepAlive" valuePropName="checked">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" style={{ cursor: 'pointer' }} />
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              保持连接（心跳保活）
            </span>
          </label>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default ConnectDialog
