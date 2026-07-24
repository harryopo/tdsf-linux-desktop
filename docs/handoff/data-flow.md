# 核心数据流文档

> 生成时间：2026-07-24
> 适用版本：v2.4（Phase A/B/C 已落地）
> 配套文档：[`ipc-contract.md`](./ipc-contract.md)、[`frontend-backend-boundary.md`](./frontend-backend-boundary.md)

---

## 0. 文档目的

本文档详细描述 TDSF Linux Desktop 项目的 6 条核心数据流，包括每条流的时序、参与的 IPC 通道、数据结构、错误处理与 v2.4 关联点，作为前后端联调与功能交接的权威依据。

**覆盖流**：
1. AI 问答流（含流式推送 + Token 统计）
2. SSH 终端流（含高危拦截 + 工具调用记录）
3. 监控流（持续推送 + 静态系统信息）
4. Token 统计流（数量 + 成本双轨）
5. 工具调用统计流（🔥 v2.4 Phase A）
6. 预算告警流（🔥 v2.4 Phase B）

---

## 1. AI 问答流

### 1.1 流程概览

用户在 `AIPanel` 输入问题 → 前端调用 `llm:chat-stream` → 主进程流式调用 LLM → 边生成边推送 token → 完成后推送 `llm:done` → 同时记录 Token 统计 + 触发预算告警检查。

### 1.2 时序图

```
渲染进程                Preload              主进程 IPC            LlmClient          LLM API
   │                      │                     │                    │                  │
   │ 1. 用户输入问题       │                     │                    │                  │
   │ ──────────────────►  │                     │                    │                  │
   │                      │ 2. llmChatStream()  │                    │                  │
   │                      │ ─────────────────►  │                    │                  │
   │                      │                     │ 3. 读取 LlmConfig  │                  │
   │                      │                     │    + ApiKey        │                  │
   │                      │                     │ ─────────────────► │                  │
   │                      │                     │                    │ 4. streamText()  │
   │                      │                     │                    │ ──────────────►  │
   │                      │                     │                    │                  │
   │                      │                     │                    │ 5. 流式 token    │
   │                      │                     │                    │ ◄──────────────  │
   │                      │                     │ 6. 推送 llm:chunk  │                  │
   │                      │ ◄─────────────────  │ （循环每个 chunk）  │                  │
   │ 7. onLlmChunk(cb)    │                     │                    │                  │
   │ ◄──────────────────  │                     │                    │                  │
   │                      │                     │                    │                  │
   │                      │                     │                    │ 8. 完成/出错      │
   │                      │                     │ 9. 推送 llm:done   │                  │
   │                      │ ◄─────────────────  │    或 llm:error    │                  │
   │ 10. onLlmDone(cb)    │                     │                    │                  │
   │     或 onLlmError    │                     │                    │                  │
   │ ◄──────────────────  │                     │                    │                  │
   │                      │                     │ 11. 记录 Token 统计 │                  │
   │                      │                     │ 12. 预算告警检查    │                  │
   │                      │                     │     （v2.4 Phase B）│                  │
```

### 1.3 关键 IPC 通道

| 通道 | 方向 | Preload API | 说明 |
|------|------|-------------|------|
| `llm:chat-stream` | invoke | `llmChatStream` | 发起流式对话，参数 `(messages: ChatMessage[], options?)` |
| `llm:chunk` | push | `onLlmChunk` | 流式 token 块，载荷 `LlmStreamChunk { delta, totalTokens? }` |
| `llm:token` | push | `onLlmToken` | 兼容旧版的单 token 字符串推送 |
| `llm:done` | push | `onLlmDone` | 完成信号，载荷 `{ text: string, usage: TokenUsage }` |
| `llm:error` | push | `onLlmError` | 错误信号，载荷 `LlmError { code, message, retryable }` |

### 1.4 数据结构

```typescript
// 流式 chunk（src/shared/models.ts）
interface LlmStreamChunk {
  delta: string         // 本次增量文本
  totalTokens?: number  // 累计 token 数（可选）
}

// 完成信号
interface LlmDonePayload {
  text: string          // 完整文本输出
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  finishReason: string  // stop / length / content-filter / tool-calls / error / cancelled
}

// 错误信号（src/shared/models.ts）
interface LlmError {
  code: string          // AUTH / RATE_LIMIT / TIMEOUT / NETWORK / SERVER / UNKNOWN
  message: string       // 用户可读错误信息（不含 stack trace）
  retryable: boolean    // 是否可重试
}
```

### 1.5 错误处理

**错误码映射**（`src/main/ipc/llm.ts` 的 `toLlmError`）：

