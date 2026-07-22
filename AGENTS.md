# TDSF-Linux Desktop - AI Agent 开发指南 v10.0

> 更新日期：2026-07-23
> 编码规范见 `CODING.md`（80 行核心标准）
> 旧版归档：`docs/archive/CLAUDE-v2.5.md` · `docs/archive/AGENTS-v8.7.md`
> 前期调研文档索引：`docs/archive/README.md`
> 当前阶段：**两周交付冲刺**（比赛截止前交付 Demo 产品）

---

## 项目定位

**TDSF-Linux Desktop** = SSH 终端 + AI 辅助问答 + 高危命令拦截 + 日志分析

> 帮助 Linux 初学者不怕命令行的桌面工具。

---

## Agent 模块当前状态（2026-07-23 评估）

| 模块 | 代码量 | 完成度 | 说明 |
|------|--------|--------|------|
| Task Protocol（14步） | ~1,920 行 | 95% | 全部真实逻辑，借鉴 Kilo Code |
| MCP 工具（25个） | ~1,500 行 | 90% | 6 域覆盖，SSH 域最完整 |
| Credibility（D-S+PCR5） | ~2,000 行 | 90% | 代码完整但生产降级为简单规则 |
| Langfuse 追踪 | ~600 行 | 95% | 3 主干路径集成，无 Key 自动降级 |
| Supervisor（PAOR） | ~1,146 行 | 95% | 流式 + 审批 + 循环编排 |
| Claude SDK 集成 | ~1,000 行 | 90% | 双重包装 + 动态 import |
| 前端 AI UI | ~5,000 行 | 85% | 25+ 组件，CoT 可视化待实现 |
| IPC 暴露 | ~3,000 行 | 90% | 55+ 通道，90% 符合 4 步规范 |

**Agent 整体：~16,000 行代码，核心逻辑完整可用。**

---

## 两周交付路线（2026-07-23 至比赛截止）

### 第一周：Demo 产品交付

> **目标**：能跑、能演示、核心链路打通。可以粗糙，不能缺环节。

| # | 模块 | 内容 | 验收标准 |
|---|------|------|----------|
| W1.1 | SSH 连接 + 终端 | ssh2 + xterm.js 完整链路 | 连接→输入命令→看到输出 |
| W1.2 | AI 基础问答 | Supervisor.chat() + 流式输出到前端 | 提问→AI 回复→文字渲染 |
| W1.3 | 高危命令拦截 | 12 条黑名单 + 审批弹窗 | 执行 rm -rf / → 拦截弹窗 |
| W1.4 | SFTP 文件管理 | 上传/下载/删除/重命名 | 拖拽上传→服务器可见 |
| W1.5 | 简易监控 | CPU/内存/磁盘面板 | 连上服务器→数据刷新 |
| W1.6 | 设置页面 | SSH 配置 + 外观 + AI 引擎选择 | 改配置→保存→生效 |
| W1.7 | Demo 打包 | build:win → .exe 可安装 | 另一台电脑能装能用 |

### 第二周：打磨与增强

> **目标**：视觉统一、交互流畅、展示效果好。

| # | 模块 | 内容 | 验收标准 |
|---|------|------|----------|
| W2.1 | Credibility 可视化 | DAG + 证据链 + 置信度环形图 | DecisionCard 完整展示 |
| W2.2 | Task Protocol 审批 | 三态权限弹窗 + 14 步进度 | Subagent 调度→弹窗→确认 |
| W2.3 | 教程浏览 | 7 爬虫源 + 分类 + 搜索 | 搜索→结果列表→点开阅读 |
| W2.4 | 日志分析 | Drain3 模板提取 + 分析报告 | tail 日志→模板识别→展示 |
| W2.5 | AI Panel 增强 | @命令划选注入 + MCP 工具选择 | @ssh → 自动补全工具列表 |
| W2.6 | UI 统一 | 暗色主题 + 颜色 token + 间距对齐 | 所有页面风格一致 |
| W2.7 | 最终打包 + 测试 | build:win + 全流程走通 | 安装→SSH→AI→命令→监控 |

---

## 降级策略（接口保留，待后续迭代）

以下模块**保留代码和接口**，Demo 阶段走简化路径：

| 模块 | Demo 策略 | 保留内容 | 后续计划 |
|------|-----------|----------|----------|
| D-S 证据理论 | 简单规则（高/中/低） | ds-theory.ts + pcr5.ts + fusion-engine.ts | v3.1 恢复完整融合 |
| PCR5 融合 | 简单加权 | 同上 | v3.1 |
| Langfuse | DEV 自动降级（无 Key 不启用） | langfuse.ts + langfuse-trace.ts | 按需开启 |
| Claude SDK | 与 Vercel AI SDK 双通道可用 | claude-sdk-provider.ts + wrapper | 稳定后择一 |
| ECE 校准 | 跳过 | 接口保留在 credibility/audit/types.ts | v3.2 |
| EU AI Act 合规 | 跳过 | formatters.ts 接口保留 | v3.x 按需 |
| CoT 熵轨迹 | 数据收集保留，可视化跳过 | cot-trace-collector.ts | v3.2 |

---

## 开发命令

```bash
pnpm dev              # 启动开发模式
pnpm build:win        # Windows 打包
pnpm test             # 单元测试
pnpm lint             # ESLint
pnpm typecheck:node   # 主进程类型检查
pnpm typecheck:web    # 渲染进程类型检查
```

## Git Commit 规范

```
feat: 添加SSH密钥认证
fix: 修复终端中文乱码
refactor: 删除冗余模块
test: 添加单元测试
docs: 更新文档
chore: 清理依赖
```

---

## 三进程架构

```
主进程 (main/)     — Node.js：SSH2/LLM/SQLite/核心算法
Preload (preload/) — contextBridge 安全桥接
渲染进程 (renderer/) — React 18 + Ant Design 5，沙箱隔离
```

## IPC 安全三原则

1. `contextIsolation: true`
2. `nodeIntegration: false`
3. `sandbox: true`

---

## 审查 Agent

- **reviewer**：`.claude/agents/reviewer.md` — 每个 Task 完成后 7 维审查
- **outsider-reviewer**：`.claude/agents/outsider-reviewer.md` — 每 3-5 版本 11 维审查

---

## 文件所有权

单 AI 工作模式。Git 是最终事实源。

---

*v10.0 · 2026-07-23 · Demo 优先，接口保留，后续迭代*
