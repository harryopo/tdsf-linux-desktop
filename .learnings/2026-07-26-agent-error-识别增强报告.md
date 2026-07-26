# 2026-07-26 Agent 错误识别增强（v2.3.8）

## 背景

用户反馈"ai对话显示agent调用失败" — 错误信息过于笼统，无法定位根因。
v2.3.7 的 toAgentError 函数只识别 AUTH/RATE_LIMIT/TIMEOUT/NETWORK/SERVER/UNKNOWN 6 种错误码，
**且 fallback 兜底文案是"Agent 调用失败"，不附原始错误** — 用户看到的就是空泛文案。

## 实地调研结论

| 错误根因 | v2.3.7 显示 | v2.3.8 显示 |
|---------|------------|------------|
| Key 错（401） | "API Key 无效或已过期" | "API Key 无效或已过期（原始 message）" |
| Key 错（"invalid api key"） | 同上 | 同上 |
| 模型不存在（404 / "model not found"） | **"Agent 调用失败"** | "模型不存在或 endpoint 错误（原始 message）" |
| 账户欠费（402） | **"Agent 调用失败"** | "账户欠费，请充值后重试（原始 message）" |
| 权限不足（403） | **"Agent 调用失败"** | "权限不足或模型未开通（原始 message）" |
| 上下文超限（408 / context_length_exceeded） | **"Agent 调用失败"** | "上下文超限（原始 message）" |
| 请求参数错误（400） | **"Agent 调用失败"** | "请求参数错误（原始 message）" |
| 响应解析失败（json / parse） | **"Agent 调用失败"** | "LLM 响应解析失败（原始 message）" |
| 缺少 API Key | **"Agent 调用失败"** | "未配置 API Key（原始 message）" |
| 其它兜底 | "Agent 调用失败" | "Agent 调用失败（原始 message）" |

## 修复方案

### 1. `src/main/ipc/agent-runtime.ts` — `toAgentError` 增强

新增错误码识别（共 15 种），并把 `rawMsg` 拼到最终 message 后面：

- PAYMENT_REQUIRED（402）
- PERMISSION（403）
- MODEL_NOT_FOUND（404 / "model not found" / "does not exist" / "no such model"）
- BAD_REQUEST（400 / "bad request" / "invalid_request_error"）
- CONTEXT_OVERFLOW（408 / "context_length_exceeded" / "context length" / "maximum context"）
- VALIDATION（422 / "unprocessable"）
- PARSE（"json" / "parse" / "unexpected token" / "malformed"）
- NO_API_KEY（"api key" / "api_key" / "missing" + "key"）

### 2. `src/main/core/agent/supervisor.ts` — 详细错误日志

在 `chatImpl` 的 catch 块增加完整诊断信息：

```ts
this.log.error('chat 调用失败', {
  correlationId,
  providerId: resolvedProviderId,
  model: modelInstance.resolvedModel,
  baseURL: modelInstance.config.baseURL,
  strength, temperature, maxTokens: effectiveMaxTokens,
  messageCount: compaction.messages.length,
  durationMs: Date.now() - startTime,
  // 关键诊断信息（Vercel AI SDK 错误对象）
  errorName, errorMessage, errorStack,
  httpStatus, responseBody,
  apiErrorCode, apiErrorType, apiErrorParam, apiErrorMessage,
  requestUrl,
})
```

主进程日志路径：`C:\Users\Lenovo\AppData\Roaming\tdsf-linux-desktop\logs\`

### 3. `src/shared/agent-types.ts` — `AgentErrorPayload.code` 扩充

新增 8 个错误码枚举值：
`PAYMENT_REQUIRED | PERMISSION | MODEL_NOT_FOUND | BAD_REQUEST | CONTEXT_OVERFLOW | VALIDATION | PARSE | NO_API_KEY`

旧 6 个码（AUTH/RATE_LIMIT/TIMEOUT/NETWORK/SERVER/UNKNOWN/CANCELLED）保持向后兼容。

## 验证结果

四绿门禁全过：
- `pnpm typecheck:node` ✓
- `pnpm typecheck:web` ✓
- `pnpm lint` ✓
- `pnpm test` ✓（62 文件 / 1366 测试全过）

dev 模式启动成功：
- Vite 渲染 dev server 跑在 http://127.0.0.1:9877/
- Electron 主进程启动正常
- 所有 IPC 通道注册成功（含 agent:chat / provider:list / token:stats）

## 预期效果

用户现在点"测试连接"或在 AI 对话中发送消息后，**任何**错误都能看到具体原因：

- 401 → "API Key 无效或已过期（原始 message）"
- 404 → "模型不存在或 endpoint 错误（原始 message）" ← 修复前是"Agent 调用失败"
- 没有 Key → "未配置 API Key（原始 message）" ← 修复前是"Agent 调用失败"
- 网络错 → "网络连接异常（原始 message）"
- 其它 → "Agent 调用失败（原始 message）" ← 修复前没有任何 raw 信息

主进程日志同时输出完整诊断信息（httpStatus / responseBody / requestUrl），便于开发者深挖。

## 修改文件

1. `src/main/ipc/agent-runtime.ts` — `toAgentError` 函数（第 105-191 行）
2. `src/main/core/agent/supervisor.ts` — `chatImpl` catch 块（第 740 行附近）
3. `src/shared/agent-types.ts` — `AgentErrorPayload.code` 类型

## 下一步

- 让用户在 dev 模式下点"测试连接"按钮，确认错误信息是否具体
- 如果还是"Agent 调用失败"，看主进程 logs 目录的具体错误码

## 引用

- [DeepSeek API 错误码](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes)
- [Vercel AI SDK 错误处理](https://sdk.vercel.ai/docs/reference/ai-sdk-errors/ai-api-error)
- @ai-sdk/openai: `APICallError` 包含 `status` / `responseBody` / `data` 字段