| 错误特征 | code | message | retryable |
|---------|------|---------|-----------|
| 401 / unauthorized / invalid api key | `AUTH` | API Key 无效或已过期 | false |
| 429 / rate limit | `RATE_LIMIT` | 请求过于频繁，请稍后重试 | true |
| timeout / aborted | `TIMEOUT` | 请求超时 | true |
| network / fetch failed / econnreset | `NETWORK` | 网络连接异常 | true |
| 5xx / server error | `SERVER` | 服务器内部错误 | true |
| 其他 | `UNKNOWN` | LLM 调用失败 | false |

**安全原则**：错误信息不泄露内部实现（不返回 stack trace 给渲染进程）。

### 1.6 v2.4 关联点

- **Phase B 预算告警**：LLM 调用完成后，`LlmClient` 内部自动调用：
  - `alertLlmSlowResponse(method, durationMs)` — 响应 > 5000ms 时记录 `alert` 级告警
  - `alertLlmFailure(method, error)` — 连续失败 >= 3 次时记录 `error` 级告警
  - `alertLlmSuccess()` — 成功时重置失败计数
- **Token 统计**：每次调用后写入 `TokenUsageRecord`（含 `cost` 字段），供 `token:stats` / `token:cost-stats` 查询

---

## 2. SSH 终端流

### 2.1 流程概览

用户连接 SSH → 启动交互式 Shell → 键入字符实时回传 → 执行一次性命令时触发高危拦截 + 工具调用记录。

### 2.2 时序图

```
渲染进程                Preload              主进程 IPC            SshManager         远程服务器
   │                      │                     │                    │                  │
   │ 1. sshConnect(cfg)   │                     │                    │                  │
   │ ──────────────────►  │                     │                    │                  │
   │                      │ ─────────────────►  │ 2. 建立连接        │                  │
   │                      │                     │ ─────────────────► │ 3. SSH 握手      │
   │                      │                     │                    │ ──────────────►  │
   │                      │                     │                    │ 4. 主机密钥校验   │
   │                      │                     │ 5. 推送 ssh:host-key-prompt（首次/变更）│
   │                      │ ◄─────────────────  │                    │                  │
   │ 6. onSshHostKeyPrompt│                     │                    │                  │
   │ ◄──────────────────  │                     │                    │                  │
   │ 7. sshRespondHostKey │                     │                    │                  │
   │ ──────────────────►  │ ─────────────────►  │ 8. 继续/终止握手    │                  │
   │                      │                     │ 9. 返回 sessionId  │                  │
   │ ◄──────────────────  │ ◄─────────────────  │                    │                  │
   │                      │                     │                    │                  │
   │ 10. sshShellStart    │                     │                    │                  │
   │ ──────────────────►  │ ─────────────────►  │ 11. 开启 PTY       │                  │
   │                      │                     │ ─────────────────► │ 12. shell 通道   │
   │                      │                     │                    │ ──────────────►  │
   │                      │                     │                    │                  │
   │ 13. sshShellWrite    │                     │                    │                  │
   │ ──────────────────►  │ ─────────────────►  │ 14. 写入字符       │                  │
   │                      │                     │ ─────────────────► │ 15. 转发到远程   │
   │                      │                     │                    │ ──────────────►  │
   │                      │                     │                    │                  │
   │                      │                     │ 16. 推送 terminal:data（输出回传）     │
   │                      │ ◄─────────────────  │ ◄────────────────── │ ◄──────────────  │
   │ 17. onTerminalData   │                     │                    │                  │
   │ ◄──────────────────  │                     │                    │                  │
   │                      │                     │                    │                  │
   │ 18. sshExec(cmd)     │                     │                    │                  │
   │ ──────────────────►  │ ─────────────────►  │ 19. 高危命令拦截   │                  │
   │                      │                     │ 20. recordToolCall │                  │
   │                      │                     │     （🔥 v2.4）     │                  │
   │                      │                     │ 21. 执行命令       │                  │
   │                      │                     │ ─────────────────► │ ──────────────►  │
   │                      │                     │ 22. 返回 CommandResult              │
   │ ◄──────────────────  │ ◄─────────────────  │                    │                  │
```

### 2.3 关键 IPC 通道

| 通道 | 方向 | Preload API | 说明 |
|------|------|-------------|------|
| `ssh:connect` | invoke | `sshConnect` | 建立连接，返回 `sessionId` |
| `ssh:host-key-prompt` | push | `onSshHostKeyPrompt` | 首次连接或密钥变更时弹窗 |
| `ssh:host-key-response` | invoke | `sshRespondHostKey` | 用户响应主机密钥弹窗 |
| `ssh:shell:start` | invoke | `sshShellStart` | 开启交互式 PTY |
| `ssh:shell:write` | invoke | `sshShellWrite` | 写入字符 |
| `ssh:shell:resize` | invoke | `sshShellResize` | 终端尺寸变化 |
| `terminal:data` | push | `onTerminalData` | Shell 输出回传 |
| `ssh:state-changed` | push | `onSshStateChanged` | 心跳失败/重连/断开 |
| `ssh:exec` | invoke | `sshExec` | 一次性命令执行 |
| `ssh:disconnect` | invoke | `sshDisconnect` | 断开连接 |

