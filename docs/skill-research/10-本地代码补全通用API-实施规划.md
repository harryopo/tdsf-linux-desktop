# 本地代码补全通用 API 实施规划

> **规划目标**：将本地部署的代码补全引擎（Ollama/llama.cpp 等）封装为与云端 OpenAI 兼容 API 无差别的通用接口，统一 Token 统计，使 TDSF Linux Desktop 在断网/本地优先场景下也能提供 AI 补全能力。
>
> **规划时间**：2026-07-25
> **配套调研**：[10-本地代码补全通用API调研.md](./10-本地代码补全通用API调研.md)
> **状态**：长期规划，比赛冲刺阶段先做最小可用闭环，后续迭代完善
>
> ---

## 1. 目标与定位

### 1.1 核心目标

| 目标 | 说明 |
|------|------|
| **本地优先** | 默认优先调用本地模型，无网络依赖、无云端 Token 费用 |
| **云端兼容** | 同一代码路径可切换 OpenAI/火山方舟/百炼等云端 API |
| **Token 透明** | 本地推理也返回统一 `usage` 字段，成本统计不中断 |
| **硬件自适应** | 根据用户电脑配置自动推荐/降级模型，避免卡顿崩溃 |
| **通用接口** | 未来可作为独立 Sidecar 或 npm 包被其他模块复用 |

### 1.2 解决的问题

- 当前 TDSF 的 AI 能力完全依赖用户配置的云端 API Key，没有 Key 则功能不可用。
- 本地部署模型与云端 API 接口不统一，上层代码需要写两套调用逻辑。
- 本地推理的 Token 消耗无法统计，导致成本/用量面板缺失本地模型数据。
- 用户不清楚自己的电脑能跑什么模型，容易配置错误导致崩溃。

### 1.3 非目标

- 不做自研推理引擎（复用 Ollama/llama.cpp）。
- 不做完全离线的大模型训练（仅做本地推理与可选 LoRA 微调）。
- 比赛冲刺阶段（2026-07-30 前）不追求多引擎支持，先跑通 Ollama 单引擎。

---

## 2. 总体架构设计

### 2.1 架构分层

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          TDSF Linux Desktop                              │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Renderer (React + Monaco + xterm.js)                            │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │    │
│  │  │ 代码编辑器   │  │ 终端输入    │  │ AI 对话 / 自然语言转命令 │  │    │
│  │  │ Monaco      │  │ xterm.js    │  │ ChatPanel               │  │    │
│  │  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘  │    │
│  │         │                │                       │               │    │
│  │         └────────────────┼───────────────────────┘               │    │
│  │                          ▼                                       │    │
│  │              OpenAI SDK / fetch('http://localhost:11434/v1/...') │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                    │                                     │
│  ┌─────────────────────────────────▼─────────────────────────────────┐   │
│  │  Main Process: LocalLLMService（通用 API 适配层）                  │   │
│  │  ┌─────────────────────────────────────────────────────────────┐  │   │
│  │  │ 1. Provider Router（本地/云端路由）                          │  │   │
│  │  │ 2. Hardware Profiler（硬件分级）                             │  │   │
│  │  │ 3. Sidecar Lifecycle（Ollama 进程管理）                      │  │   │
│  │  │ 4. Model Manager（拉取/切换/删除模型）                       │  │   │
│  │  │ 5. Usage Normalizer（Token 字段归一化）                      │  │   │
│  │  └─────────────────────────────────────────────────────────────┘  │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                    │                                     │
│  ┌─────────────────────────────────▼─────────────────────────────────┐   │
│  │  Sidecar Process: Ollama (ollama serve)                            │   │
│  │  - OpenAI 兼容 API (/v1/chat/completions, /v1/models)             │   │
│  │  - 模型目录隔离：app.getPath('userData')/ollama-models             │   │
│  └───────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键模块职责

| 模块 | 位置 | 职责 |
|------|------|------|
| `LocalLLMService` | `src/main/services/local-llm/` | 管理 Sidecar 生命周期、硬件检测、模型下载、健康检查 |
| `UnifiedLLMClient` | `src/main/services/llm/unified-client.ts` | 统一封装 OpenAI SDK，隐藏本地/云端差异 |
| `UsageNormalizer` | `src/main/services/llm/usage-normalizer.ts` | 将 Ollama/火山/OpenAI 等异构 usage 字段归一化 |
| `HardwareProfiler` | `src/main/services/local-llm/hardware-profiler.ts` | 检测内存/GPU，推荐默认模型 |
| `LocalLLMConfig` | `src/shared/models/local-llm.ts` | 共享类型：Provider 配置、模型别名、硬件等级 |

