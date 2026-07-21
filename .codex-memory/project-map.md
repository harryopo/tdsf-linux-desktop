# 项目地图

## 项目定位

`tdsf-linux-desktop` 是一个 Electron + React + TypeScript 的 Linux 运维桌面助手。
目标不是纯自动化，而是“AI 辅助 + 人工确认 + 可解释决策”。

## 技术栈

- Electron 30
- React 18
- TypeScript 5.4
- electron-vite
- Ant Design
- xterm.js
- ssh2
- Zustand
- better-sqlite3
- Vercel AI SDK / Langfuse / MCP / safeStorage

## 进程模型

- `src/main`：主进程，持有 SSH、LLM、SQLite、MCP、沙箱和审计能力
- `src/preload`：扁平化安全桥接
- `src/renderer`：React UI
- `src/shared`：跨进程类型 SSOT

## 主进程分层

- `src/main/index.ts`：启动入口
- `src/main/windows`：窗口生命周期
- `src/main/ipc`：全部 IPC 注册
- `src/main/services`：SSH、LLM、教程、部署、数据库、可观测性、沙箱、日志
- `src/main/core/agent`：Agent 子系统，含 modes / providers / subagents / credibility / claude-sdk / at-commands

## 渲染层分层

- `src/renderer/src/router.tsx`：20 条路由
- `src/renderer/src/pages`：页面级路由组件
- `src/renderer/src/components`：业务组件和复用组件
- `src/renderer/src/stores`：Zustand 状态
- `src/renderer/src/styles`：全局样式与 token

## 当前产品能力

- SSH 连接、终端、SFTP
- AI 对话与 Agent 工作流
- 置信度 / 风险 / 证据链
- 历史决策、知识库、教程
- Web 部署助手
- 系统探查、监控、日志、设置
- 沙箱、MCP、Provider、Token、Mode、Attention、Subagent