### 2.4 数据结构

```typescript
// SSH 连接配置（src/shared/models.ts）
interface SshConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password?: string
  privateKeyPath?: string
  privateKey?: string
  passphrase?: string
  strictHostKeyCheck?: boolean  // Phase L：严格主机密钥校验
  knownHostsPath?: string
  keepAlive?: boolean
  keepAliveIntervalSec?: number
}

// 命令执行结果
interface CommandResult {
  exitCode: number    // 0 表示成功
  stdout: string
  stderr: string
  duration: number    // 毫秒
}

// 主机密钥弹窗事件（push 载荷）
interface SshHostKeyPromptEvent {
  requestId: string
  sessionId: string
  serverId: string
  host: string
  port: number
  scenario: 'unknown-host' | 'host-key-changed'
  currentKey: SshHostKeyMeta
  knownKey?: SshHostKeyMeta
  promptMessage: string
}

// 心跳状态变更
interface SshStateEvent {
  sessionId: string
  serverId: string
  state: 'reconnecting' | 'disconnected'
  reason: string
  attemptCount: number
}
```

### 2.5 高危命令拦截（v2.2 修复 #41）

**实现位置**：`src/main/ipc/ssh.ts`

**拦截规则**（正则匹配，命中即拒绝执行）：
- `rm -rf /` — 递归删除根目录
- `shutdown` / `reboot` / `poweroff` / `halt` / `init 0` — 关机重启
- `mkfs` — 格式化文件系统
- `dd ... of=/dev/` — 写入块设备
- `chmod 777 /` — 危险权限
- `:(){:|:&};:` — fork 炸弹
- `> /dev/sd*` — 覆盖块设备

**拦截后行为**：
- 不透传到 SSH 通道
- 抛出 `Error('高危命令已被拦截：...')`
- 前端 `try/catch` 捕获并展示错误提示

### 2.6 v2.4 关联点（🔥 Phase A）

`ssh:exec` handler 在命令执行成功后调用：
```typescript
recordToolCall(DatabaseManager.getInstance(), '终端命令执行')
```

- 写入 `tool_call_log` 表（`toolName = '终端命令执行'`, `timestamp = Date.now()`）
- 内部 `try/catch`，DB 不可用时静默返回
- 工具名与 `ModelSettings` 显示一致，让"功能调用统计"反映真实使用频率

**审计日志**：每次 `ssh:exec` 调用都记录 `sessionId + command`（脱敏后）到 `logger`。

---

## 3. 监控流

### 3.1 流程概览

用户启动监控 → 主进程通过 SSH 定期采集指标 → 持续推送到渲染进程 → 前端更新图表。系统静态信息首次采集时推送一次。

### 3.2 时序图

```
渲染进程                Preload              主进程 IPC            SystemMonitor       远程服务器
   │                      │                     │                    │                  │
   │ 1. monitorStart      │                     │                    │                  │
   │   (sessionId,        │                     │                    │                  │
   │    interval)         │                     │                    │                  │
   │ ──────────────────►  │ ─────────────────►  │ 2. startMonitoring │                  │
   │                      │                     │ ─────────────────► │ 3. 定时器启动    │
   │                      │                     │                    │ 4. SSH 采集      │
   │                      │                     │                    │ ──────────────►  │
   │                      │                     │                    │ 5. 解析 top/ps   │
   │                      │                     │                    │ ◄──────────────  │
   │                      │                     │ 6. 推送 monitor:data（每次采集）       │
   │                      │ ◄─────────────────  │ ◄────────────────── │                  │
   │ 7. onMonitorData     │                     │                    │                  │
   │ ◄──────────────────  │                     │                    │                  │
   │                      │                     │                    │                  │
   │                      │                     │ 8. 首次推送 monitor:systemInfo         │
   │                      │ ◄─────────────────  │ ◄────────────────── │                  │
   │ 9. onSystemInfo      │                     │                    │                  │
   │ ◄──────────────────  │                     │                    │                  │
   │                      │                     │                    │                  │
   │ 10. monitorStop      │                     │                    │                  │
   │ ──────────────────►  │ ─────────────────►  │ 11. stopMonitoring │                  │
   │                      │                     │ ─────────────────► │ 12. 清除定时器   │
```

