# Agent 主路径冻结（v1.0 Wire Sprint）

> Session: `ai-claude-20260720-wire`  
> 日期：2026-07-20  
> 状态：**冻结生效** — 新功能不得再开第三条「大脑」入口

## 1. 唯一产品主路径

```
Workbench AIPanel
  → preload agentChat / agentChatCancel
  → IPC agent:chat / agent:chat:cancel
  → Supervisor.chat (streamText + redact + token + CoT collect)
  → (后续) tools / risk-engine / HITL / DecisionCard
  → events: agent:chunk | agent:done | agent:error
  → useAgentStore + AIPanel 渲染
```

## 2. 三条历史路径的职责边界

| 路径 | 入口 | 状态 | 允许用法 |
|------|------|------|----------|
| **B Supervisor** | `agent:chat` + `ipc/agent-runtime.ts` | **主路径** | Workbench AIPanel、ChatPanel 统一走这里 |
| A AgentWorkflow | `agent:start/confirm/cancel` | 保留 | 仅作诊断执行引擎；**不对 UI 新增入口** |
| C Sidecar-A | `sidecar:pipeline` | 工具 | 作为 Supervisor 的工具/面板，不是第二大脑 |

## 3. 本 Sprint 范围（Wire-1）

### 做

1. 冻结本文档
2. 抽出 `useAgentChat`（订阅 chunk/done/error + send/cancel）
3. Workbench `AIPanel` 去 mock 发送：真实 `agent:chat` 流式对话
4. 空状态 / 错误 / 停止按钮可用

### 不做（防冲突 / 防膨胀）

- 不改 `DecisionCard.tsx` / credibility 融合 UI（其他 AI 曾 claim）
- 不改 `ChatPanel.tsx` 大文件（并行会话风险高）
- 不实现完整 PAOR / 8 Subagent
- 不接 SFTP 真文件树（下一循环）
- 不新增 Sidecar-B/C 能力

## 4. 文件所有权（本 Session）

| 文件 | 动作 |
|------|------|
| `docs/AGENT_MAIN_PATH.md` | 新建 |
| `src/renderer/src/components/workbench/useAgentChat.ts` | 新建 |
| `src/renderer/src/components/workbench/AIPanel.tsx` | 接线 |
| `src/renderer/src/stores/agent-store.ts` | 只读优先；必要时最小补丁 |

## 5. 验收标准（编译循环）

1. `pnpm typecheck:web` 通过（本改动相关 0 error）
2. AIPanel 输入后调用 `window.electronAPI.agentChat`
3. 流式 token 写入 `useAgentStore.messages`
4. 停止按钮调用 `agentChatCancel`
5. 无 electronAPI 时展示明确错误，不静默 mock 成功

## 6. Wire-2 + Overnight（至 2026-07-20 wb3）

### 已完成

1. Provider 列表 + tokenStats + agent:chat
2. TerminalView 真终端
3. **FileTree sftpList 懒加载**
4. **Editor 读/写远程文件**
5. **Titlebar ConnectDialog 连接 SSH**
6. 工作台密度补丁 `workbench-density.css`
7. 交付清单：`docs/DELIVERY_CHECKLIST.md`

### 未做

1. Supervisor 真工具：ssh_readonly + risk gate
2. DecisionCard 挂 done
3. 文件树写操作（mkdir/delete）
