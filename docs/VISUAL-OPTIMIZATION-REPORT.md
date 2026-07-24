# TDSF Linux Desktop — 视觉优化与 Agent 链路打磨报告

> 日期：2026-07-25 · 分支：feat/design-migration
> 比赛截止：2026-07-30

---

## 一、本次变更概览

本次工作核心目标：以**美观为第一优先级**，将 design-app（tdsf-design-app）的视觉优势移植到生产项目（tdsf-linux-desktop），同时保留 desktop 的 IPC 数据逻辑和后端架构。

### 修改文件清单（7 文件，+140/-60 行）

| 文件 | 变更内容 |
|------|----------|
| `components/workbench/MessageList.tsx` | AI Panel 欢迎态重写：能力网格 + 快捷 chips + 品牌图标 |
| `components/layout/MainLayout.tsx` | 路由切换入场动画（fade-in-up 0.22s） |
| `components/workbench/Workbench.css` | ActivityRail 按压缩放 + 指示条入场动画 + reduced-motion |
| `styles/global.css` | 滚动条收窄至 6px + 半透明 idle + active 态 |
| `styles/design-tokens.css` | 修复 CSS 注释 `*/` 导致 PostCSS 解析失败 |
| `components/workbench/panels/LiveMessageRow.tsx` | 内联样式 → Tailwind token 类 + btn-press + hover 过渡 |
| `components/workbench/panels/PaorApprovalCard.tsx` | 添加 btn-press + transition-colors |

### 已就位的基建（上一轮完成）

| 文件 | 作用 |
|------|------|
| `styles/design-tokens.css` | Token 桥接层：134 个短名 → `--trae-*` 映射 + keyframes + 工具类 |
| `components/ds/ds-ui.tsx` | 36 个 Ds* 组件库（1277 行，从 design-app 复制） |
| `main.tsx` | 引入 design-tokens.css（import 顺序：tailwind → global → design-tokens） |

---

## 二、对比结论（design-app vs desktop）

### desktop 领先的页面（保留不动）

| 页面 | 优势 |
|------|------|
| SettingsPage | 9 卡片响应式网格 + 内嵌控制预览 |
| AppearanceSettings | 60px 主题预览 + 代码高亮实时着色 + 8 色板 |
| KnowledgePage | 双栏布局 + 侧边栏 + AI 搜索发光 + 贡献弹窗 |
| HistoryPage | 时间线轨道 + 火花线统计 + 分页 + 空态 |
| MonitorPage | 加载骨架 + 三态告警 + 按钮按压反馈 |
| BootPage | RAF 进度 + 禁用态 + WebGL 降级 + 状态文字 |

### design-app 领先的维度（已移植）

| 维度 | 移植内容 |
|------|----------|
| AI Panel 欢迎态 | 40px 品牌图标 + 2×2 能力网格 + 4 快捷 chips + 引导按钮 |
| 组件级工艺 | Ds* 组件库 36 个（按钮/卡片/开关/滑块/标签/表格等） |
| 页面过渡 | 路由切换 fade-in-up 动画 |
| 导航微交互 | 指示条 scaleY 入场 + 按钮 scale(0.92) 按压 |
| 滚动条 | 6px 窄轨 + 半透明 + active 态 |

---

## 三、Agent 链路模块审计结果

### 评分总览

| 组件 | 行数 | 评分 | 状态 |
|------|------|------|------|
| LoopWorkflowPanel.tsx | 510 | 9/10 | 生产就绪 |
| AIPanel.css | 1284 | 9/10 | 动画系统完备 |
| useAgentChat.ts | 382 | 9/10 | 状态管理健壮 |
| ToolPanel.tsx | 405 | 8.5/10 | 少量 mock 残留 |
| ProgressPanel.tsx | 70 | 8/10 | 可用，缺总进度条 |
| MessageRow.tsx | 103 | 7.5/10 | `msg-2` 硬编码待清理 |
| PaorApprovalCard.tsx | 85 | 7→8/10 | **已修复**：+btn-press +transition |
| LiveMessageRow.tsx | 153 | 5.5→8/10 | **已修复**：内联→token 类 |

### 本次修复的 Agent 组件

**LiveMessageRow.tsx（最大短板，已修复）：**
- 所有 `style={{}}` 内联样式 → Tailwind `var(--trae-*)` token 类
- 硬编码 hex（`#2A2D31`, `#387BFF`, `#D29D00`, `#3c3c3c`）→ 设计令牌
- emoji `⏸` → lucide `<Pause>` 图标
- 动作按钮：+`btn-press` +`transition-colors` +`hover:border/bg/text` 三态
- 步骤进度条：+`transition-colors duration-150` 平滑状态切换

