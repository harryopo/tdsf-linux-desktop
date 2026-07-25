# 本地部署代码补全引擎作为通用 API 接口调研

> 调研目标：为 TDSF Linux Desktop 项目设计"本地部署代码补全引擎作为通用 API 接口"的技术方案，使本地模型与云端 API 对调用者无差别，并覆盖硬件分级适配、Token 统计、开源项目复用及 Electron 集成。
>
> 调研时间：2026-07-25
> 调研方式：GitHub API（`gh repo view`）+ 官方文档 + WebSearch 性能基准核对
> 适用项目：TDSF Linux Desktop（Electron + xterm.js + SSH + AI 辅助）
> 配套文档：[`08-开源代码补全引擎调研.md`](./08-开源代码补全引擎调研.md)（聚焦代码补全引擎选型）
>
> License 红线：本调研排除 AGPL/GPL 传染风险项目；核心推荐均为 MIT / Apache 2.0。

---

## 1. 调研概览

### 1.1 调研背景

TDSF Linux Desktop 当前已具备 SSH 终端、AI 辅助、高危命令拦截、日志分析等能力。在比赛冲刺阶段，需要在**控制 Token 成本（本地推理优先）**的前提下，为代码编辑器（Monaco）与终端命令输入提供统一的 AI 补全能力。

本调研聚焦：如何把本地部署的代码补全模型（如 Qwen2.5-Coder）包装成**与 OpenAI 云端 API 无差别的通用接口**，使上层应用无需关心模型跑在本地 Ollama、llama.cpp、vLLM 还是云端火山方舟上。

### 1.2 调研覆盖范围

| 维度 | 内容 |
|------|------|
| **本地推理引擎** | Ollama、llama.cpp、vLLM、transformers.js |
| **硬件配置分级** | CPU 核显 / 8GB 内存 / 16GB 内存 / RTX 3060 / RTX 4060 / 无 GPU |
| **通用 API 层** | OpenAI 兼容协议、模型发现、流式输出、Tool Calling、健康检查抽象 |
| **Token 统计** | 各引擎真实 token 返回能力、tokenizer 估算兜底、统一 usage 字段 |
| **开源复用** | LocalAI、LiteLLM、Jan、Tabby、Ollama、llama.cpp、vLLM、transformers.js |
| **Electron 集成** | Sidecar 子进程、独立服务、Renderer 嵌入、生命周期、模型下载与缓存 |

### 1.3 关键结论速览

1. **Ollama 是 Electron 本地集成的最佳起点**：MIT 许可、176k+ stars、原生 OpenAI 兼容 API、自动硬件检测、`electron-ollama` 可直接管理二进制生命周期。
2. **通用 API 层只需做 thin wrapper**：本地引擎本身已高度兼容 OpenAI API，统一层重点做 baseURL/模型别名/usage 归一化，无需重写协议。
3. **Token 统计以引擎真实值为主，tokenizer 估算兜底**：Ollama/llama.cpp/vLLM 的 OpenAI 兼容端点均返回 `usage.prompt_tokens/completion_tokens/total_tokens`；仅在原生 `/api/generate` 等场景使用 `prompt_eval_count/eval_count`。
4. **硬件分级推荐 0.5B → 7B 四级模型**：无 GPU 用 Qwen2.5-Coder-0.5B；RTX 3060 用 1.5B/3B；RTX 4060 用 3B/7B。
5. **推荐架构**：Electron Main 进程通过 `electron-ollama` 拉起 Ollama Sidecar → 暴露统一 `http://localhost:<port>/v1` → Renderer 通过 OpenAI SDK 调用；云端 Provider 通过 LiteLLM 风格网关做 fallback。

---

## 2. 本地推理引擎硬件配置分级适配

### 2.1 目标硬件分级

| 等级 | 硬件配置 | 典型场景 |
|------|---------|---------|
| L0 | CPU 核显 / 4-8GB RAM | 老旧笔记本、教学机房最低配 |
| L1 | 8GB RAM / 核显 | 主流轻薄本 |
| L2 | 16GB RAM / RTX 3060 6GB | 入门级游戏本/工作站 |
| L3 | 32GB RAM / RTX 4060 8GB | 主流开发工作站 |
| L4 | RTX 4090 / 64GB+ RAM | 高性能本地服务器（对照） |

