# 交付验收清单（通宵冲刺）

> 更新：2026-07-21 overnight-b  
> Sessions：`ai-claude-20260720-wb3` / `ai-claude-20260721-overnight`

## 如何启动

```bash
cd tdsf-linux-desktop
pnpm dev
```

## 演示路径（比赛用）

1. **启动页**  
   - 黑底 Shader +「进入工作台」→ `/workbench`

2. **连接 SSH（两处任一）**  
   - **设置 → SSH**：真实服务器列表，添加/编辑/连接/断开  
   - **工作台顶栏**服务器下拉 → 新建连接 / 点已有服务器连接  

3. **真终端**  
   - 中间「终端」标签：xterm 真 Shell  

4. **真文件树 + 编辑**  
   - 左侧 `sftpList`；点文件读/改/`Ctrl+S` 写回  

5. **真 Agent**  
   - 右侧发消息 → `agent:chat`（先配置 **设置 → 模型**）  
   - **演示模式** chip → 循环工程 7 步 HITL + 决策卡片（需已连 SSH）  

## 自动化检测

```bash
node scripts/overnight-ui-audit.cjs
# 报告：docs/UI_AUDIT_LATEST.md
```

关键页 mock 标记应为 0 hits：SshSettings / WorkbenchPage / FileTree / AIPanel / Titlebar

## 验收勾选

- [ ] 启动页不是白屏
- [ ] 设置→SSH 能看到真实服务器（非 prod-web-01 假列表）
- [ ] 能新建并连上 SSH
- [ ] 终端能输入命令
- [ ] 文件树能展开 `/`
- [ ] 能打开文件并保存
- [ ] AI 能流式回复或提示配置模型
- [ ] 演示模式能出决策卡片（有 SSH + 模型时）
- [ ] 按钮大致 ≥32px 可点，正文约 13px

## 教程页

- 列表仅 `tutorial:list` 真数据，空库提示抓取（不再混 mock）
- 详情仅 `tutorial:get`；找不到 id 显示空状态（不再 mock 兜底）
- 知识库仅真实 tutorialList + kbExport

## 仍弱 / 已知限制

| 项 | 状态 |
|----|------|
| AI 工具面板「执行/沙箱」细按钮 | 未全接 HITL |
| 文件树新建/删除 | ✅ sftpMkdir/sftpDelete 已接 |
| 监控/知识库等页 | 监控真 IPC；知识库真数据 |
| 其它设置页 | 另一 AI（qoder）在接 config IPC |
| CredibilityPanel typecheck | 预存错误 |
| Agent 只读工具 | ✅ supervisor `ssh_readonly`（需已连 SSH） |

## 本轮核心文件

- `pages/SshSettings.tsx` — 真 IPC
- `scripts/overnight-ui-audit.cjs` — 静态审计
- `styles/workbench-density.css` — 密度
- workbench FileTree / EditorArea / Titlebar / AIPanel
- loop engineering：`useLoopEngineering` + `LoopWorkflowPanel`（演示模式）
