# Agent 边界声明：Mastra OpsAgent vs SupervisorAgent

> **版本**：v2.0 Phase E.3（TD-3 边界澄清）
> **目的**：明确两个 Agent 的职责边界，避免重复实现 / 误调用
> **关联文件**：
> - `src/main/core/agent/mastra/ops-agent.ts`（单轮场景）
> - `src/main/core/agent/supervisor.ts`（多步场景）
> - `src/main/core/agent/mastra/index.ts`（Mastra 实例入口）

---

## 1. 一句话总结

| 维度 | Mastra OpsAgent | SupervisorAgent |
|------|-----------------|-----------------|
| **场景** | 单轮（一问一答 + 一次工具调用） | 多步（PAOR 4 阶段循环 + HITL） |
| **入口** | `runOpsAgent()` / `getMastraInstance()` | `getSupervisor().chat()` |
| **LLM** | Vercel AI SDK（OpenAI 兼容） | Provider 抽象层（多厂商） |
| **工具** | ToolRegistry 5 工具（共享） | ToolRegistry 5 工具（共享） |
| **审批** | 无（依赖工具自身风险检查） | 7 步 HITL（isApprovalRequired） |
| **Subagent** | 不调度 | 调度 8 个 Subagent |
| **可信度** | 不集成 | 集成 credibility 子系统 |
| **审计** | 不生成 | 生成 EU AI Act 报告 |
| **Compaction** | 不压缩 | 5 层 L1-L4 |

---

## 2. 决策树

```
┌─────────────────────────────────────────────┐
│ 用户请求到达 IPC 层（agent:chat / mastra:run）│
└───────────────────┬─────────────────────────┘
                    ▼
         ┌──────────────────────┐
         │ 1. 是否需要多步推理？  │
         │   (PAOR 循环)        │
         └──────┬───────────────┘
                │
        ┌───────┴───────┐
       YES             NO
        │               │
        ▼               ▼
   ┌─────────┐    ┌──────────────────────┐
   │Supervisor│    │ 2. 是否需要 HITL？  │
   │  (多步)  │    │   (高危操作)        │
   └─────────┘    └──────┬───────────────┘
                         │
                 ┌───────┴───────┐
                YES             NO
                 │               │
                 ▼               ▼
            ┌─────────┐    ┌──────────────────────┐
            │Supervisor│    │ 3. 是否需要 Subagent？│
            │  (HITL)  │    │   (8 个之一)         │
            └─────────┘    └──────┬───────────────┘
                                  │
                          ┌───────┴───────┐
                         YES             NO
                          │               │
                          ▼               ▼
                     ┌─────────┐    ┌──────────────────────┐
                     │Supervisor│    │ 4. 是否需要可信度评估？│
                     │(Subagent)│    │   (6 源融合)         │
                     └─────────┘    └──────┬───────────────┘
                                           │
                                   ┌───────┴───────┐
                                  YES             NO
                                   │               │
                                   ▼               ▼
                              ┌─────────┐    ┌─────────┐
                              │Supervisor│    │ Mastra  │
                              │(可信度)  │    │ OpsAgent│
                              └─────────┘    └─────────┘
```

**核心判定原则**：
- 4 个问题中**任意 1 个 YES** → 走 Supervisor
- 4 个问题**全部 NO** → 走 Mastra OpsAgent

---

## 3. 接口对比表

| 接口 | Mastra OpsAgent | SupervisorAgent |
|------|-----------------|-----------------|
| 创建 | `createOpsAgent(config)` | `getSupervisor()`（单例） |
| 调用 | `runOpsAgent(config, msg, history)` | `supervisor.chat(params)` |
| 返回 | `{ text, toolCalls }` | `void`（通过 onToken / onDone 回调） |
| 流式 | ❌（仅一次性返回） | ✅（streamText） |
| 取消 | ❌ | ✅（`cancelRequest(correlationId)`） |
| 历史 | 显式传入 `history[]` | 内部维护 + compaction |
| Token 统计 | ❌ | ✅（recordTokenUsage） |
| 风险评估 | ❌ | ✅（assessRisk） |
| Langfuse trace | ❌ | ✅（withCallbackStreamTrace） |

---

## 4. 调用示例

### 4.1 Mastra OpsAgent（单轮场景）

```typescript
import { runOpsAgent } from '@/main/core/agent/mastra/ops-agent'

// 场景：用户问"查看 CPU 使用率"
const result = await runOpsAgent(
  { llmConfig, db },
  '查看 CPU 使用率',
  []  // 无历史
)
console.log(result.text)        // "当前 CPU 使用率为 23%"
console.log(result.toolCalls)  // [{ toolName: 'monitor_get_data', ... }]
```

### 4.2 SupervisorAgent（多步场景）

```typescript
import { getSupervisor } from '@/main/core/agent/supervisor'

// 场景：用户问"服务为什么变慢了"（需要 PAOR + 多 Subagent）
const supervisor = getSupervisor()
await supervisor.chat({
  messages: [{ role: 'user', content: '服务为什么变慢了' }],
  providerId: 'deepseek-v4',
  strength: 'deep',  // 触发 8 Subagent + 多轮 Reflect
  onToken: (delta) => sendToRenderer(delta),
  onDone: (result) => sendToRenderer(result),
  onError: (err) => sendErrorToRenderer(err),
  correlationId: 'req-123',
})
```

### 4.3 IPC 层路由示例（伪代码）

```typescript
// IPC handler: agent:chat
ipcMain.handle('agent:chat', async (_event, params) => {
  const complexity = assessComplexity(params.message)
  if (complexity === 'simple') {
    // 单轮：走 Mastra
    return runOpsAgent(/* ... */)
  } else {
    // 多步：走 Supervisor
    return getSupervisor().chat(/* ... */)
  }
})
```

---

## 5. 共享与隔离

### 共享（不重复实现）
- **ToolRegistry**：5 个核心工具（ssh_exec / tutorial_search / deploy_list / profiler_run / monitor_get_data）
- **Provider Registry**：LLM 实例工厂
- **Logger**：日志器
- **DatabaseManager**：教程知识库

### 隔离（不互相调用）
- ❌ Mastra 不调用 Supervisor 的 PAOR / Subagent
- ❌ Supervisor 不调用 Mastra 的 OpsAgent
- ✅ 路由决策由 **IPC 层** 或 **上层调用方** 完成

---

## 6. 边界 Violation 检查清单

如果出现以下情况，说明边界被破坏，应重构：
- [ ] ops-agent.ts 中 import 了 `supervisor` 或 `subagents/*`
- [ ] supervisor.ts 中 import 了 `mastra/ops-agent`
- [ ] Mastra Agent 内部调用 PAOR 循环
- [ ] Supervisor 内部创建 Mastra Agent 实例
- [ ] 同一个请求被两个 Agent 串行处理（应明确归属其一）

---

## 7. 历史背景

**v0.9**：引入 Mastra + AI SDK 7 组合，Mastra 作为轻量级 Agent 入口
**v0.9.6 P2**：Supervisor 集成 credibility 子系统，职责进一步加重
**v2.0 Phase E.3**（本文档）：明确两者边界，解决 TD-3 职责重叠问题

---

## 8. 后续演进方向

- **MCP Gateway**：未来 MCP Server 外部调用应统一走 Mastra（保持无状态）
- **Skill 系统**：未来 Skill 调用可走 Mastra（轻量级）或 Supervisor（需审计）
- **多模态**：未来图像/视频输入可能需要 Supervisor 处理（需多步推理）
- **Streaming**：Mastra 当前不支持流式，未来可扩展 `streamOpsAgent()`
