# TDSF-Linux Desktop - AI Agent 开发指南

> 本文件是所有 AI Agent（Claude Code / Trae / Codex 等）在本项目工作时的通用入口。

## 项目概述

**TDSF-Linux Desktop** = FinalShell 的 SSH 能力 + AI 运维助手 + 可信决策内核

- **技术栈**：Electron 30 + React 18 + TypeScript 5.4 + Vite 5 + Ant Design 5 + Recharts 2
- **SSH**：ssh2 (mscdex) v1.15+ — 支持密码/密钥认证、交互式Shell、SFTP
- **终端**：xterm.js v5.5 + WebGL 加速
- **状态管理**：Zustand v4.5
- **数据库**：better-sqlite3 v12 + @photostructure/sqlite-vec 向量检索
- **LLM**：OpenAI 兼容 SDK（支持火山方舟/任意兼容API）

## 三进程架构

```
主进程 (main/)     — Node.js 完整权限：SSH2/LLM/SQLite/safeStorage/核心算法
Preload (preload/) — contextBridge 安全桥接，只暴露 invoke/handle API
渲染进程 (renderer/) — 沙箱隔离，React 18 + Ant Design 5
```

## IPC 安全三原则（不可违反）

1. `contextIsolation: true` — 上下文隔离
2. `nodeIntegration: false` — 禁用 Node 集成
3. `sandbox: true` — 沙箱模式

## 文件所有权声明

```yaml
main-agent:     {domains: [src/main/**], forbidden: [src/renderer/**]}
renderer-agent: {domains: [src/renderer/**], forbidden: [src/main/**]}
shared-files:   [src/shared/**, AGENTS.md, package.json, tsconfig*.json]
test-agent:     {domains: [tests/**], forbidden: [src/main/**, src/renderer/**], readonly: [src/**]}
```

## 核心算法层（TypeScript 重写自 Python）

| 模块 | 文件 | 功能 |
|------|------|------|
| 置信度计算 | `src/main/core/confidence.ts` | 0.7×Drain3匹配度 + 0.3×来源先验 |
| 证据溯源 | `src/main/core/grounding.ts` | Ground-Check：验证证据来自真实工具调用 |
| 风险引擎 | `src/main/core/risk-engine.ts` | 4层风险控制（语法→风险→人确认→审计） |
| 决策引擎 | `src/main/core/decision-engine.ts` | 整合置信度+风险+证据 → DecisionCard |
| 自适应采样 | `src/main/core/sampling.ts` | 置信度≥0.7单次，<0.7三次重采样 |

## 6大核心机制（v4.0方案书）

1. **证据置信度公式**：0.7×Drain3匹配度 + 0.3×来源先验
2. **证据溯源校验 Ground-Check**：每条证据必须来自真实工具调用
3. **自适应自洽采样**：置信度≥0.7单次推理，<0.7触发3次重采样
4. **4层风险控制**：语法检查→风险评估→证据展示+人确认→审计日志
5. **双推理模式**：快速（简单问题）vs 深度（多步推理+证据核验）
6. **知识双轨制**：command_skills（操作能力）+ incident_cases（故障案例）

## SSH 连接方式（必须全部支持）

1. **密码认证**：username + password
2. **密钥文件认证**：username + privateKeyPath + passphrase（可选）
3. **交互式 Shell**：pty = true，支持 vim/top 等全屏程序
4. **SFTP 文件管理**：上传/下载/删除/重命名/权限修改
5. **端口转发**：本地/远程端口转发
6. **跳板机**：通过跳板机连接目标服务器

## LLM 接入（用户自配）

- API Key 通过 safeStorage 加密存储（OS 钥匙串）
- 支持 Base URL 自定义（火山方舟/OpenAI/任意兼容API）
- 模型名可配置（doubao-seed-1-6-250615 / gpt-4o / 等）
- 降级机制：API Key 为空或调用失败时降级到规则引擎

## 开发命令

```bash
pnpm dev          # 启动开发模式（electron-vite dev）
pnpm build        # 构建生产版本
pnpm test         # 运行测试（vitest）
pnpm lint         # ESLint 检查
pnpm typecheck    # TypeScript 类型检查
pnpm rebuild      # 重新编译原生模块（适配 Electron）
```

## 质量门禁

- TypeScript strict 模式
- ESLint 0 错误（max-warnings=0）
- 测试覆盖率 ≥ 85%
- 单文件 ≤ 500 行
- 单函数圈复杂度 ≤ 15

## Git Commit 规范

```
feat: 添加SSH密钥认证
fix: 修复终端中文乱码
refactor: 提取置信度计算为独立模块
test: 添加风险引擎单元测试
docs: 更新AGENTS.md
```