### 2.2 模型与量化推荐矩阵

> 数据来源：08-开源代码补全引擎调研.md 实测汇总 + 2026 H1 多平台基准测试。

| 硬件等级 | 推荐模型 | 推荐量化 | 预计显存/内存占用 | 首 token 延迟 | 吞吐 (tok/s) |
|---------|---------|---------|-----------------|--------------|-------------|
| L0 无 GPU | Qwen2.5-Coder-0.5B | Q4_K_M | ~0.5 GB RAM | 400-650 ms | 8-15 |
| L1 核显 8GB | Qwen2.5-Coder-0.5B / 1.5B | Q4_K_M | ~0.5-1.0 GB RAM | 180-300 ms | 15-40 |
| L2 RTX 3060 6GB | Qwen2.5-Coder-1.5B / 3B | Q4_K_M | ~1.0-2.0 GB VRAM | 85-150 ms | 85-180 |
| L3 RTX 4060 8GB | Qwen2.5-Coder-3B / 7B | Q4_K_M | ~2.0-6.0 GB VRAM | 50-100 ms | 120-200 |
| L4 RTX 4090 | Qwen2.5-Coder-7B / 14B | Q5_K_M | ~6-12 GB VRAM | 30-80 ms | 150-250 |

### 2.3 自动硬件检测与默认模型推荐

在 Electron 主进程中，使用 Node.js 标准 `os` 模块即可获取核心硬件信息：

```typescript
import os from 'node:os';

function detectHardwareProfile() {
  const totalMemGB = os.totalmem() / 1024 ** 3;
  const cpuCores = os.availableParallelism?.() ?? os.cpus().length;
  const platform = os.platform(); // 'win32' | 'darwin' | 'linux'
  // GPU/VRAM 检测需借助原生模块或子进程：
  // - Windows: wmic path win32_VideoController get AdapterRAM,Name
  // - macOS: system_profiler SPDisplaysDataType
  // - Linux: nvidia-smi / lspci
  return { totalMemGB, cpuCores, platform };
}
```

基于检测结果的最小配置阈值与降级策略：

| 检测指标 | 阈值 | 行为 |
|---------|------|------|
| 总内存 < 6 GB | L0 | 禁用本地 LLM 补全，回退到规则补全（bash-language-server / Fig specs） |
| 总内存 6-12 GB 且无独立 GPU | L1 | 默认加载 Qwen2.5-Coder-0.5B |
| 总内存 ≥ 16 GB 且显存 4-6 GB | L2 | 默认加载 Qwen2.5-Coder-1.5B |
| 显存 ≥ 6 GB | L3 | 默认加载 Qwen2.5-Coder-3B |
| 显存 ≥ 10 GB | L4 | 默认加载 Qwen2.5-Coder-7B |

> 说明：GPU 信息在 Node.js 中没有跨平台标准 API，生产环境建议通过子进程调用 `nvidia-smi`（NVIDIA）、`system_profiler`（macOS）或 Windows WMI 获取；若检测失败，按"无 GPU"保守降级。

---

## 3. 通用 API 接口设计

### 3.1 设计目标

让本地模型和云端 API（OpenAI / 火山方舟 / 百炼等）对调用者**完全无差别**：

- 同一套请求/响应 JSON Schema
- 同一套错误码
- 同一套 Token 统计字段
- 同一套流式输出格式
- 模型列表可发现

### 3.2 推荐协议：OpenAI 兼容 API

主流本地引擎均已原生支持 OpenAI API 子集：

| 端点 | Ollama | llama.cpp | vLLM | transformers.js |
|------|--------|-----------|------|-----------------|
| `GET /v1/models` | ✅ | ✅ | ✅ | ⚠️（需自行实现） |
| `POST /v1/chat/completions` | ✅ | ✅ | ✅ | ⚠️ |
| `POST /v1/completions` | ✅ | ✅ | ✅ | ⚠️ |
| `POST /v1/embeddings` | ✅ | ✅ | ✅ | ⚠️ |
| `GET /health` | ❌（用 `/v1/models`） | ✅ `/health` | ✅ `/health` | ❌ |

