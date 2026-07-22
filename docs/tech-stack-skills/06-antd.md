# 06 · Ant Design 5.20 核心栈 Skill 调研

> **项目版本**：antd 5.20.0 + @ant-design/icons 5.4.0
> **核心定位**：企业级组件库（与 Tailwind v4 + shadcn 配合使用）
> **最后更新**：2026-07-22

---

## 1. 核心 Skill 速查

| Skill | 评级 | 来源 | 触发词 | 核心价值 |
|-------|------|------|--------|----------|
| `antd` 官方文档 | ⭐⭐⭐必装 | ant.design | "Form" / "Table" / "Modal" | 完整 API + 主题 |
| `shadcn` Skill | ⭐⭐推荐 | shadcn | "Form 组件" / "Field" | shadcn Field 模式可作参考 |

> **说明**：Antd 没有专门的 Skill 插件，主要靠官方文档。已有 `shadcn` Skill 教组件设计思想可迁移。

---

## 2. Antd 5 vs 4 关键变化

| 变化 | v4 | v5 |
|------|----|----|
| CSS-in-JS | ❌ | ✅ 零运行时 |
| 主题系统 | less 变量 | ConfigProvider + theme token |
| 暗色模式 | 需配算法 | `theme: { algorithm: theme.darkAlgorithm }` |
| Bundle | 全量 | 自动 tree-shaking |
| React 兼容 | 16-17 | 18+ |
| TypeScript | 一般 | 完善 |

### 2.1 主题（与 Tailwind 变量联动）

```typescript
// src/renderer/src/main.tsx
import { ConfigProvider, theme } from 'antd'

<ConfigProvider
  theme={{
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: 'var(--color-primary)',
      colorBgBase: 'var(--color-background)',
      colorText: 'var(--color-foreground)',
      borderRadius: 6,
      fontFamily: 'Inter, system-ui, sans-serif'
    }
  }}
>
  <App />
</ConfigProvider>
```

> **关键**：Antd token 接受 CSS 变量字符串，与 Tailwind 主题联动。

---

## 3. Antd 5 + Tailwind v4 集成（项目重点）

### 3.1 优先级策略

| 场景 | 用 Antd | 用 shadcn + Tailwind |
|------|---------|---------------------|
| 复杂表格（排序/筛选/分页） | ✅ | ❌ |
| 表单（Form/Field/验证） | ✅ | ✅（shadcn Field） |
| 弹窗（Modal/Drawer） | ✅ | ✅（shadcn Dialog） |
| 简单按钮 / 卡片 | ⭐ | ✅ |
| 设计稿严格 1:1 复刻 | ❌（难定制） | ✅ |
| 树形控件 | ✅ | ❌ |
| 步骤条 / 进度条 | ✅ | ❌ |
| 通知 / Message | ✅ | sonner |

> **项目原则**：能用 shadcn + Tailwind 复刻设计稿就用 shadcn，复杂业务组件用 Antd。

### 3.2 避免冲突

```typescript
// ❌ 错：className 覆盖 Antd 内部样式
<Button className="bg-blue-500 text-white">Click</Button>

// ✅ 对：用 ConfigProvider token 改主题
<Button type="primary">Click</Button>
```

```css
/* Tailwind 4 preflight 与 Antd reset 共存 */
/* src/index.css */
@layer base {
  /* 不要清掉 Antd 的 reset */
}
```

---

## 4. Antd Form 模式（v5 重点）

### 4.1 三种使用方式

#### 方式 1：基础 Form

```typescript
import { Form, Input, Button } from 'antd'

interface FormValues {
  username: string
  password: string
}

<Form<FormValues>
  layout="vertical"
  onFinish={handleSubmit}
  initialValues={{ remember: true }}
>
  <Form.Item
    name="username"
    label="Username"
    rules={[{ required: true, message: 'Please input username' }]}
  >
    <Input />
  </Form.Item>
  <Form.Item
    name="password"
    label="Password"
    rules={[{ required: true, message: 'Please input password' }]}
  >
    <Input.Password />
  </Form.Item>
  <Form.Item>
    <Button type="primary" htmlType="submit">Submit</Button>
  </Form.Item>
</Form>
```

#### 方式 2：Form.useForm + 自定义