### 3.3 关键 IPC 通道

| 通道 | 方向 | Preload API | 说明 |
|------|------|-------------|------|
| `monitor:start` | invoke | `monitorStart` | 启动监控，参数 `(sessionId, interval)` |
| `monitor:stop` | invoke | `monitorStop` | 停止监控 |
| `monitor:getSystemInfo` | invoke | `monitorGetSystemInfo` | 主动获取系统信息 |
| `monitor:data` | push | `onMonitorData` | 实时指标推送（每 interval 秒） |
| `monitor:systemInfo` | push | `onSystemInfo` | 静态系统信息（首次采集时推送） |

### 3.4 数据结构

```typescript
// 实时监控数据（src/shared/models.ts）
interface MonitorData {
  timestamp: number       // 时间戳
  cpuUsage: number        // CPU 使用率（%）
  memoryUsage: number     // 内存使用率（%）
  diskUsage: number       // 磁盘使用率（%）
  networkIn: number       // 网络入站（KB/s）
  networkOut: number      // 网络出站（KB/s）
  loadAverage: number     // 1 分钟平均负载
  uptime: number          // 运行时长（秒）
  processCount: number    // 进程数
}

// 静态系统信息
interface SystemInfo {
  hostname: string
  os: string
  kernel: string
  architecture: string
  cpuModel: string
  cpuCores: number
  totalMemory: number     // 字节
  totalDisk: number       // 字节
}
```

### 3.5 设计要点

- **全局单例**：`SystemMonitor` 整个应用共享一个实例，所有监控会话复用
- **回调注册时机**：`onMonitorData` / `onSystemInfo` 回调在 `registerMonitorIpcHandlers` 时一次性注册，不是每次 `monitor:start` 时注册
- **窗口销毁保护**：推送前检查 `mainWindow.isDestroyed()`，避免向已关闭窗口推送
- **静态信息只推一次**：`onSystemInfo` 回调在首次采集到系统静态信息时推送，避免重复推送
- **采集方式**：通过 SSH 执行 `top` / `ps` / `free` / `df` 等命令并解析输出

### 3.6 v2.4 关联点

监控流本身不直接涉及 v2.4 新能力，但 `MonitorData` + `SystemInfo` 会合并成 `EnvironmentContext`，作为 `llm:chat-with-context` 的输入，让 LLM 感知当前系统状态。

---

## 4. Token 统计流

### 4.1 流程概览

每次 LLM 调用后记录 `TokenUsageRecord` → 前端通过 `token:stats`（数量）和 `token:cost-stats`（成本）拉取聚合数据 → 同时触发预算告警检查。

### 4.2 时序图

```
渲染进程                Preload              主进程 IPC            TokenStats模块       预算告警器
   │                      │                     │                    │                  │
   │                      │                     │ 1. LLM 调用完成    │                  │
   │                      │                     │ ─────────────────► │ 2. 记录 Record   │
   │                      │                     │                    │    （含 cost）    │
   │                      │                     │ 3. 触发预算检查    │                  │
   │                      │                     │ ───────────────────────────────────►  │
   │                      │                     │                    │ 4. 若超阈值       │
   │                      │                     │                    │    recordBudgetAlert
   │                      │                     │                    │ ◄─────────────────│
   │                      │                     │                    │                  │
   │ 5. tokenStats()      │                     │                    │                  │
   │ ──────────────────►  │ ─────────────────►  │ 6. 聚合统计        │                  │
   │                      │                     │ ─────────────────► │ 7. 遍历 records  │
   │                      │                     │                    │    按时间窗口累加 │
   │                      │                     │ 8. 返回 TokenStats │                  │
   │ ◄──────────────────  │ ◄─────────────────  │ ◄────────────────── │                  │
   │                      │                     │                    │                  │
   │ 9. tokenCostStats()  │                     │                    │                  │
   │ ──────────────────►  │ ─────────────────►  │ 10. 成本聚合       │                  │
   │                      │                     │ ─────────────────► │ 11. computeCost  │
   │                      │                     │                    │     per record   │
   │                      │                     │ 12. 返回 CostStats │                  │
   │ ◄──────────────────  │ ◄─────────────────  │ ◄────────────────── │                  │
```

### 4.3 关键 IPC 通道

| 通道 | 方向 | Preload API | 说明 |
|------|------|-------------|------|
| `token:stats` | invoke | `tokenStats` | 获取 token 数量统计（当日/周/月/总 + Subagent/Provider 分布） |
| `token:cost-stats` | invoke | `tokenCostStats` | 获取 token 成本统计（USD，v0.9.5 新增） |
| `token:records` | invoke | `tokenRecords` | 获取 token 使用明细记录（P-5 新增） |
| `token:reset` | invoke | `tokenReset` | 重置 token 统计 |

