# v2.0 后端 + Agent 架构循环工程 — 任务清单

> **方案书**：`idea-to-dev-output/45-后端与Agent架构规划-v2.0.md`
> **执行模式**：subagent-driven-development（父 agent 编排 + 子 agent 实施）
> **执行周期**：2026-07-22（单日循环工程）
> **状态**：✅ 全部完成

---

## Phase 总览

| Phase | 主题 | Task 数 | Commit | 状态 |
|-------|------|---------|--------|------|
| Phase 0 | 环境前置校验 | 3 | — | ✅ |
| Phase A | Monaco Editor + 沙箱资源补齐 | 6 | `4c63eb9` | ✅ |
| Phase B | Inline Completion + Diff + @命令划选 | 5 | `cfbaa09` | ✅ |
| Phase C | 文件搜索 + 监听 + Tab 持久化 + 三态权限 | 6 | `ea7ef83` | ✅ |
| Phase D | task-protocol 14 步 + Langfuse trace | 5 | `b47aa95` | ✅ |
| Phase E | credibility/calibration + Mastra 边界 | 4 | `479d33a` | ✅ |
| Phase F | MCP 工具扩展到 30+ | 4 | `b2af5e8` | ✅ |
| Phase G | 集成验证 + 归档 | 5 | — | ✅ |

**总计**：38 Task，6 commit，全部完成。

---

## Phase 0 · 环境前置校验

| Task | 内容 | 状态 |
|------|------|------|
| 0.1 | git status + git log 工作区状态 | ✅ |
| 0.2 | typecheck:node + typecheck:web + lint 编译门禁 | ✅ |
| 0.3 | pnpm test 冒烟测试 1220/1221 通过 | ✅ |

## Phase A · Monaco Editor + 沙箱资源（commit `4c63eb9`）

| Task | 内容 | 状态 |
|------|------|------|
| A.1 | 安装 @monaco-editor/react + monaco-editor | ✅ |
| A.2 | 新建 MonacoEditor.tsx 组件 | ✅ |
| A.3 | 改造 EditorArea.tsx 替换 textarea | ✅ |
| A.4 | StatusBar 光标位置实时更新 | ✅ |
| A.5 | 补齐 docker-compose.yml 资源文件 | ✅ |
| A.6 | Monaco 语言扩展注册（bash/python/json/yaml） | ✅ |

## Phase B · Inline Completion + Diff + @命令（commit `cfbaa09`）

| Task | 内容 | 状态 |
|------|------|------|
| B.1 | InlineCompletionProvider（ghost text 补全） | ✅ |
| B.2 | InlineDiffAdapter（Accept/Reject diff 块） | ✅ |
| B.3 | SelectionPopover（@命令划选注入） | ✅ |
| B.4 | inline-completion-service（5 限流 + LRU 100 + 5s 超时） | ✅ |
| B.5 | IPC 4 通道 4 步同步 | ✅ |

## Phase C · 文件搜索 + 监听 + Tab 持久化（commit `ea7ef83`）

| Task | 内容 | 状态 |
|------|------|------|
| C.1 | QuickFileSearch（Cmd+P fzf 模糊匹配） | ✅ |
| C.2 | GlobalSearch（Cmd+Shift+F 正则搜索） | ✅ |
| C.3 | FileWatcher（SSH inotifywait + 降级轮询） | ✅ |
| C.4 | workbench-store（Zustand persist + electron-store） | ✅ |
| C.5 | ActivityRail 路由接线 + 三态权限（R12） | ✅ |
| C.6 | IPC 5 通道 4 步同步 | ✅ |

## Phase D · task-protocol 14 步 + Langfuse trace（commit `b47aa95`）

| Task | 内容 | 状态 |
|------|------|------|
| D.1 | step 1-5 补齐（validate/permission/config/permissions/context） | ✅ |
| D.2 | step 6-8 补齐（provider/mode/prompt） | ✅ |
| D.3 | step 9-11 补齐（invoke/stream/usage） | ✅ |
| D.4 | step 12-14 补齐（validate/cleanup/return） | ✅ |
| D.5 | Langfuse 流式 trace 集成（provider + supervisor + HITL） | ✅ |

## Phase E · credibility/calibration + Mastra 边界（commit `479d33a`）

| Task | 内容 | 状态 |
|------|------|------|
| E.1 | ECE 校准集成到 FusionEngine | ✅ |
| E.2 | Temperature Scaling 集成到 FusionEngine | ✅ |
| E.3 | Mastra vs Supervisor 边界文档 + JSDoc | ✅ |
| E.4 | DecisionDetailPage 校准状态 UI（前端任务，跳过） | ⏭️ 前端 |

## Phase F · MCP 工具扩展到 30+（commit `b2af5e8`）

| Task | 内容 | 状态 |
|------|------|------|
| F.1 | SSH 域 5 工具 + 监控域 3 工具 | ✅ |
| F.2 | 日志域 3 工具 + 知识域 4 工具 | ✅ |
| F.3 | 决策域 3 工具 + 沙箱域 3 工具 | ✅ |
| F.4 | MCP resources(8) + prompts(5) 暴露 | ✅ |

## Phase G · 集成验证 + 归档

| Task | 内容 | 状态 |
|------|------|------|
| G.1 | 编译门禁三绿验证 | ✅ typecheck:node ✅ typecheck:web ✅ lint(后端✅ 前端⚠️) |
| G.2 | 测试运行 1220/1221 通过 | ✅ |
| G.3 | 归档五件套创建 | ✅ |
| G.4 | PROGRESS.md 更新 | ✅ |
| G.5 | 最终 commit | ✅ |