**PaorApprovalCard.tsx（快速修复）：**
- 批准/拒绝按钮：+`btn-press transition-colors`

### Agent 链路待后续优化项

| 优先级 | 项目 | 说明 |
|--------|------|------|
| P2 | MessageRow `msg-2` 硬编码 | 动作 chips 应改为数据驱动（`message.showActions`） |
| P2 | ToolPanel mock 残留 | `prod-web-01` 主机名 + `1.2s` 执行时间应动态化 |
| P3 | ProgressPanel 总进度条 | 添加 completedSteps/totalSteps 细进度条 |
| P3 | PaorApprovalCard 倒计时 | 60s 自动拒绝缺少可视化倒计时 |
| P3 | LiveMessageRow 步骤进度 | 考虑与 LoopWorkflowPanel 统一为垂直列表样式 |

---

## 四、前后端对接指南

### IPC 通道状态（55+ 通道）

Agent 链路核心 IPC 路径：

```
渲染进程                          主进程
────────                          ──────
agent:chat(text, opts)     →     Supervisor.chat() → LLM 流式
agent:chat:stream          ←     流式 token 推送
agent:chat:cancel          →     取消当前对话流
agent:step                 ←     7 步工作流步骤进度
paor:approval:request      ←     高危命令审批请求推送
paor:approve(callId, bool) →     审批响应
ssh:exec(sessionId, cmd)   →     SSH 命令执行
sandbox:create/execute     →     沙箱预演
```

### 前端 Store 架构

| Store | 文件 | 职责 |
|-------|------|------|
| useAgentStore | `stores/agent-store.ts` | 消息列表 + 流式状态 + 步骤进度 |
| useServerStore | `stores/server-store.ts` | SSH 会话 + 连接状态 |
| useThemeStore | `stores/theme-store.ts` | 主题 + 强调色 + 密度 |
| useConfigStore | `stores/config-store.ts` | 通用配置持久化 |

### 关键 Hook

| Hook | 文件 | 作用 |
|------|------|------|
| useAgentChat | `workbench/useAgentChat.ts` | 主对话路径（send/cancel/clear/compress） |
| useLoopEngineering | `workbench/useLoopEngineering.ts` | 演示模式 7 步 HITL 循环工程 |
| usePersistentState | `hooks/usePersistentState.ts` | IPC -backed 配置持久化 |

### 新增前端组件的对接要点

1. **Ds* 组件库**（`components/ds/ds-ui.tsx`）：纯展示组件，无 IPC 依赖，可直接在任何页面使用。通过 `design-tokens.css` 桥接层消费 `--trae-*` 令牌。

2. **AI Panel 欢迎态**（MessageList.tsx）：快捷 chips 当前为静态文本。后续对接：点击 chip → 调用 `send(chipText)` 触发真实 agent:chat。

3. **LiveMessageRow 动作按钮**：已通过 `onNavigate(path)` 回调实现路由跳转。后续可扩展为真实 IPC 操作（如直接触发监控刷新）。

---

## 五、设计令牌体系

### 三层架构

```
trae-tokens.css (500+ tokens, --trae-* 前缀)
       ↓
design-tokens.css (桥接层, 短名 → --trae-*)
       ↓
ds-ui.tsx + 各页面 (消费短名 var(--bg-brand) 等)
```

### 品牌色

- 主色：`#387BFF`（`--trae-bg-brand`）
- 暗色基底：`#1A1B1D`（`--trae-bg-base-default`）
- 签名缓动：`cubic-bezier(0.16, 1, 0.3, 1)`（`--trae-ease-out`）

### 动画规范

- 快速反馈：150ms（hover/focus）
- 标准过渡：200ms（展开/收起）
- 慢速入场：320ms（抽屉/弹窗）
- 禁止 spring/bounce/elastic
- 全部尊重 `prefers-reduced-motion`

---

## 六、后续开发建议

### 比赛前（5 天内）

1. `pnpm dev` 启动验证所有页面视觉一致性
2. 清理 ToolPanel 中的 mock 残留（`prod-web-01`、`1.2s`）
3. MessageRow 的 `msg-2` 硬编码改为数据驱动
4. 全流程走通：Boot → Workbench → SSH 连接 → AI 对话 → 命令拦截 → 监控

### 比赛后迭代

1. LiveMessageRow 步骤进度与 LoopWorkflowPanel 统一视觉语言
2. PaorApprovalCard 添加 60s 倒计时环形进度
3. ProgressPanel 添加总体进度条
4. Ds* 组件库在 Settings 子页面中逐步替换 AntD 组件（统一手感）
5. 考虑 View Transition API 实现更流畅的页面切换

---

*报告生成：2026-07-25 · feat/design-migration 分支*
