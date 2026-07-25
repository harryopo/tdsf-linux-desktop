# Changelog

All notable changes to TDSF-Linux Desktop will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- v0.9.7 P3 M1：Token logprobs 直采 — **部分落地 + Claude 兑底（诚实策略）**
  - 论文依据：**Zhao 2026, arXiv:2603.18940** §3 — token-level answer-distribution entropy 比 text-Shannon entropy 更预测 LLM 推理可靠性
  - **诚实策略**：5/8 provider 直采 + 3/8 provider 兑底（用户主用 Claude 走 fallback 路径）
    - **支持 5/8 provider**（OpenAI 协议族）：openai-compatible / deepseek / qwen / volcengine-ark / ollama
    - **兑底 3/8 provider**（不暴露 logprobs）：anthropic / google / claude-sdk → 走 thinking-block / text-fallback
  - `ProviderCapabilities.logprobs: boolean` 字段（`src/shared/agent-types.ts` + 8 provider 默认表）
  - `tokenLogprobShannonEntropy(logprobs)` 纯函数（数值稳定：max-subtraction + log₂ 归一化）
  - `CotTraceCollector.recordTokenLogprobEntropies` 方法（4 优先级降级：thinking-block / turn-text / **logprobs** / text-fallback）
  - supervisor.ts 集成：`providerOptions.openai = { logprobs: true, top_logprobs: 5 }` + 捕获 `result.fullStream` 的 `providerMetadata.openai.logprobs[]`
  - 测试覆盖 **+44**：tokenLogprobShannonEntropy 14 + recordTokenLogprobEntropies 15 + provider-capabilities 15

### Added (prior v0.9.6 P2 M6/M7)
- v0.9.6 P2 M6：CoT-shape 熵轨迹可视化渲染（ConfidenceBreakdown 内嵌纯 SVG 折线图）
  - 320×80 viewBox，水平网格 + y 轴标签 + 主折线（绿/黄）+ 轨迹点 + 违规红圆标记
  - 单调性 tag + 5 列统计指标（步数/H₀/Hₙ/ΔH/形状置信度）+ 论文依据
  - 论文：Zhao 2026, arXiv:2603.18940
- v0.9.6 P2 M7：ConfidenceBreakdown 组件级 RTL 测试（12 个）
  - 基础渲染（5）+ CoT 可视化（7）：单调链 / 典型非单调 / 3 次反弹 / 单步降级 / 论文引用
- v0.9.6 P2 M7：DecisionCard 集成 CoT 熵轨迹数据流（ChatPanel → DecisionCard → ConfidenceBreakdown）
- v0.9.6 P2 M7：CredibilityPanel CoT 熵轨迹 TextArea 输入（多分隔符支持，实时 useMemo 分析）

### Fixed
- 前端重构时遗漏 ConfidenceBreakdown.css 的 CoT 区样式（TSX 引用 11 个 CSS 类但 CSS 缺失）
- 现已在 CSS 文件末尾补齐完整 CoT 区样式块

### Quality
- 全量测试：1304 → 1348（+44，+3.4%）
- 五绿门禁 4/5 通过：typecheck:node / typecheck:web / lint / test
- 完成度：100%（P2 M6/M7 + P3 M1 全部完成）

### Planned
- v0.9.7+ P3 M2：thinking block 内部再切分（进一步细化 trace step）
- v0.9.7+ P3 M3：自适应权重（按 provider 类别动态调整 4 路融合比例）
- v1.5: Firecracker microVM sandbox (replaces Docker)
- v1.5: Full OpenTelemetry integration (Langfuse + Tempo)
- v2.0: code-server / Theia IDE embedding
- v2.0: WASM sandbox alternative

## [1.0.0] - 2026-07-25

### 🎉 火山杯 2026 比赛首发版本

这是 TDSF-Linux Desktop 的首个比赛交付版本，集成 v0.2 → v0.9 → v1.0 三个里程碑。

### Added
- **SSH 终端完整链路**（ssh2 + xterm.js）
- **AI 辅助问答**（多 Provider + Supervisor + Subagent 编排）
- **高危命令拦截**（12 条黑名单 + 三态权限审批）
- **SFTP 文件管理**（react-arborist + Monaco Editor）
- **可信度评估**（D-S + PCR5 融合 + 6 源证据权重可视化）
- **CoT-shape 熵轨迹分析**（基于 Zhao 2026 论文）
- **教程词库 v1.2.0**（2236 词条）
- **8 爬虫源教程聚合**
- **AI 运维助手面板**（PAOR 流式 + 审批 + 循环）
- **Langfuse 可观测性**（OpenTelemetry 集成）
- **Skills 服务**（5 个诊断技能：磁盘满 / OOM / 网络 / 权限 / 服务故障）
- **教程 Embedding 异步回填**（v2.5 架构）
- **混合搜索**（vector + keyword）
- **问题反馈**（飞书问卷链接）

### Changed
- IPC 4 步同步铁律严格执行
- 设计稿 1:1 复刻（14 文件视觉修复）
- 字典 v1.1.0 → v1.2.0 升级（13340 行变更）
- 移除 v0.x 根目录散落文档，统一归档到 `docs/archive/`

### Fixed
- `CotTraceAnalysis` 接口缺 `trajectory` 字段（v1.0 修复）
- `ChatPanel` 透传 `latestCotEntropyTrajectory` 缺失
- `translator.test.ts` 字典短语断言与 v1.2.0 不一致
- 6 项视觉修复（教程排版 / 决策间距 / 时间选择器 / 服务器列表 / 弹窗可读性）

### Security
- 敏感文件 redact（.env / .ssh / *_key 发送前自动脱敏）
- IPC 三原则强制（contextIsolation / nodeIntegration: false / sandbox: true）
- 所有网络请求 UI 可见（防静默上传）

## [0.9.6] - 2026-07-20 (Pre-release)

### Added
- CoT-shape 熵轨迹分析器（src/shared/cot-trace-analyzer.ts）
- Credibility 6 源证据权重可视化
- Langfuse 追踪 3 主干路径

### Changed
- 整体重构为 Skill + Service 架构

## [0.5.0] - 2026-06-15 (Pre-release)

### Added
- AI 对话面板 + 流式输出
- 基础 SSH 连接 + 终端
- 高危命令拦截 v1（5 条规则）

## [0.2.0] - 2026-05-01 (Pre-release)

### Added
- Electron + React + TypeScript 基础架构
- 主进程 / 渲染进程 IPC 通信
- ssh2 + xterm.js 集成

---

## 版本说明

- **Major version (X.0.0)**：架构级变化（如 v1.0 = 比赛首发，v2.0 = 嵌入 IDE）
- **Minor version (0.X.0)**：功能新增（每 2 周一个 minor）
- **Patch version (0.0.X)**：Bug 修复（按需发布）

## 链接

- [GitHub Releases](https://github.com/harryopo/tdsf-linux-desktop/releases)
- [ROADMAP.md](ROADMAP.md) - 未来版本规划
- [SECURITY.md](SECURITY.md) - 安全披露
- [CONTRIBUTING.md](CONTRIBUTING.md) - 贡献指南