### 4.4 数据结构

```typescript
// Token 使用记录（src/shared/agent-types.ts）
interface TokenUsageRecord {
  providerId: string
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  subagent: string         // 'supervisor' / 'coding-subagent' / 'direct'
  strength: 'fast' | 'standard' | 'deep'
  timestamp: number
  cost?: number            // USD（v0.9.4 批次 2 新增）
}

// 数量统计聚合
interface TokenStats {
  today: number
  week: number
  month: number
  total: number
  bySubagent: Record<string, number>
  byProvider: Record<string, number>
}

// 成本统计聚合（CostStats，定义在 @shared/agent-types）
interface CostStats {
  todayCost: number
  weekCost: number
  monthCost: number
  totalCost: number
  bySubagent: Record<string, number>
  byProvider: Record<string, number>
}
```

### 4.5 成本计算逻辑

**位置**：`src/main/core/agent/providers/token-stats.ts` 的 `getCostStats()`

**公式**：
```
cost = (inputTokens * inputCostPer1M + outputTokens * outputCostPer1M) / 1_000_000
```

**定价来源**：`ProviderConfig.pricing`，未设置时由 `PROVIDER_PRICING` 默认表按 type 推断。

**聚合步骤**：
1. 遍历 `usageRecords`
2. 对每条记录调用 `computeRecordCost` 计算 cost
3. 按时间窗口（当日/当周/当月/总）累加 cost
4. 按 Subagent 维度（`record.subagent`）累加 cost
5. 按 Provider 维度（`record.providerId`）累加 cost
6. 四舍五入到 6 位小数（避免浮点精度问题）

### 4.6 v2.4 关联点（🔥 Phase B）

**预算告警触发**（`src/main/ipc/agent-runtime.ts`）：
- `token:stats` handler 内部检查 `costStats.monthCost` 是否超阈值
- 超阈值时调用 `alertTokenBudgetExceeded(costStats.monthCost, threshold, '月')`
- `alertTokenBudgetExceeded` 内部有当日去重逻辑，不会刷屏
- 阈值由配置项控制（用户可在设置中调整）

**静默失败**：成本检查失败不影响 `token:stats` 正常返回。

---

## 5. 工具调用统计流（🔥 v2.4 Phase A）

### 5.1 流程概览

主进程各工具 handler 执行工具时调用 `recordToolCall` → 写入 `tool_call_log` 表 → 前端 `ModelSettings` 通过 `model:toolCalls` 拉取聚合数据 → 展示工具调用分布图。

### 5.2 时序图

```
工具 Handler            model-stats模块       SQLite (tool_call_log)    渲染进程
   │                       │                       │                       │
   │ 1. 工具执行完成        │                       │                       │
   │ ──────────────────►   │ 2. recordToolCall     │                       │
   │                       │    (db, toolName)     │                       │
   │                       │ ──────────────────►   │ 3. INSERT row         │
   │                       │                       │    (toolName, ts)     │
   │                       │ ◄──────────────────   │                       │
   │                       │                       │                       │
   │                       │                       │ 4. 前端拉取数据        │
   │                       │                       │ ◄──────────────────── │
   │                       │ 5. modelToolCalls()   │                       │
   │                       │ ◄─────────────────    │ 6. SELECT + GROUP BY  │
   │                       │                       │    toolName           │
   │                       │                       │ ──────────────────►   │
   │                       │ 7. 返回 ToolCallStat[]│                       │
   │                       │ ◄──────────────────   │                       │
   │                       │                       │ 8. 渲染饼图/柱状图     │
   │                       │                       │ ──────────────────►   │
```

### 5.2 关键 IPC 通道

| 通道 | 方向 | Preload API | 说明 |
|------|------|-------------|------|
| `model:toolCalls` | invoke | `modelToolCalls` | 获取工具调用统计聚合，无参数 |

### 5.3 数据结构

```typescript
// 工具调用统计行（src/shared/models.ts）
interface ToolCallStat {
  name: string       // 工具名称（如 '终端命令执行'）
  count: number      // 调用次数
  percent: number    // 占比百分比（0-100 整数）
}
```

### 5.4 写入侧：`recordToolCall`

**实现位置**：`src/main/ipc/model-stats.ts`

```typescript
export function recordToolCall(db: DatabaseManager, toolName: string): void {
  try {
    if (!db.isAvailable()) return
    db.prepare('INSERT INTO tool_call_log (toolName, timestamp) VALUES (?, ?)').run(
      toolName,
      Date.now()
    )
  } catch (err) {
    logger.warn('IPC.MODEL_STATS', `recordToolCall 失败: ${(err as Error).message}`)
  }
}
```

