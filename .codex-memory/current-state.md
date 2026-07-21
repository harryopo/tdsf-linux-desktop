# 当前状态

## 我确认到的事实

- 主工程就是 `tdsf-linux-desktop`
- 仓库里有大量未提交改动，明显是 Trae 正在推进中的工作
- `package.json` 版本仍是 `0.9.0`
- 代码和文档已经出现 `v0.9.5`、`v1.0` 两套叙事，版本口径不一致

## 已实现的主线

- Electron 三进程安全架构已经搭起来
- 主进程已经注册大量 IPC，覆盖 SSH、LLM、教程、部署、沙箱、MCP、日志、可信度、mode、attention、subagent、provider 信息
- 渲染层已经有 20 条路由和完整页面壳
- `src/main/core/agent` 已经拆成 modes / providers / subagents / claude-sdk / credibility / at-commands 等子域

## 目前明显的状态

- 很多页面仍然是 mock 数据或占位实现
- `WorkbenchPage` 目前还是设计稿优先的本地 mock 工作台
- `MainLayout` 已退化为纯 Outlet 容器，避免和页面内部布局重复
- 教程、部署、沙箱、Token、Mode 等能力正在补齐 UI 接线

## 当前可见问题

- `pnpm typecheck:web` 目前报错：
  - `lucide-react` 没有 `Github` 导出
  - `ApprovalStateMachine` / `EvidenceList` / `ExecutionResult` 的若干类型没有正确导出
- 这个问题看起来是渲染层导出和依赖 API 不一致，不是构建链本身坏掉

## 结论

这是一个“主进程能力已很重、渲染层正在重构接线”的项目。
新接手时不要假设 UI 已经接完所有 IPC，先看接线图再动手。

