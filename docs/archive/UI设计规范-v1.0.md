# TDSF-Linux Desktop — UI 设计规范 v1.0

> **版本**：v1.0（v0.7.0 实现对应）
> **生效日期**：2026-07-16
> **维护人**：TDSF 前端组
> **适用范围**：`tdsf-linux-desktop` 全部 renderer 端代码
> **参考体系**：Apple Human Interface Guidelines · Ant Design 5 Design Token · shadcn/ui · Material Design 3

---

## 目录

- [1. 设计原则](#1-设计原则)
- [2. 颜色系统](#2-颜色系统)
- [3. 字体系统](#3-字体系统)
- [4. 间距系统](#4-间距系统)
- [5. 圆角系统](#5-圆角系统)
- [6. 阴影系统](#6-阴影系统)
- [7. 组件使用规范](#7-组件使用规范)
- [8. 图标使用规范](#8-图标使用规范)
- [9. 交互与动效](#9-交互与动效)
- [10. 暗黑模式规则](#10-暗黑模式规则)
- [11. 响应式断点](#11-响应式断点)
- [12. 禁止的反模式](#12-禁止的反模式)
- [13. 模板与可复用组件](#13-模板与可复用组件)
- [14. 中英对照术语表](#14-中英对照术语表)

---

## 1. 设计原则

### 1.1 五大核心原则

| 原则 | 描述 | 优先级 |
|------|------|--------|
| **极简留白** | 大量留白、细线条、轻阴影（参考 Apple HIG） | P0 |
| **暗黑模式优先** | 全站统一暗色，CSS 变量驱动 | P0 |
| **去 AI 味** | 禁止 emoji / 蓝紫渐变 / 通用 SaaS 卡片网格 | P0 |
| **语义化状态** | 风险/成功/失败用图标 + 颜色 + 文字三重表达 | P0 |
| **可访问性** | 对比度 ≥ 4.5:1，触摸目标 ≥ 44pt | P1 |

### 1.2 视觉层次（字号阶梯）

```
H1  32px  -000000  ─  页面主标题（极少使用）
H2  24px  -333333  ─  模块大标题
H3  20px  -555555  ─  区块标题
H4  18px  -666666  ─  卡片标题
H5  16px  -1d1d1f  ─  正文字号（默认）
H6  14px  -4a4a4a  ─  辅助文字
H7  13px  -86868b  ─  元信息/时间戳
H8  12px  -999999  ─  极小标签
H9  11px  -aaaaaa  ─  仅限 license/版权信息
```

### 1.3 WHY 我们的设计哲学

> **TDSF 不是"AI 替代运维"，而是"AI 让运维可解释"**
>
> 视觉设计要服务于这个核心叙事：
> - **冷静专业**：拒绝花哨，让运维人员专注任务
> - **可信可读**：每个状态、每个证据都有清晰视觉表达
> - **教育友好**：学生能一眼看懂"为什么"，而不是被设计分散注意力

---

## 2. 颜色系统

### 2.1 CSS 变量定义（推荐放在 `src/renderer/src/styles/global.css`）

```css
:root {
  /* ===== 背景三级 ===== */
  --color-bg-primary:    #ffffff;  /* 页面最底 */
  --color-bg-card:       #fafafa;  /* 卡片 */
  --color-bg-elevated:   #ffffff;  /* 弹窗/浮层 */

  /* ===== 文字三级 ===== */
  --color-text-primary:   #1d1d1f;  /* 主标题、关键数字 */
  --color-text-secondary: #4a4a4a;  /* 正文 */
  --color-text-tertiary:  #86868b;  /* 次要/时间戳 */

  /* ===== 边框/分割 ===== */
  --color-border:         #f0f0f0;  /* 浅分割 */
  --color-border-strong:  #e5e5e7;  /* 强分割/输入框边框 */

  /* ===== 主色（链接/品牌） ===== */
  --color-link:        #0071e3;     /* 亮色 */
  --color-link-hover:  #0058b0;
  --color-primary:     #2c7be5;     /* 项目主色（用于强调） */

  /* ===== 状态色 ===== */
  --color-success:  #52c41a;        /* 成功 */
  --color-warning:  #faad14;        /* 警告 */
  --color-error:    #ff4d4f;        /* 错误 */
  --color-info:     #1890ff;        /* 信息 */

  /* ===== 风险色（与业务系统一致） ===== */
  --color-risk-critical: #ff4d4f;   /* 严重 */
  --color-risk-high:     #fa8c16;   /* 高 */
  --color-risk-medium:   #faad14;   /* 中 */
  --color-risk-low:      #52c41a;   /* 低 */
  --color-risk-info:     #1890ff;   /* 提示 */
}

/* ===== 暗黑模式（v0.7.0 默认） ===== */
[data-theme='dark'] {
  --color-bg-primary:    #1d1d1f;   /* 不使用纯黑 */
  --color-bg-card:       #2c2c2e;
  --color-bg-elevated:   #3a3a3c;

  --color-text-primary:   #f5f5f7;   /* 不使用纯白 */
  --color-text-secondary: #d1d1d6;
  --color-text-tertiary:  #86868b;

  --color-border:         #3a3a3c;
  --color-border-strong:  #48484a;

  --color-link:        #0a84ff;
  --color-link-hover:  #409cff;
  --color-primary:     #2c7be5;
}
```

### 2.2 使用规范

| 场景 | 颜色变量 | 示例 |
|------|---------|------|
| 页面背景 | `--color-bg-primary` | `<body>` 背景 |
| 卡片背景 | `--color-bg-card` | `Card` 组件 |
| 弹窗背景 | `--color-bg-elevated` | `Modal` 组件 |
| 标题文字 | `--color-text-primary` | `<h1>` - `<h3>` |
| 正文 | `--color-text-secondary` | `<p>` 段落 |
| 元信息 | `--color-text-tertiary` | 时间戳、版权 |
| 链接 | `--color-link` | `<a>` 标签 |
| 风险高 | `var(--color-risk-high)` | 风险卡片左边框 |

### 2.3 反模式（绝对禁止）

- ❌ **硬编码颜色**（如 `color: '#52c41a'` → 必须 `var(--color-success)`）
- ❌ **蓝紫渐变**（如 `linear-gradient(135deg, #6366f1, #8b5cf6)`）
- ❌ **纯黑/纯白**（暗黑模式禁用 `#000` / 亮色禁用纯白卡片堆叠）
- ❌ **超过 3 种主色**同时出现

---

## 3. 字体系统

### 3.1 字体栈

```css
/* ===== 中文（优先） ===== */
font-family: 'PingFang SC', 'Microsoft YaHei', 'HarmonyOS Sans',
             -apple-system, BlinkMacSystemFont, sans-serif;

/* ===== 英文（兼容） ===== */
font-family: 'SF Pro', '-apple-system', 'Segoe UI', 'Inter',
             BlinkMacSystemFont, sans-serif;

/* ===== 等宽（终端/代码） ===== */
font-family: 'JetBrains Mono', 'Menlo', 'Consolas', 'Monaco', monospace;
```

### 3.2 字号阶梯

| Token | 像素 | 使用场景 |
|-------|------|---------|
| `font-display` | 32px | 主标题（极少用） |
| `font-h1` | 24px | 模态框大标题 |
| `font-h2` | 20px | 区块标题 |
| `font-h3` | 18px | 卡片标题 |
| `font-body-lg` | 16px | 默认正文 |
| `font-body` | 14px | 次要正文 |
| `font-body-sm` | 13px | 元信息 |
| `font-caption` | 12px | 标签/Tooltip |
| `font-micro` | 11px | License/版权 |

### 3.3 行高规范

| 场景 | line-height |
|------|-------------|
| 标题（H1-H3） | 1.3 |
| 正文 | 1.6 |
| 代码块 | 1.5 |
| 按钮文字 | 1.0 |
| 极小标签 | 1.4 |

---

## 4. 间距系统（8px 栅格）

### 4.1 基础间距

```css
--space-1:  4px;
--space-2:  8px;
--space-3:  12px;
--space-4:  16px;
--space-5:  20px;
--space-6:  24px;
--space-7:  32px;
--space-8:  40px;
--space-9:  48px;
--space-10: 64px;
```

### 4.2 场景使用

| 场景 | 推荐间距 |
|------|---------|
| 组件内边距 | 12-16px |
| 卡片内边距 | 16-20px |
| 卡片间距 | 16-20px |
| 区块间距 | 24-32px |
| 页面边距 | 32-48px |

### 4.3 反模式

- ❌ 8px 栅格外的小数值（如 7px、13px）
- ❌ 组件内外 padding 不一致

---

## 5. 圆角系统

| 元素类型 | 圆角值 | 示例 |
|---------|--------|------|
| 小元素（按钮/Tag） | 4-6px | `<Tag>` 默认 4px |
| 卡片/输入框 | 8-12px | `<Card>` 8px |
| 弹窗/Modal | 12-16px | `<Modal>` 12px |
| 头像/徽章 | 50%（圆形） | `<Avatar>` 50% |

### Token 定义

```css
--radius-sm:   4px;
--radius-md:   6px;
--radius-base: 8px;
--radius-lg:   12px;
--radius-xl:   16px;
--radius-full: 50%;
```

---

## 6. 阴影系统

### 6.1 亮色模式

| 层级 | Token | CSS |
|------|-------|-----|
| 轻 | `--shadow-sm` | `0 1px 2px rgba(0, 0, 0, 0.06)` |
| 中 | `--shadow-md` | `0 2px 8px rgba(0, 0, 0, 0.12)` |
| 重 | `--shadow-lg` | `0 8px 24px rgba(0, 0, 0, 0.18)` |

### 6.2 暗黑模式（弱化）

```css
[data-theme='dark'] {
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.6);
}
```

### 6.3 使用场景

| 组件 | 阴影 |
|------|------|
| 卡片 | 默认无，hover 用 `--shadow-sm` |
| 弹窗 | `--shadow-lg` |
| Dropdown | `--shadow-md` |
| Tooltip | `--shadow-sm` |

---

## 7. 组件使用规范

### 7.1 按钮

```tsx
// ✅ 主操作
<Button type="primary">保存</Button>

// ✅ 次要操作
<Button>取消</Button>

// ✅ 危险操作（必须二次确认）
<Button danger onClick={handleDelete}>删除</Button>
<Popconfirm title="确认删除？" onConfirm={handleDelete}>
  <Button danger>删除</Button>
</Popconfirm>

// ❌ 反例：多色按钮混用
<Button type="primary" danger>...</Button>
```

### 7.2 列表/卡片网格

```tsx
<Row gutter={[16, 16]}>
  <Col xs={24} sm={12} md={8} lg={6} xl={4}>
    <Card>...</Card>
  </Col>
</Row>
```

### 7.3 表单

```tsx
<Form layout="vertical" labelAlign="left">
  <Form.Item
    label="主机地址"
    required  // 必填
    tooltip="IPv4 地址或域名"
  >
    <Input placeholder="192.168.1.1" />
  </Form.Item>
</Form>
```

### 7.4 弹窗

```tsx
<Modal
  width={640}  // 520-720px 之间
  title="风险确认"
  okText="确认执行"
  cancelText="取消"
  okButtonProps={{ danger: isHighRisk }}
>
  ...
</Modal>
```

### 7.5 通知反馈

| 场景 | 组件 |
|------|------|
| 轻提示 | `message.success('已保存')` |
| 右上通知 | `notification.info({ ... })` |
| 阻塞确认 | `Modal.confirm({ ... })` |
| Loading | `<Spin />` / `<Button loading />` |
| 空状态 | `<EmptyState />`（推荐统一组件） |
| 错误页 | `<ErrorState />`（推荐统一组件） |

### 7.6 区块标题

```tsx
<SectionTitle
  icon={<FileTextIcon />}
  title="风险详情"
  tag={{ label: '3 项', color: 'red' }}
  extra={<Button>刷新</Button>}
/>
```

---

## 8. 图标使用规范

### 8.1 铁律

- **统一使用 Ant Design Icons**（`@ant-design/icons`），按需 import
- **禁止 emoji 作为功能图标**（含标题前缀、状态指示）
- 装饰性图标：14-16px，单色 `currentColor`
- 状态图标：搭配 `Badge` / `Tag` / `Alert` 使用

### 8.2 业务图标清单

| 业务场景 | 推荐图标 | Ant Design 名 |
|---------|---------|---------------|
| 部署 | `RocketOutlined` / `CloudServerOutlined` | 火箭/云服务器 |
| 教程 | `BookOutlined` / `ReadOutlined` / `FileTextOutlined` | 书籍/阅读/文件 |
| AI | `RobotOutlined` / `MessageOutlined` / `ThunderboltOutlined` | 机器人/消息/闪电 |
| 服务器 | `DesktopOutlined` / `ApiOutlined` | 桌面/API |
| 监控 | `LineChartOutlined` / `DashboardOutlined` | 折线图/仪表盘 |
| 风险 | `WarningOutlined` / `AlertOutlined` / `SafetyOutlined` | 警告/告警/安全 |
| 日志 | `FileSearchOutlined` / `CodeOutlined` | 文件搜索/代码 |
| 设置 | `SettingOutlined` / `ToolOutlined` | 设置/工具 |

### 8.3 状态图标矩阵

| 状态 | 图标 | Tag color | 适用场景 |
|------|------|-----------|---------|
| 成功 | `CheckCircleFilled` | `success` / `green` | 部署成功、命令完成 |
| 失败 | `CloseCircleFilled` | `error` / `red` | 部署失败、命令报错 |
| 警告 | `ExclamationCircleOutlined` | `warning` / `gold` | 中风险、降级 |
| 严重 | `WarningFilled` | `red` | 极高风险 |
| 进行中 | `LoadingOutlined` (spin) | `processing` / `blue` | 执行中、加载中 |
| 提示 | `InfoCircleOutlined` | `info` / `blue` | 补充说明 |
| 想法 | `BulbOutlined` | `default` | 建议、提示 |
| 取消 | `StopOutlined` | `default` | 用户取消操作 |

### 8.4 emoji → 图标替换示例

| 旧 emoji | 新图标 | 使用 |
|---------|--------|------|
| 📚 全部 | `<AppstoreOutlined /> 全部` | 分类 |
| 📖 来源 | `<BookOutlined /> 来源` | 元信息 |
| 📝 配置 | `<SettingOutlined /> 配置` | 区块标题 |
| 📋 计划 | `<FileTextOutlined /> 计划` | 区块标题 |
| 🚀 部署 | `<RocketOutlined /> 部署` | 区块标题 |
| 🛠️ 工具 | `<ThunderboltOutlined /> 工具` | 区块标题 |
| ✅ 成功 | `<CheckCircleFilled /> 成功` | 状态 |
| ❌ 失败 | `<CloseCircleFilled /> 失败` | 状态 |
| ⚠️ 警告 | `<ExclamationCircleOutlined /> 警告` | 状态 |
| 🚨 严重 | `<WarningFilled /> 严重` | 状态 |
| 💡 建议 | `<BulbOutlined /> 建议` | 提示 |
| 📊 图表 | `<BarChartOutlined /> 图表` | 数据 |
| 📡 抓取 | `<ApiOutlined /> 抓取` | 数据源 |
| 🕐 时间 | `<HistoryOutlined /> 时间` | 时间戳 |
| 📜 协议 | `<ProfileOutlined /> 协议` | License |
| 🐧 Linux | `<LinuxOutlined /> Linux` | 发行版 |
| ⏱️ 耗时 | `<ClockCircleOutlined /> 耗时` | 时间 |
| 🔬 探查 | `<ExperimentOutlined /> 探查` | 系统分析 |
| ⏹️ 停止 | `<StopOutlined /> 停止` | 操作 |
| ⏳ 等待 | `<LoadingOutlined /> 等待` | 加载 |
| 📺 日志 | `<PlayCircleOutlined /> 日志` | 实时流 |
| 🎉 完成 | `<ThunderboltFilledIcon /> 完成` | 庆祝 |

### 8.5 推荐导入方式

**方式一：按需直接 import（推荐）**
```tsx
import { BookOutlined, RocketOutlined } from '@ant-design/icons'
```

**方式二：统一通过 `common/icons.ts`**
```tsx
import { BookIcon, RocketIcon } from '../common/icons'
```

详见 `src/renderer/src/components/common/icons.ts`。

---

## 9. 交互与动效

### 9.1 过渡时长

| 元素 | 时长 | 缓动函数 |
|------|------|---------|
| 小元素（按钮、Tag） | 150ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| 卡片 | 200ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| 弹窗/Modal | 300ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Tooltip | 100ms | `ease-out` |

### 9.2 状态反馈

| 状态 | 视觉反馈 |
|------|---------|
| Hover | `background-color` 淡化 + 阴影提升 |
| Active/Press | `transform: scale(0.98)` + 100ms |
| Focus | 可见焦点环（`outline: 2px solid var(--color-link)`） |
| Disabled | opacity 0.5 + cursor not-allowed |

### 9.3 滚动条（暗色模式）

```css
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}
```

### 9.4 动画原则

- ✅ **功能优先**：动画必须有目的（提示状态、引导注意力）
- ❌ **仅为装饰**：禁止闪烁/旋转/跳动等无意义动画
- ✅ **尊重系统设置**：`prefers-reduced-motion: reduce` 时禁用

---

## 10. 暗黑模式规则

### 10.1 实现

```css
/* 通过 [data-theme='dark'] 切换 */
[data-theme='dark'] {
  --color-bg-primary: #1d1d1f;
  /* ... */
}
```

```tsx
// 切换
document.documentElement.setAttribute('data-theme', 'dark')
```

### 10.2 暗黑模式铁律

| 规则 | 原因 |
|------|------|
| 所有颜色必须走 CSS 变量 | 避免重复定义 |
| 禁用纯黑背景 | OLED 屏幕烧屏风险 + 视觉过暗 |
| 使用 `#1d1d1f` 而非 `#000` | 苹果推荐深灰 |
| 阴影透明度提高但 blur 加大 | 暗色下阴影更明显 |
| 文字用 `#f5f5f7` 而非纯白 | 减轻视觉疲劳 |
| 图片需考虑暗色背景对比 | 透明度 0.85 提升可读性 |

### 10.3 暗色文字颜色对照

| 元素 | 亮色 | 暗色 |
|------|------|------|
| 主标题 | `#1d1d1f` | `#f5f5f7` |
| 正文 | `#4a4a4a` | `#d1d1d6` |
| 次要 | `#86868b` | `#86868b`（一致） |
| 链接 | `#0071e3` | `#0a84ff` |

---

## 11. 响应式断点

| 断点 | 范围 | 列数建议 |
|------|------|---------|
| `xs` | <576px | 1 列（移动） |
| `sm` | ≥576px | 2 列 |
| `md` | ≥768px | 2-3 列（平板） |
| `lg` | ≥992px | 3-4 列（笔记本） |
| `xl` | ≥1200px | 4-6 列（桌面） |
| `xxl` | ≥1600px | 6+ 列（大屏） |

```tsx
<Row gutter={[16, 16]}>
  <Col xs={24} sm={12} md={8} lg={6} xl={4} xxl={4}>
    <Card>...</Card>
  </Col>
</Row>
```

> **TDSF 桌面端为主**：优先保证 ≥992px 的体验，移动端最低支持 768px（保证教学场景下平板可用）。

---

## 12. 禁止的反模式

### 12.1 必须严格禁止

| 反模式 | 原因 | 替代方案 |
|--------|------|---------|
| ❌ **任何 emoji**（含标题前缀） | 视觉不专业、与 Ant Design 风格冲突 | 统一 Ant Design Icons |
| ❌ **蓝紫渐变背景** | AI 味重、视觉疲劳 | 单一深色 + 微弱分层 |
| ❌ **灰底白卡堆叠** | 缺乏层次感 | 卡片用边框 + 极轻阴影 |
| ❌ **标准 Hero 段落** | "欢迎使用...我们致力于..." | 直接展示功能 |
| ❌ **硬编码颜色** | 难以维护主题 | 全部用 `var(--color-*)` |
| ❌ **AI 味设计**（emoji + 圆角 + 插画） | 千篇一律 | 极简 + 语义化 |
| ❌ **多色按钮**（>3 种） | 视觉杂乱 | 主色 + 危险色 2 种 |
| ❌ **闪烁/旋转/跳动动画** | 干扰注意力 | 仅功能反馈 |
| ❌ **弹窗套弹窗** | 焦点丢失 | 最多一层 |
| ❌ **彩虹渐变文字** | AI 味 | 单色文字 |
| ❌ **占位符感排版** | 不专业 | 真实内容 + 真实字号 |

### 12.2 Emoji 反模式专项（v0.7.0 已清理）

历史上 emoji 滥用案例（已全部修复）：

```tsx
// ❌ 历史反例（v0.7.0 前）
<h3>📚 全部</h3>
<Tag>✅ 成功</Tag>
<Tag>⚠️ 警告</Tag>
<RiskCard emoji="🚨" />

// ✅ 修复后（v0.7.0+）
<h3><AppstoreOutlined style={{ marginRight: 6 }} />全部</h3>
<Tag icon={<CheckCircleFilled />} color="success">成功</Tag>
<Tag icon={<ExclamationCircleOutlined />} color="warning">警告</Tag>
<RiskCard icon={<WarningFilled />} />
```

---

## 13. 模板与可复用组件

### 13.1 统一组件库（`src/renderer/src/components/common/`）

| 组件 | 文件 | 用途 |
|------|------|------|
| `EmptyState` | `EmptyState.tsx` | 空状态统一（图标 + 标题 + 描述 + 主操作） |
| `ErrorState` | `ErrorState.tsx` | 错误状态（网络/认证/超时/通用） |
| `SectionTitle` | `SectionTitle.tsx` | 区块标题（图标 + 标题 + 标签 + 副操作） |
| `RiskTag` | `RiskTag.tsx` | 风险等级 Tag（5 级 + 兼容大写） |
| `ToolTag` | `ToolTag.tsx` | 工具类型 Tag（5 个 LLM 工具） |
| `Icons` | `icons.ts` | 图标统一导出（按业务分类） |

### 13.2 使用示例

```tsx
// 1. 空状态
<EmptyState
  icon={<FileSearchIcon />}
  title="暂无教程"
  description="该分类下还没有教程，尝试切换分类或搜索关键词"
  action={{ label: '刷新教程', onClick: handleRefresh, icon: <ReloadIcon /> }}
/>

// 2. 错误状态
<ErrorState
  type="network"
  title="无法连接到服务器"
  errorMessage="ECONNREFUSED 127.0.0.1:22"
  onRetry={handleRetry}
  onBack={handleBack}
/>

// 3. 区块标题
<SectionTitle
  icon={<FileTextIcon />}
  title="风险详情"
  tag={{ label: '3 项', color: 'red' }}
  extra={<Button>刷新</Button>}
/>

// 4. 风险等级
<RiskTag level="critical" />
<RiskTag level="HIGH" label="高风险命令" />
<RiskTag level="low" outlined compact />

// 5. 工具类型
<ToolTag toolId="ssh_exec" />
<ToolTag toolId="tutorial_search" showLabel />
```

### 13.3 推广计划

- [x] v0.7.0：创建 5 个 common 组件
- [x] v0.7.0：清除全部 44 处 emoji
- [ ] v0.8.0：把 5 个 common 组件应用到所有页面
- [ ] v0.8.0：替换所有 `import { ... } from '@ant-design/icons'` 为 `from '../common/icons'`
- [ ] v0.8.0：CSS 变量全量替换硬编码颜色

---

## 14. 中英对照术语表

| 中文 | 英文 | 说明 |
|------|------|------|
| 极简留白 | Minimal Whitespace | 苹果 HIG 推荐 |
| 暗黑模式 | Dark Mode | 通过 `data-theme='dark'` 切换 |
| 风险等级 | Risk Level | safe/low/medium/high/critical |
| 证据链 | Evidence Chain | DecisionCard 核心组件 |
| 风险确认 | Risk Confirmation | 高危命令人工二次确认 |
| 部署模板 | Deploy Template | LAMP/WordPress/Nginx/Docker |
| 教程来源 | Tutorial Source | Arch Wiki / LDP / tldr 等 |
| 风险标签 | Risk Tag | 颜色 + 图标 + 文字 |
| 空状态 | Empty State | 数据为 0 时的占位 |
| 错误状态 | Error State | 网络/权限/超时错误 |
| 区块标题 | Section Title | 统一标题样式 |
| 通用组件 | Common Components | 跨页面可复用 |
| 设计令牌 | Design Token | 三层架构（Primitive/Semantic/Component） |
| 反 AI 味 | Anti-AI-Slop | 拒绝通用 SaaS 风 |
| 视觉层次 | Visual Hierarchy | 字号 + 颜色 + 间距三重 |
| 触摸目标 | Touch Target | ≥ 44×44pt（WCAG 标准） |
| 颜色对比度 | Color Contrast | 正文 ≥ 4.5:1（大文本 ≥ 3:1） |
| 焦点环 | Focus Ring | 键盘导航可见标识 |
| 缓动函数 | Easing Function | `cubic-bezier(0.4, 0, 0.2, 1)` |
| 响应式断点 | Responsive Breakpoint | xs/sm/md/lg/xl/xxl |

---

## 附录 A：变更记录

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| v1.0 | 2026-07-16 | 首次发布（v0.7.0 对应） |
| | | - 清除全部 44 处 emoji |
| | | - 引入 5 个统一组件 |
| | | - 制定 12 章节完整规范 |
| | | - 引用 Ant Design 5 + Apple HIG 体系 |

## 附录 B：参考资源

- **Ant Design 5 Design Token**：https://ant.design/docs/react/customize-theme
- **Apple Human Interface Guidelines — Dark Mode**：https://developer.apple.com/design/human-interface-guidelines/dark-mode
- **Material Design 3 — Color System**：https://m3.material.io/styles/color
- **shadcn/ui Theme**：https://ui.shadcn.com/themes
- **WCAG 2.2 Contrast Guidelines**：https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- **LobeChat 设计参考**：https://github.com/lobehub/lobe-chat
- **Cherry Studio 设计参考**：https://github.com/kangfenmao/cherry-studio

---

> **维护说明**：本规范是活文档，每次新增组件/修改样式前必须先查阅本规范。如发现需要扩展的规则，请提交 PR 并在「变更记录」中说明。