> 参考：Ollama 官方 OpenAI 兼容性文档 `/v1/chat/completions`、`/v1/models` 端点已实验性支持；llama.cpp HTTP server README 列出 `/v1/chat/completions`、`/v1/completions`、`/v1/models`、`/v1/embeddings` 为 OpenAI-compatible endpoints；vLLM 官方文档确认完整 OpenAI API 兼容。

### 3.3 统一请求/响应示例

**统一请求**：

```json
POST /v1/chat/completions
{
  "model": "qwen2.5-coder-1.5b",
  "messages": [
    { "role": "system", "content": "You are a Linux terminal assistant." },
    { "role": "user", "content": "List all running docker containers" }
  ],
  "temperature": 0.2,
  "max_tokens": 256,
  "stream": true
}
```

**统一响应（非流式）**：

```json
{
  "id": "chatcmpl-local-001",
  "object": "chat.completion",
  "created": 1753449600,
  "model": "qwen2.5-coder-1.5b",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "docker ps" },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 28,
    "completion_tokens": 3,
    "total_tokens": 31
  }
}
```

**统一响应（流式最后 chunk）**：

```json
data: {"id":"chatcmpl-local-001","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":28,"completion_tokens":3,"total_tokens":31}}
```

### 3.4 健康检查与模型发现抽象

由于各引擎健康端点不一致，建议在 Electron 主进程封装统一探测逻辑：

| Provider 类型 | 探测端点 | 可用判定 |
|--------------|---------|---------|
| Ollama | `GET /v1/models` | HTTP 200 且模型列表非空 |
| llama.cpp | `GET /health` 或 `/v1/models` | HTTP 200 |
| vLLM | `GET /health` | HTTP 200 |
| 云端 OpenAI | `GET /v1/models` | HTTP 200 + 有效 API Key |

### 3.5 Tool Calling 支持

| 引擎 | Tool Calling 能力 | 备注 |
|------|------------------|------|
| Ollama | ✅ 实验性 | 通过 `/v1/chat/completions` 支持 `tools` 字段 |
| llama.cpp | ✅ | `--tool-call` 支持，OpenAI 兼容端点可用 |
| vLLM | ✅ | 原生支持 `tools` 参数 |
| transformers.js | ⚠️ | 需自行在前端实现 tool schema 注入与解析 |

> 结论：通用 API 层不需要重新发明协议，只需在 Provider 配置中维护 `baseURL`、`apiKey`、`modelAliasMap`、`healthEndpoint`，并对返回的 `usage` 字段做归一化。

---

## 4. Token 统计方案

### 4.1 各引擎真实 Token 返回能力

| 引擎 | 端点/字段 | prompt tokens | completion tokens | 流式支持 |
|------|----------|---------------|-------------------|---------|
| **Ollama 原生** | `/api/generate` | `prompt_eval_count` | `eval_count` | 最后 chunk 返回 |
| **Ollama OpenAI** | `/v1/chat/completions` | `usage.prompt_tokens` | `usage.completion_tokens` | ✅ 最后 chunk |
| **llama.cpp OpenAI** | `/v1/chat/completions` | `usage.prompt_tokens` | `usage.completion_tokens` | ✅ 最后 chunk |
| **vLLM** | `/v1/chat/completions` | `usage.prompt_tokens` | `usage.completion_tokens` | ✅ 最后 chunk |
| **transformers.js** | 前端 tokenizer | `tokenizer.encode(prompt).length` | `tokenizer.encode(output).length` | ✅ 即时 |

> 参考：Ollama 官方 Usage 文档说明 `prompt_eval_count` / `eval_count` 为输入/输出 token 数；llama.cpp OpenAI 兼容端点实测返回 `usage.completion_tokens`/`prompt_tokens`/`total_tokens`；vLLM 官方响应示例包含标准 `usage` 字段；NVIDIA AIPerf Vendor Usage Field Reference 确认 vLLM 使用 OpenAI-shape 的 `usage`。