```typescript
const [form] = Form.useForm<FormValues>()

<Form form={form} onFinish={onFinish}>
  ...
</Form>

// 外部访问
form.setFieldsValue({ username: 'admin' })
form.validateFields()
form.resetFields()
```

#### 方式 3：Form.useWatch 细粒度订阅（性能优化）

```typescript
// ✅ 避免全表 re-render
const username = Form.useWatch('username', form)
// 仅 username 变化触发组件更新
```

### 4.2 验证规则

```typescript
rules={[
  { required: true, message: '必填' },
  { type: 'email', message: '邮箱格式' },
  { min: 6, max: 20, message: '长度 6-20' },
  { pattern: /^[a-z]+$/, message: '仅小写字母' },
  {
    validator: async (_, value) => {
      if (await checkAvailable(value)) {
        return Promise.resolve()
      }
      return Promise.reject(new Error('已被占用'))
    }
  }
]}
```

---

## 5. Antd Table 模式（v5 重点）

### 5.1 基础用法

```typescript
import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'

interface User {
  id: string
  name: string
  age: number
  email: string
}

const columns: ColumnsType<User> = [
  { title: 'ID', dataIndex: 'id', key: 'id' },
  { title: 'Name', dataIndex: 'name', key: 'name', sorter: (a, b) => a.name.localeCompare(b.name) },
  { title: 'Age', dataIndex: 'age', key: 'age', sorter: (a, b) => a.age - b.age },
  { title: 'Email', dataIndex: 'email', key: 'email' },
  {
    title: 'Action',
    key: 'action',
    render: (_, record) => (
      <Space>
        <Button onClick={() => edit(record)}>Edit</Button>
        <Button danger onClick={() => remove(record)}>Delete</Button>
      </Space>
    )
  }
]

<Table
  dataSource={users}
  columns={columns}
  rowKey="id"
  pagination={{ pageSize: 20, showSizeChanger: true }}
  size="middle"
/>
```

### 5.2 性能优化

```typescript
// ✅ 固定列宽
{ title: 'Name', dataIndex: 'name', width: 120, fixed: 'left' }

// ✅ 虚拟滚动（大数据）
<Table
  dataSource={bigData}
  columns={columns}
  scroll={{ x: 1000, y: 600 }}
  virtual
  pagination={false}
/>

// ✅ memo 行
const MemoRow = memo(Table.Row)
```

---

## 6. 暗色模式（v5 关键）

### 6.1 ConfigProvider 一键切换

```typescript
import { ConfigProvider, theme } from 'antd'

const App = () => {
  const { isDark } = useTheme()  // 项目自写 hook
  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm
      }}
    >
      ...
    </ConfigProvider>
  )
}
```

### 6.2 与 CSS 变量联动

```typescript
// 监听系统主题变化
const useTheme = () => {
  const [isDark, setIsDark] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return { isDark, setIsDark }
}
```

---

## 7. Antd 主题 Token（与 Tailwind 联动）

### 7.1 项目主题 Token

```typescript
const token = {
  // 主色
  colorPrimary: 'var(--color-primary)',
  colorSuccess: 'var(--color-success)',
  colorWarning: 'var(--color-warning)',
  colorError: 'var(--color-error)',

  // 背景
  colorBgBase: 'var(--color-background)',
  colorBgContainer: 'var(--color-card)',
  colorBgElevated: 'var(--color-popover)',

  // 文字
  colorText: 'var(--color-foreground)',
  colorTextSecondary: 'var(--color-muted-foreground)',

  // 边框
  colorBorder: 'var(--color-border)',
  borderRadius: 6,

  // 字体
  fontFamily: 'Inter, system-ui, sans-serif'
}
```

### 7.2 自定义组件样式

```typescript
import { theme } from 'antd'

const MyComponent = () => {
  const { token } = theme.useToken()
  return (
    <div style={{
      background: token.colorBgContainer,
      color: token.colorText,
      borderRadius: token.borderRadius
    }}>
      ...
    </div>
  )
}
```

---

## 8. Antd Icons 使用

```typescript
import { UserOutlined, LockOutlined } from '@ant-design/icons'

<Input prefix={<UserOutlined />} placeholder="Username" />
<Button icon={<PlusOutlined />}>Add</Button>
<Button icon={<DeleteOutlined />} danger>Delete</Button>
```