### 2.3 与现有 LLM 层的关系

- 保留现有 `VercelAiService` / `LlmClient` 作为云端 Provider 调用路径。
- 新增 `UnifiedLLMClient`，根据配置决定走本地 Ollama 还是云端 Provider。
- Token 统计层（`TokenStats`）只接收归一化后的 `NormalizedUsage`，无需关心来源。

---

## 3. 硬件配置分级与模型推荐

### 3.1 硬件等级定义

| 等级 | 配置 | 默认模型 | 显存/内存占用 | 首 token 延迟 | 适用场景 |
|------|------|---------|--------------|--------------|---------|
| L0 | CPU 核显 / RAM < 6GB | **禁用本地 LLM**，回退规则补全 | 0 | 0 | 老旧设备、最低配教学机 |
| L1 | 8GB RAM / 无独显 | Qwen2.5-Coder-0.5B Q4 | ~0.5GB RAM | 400-650ms | 主流轻薄本 |
| L2 | 16GB RAM / RTX 3060 6GB | Qwen2.5-Coder-1.5B Q4 | ~1GB VRAM | 180-300ms | 入门级游戏本 |
| L3 | 32GB RAM / RTX 4060 8GB | Qwen2.5-Coder-3B Q4 | ~2GB VRAM | 85-150ms | 主流开发工作站 |
| L4 | RTX 4090 / 64GB+ RAM | Qwen2.5-Coder-7B Q4 | ~6GB VRAM | 50-100ms | 高性能工作站 |

### 3.2 自动检测逻辑

```typescript
function detectHardwareLevel(): HardwareLevel {
  const totalMemGB = os.totalmem() / 1024 ** 3;
  const vramGB = detectGpuVram(); // 优先 nvidia-smi，次选 WMI/system_profiler

  if (totalMemGB < 6) return 'L0';
  if (vramGB >= 10) return 'L4';
  if (vramGB >= 6) return 'L3';
  if (vramGB >= 4 && totalMemGB >= 16) return 'L2';
  if (totalMemGB >= 8) return 'L1';
  return 'L0';
}
```

### 3.3 用户可覆盖

- 自动推荐仅作为默认选择，用户可在设置中手动指定模型。
- 手动选择模型时，若硬件不满足最低要求，给出警告但不阻止（允许高级用户尝试）。

---

## 4. 通用 API 接口设计

### 4.1 接口原则

- **完全兼容 OpenAI API**：请求体/响应体/流式格式/错误码与 OpenAI 一致。
- **模型别名映射**：`qwen2.5-coder:1.5b`（Ollama 名）→ `qwen2.5-coder-1.5b`（通用名）。
- **baseURL 切换即切换 Provider**：本地 `http://127.0.0.1:11434/v1`，云端 `https://api.openai.com/v1`。

### 4.2 核心端点

| 端点 | 用途 | 本地支持 | 云端支持 |
|------|------|---------|---------|
| `GET /v1/models` | 模型列表发现 | Ollama ✅ | OpenAI ✅ |
| `POST /v1/chat/completions` | 对话/补全 | Ollama ✅ | OpenAI ✅ |
| `POST /v1/completions` | 基础补全 | Ollama ✅ | OpenAI ✅ |
| `GET /health` | 健康检查 | Ollama 用 `/v1/models` 代理 | OpenAI 用 `/v1/models` |

### 4.3 统一请求示例

```typescript
const response = await unifiedClient.chat.completions.create({
  model: 'qwen2.5-coder-1.5b',   // 或 'gpt-4o-mini'
  messages: [
    { role: 'system', content: 'You are a Linux terminal assistant.' },
    { role: 'user', content: '查看当前目录下所有文件' },
  ],
  temperature: 0.2,
  max_tokens: 256,
  stream: true,
});
```

### 4.4 Provider 配置类型

```typescript
interface LLMProviderConfig {
  id: string;                 // 'local-ollama' | 'volc-ark' | 'openai'
  name: string;               // 显示名称
  type: 'local' | 'remote';
  baseURL: string;            // OpenAI 兼容 baseURL
  apiKey?: string;            // 本地可省略
  defaultModel: string;       // 默认模型名
  modelAlias: Record<string, string>; // 通用名 → Provider 原始名
  enableToolCalling: boolean;
}
```