**已接入的工具**：

| 工具名 | 接入位置 | 说明 |
|--------|---------|------|
| `终端命令执行` | `src/main/ipc/ssh.ts` 的 `ssh:exec` handler | 用户直接通过终端执行命令 |
| `知识库检索` | ⏳ 待接入 `knowledge.ts` | kb:search 执行时 |
| `联网搜索` | ⏳ 待接入 | 联网搜索执行时 |
| `Skill调用` | ⏳ 待接入 | Skill 调用执行时 |
| `方法论应用` | ⏳ 待接入 | 方法论应用执行时 |

### 5.5 读取侧：`model:toolCalls` handler

**实现位置**：`src/main/ipc/model-stats.ts`

**SQL 查询**：
```sql
SELECT toolName, COUNT(*) as cnt
FROM tool_call_log
GROUP BY toolName
ORDER BY cnt DESC
```

**聚合逻辑**：
1. 查询所有工具调用记录，按 `toolName` 分组计数
2. 计算 `totalCount = sum(all counts)`
3. 对每条记录计算 `percent = Math.round((count / totalCount) * 100)`
4. 返回 `ToolCallStat[]`（按 count 降序）

**降级策略**：
- DB 不可用（`db.isAvailable() === false`）：返回 `[]`
- 表为空：返回 `[]`
- 查询出错：`logger.error` 记录，返回 `[]`
- 前端显示"暂无工具调用数据"

### 5.6 设计原则

- **表为空时返回空数组**，不返回 mock 数据（前端显示"暂无数据"）
- **percent 计算**：`count / totalCount * 100`，四舍五入到整数
- **降级**：数据库不可用时返回空数组
- **工具名一致性**：`recordToolCall` 传入的 `toolName` 必须与 `ModelSettings` 显示一致

---

## 6. 预算告警流（🔥 v2.4 Phase B）

### 6.1 流程概览

LLM 调用 / Token 统计触发告警条件 → `budget-alerter` 调用 `recordBudgetAlert` → 写入 `budget_alerts` 表 → 前端 `ModelSettings` 通过 `budget:alerts` 拉取历史告警。

### 6.2 时序图

```
LLM Client / AgentRuntime    BudgetAlerter          model-stats模块       SQLite (budget_alerts)    渲染进程
   │                              │                       │                       │                       │
   │ 1. LLM 响应慢 (>5000ms)      │                       │                       │                       │
   │ ──────────────────────────►  │ 2. alertLlmSlowResponse│                     │                       │
   │                              │ ──────────────────►   │ 3. recordBudgetAlert │                       │
   │                              │                       │ ──────────────────►   │ 4. INSERT row         │
   │                              │                       │                       │    (level='alert',    │
   │                              │                       │                       │     text, ts)         │
   │                              │                       │                       │                       │
   │ 5. LLM 连续失败 (>=3次)      │                       │                       │                       │
   │ ──────────────────────────►  │ 6. alertLlmFailure    │                       │                       │
   │                              │ ──────────────────►   │ 7. recordBudgetAlert │                       │
   │                              │                       │ ──────────────────►   │ 8. INSERT row         │
   │                              │                       │                       │    (level='error',    │
   │                              │                       │                       │     text, ts)         │
   │                              │                       │                       │                       │
   │ 9. Token 月成本超阈值        │                       │                       │                       │
   │ ──────────────────────────►  │ 10. alertTokenBudgetExceeded                  │                       │
   │                              │     （当日去重检查）   │                       │                       │
   │                              │ ──────────────────►   │ 11. recordBudgetAlert│                       │
   │                              │                       │ ──────────────────►   │ 12. INSERT row        │
   │                              │                       │                       │                       │
   │                              │                       │                       │ 13. 前端拉取告警       │
   │                              │                       │                       │ ◄──────────────────── │
   │                              │                       │ 14. budgetAlerts(20)  │                       │
   │                              │                       │ ◄─────────────────    │ 15. SELECT + ORDER BY │
   │                              │                       │                       │     timestamp DESC    │
   │                              │                       │ 16. 返回 BudgetAlert[]│                       │
   │                              │                       │ ◄──────────────────   │                       │
   │                              │                       │                       │ 17. 渲染告警列表       │
   │                              │                       │                       │ ──────────────────►   │
```

### 6.3 关键 IPC 通道

| 通道 | 方向 | Preload API | 说明 |
|------|------|-------------|------|
| `budget:alerts` | invoke | `budgetAlerts` | 获取预算告警历史，参数 `(limit?: number)` |

### 6.4 数据结构