> **项目偏好**：Antd Icons + Lucide React 并存，按场景选：
> - 业务表单 / 表格内：Antd Icons
> - 主 UI / 设计稿 1:1 复刻：Lucide React

---

## 9. Antd 国际化

```typescript
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'

<ConfigProvider locale={zhCN}>
  <App />
</ConfigProvider>
```

支持：zh_CN / en_US / ja_JP 等 50+ 语言。

---

## 10. Antd + React Hook Form / Zustand

### 10.1 React Hook Form 集成（可选）

```typescript
import { useForm, Controller } from 'react-hook-form'

const { control, handleSubmit } = useForm<FormValues>()

<Controller
  name="username"
  control={control}
  rules={{ required: true }}
  render={({ field, fieldState }) => (
    <Form.Item
      label="Username"
      validateStatus={fieldState.error ? 'error' : ''}
      help={fieldState.error?.message}
    >
      <Input {...field} />
    </Form.Item>
  )}
/>
```

### 10.2 Zustand 集成

```typescript
// 提交时同步到 Store
const settings = useSettingsStore()

<Form initialValues={settings} onFinish={(v) => settings.setAll(v)}>
  ...
</Form>
```

---

## 11. 常见错误速查

| 错误 | 根因 | 修复 |
|------|------|------|
| 主题不切换 | `algorithm` 未设 | 加 `theme.darkAlgorithm` |
| 字体不应用 | ConfigProvider 嵌套错 | 顶层包 App |
| Form.Item 不显示错误 | `validateTrigger` 未配 | 加 `validateTrigger="onBlur"` |
| Table 性能差 | 没用 `virtual` | 大数据加 `virtual` |
| Bundle 太大 | 全量 import | 改按需 import（`import { Button } from 'antd'`） |
| CSS 冲突 | 用了 reset 清掉了 Antd | 不清 Antd 样式 |

---

## 12. 性能优化清单

1. **按需 import**（`import { Button } from 'antd'`，不 `import * as antd`）
2. **Table 大数据用 `virtual`**
3. **Form 细粒度订阅**（`Form.useWatch`）
4. **memoize columns**（用 `useMemo` 包装 columns）
5. **Tree 用 `fieldNames` 自定义 key**
6. **Select 大数据用 `virtual` + `searchValue`**
7. **Modal 用 `destroyOnClose` 释放内存**
8. **DatePicker 用 `showTime` 按需**
9. **主题 token 用 CSS 变量**，不每次渲染重算
10. **统一 ConfigProvider 顶层**，避免重复

---

## 13. 最佳实践清单

1. **顶层 ConfigProvider 包整个 App**
2. **暗色模式用 `theme.darkAlgorithm`**
3. **Token 用 CSS 变量**（与 Tailwind 联动）
4. **Form 优先用 Antd**（复杂校验）
5. **Table 优先用 Antd**（排序筛选分页）
6. **Modal / Drawer 用 Antd**（业务弹窗）
7. **简单 UI 优先 shadcn + Tailwind**（设计稿 1:1）
8. **不写 inline style 覆盖 Antd**
9. **国际化用 ConfigProvider locale**
10. **TypeScript 严格模式用 `ColumnsType<T>`**

---

## 14. 推荐阅读顺序

1. [Antd 5 官方文档 - 升级指南](https://ant.design/docs/react/migration-v5)（10 分钟）
2. [Antd 5 主题定制](https://ant.design/docs/react/customize-theme)（按需查）
3. [Antd 5 Form 最佳实践](https://ant.design/components/form-cn)（深入）
4. 项目 `src/renderer/src/main.tsx` ConfigProvider 配置

---

## 15. 引用文档

- [ant.design](https://ant.design/) — 官方文档
- `c:\Users\Lenovo\.trae-cn\skills\shadcn\SKILL.md` — Form / Field 设计参考
- `d:\ai\linux教学一体\tdsf-linux-desktop\AGENTS.md` v8.4 — Antd 规约
- `d:\ai\linux教学一体\tdsf-linux-desktop\docs\UI设计规范-v2.0.md` — 设计稿