---

## 5. Token 统计方案

### 5.1 归一化目标

无论本地还是云端，最终都输出统一的 `NormalizedUsage`：

```typescript
interface NormalizedUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
  estimated?: boolean;        // true 表示 tokenizer 估算，非引擎真实值
}
```

### 5.2 本地引擎字段映射

| Provider | 原始字段 | 映射后字段 |
|----------|---------|-----------|
| Ollama 原生 `/api/generate` | `prompt_eval_count` | `prompt_tokens` |
| Ollama 原生 `/api/generate` | `eval_count` | `completion_tokens` |
| Ollama `/v1/chat/completions` | `usage.prompt_tokens` | `prompt_tokens` |
| llama.cpp `/v1/...` | `usage.prompt_tokens` | `prompt_tokens` |
| vLLM | `usage.prompt_tokens` | `prompt_tokens` |
| 火山方舟 | `usage.input_tokens` | `prompt_tokens` |

### 5.3 估算兜底

当引擎未返回 usage 时，使用 `@huggingface/transformers` 的 `AutoTokenizer` 做前端/主进程估算，并标记 `estimated: true`。

```typescript
async function estimateTokens(text: string, model: string): Promise<number> {
  const tokenizer = await AutoTokenizer.from_pretrained(model);
  return (await tokenizer.encode(text)).length;
}
```

### 5.4 成本面板

- 本地模型成本显示为 `0.00 CNY`（或标注"本地推理，无 API 成本"）。
- 仍统计 token 数，用于展示用量趋势和模型效率对比。

---

## 6. 实施路线图

### Phase 0：最小可用闭环（MVP，2-3 天）

**目标**：让 TDSF 在没有云端 API Key 时，也能通过本地 Ollama 回答一条简单问题。

| 任务 | 工时 | 验收标准 |
|------|------|---------|
| 新增 `LocalLLMService`：启动/停止 Ollama Sidecar | 4h | `ollama serve` 随 TDSF 启动/退出 |
| 新增 `UnifiedLLMClient`：统一本地/云端调用 | 4h | 同一接口切换 baseURL 即可换 Provider |
| 新增 `UsageNormalizer`：归一化 usage 字段 | 2h | Ollama 返回的 token 数被正确统计到 TokenStats |
| 设置页新增"本地模型"开关与模型选择 | 2h | 用户可开关本地模型、查看模型状态 |
| 默认下载 Qwen2.5-Coder-0.5B | 2h | 首次启动自动检测硬件并拉取模型 |

**Phase 0 验收**：断网状态下，在 AI 面板输入"查看当前目录"，本地模型返回命令建议，且 Token 面板显示用量。

### Phase 1：集成到终端与编辑器（3-5 天）

- 终端命令补全：xterm.js ghost text 接入 `UnifiedLLMClient`。
- 代码编辑器补全：Monaco inline completion 接入本地模型（FIM 模式）。
- 硬件检测与自动模型推荐。
- 模型下载进度 UI。

### Phase 2：多引擎与网关（2-4 周）

- 支持 llama.cpp 作为高性能备选引擎。
- 引入 LiteLLM 风格网关，统一管理本地+云端多 Provider。
- 本地 tokenizer 缓存，实时显示 prompt token 数。

### Phase 3：优化与生态（长期）

- 使用项目历史命令做 LoRA 微调，提升 Shell 补全准确率。
- 将 `LocalLLMService` 抽离为独立 npm 包或 Sidecar，供其他项目复用。
- 支持模型量化级别选择（Q4/Q5/Q8）。

---

## 7. 开源复用清单

| 项目 | License | 用途 | 集成方式 | 风险 |
|------|---------|------|---------|------|
| **Ollama** | MIT | 本地推理引擎 | Sidecar 子进程 | 无 |
| **electron-ollama**（npm） | MIT | 管理 Ollama 二进制生命周期 | npm install | 活跃度一般，必要时自研 |
| **OpenAI SDK** | Apache 2.0 | 统一 API 调用 | npm install | 无 |
| **@huggingface/transformers** | Apache 2.0 | Tokenizer 估算 | npm install | 包体积较大，按需加载 |
| **Qwen2.5-Coder GGUF** | Apache 2.0 | 代码补全模型 | `ollama pull` | 无 |
| **LiteLLM** | MIT（核心） | 未来多 Provider 网关 | Python Sidecar（v1.5） | Python 依赖重 |
| **llama.cpp** | MIT | 高性能备选引擎 | 子进程（v1.5） | 配置复杂 |