```typescript
// 预算告警行（src/shared/models.ts）
interface BudgetAlert {
  level: 'alert' | 'error'  // 告警级别
  text: string               // 告警文本
  timestamp: number          // 时间戳（ms）
}
```

### 6.5 告警触发器（`budget-alerter.ts`）

| 触发器 | 函数 | 阈值 | 级别 | 去重策略 |
|--------|------|------|------|---------|
| LLM 响应慢 | `alertLlmSlowResponse(method, durationMs)` | `> 5000ms` | `alert` | 无去重（每次慢都记录） |
| LLM 连续失败 | `alertLlmFailure(method, error)` | `>= 3 次` | `error` | 记录后重置计数，下一轮 3 次再告警 |
| Token 成本超阈值 | `alertTokenBudgetExceeded(cost, threshold, dimension)` | `cost > threshold` | `alert` | 当日去重（每天最多一次） |
| LLM 调用成功 | `alertLlmSuccess()` | — | — | 重置失败计数 |

### 6.6 模块级状态

```typescript
// src/main/services/llm/budget-alerter.ts

/** LLM 连续失败计数（成功时重置为 0） */
let llmFailureCount = 0

/** 上次 token 告警日期（YYYY-MM-DD），避免当日重复告警 */
let lastTokenAlertDate = ''
```

**设计原则**：
- **模块级状态**：无需注入 db，直接 `DatabaseManager.getInstance()`
- **静默失败**：db 未初始化或不可用时不影响主流程
- **当日去重**：token 告警每天最多一次，避免每次查询都告警
- **失败计数重置**：记录后清零，下一轮 3 次再告警

### 6.7 写入侧：`recordBudgetAlert`

**实现位置**：`src/main/ipc/model-stats.ts`

```typescript
export function recordBudgetAlert(
  db: DatabaseManager,
  level: 'alert' | 'error',
  text: string
): void {
  try {
    if (!db.isAvailable()) return
    db.prepare('INSERT INTO budget_alerts (level, text, timestamp) VALUES (?, ?, ?)').run(
      level,
      text,
      Date.now()
    )
  } catch (err) {
    logger.warn('IPC.MODEL_STATS', `recordBudgetAlert 失败: ${(err as Error).message}`)
  }
}
```

### 6.8 读取侧：`budget:alerts` handler

**SQL 查询**：
```sql
SELECT level, text, timestamp
FROM budget_alerts
ORDER BY timestamp DESC
LIMIT ?
```

**参数约束**：
- `limit` 默认 20
- 上限 100（`Math.min(Math.max(limit ?? 20, 1), 100)`）
- 下限 1

**级别规范化**：`r.level === 'error' ? 'error' : 'alert'`（非 error 一律归为 alert）

**降级策略**：
- DB 不可用：返回 `[]`
- 表为空：返回 `[]`
- 查询出错：`logger.error` 记录，返回 `[]`
- 前端显示"暂无告警"

### 6.9 接入点汇总

| 接入位置 | 触发函数 | 说明 |
|---------|---------|------|
| `src/main/services/llm/client.ts` | `alertLlmSlowResponse` / `alertLlmFailure` / `alertLlmSuccess` | LLM 调用的响应时间、成功/失败状态 |
| `src/main/ipc/agent-runtime.ts` | `alertTokenBudgetExceeded` | `token:stats` handler 内检查月成本超阈值 |

---

## 7. 通用数据流模式

### 7.1 invoke 请求-响应模式

适用于一次性操作（SSH 连接、命令执行、配置读写）。

```
渲染进程 ──── invoke(channel, ...args) ──────► 主进程
         ◄──── Promise<result> ──────────────
```

**特点**：
- 主进程 `ipcMain.handle` 注册
- 渲染进程 `ipcRenderer.invoke` 调用
- 返回 Promise，支持 async/await
- 错误通过 Promise rejection 传递

### 7.2 push 推送订阅模式

适用于持续数据流（终端输出、监控数据、LLM 流式 token）。

```
主进程 ──── send(channel, ...args) ──────► 渲染进程
         （订阅：onXxx(callback)）
         （取消：返回的 unsubscribe 函数）
```

**特点**：
- 主进程 `webContents.send` 推送
- 渲染进程 `ipcRenderer.on` 订阅
- Preload 返回取消订阅函数，组件 unmount 时调用
- 推送前检查 `mainWindow.isDestroyed()`，避免向已关闭窗口推送

### 7.3 双向确认模式

适用于需要用户确认的操作（主机密钥校验、Task 审批）。

```
主进程 ──── send(promptChannel, payload) ──────► 渲染进程
         ◄──── invoke(responseChannel, action) ──
```

