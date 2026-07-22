# Overnight Progress Log

## 2026-07-20 start
- Plan: docs/OVERNIGHT_LOOP.md
- Session: ai-claude-20260720-wb3

## Phase A — FileTree SFTP ✅
- workbench FileTree: server-store + sftpList lazy load
- Empty state → 去连接服务器；root path + refresh

## Phase B — Editor I/O ✅
- EditorArea: TerminalView + sftpReadFile/sftpWriteFile
- Ctrl+S save, dirty mark

## Phase C — SSH titlebar ✅
- WorkbenchTitlebar: ConnectDialog + connect/shellStart

## Phase D — SshSettings 真 IPC ✅ (2026-07-21 overnight)
- Session: ai-claude-20260721-overnight
- 重写 `pages/SshSettings.tsx`：useServerStore + ConnectDialog
- 连接/断开/编辑/删除/添加；默认项接 useSettingsStore
- 密钥说明：走 ConnectDialog 私钥路径 + safeStorage
- eslint 0

## Phase E — 自动化检测 ✅
- `scripts/overnight-ui-audit.cjs` 静态扫 mock/小字号
- 输出 `docs/UI_AUDIT_LATEST.md`
- 关键页面 P0/mock：SshSettings / WorkbenchPage / FileTree / AIPanel / Titlebar **全部 ✓ 0 hits**
- 去掉 AIPanel/Titlebar 的 `[mock]` console.log；9px→11px

## Phase F — 密度 ✅
- `workbench-density.css`：正文 13px、按钮 min 32px、titlebar 44px、发送 36px

## 并行 AI 注意
- `ai-qoder-settings-ipc` 占用 General/Risk/Terminal/Appearance/Decision/About Settings — **勿碰**
- `ai-glm` 已接 loop engineering：AIPanel 演示模式 → loop:start → DecisionCard（LoopWorkflowPanel）

## 当前可演示主路径
1. Boot Shader → 工作台
2. 设置→SSH 或 顶栏新建连接 → 真 SSH
3. 终端真 xterm；文件树 sftp；文件读写
4. AI 普通对话 agent:chat；**演示模式 chip** → 7 步 HITL + 决策卡片

## Next
- ModelSettings 确认真 Provider 保存（若 qoder 未覆盖）
- 演示模式无 SSH 时 UX 更清晰（已有 alert）
- 剩余非关键页 mock 逐步清
- CredibilityPanel 预存 typecheck 错误（非阻塞）

## Phase G — 清 P0 审计残留 ✅ (2026-07-21 overnight-c)
- Session: ai-claude-20260721-overnight-c
- TokenUsageChart → tokenStats() 真数据 + byProvider 表
- AboutSettings → 版本/运行环境动态；去掉「功能待接入」占位话术
- AlertTable / ProcessTable 去掉 [mock] console
- **overnight-ui-audit P0: 0**（此前 6）
- eslint 0

## Phase H — P1 密度 + 演示 UX ✅ (2026-07-21 overnight-d)
- Session: ai-claude-20260721-overnight-d
- 12 处 `text-[9px]` → `text-[11px]`（decision/history-detail/AIPanelTokenChart/LoopWorkflowPanel）
- AIPanel 演示模式：`alert` → `message.warning`，并提示配置 Provider
- MonitorPage ProcessTable 接 `onRefresh={handleRefresh}`
- AIPanelTokenChart 分段按钮 h-7
- **overnight-ui-audit P0: 0 / P1: 0**（P2 仍为设计壳/注释类）
- eslint 0

## Lint
- SshSettings + AIPanel + Titlebar + About + TokenUsageChart + Phase H files: eslint 0

## Phase I — FileTree 写操作 + Knowledge 去假数据 ✅ (2026-07-21 overnight-e)
- Session: ai-claude-20260721-overnight-e
- FileTree: sftpMkdir / sftpDelete 工具栏（新建目录、删除高亮/指定路径）
- KnowledgePage: 去掉 mock 回退，仅真实 tutorialList+kbExport；空库明确提示
- eslint FileTree 0

## Phase J — Supervisor ssh_readonly 工具 ✅ (2026-07-21 overnight-f)
- Session: ai-claude-20260721-overnight-f
- Supervisor.streamText 挂载 `ssh_readonly`（有 SSH session 且已连接时）
- risk-engine 拦截 HIGH/CRITICAL + 写操作启发式拒绝
- agent:chat 第 5 参 sshSessionId；preload/types/useAgentChat 传入 activeSessionId
- smoke: scripts/overnight-smoke-check.cjs
- eslint/tsc 相关 0

## Phase K — Tutorial 去假数据 + StatusBar 密度 ✅ (2026-07-21 overnight-g)
- Session: ai-claude-20260721-overnight-g
- TutorialPage: 去掉 MOCK 合并回退，仅 tutorial:list；空状态提示抓取源
- 统计改用 realCourses.length（不再写死 12/48/3.2k）
- StatusBar: 字号 12px、图标 size-3、高度 h-7
- smoke ALL PASS；audit P0/P1 0

## Phase L — TutorialDetail 去假数据 ✅ (2026-07-21 overnight-h)
- Session: ai-claude-20260721-overnight-h
- TutorialDetailPage: 仅 tutorial:get；无数据空状态「教程未找到」
- 移除 MOCK_TUTORIAL / MOCK_CHAPTERS / MOCK_PARSED_TUTORIAL
- smoke 扩展覆盖 Tutorial/Knowledge；ALL PASS
- eslint 0 error（既有 any warning）