### 4.2 Tokenizer 估算兜底方案

当引擎未返回 usage 或需要在前端预估时，可使用以下库：

| 库 | 适用模型 | License | 使用方式 |
|----|---------|---------|---------|
| `@xenova/transformers` / `@huggingface/transformers` | HuggingFace 系列 | Apache 2.0 | `AutoTokenizer.from_pretrained(...).encode(text).length` |
| `llama-tokenizer-js` | LLaMA 1/2/3 | - | `llamaTokenizer.encode(text)` |
| `tiktoken` (Node.js) | GPT 系列 | MIT | `encoding.encode(text).length` |
| `@anthropic-ai/tokenizer` | Claude 系列 | MIT | `countTokens(text)` |

推荐：本地代码补全以 Qwen/CodeGemma/StarCoder 为主，优先使用 `@huggingface/transformers` 的 `AutoTokenizer`；云端 fallback 到对应 Provider 的 tokenizer 库。

### 4.3 统一 Usage 归一化

```typescript
interface NormalizedUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens?: number;     // vLLM / OpenAI 可选
  reasoning_tokens?: number;  // DeepSeek / 推理模型可选
}

function normalizeUsage(raw: any): NormalizedUsage {
  // Ollama 原生格式
  if ('prompt_eval_count' in raw) {
    const prompt = raw.prompt_eval_count ?? 0;
    const completion = raw.eval_count ?? 0;
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
  }
  // OpenAI 兼容格式
  const u = raw.usage ?? raw;
  return {
    prompt_tokens: u.prompt_tokens ?? u.input_tokens ?? 0,
    completion_tokens: u.completion_tokens ?? u.output_tokens ?? 0,
    total_tokens: u.total_tokens ?? (u.prompt_tokens + u.completion_tokens),
    cached_tokens: u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens,
    reasoning_tokens: u.completion_tokens_details?.reasoning_tokens,
  };
}
```

### 4.4 本地与云端 Token 字段差异

| Provider | prompt 字段 | completion 字段 | cache 字段 | 备注 |
|---------|------------|----------------|-----------|------|
| OpenAI | `prompt_tokens` | `completion_tokens` | `prompt_tokens_details.cached_tokens` | 标准 |
| 火山方舟 / 百炼 | `input_tokens` | `output_tokens` | - | Anthropic-style |
| vLLM | `prompt_tokens` | `completion_tokens` | `prompt_tokens_details.cached_tokens`（需 `--enable-prompt-tokens-details`） | OpenAI-shape |
| Ollama | `prompt_eval_count` | `eval_count` | - | 原生命名不同 |

> 结论：统一层必须做字段映射，最终输出固定为 `prompt_tokens/completion_tokens/total_tokens` 三元组。

---

## 5. 开源项目复用对比矩阵

### 5.1 核心引擎与网关项目