**特点**：
- 主进程先推送弹窗事件（含 `requestId`）
- 渲染进程展示弹窗，用户选择后 invoke 响应通道
- 主进程通过 `requestId` 关联请求与响应
- 参考 `ssh:host-key-prompt` + `ssh:host-key-response`

### 7.4 流式推送模式

适用于 LLM 流式输出、Agent 步骤推送。

```
渲染进程 ──── invoke(startChannel, params) ──────► 主进程
         ◄──── push(chunkChannel, chunk) ──────────
         ◄──── push(chunkChannel, chunk) ──────────
         ◄──── push(doneChannel, result) ──────────
         （或 push(errorChannel, error)）
```

**特点**：
- invoke 启动流式任务，立即返回（不等完成）
- 主进程通过多个 push 通道推送中间状态
- 最终通过 `done` 或 `error` 通道通知完成
- 参考 `llm:chat-stream` + `llm:chunk` / `llm:done` / `llm:error`

---

## 8. 跨流关联矩阵

| 源流 | 目标流 | 关联点 | 说明 |
|------|--------|--------|------|
| AI 问答流 | Token 统计流 | LLM 调用完成 | 每次调用写入 `TokenUsageRecord` |
| AI 问答流 | 预算告警流 | LLM 慢/失败/Token 超阈值 | `budget-alerter` 自动触发 |
| SSH 终端流 | 工具调用统计流 | `ssh:exec` 执行 | 🔥 v2.4 调用 `recordToolCall` |
| 监控流 | AI 问答流 | `EnvironmentContext` | 监控数据合并为环境上下文传给 LLM |
| Token 统计流 | 预算告警流 | `token:stats` 检查成本 | 🔥 v2.4 调用 `alertTokenBudgetExceeded` |
| 工具调用统计流 | 前端展示 | `ModelSettings` 页面 | 🔥 v2.4 消费 `model:toolCalls` |
| 预算告警流 | 前端展示 | `ModelSettings` 页面 | 🔥 v2.4 消费 `budget:alerts` |

---

## 9. 数据持久化汇总

| 表 | 写入方 | 读取方 | v2.4 关联 |
|----|--------|--------|-----------|
| `decisions` | Agent 工作流 / 决策审批 | `history:list` / `history:stats` | — |
| `knowledge_entries` | 知识库管理 | `knowledge:list` / `knowledge:search` | — |
| `tool_call_log` | `recordToolCall`（🔥 v2.4） | `model:toolCalls`（🔥 v2.4） | 🔥 Phase A |
| `budget_alerts` | `recordBudgetAlert`（🔥 v2.4） | `budget:alerts`（🔥 v2.4） | 🔥 Phase B |
| `kb_view_history` | 知识库浏览 | `knowledge:view-history` | — |
| `tutorial_*` | 教程爬虫 / 学习进度 | `tutorial:list` / `tutorial:progress` | — |
| `calibration-state.json` | `CalibrationTuner`（🔥 v2.4） | `CalibrationTuner`（🔥 v2.4） | 🔥 Phase C |

---

## 10. v2.4 数据流完成度矩阵

| 编号 | 数据流 | 完成度 | 验证证据 |
|------|--------|--------|---------|
| DF-1 | AI 问答流（含 Token 统计 + 预算告警） | ✅ | `llm.ts` + `client.ts` + `budget-alerter.ts` |
| DF-2 | SSH 终端流（含高危拦截 + 工具调用记录） | ✅ | `ssh.ts` 第 273-277 行调用 `recordToolCall` |
| DF-3 | 监控流（持续推送 + 静态信息） | ✅ | `monitor.ts` + `SystemMonitor` |
| DF-4 | Token 统计流（数量 + 成本双轨） | ✅ | `agent-runtime.ts` + `token-stats.ts` |
| DF-5 | 工具调用统计流（🔥 Phase A） | ✅ | `model-stats.ts` `recordToolCall` + `model:toolCalls` |
| DF-6 | 预算告警流（🔥 Phase B） | ✅ | `budget-alerter.ts` + `model-stats.ts` `recordBudgetAlert` + `budget:alerts` |
| DF-7 | 校准数据流（⚠️ Phase C） | ⚠️ | `fusion-engine.ts` `fuseAndAssess(options)` 已支持，但 IPC 透传未完成 |

**完成度**：7 条数据流中 6 条 ✅，1 条 ⚠️（校准流的 IPC 暴露层未完成，详见 [`frontend-backend-boundary.md`](./frontend-backend-boundary.md) 附录 A）

---

**文档结束**。如有疑问，请对照 [`ipc-contract.md`](./ipc-contract.md) 核对通道细节，或对照 [`frontend-backend-boundary.md`](./frontend-backend-boundary.md) 核对职责边界。