> 所有项目均已排除 AGPL/GPL 传染风险。

---

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 用户电脑无法运行任何本地模型 | 中 | 高 | L0 自动降级到规则补全；提示"当前配置不支持本地模型" |
| Ollama Sidecar 启动失败 | 中 | 高 | 启动失败时自动禁用本地模型并提示；保留云端 fallback |
| 模型下载慢/失败 | 高 | 中 | 预置 0.5B 小模型；提供国内镜像源；显示下载进度与重试 |
| 本地模型质量不如云端 | 高 | 中 | 默认 0.5B 仅用于简单补全；复杂任务引导使用云端或 7B 模型 |
| 内存/显存不足导致系统卡顿 | 中 | 高 | 硬件检测阈值保守；大文件编辑时自动关闭本地模型 |
| OpenAI SDK 与 Ollama 字段差异 | 低 | 中 | `UsageNormalizer` 统一字段映射，已覆盖已知差异 |
| Windows 下 SIGTERM 不生效 | 中 | 低 | Sidecar 停止用 `taskkill` fallback |

---

## 9. 关键决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 核心引擎 | **Ollama** | MIT 许可、OpenAI 原生兼容、社区最活跃、Electron Sidecar 生态成熟 |
| 默认模型 | **Qwen2.5-Coder 0.5B/1.5B** | Apache 2.0、中文友好、FIM 原生支持、硬件门槛低 |
| 接口协议 | **OpenAI 兼容 API** | 事实标准，本地/云端代码路径统一，减少自研成本 |
| 集成形态 | **Sidecar 子进程** | 进程隔离、崩溃不影响主应用、生命周期可控 |
| Token 统计 | **引擎真实值 + tokenizer 估算兜底** | 保证数据准确性，同时覆盖所有异常场景 |
| 多引擎支持 | **v1.5 再引入 llama.cpp** | 比赛冲刺阶段聚焦 Ollama 单引擎，降低复杂度 |
| 云端 fallback | **保留现有 LlmClient + 新增 UnifiedLLMClient** | 不破坏现有功能，平滑过渡 |

---

## 10. 下一步可执行动作

### 立即可以做（不依赖比赛冲刺）

1. **在 `opensource-reference/` 克隆 Ollama 源码做全量分析**
   ```bash
   cd d:/ai/linux教学一体/opensource-reference
   git clone https://github.com/ollama/ollama.git --depth 1
   ```
2. **安装 `electron-ollama` 到 TDSF 做 POC 验证**
   ```bash
   cd d:/ai/linux教学一体/tdsf-linux-desktop
   pnpm add electron-ollama
   ```
3. **创建模块骨架**
   ```bash
   mkdir -p src/main/services/local-llm
   touch src/main/services/local-llm/service.ts
   touch src/main/services/local-llm/hardware-profiler.ts
   touch src/main/services/llm/unified-client.ts
   touch src/main/services/llm/usage-normalizer.ts
   ```

### 比赛冲刺后做（长期）

- Phase 1：终端/编辑器补全接入。
- Phase 2：llama.cpp 备选 + LiteLLM 网关。
- Phase 3：LoRA 微调 + 独立 npm 包。

---

## 11. 与 TDSF 现有代码的关系

- **不替换**现有 `VercelAiService` 和 `LlmClient`，而是新增 `UnifiedLLMClient` 作为可选入口。
- **不改动**现有云端 Provider 配置，仅新增 `local-ollama` Provider 类型。
- **复用**现有 TokenStats/CostStats 统计层，通过 `NormalizedUsage` 注入本地数据。
- **复用**现有 Sidecar 生命周期管理经验（v0.9.5 McpLifecycleHardened 5 阶段状态机）。

---

## 12. 参考资料

- [10-本地代码补全通用API调研.md](./10-本地代码补全通用API调研.md)
- [08-开源代码补全引擎调研.md](./08-开源代码补全引擎调研.md)
- [07-终端智能补全技术调研.md](./07-终端智能补全技术调研.md)
- Ollama 官方文档：https://docs.ollama.com/api/openai-compatibility
- OpenAI API 参考：https://platform.openai.com/docs/api-reference