| 项目 | GitHub | Stars | 最近活跃 | License | 主语言 | 定位 | Electron 友好度 | 备注 |
|------|--------|-------|---------|---------|--------|------|----------------|------|
| **Ollama** | [ollama/ollama](https://github.com/ollama/ollama) | 176,815 | 2026-07-25 | MIT | Go | 本地模型运行时 | ⭐⭐⭐⭐⭐ | 推荐核心引擎 |
| **llama.cpp** | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) | 121,517 | 2026-07-25 | MIT | C++ | 高性能底层推理 | ⭐⭐⭐⭐ | 比 Ollama 快 ~50% |
| **vLLM** | [vllm-project/vllm](https://github.com/vllm-project/vllm) | 87,095 | 2026-07-25 | Apache 2.0 | Python | 生产级高并发 | ⭐⭐⭐ | Python 依赖重 |
| **transformers.js** | [huggingface/transformers.js](https://github.com/huggingface/transformers.js) | 16,207 | 2026-07-24 | Apache 2.0 | JavaScript | 浏览器/Node 推理 | ⭐⭐⭐⭐ | 适合前端 tokenizer |
| **LocalAI** | [mudler/LocalAI](https://github.com/mudler/LocalAI) | 47,821 | 2026-07-25 | MIT | Go | 本地多模态 AI 引擎 | ⭐⭐⭐⭐ | 功能全但体积大 |
| **LiteLLM** | [BerriAI/litellm](https://github.com/BerriAI/litellm) | 54,633 | 2026-07-25 | MIT（核心）+ 私有 EE | Python | 100+ Provider 网关 | ⭐⭐ | 适合云端多路由 |
| **Jan** | [janhq/jan](https://github.com/janhq/jan) | 43,691 | 2026-07-24 | Apache 2.0 | TypeScript | 离线 ChatGPT 替代 | ⭐⭐⭐ | Electron 应用，可借鉴 UI |
| **Tabby** | [TabbyML/tabby](https://github.com/TabbyML/tabby) | 33,788 | 2026-06-30 | Apache 2.0（核心）+ 私有 EE | Rust | 自托管代码补全服务器 | ⭐⭐⭐ | 专注 IDE 补全 |

> 数据来源：GitHub API `gh repo view` 于 2026-07-25 查询。LiteLLM 与 Tabby 均有 `enterprise/` / `ee/` 目录为私有企业版，核心代码分别为 MIT / Apache 2.0。

### 5.2 各项目深度评估

#### 5.2.1 Ollama（推荐核心引擎）

- **优势**：
  - 176k+ stars，社区最活跃，日更 commit。
  - 一键模型管理 `ollama pull/run`。
  - 自动检测 GPU/CPU 并选择后端。
  - 原生 OpenAI 兼容 API，迁移成本最低。
  - MIT License，无传染风险。
- **劣势**：
  - 吞吐量低于 vLLM 与 llama.cpp（单用户场景可接受）。
  - 多用户并发能力弱。
- **适用**：Electron 内嵌 Sidecar，单用户本地补全。

#### 5.2.2 llama.cpp（性能优先备选）

- **优势**：
  - 121k+ stars，纯 C++，跨平台，Metal/CUDA/Vulkan 后端齐全。
  - OpenAI 兼容 HTTP server（`llama-server`）。
  - 同硬件下比 Ollama 快约 50%，显存省约 28%。
- **劣势**：
  - 模型加载、参数调优较复杂。
  - 无内置模型注册表，需自行下载 GGUF。
- **适用**：对延迟敏感且愿意维护模型文件的场景。

#### 5.2.3 vLLM（高并发/服务器场景）

- **优势**：
  - 87k+ stars，PagedAttention 带来极高吞吐。
  - 完整 OpenAI API 兼容。
  - 适合团队级共享 GPU 服务器。
- **劣势**：
  - Python 重依赖，打包体积大。
  - 消费级显卡上启动慢。
- **适用**：TDSF 后期团队服务器版本，非当前 Electron 内嵌首选。

#### 5.2.4 transformers.js（前端推理/Tokenizer）

- **优势**：
  - 16k+ stars，HuggingFace 官方，Apache 2.0。
  - 可直接在 Renderer 进程做 tokenizer 统计。
  - v3 支持 WebGPU，速度提升显著。
- **劣势**：
  - 完整模型推理会占用 Renderer 内存，影响 IDE 响应。
  - 大模型首次下载体验差。
- **适用**：前端 token 估算、轻量模型实验，不建议作为主力推理后端。

#### 5.2.5 LiteLLM（统一网关备选）

- **优势**：
  - 54k+ stars，支持 100+ Provider 统一调用。
  - 内置成本追踪、负载均衡、guardrails。
  - 核心代码 MIT。
- **劣势**：
  - Python 依赖，嵌入 Electron 体积大。
  - 企业版功能私有。
- **适用**：未来需要同时管理本地+云端多 Provider 时作为网关层，而非当前内嵌方案。

#### 5.2.6 Tabby（代码补全专用）

- **优势**：
  - 33k+ stars，Rust 高性能，内置代码库索引。
  - 专注 IDE 补全，体验接近 GitHub Copilot。
- **劣势**：
  - 不原生支持 Shell 命令补全（issue #2644 仍 Open）。
  - 需要独立服务器，不适合纯 Electron 内嵌。
- **适用**：团队级代码补全服务器，与本项目终端补全需求不完全匹配。

---

## 6. Electron 集成方案

### 6.1 三种集成形态对比

| 形态 | 说明 | 优点 | 缺点 | 推荐度 |
|------|------|------|------|--------|
| **Sidecar 子进程** | Electron Main 进程 spawn 本地推理引擎（Ollama/llama.cpp） | 进程隔离、崩溃不影响主应用、生命周期可控 | 需要管理二进制下载与更新 | ⭐⭐⭐⭐⭐ |
| **独立系统服务** | 依赖用户自行安装 Ollama 服务 | 体积小、升级独立 | 安装门槛高、版本不可控 | ⭐⭐⭐ |
| **Renderer 嵌入** | 在渲染进程直接运行 transformers.js | 无需额外进程 | 占用 UI 线程内存、大模型卡顿 | ⭐⭐ |

### 6.2 推荐：Sidecar 子进程方案

参考 `electron-ollama` 包的设计，TDSF 可采用以下架构：

```
┌─────────────────────────────────────────────────────────┐
│ Electron Renderer (Monaco + xterm.js)                   │
│  ┌───────────────────────────────────────────────────┐  │
│  │ OpenAI SDK / fetch('http://localhost:11434/v1/...')│  │
│  └───────────────────┬───────────────────────────────┘  │
└──────────────────────┼──────────────────────────────────┘
                       │ IPC（可选，用于状态同步）
┌──────────────────────▼──────────────────────────────────┐
│ Electron Main Process                                   │
│  ┌───────────────────────────────────────────────────┐  │
│  │ LocalLLMService                                   │  │
│  │ - 检测硬件 → 选择默认模型                         │  │
│  │ - 管理 Ollama Sidecar 生命周期                    │  │
│  │ - 模型下载进度推送                                │  │
│  │ - 健康检查 / 故障重启                             │  │
│  └───────────────────┬───────────────────────────────┘  │
└──────────────────────┼──────────────────────────────────┘
                       │ spawn
┌──────────────────────▼──────────────────────────────────┐
│ Ollama Sidecar (ollama serve)                           │
│  ┌───────────────────────────────────────────────────┐  │
│  │ GGUF Models in ~/.ollama/models or userData/models│  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 6.3 模型文件下载管理

| 项目 | 默认模型目录 | 可配置 | 推荐策略 |
|------|------------|--------|---------|
| Ollama | `~/.ollama/models` | ✅ `OLLAMA_MODELS` | 沿用默认，避免重复占用空间 |
| llama.cpp | 用户指定路径 | ✅ `--model` | 放在 `app.getPath('userData')/models` |
| vLLM | HuggingFace cache | ✅ `HF_HOME` | 不建议内嵌 |

推荐：Electron 中通过环境变量 `OLLAMA_MODELS` 指向 `app.getPath('userData')/ollama-models`，实现应用级隔离；若用户已安装系统 Ollama，则复用其模型目录避免重复下载。

### 6.4 进程生命周期管理

```typescript
class LocalLLMService {
  private process?: ChildProcess;

  async start() {
    if (await this.isRunning()) return;
    const ollamaPath = await this.ensureBinary();
    this.process = spawn(ollamaPath, ['serve'], {
      env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' },
    });
    await this.waitForHealthy();
  }

  async stop() {
    this.process?.kill('SIGTERM');
    // Windows 上 SIGTERM 不生效，可改用 taskkill
  }

  async pullModel(model: string, onProgress: (p: number) => void) {
    // 通过 Ollama REST API POST /api/pull 拉取模型
  }
}
```

### 6.5 缓存目录设计

```
<userData>/
├── ollama-models/          # Ollama 模型文件（可配置 OLLAMA_MODELS）
├── llm-cache/
│   ├── tokenizers/         # 前端 tokenizer 缓存
│   └── embeddings/         # 本地 embedding 缓存
└── logs/
    └── ollama.log          # Sidecar 日志
```

---

## 7. 推荐技术路线

### 7.1 v1.0 冲刺路线（比赛截止 2026-07-30）

采用**最小可用、可扩展**的架构：

1. **推理引擎**：Ollama（MIT，176k+ stars，OpenAI 兼容）。
2. **通用 API 层**：直接暴露 Ollama 的 `/v1` 端点，不做 heavy wrapper。
3. **模型默认**：
   - L0/L1：Qwen2.5-Coder-0.5B Q4
   - L2：Qwen2.5-Coder-1.5B Q4
   - L3：Qwen2.5-Coder-3B Q4
4. **Token 统计**：优先使用 `/v1/chat/completions` 返回的 `usage`；Ollama 原生 `/api/generate` 场景使用 `prompt_eval_count/eval_count`。
5. **Electron 集成**：`electron-ollama` 管理 Sidecar，模型目录隔离到 `userData`。
6. **云端 fallback**：保留一个 `UnifiedLLMClient`，baseURL 切换即可接入 OpenAI/火山方舟，v1.0 可用硬编码 Provider 配置，v1.5 再引入 LiteLLM 网关。

### 7.2 v1.5 扩展路线

- 引入 llama.cpp 作为高性能备选引擎，通过统一的 `InferenceEngine` 接口切换。
- 引入 LiteLLM 网关，实现本地+云端多 Provider 路由与成本统计。
- 引入本地 tokenizer 缓存，前端实时显示 prompt token 数。

### 7.3 不推荐的方案

| 方案 | 原因 |
|------|------|
| 纯 transformers.js 推理 | 大模型占用 Renderer 内存，影响 Monaco 编辑体验 |
| vLLM 作为默认内嵌引擎 | Python 依赖重，打包体积超出预算 |
| 自研 RPC 协议 | OpenAI 兼容已是事实标准，重复造轮子 |
| AGPL/GPL 项目 | 法律风险高，比赛交付需规避 |

---

## 8. 数据来源

- GitHub 仓库元数据：通过 `gh repo view` 于 2026-07-25 查询。
  - Ollama: https://github.com/ollama/ollama
  - llama.cpp: https://github.com/ggml-org/llama.cpp
  - vLLM: https://github.com/vllm-project/vllm
  - transformers.js: https://github.com/huggingface/transformers.js
  - LocalAI: https://github.com/mudler/LocalAI
  - LiteLLM: https://github.com/BerriAI/litellm
  - Jan: https://github.com/janhq/jan
  - Tabby: https://github.com/TabbyML/tabby
- Ollama 官方文档：https://docs.ollama.com/api/usage、https://docs.ollama.com/api/openai-compatibility
- llama.cpp HTTP Server README：https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- vLLM OpenAI 兼容 API 说明：社区技术博客与官方文档
- NVIDIA AIPerf Vendor Usage Field Reference：https://docs.nvidia.com/aiperf/reference/vendor-usage-field-reference
- transformers.js Tokenizer 用法：https://huggingface.co/docs/transformers.js、https://dev.to/ppaanngggg/how-to-count-tokens-in-frontend-for-popular-llm-models-gpt-claude-and-llama-efm
- electron-ollama：https://www.npmjs.com/package/electron-ollama
- Node.js os 模块硬件检测：https://nodejs.org/api/os.html
- 硬件性能数据参考：08-开源代码补全引擎调研.md 中 2026 H1 多平台实测汇总

---

## 9. 附录：License 核查结论

| 项目 | 核心 License | 是否有传染性模块 | 结论 |
|------|------------|----------------|------|
| Ollama | MIT | 无 | ✅ 可安全复用 |
| llama.cpp | MIT | 无 | ✅ 可安全复用 |
| vLLM | Apache 2.0 | 无 | ✅ 可安全复用 |
| transformers.js | Apache 2.0 | 无 | ✅ 可安全复用 |
| LocalAI | MIT | 无 | ✅ 可安全复用 |
| LiteLLM | MIT（核心） | `enterprise/` 目录私有 | ✅ 核心可复用，避免引入 enterprise 代码 |
| Jan | Apache 2.0 | 无 | ✅ 可安全复用 |
| Tabby | Apache 2.0（核心） | `ee/` 目录私有 | ✅ 核心可复用，避免引入 ee 代码 |

> 所有推荐项目核心代码均为 MIT 或 Apache 2.0，符合 TDSF Linux Desktop 的 License 红线要求。
