# 变更日志

> 本文件记录 TDSF Linux Desktop 所有版本的显著变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范。
> 版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [v2.5] - 2026-07-24 — 循环工程（Loop Engineering）

> 后端完善循环工程，聚焦 4 个 Phase：P1-8 回滚命令动态生成、Phase C 异步 embedding 回填、Phase D 代码清理、Phase E 归档交接。

### 新增（Added）

#### P1-8：回滚命令动态生成（[rollback-generator.ts](src/main/services/security/rollback-generator.ts)）

- **18 条 Linux 常见操作的回滚规则**：覆盖 git / chmod / chown / mv / cp / ln / export / source / systemctl / usermod / groupadd / iptables / firewall-cmd / sysctl / 文件覆盖写入 / apt install / pip install / docker run 等
- **5 类不可逆命令黑名单**：`rm -rf` / `mkfs` / `dd if=` / `shutdown` / 直接写块设备，匹配后返回 `undefined` 拒绝执行
- **路径解析器**：从命令中提取文件路径并生成 `.bak` 备份恢复命令
- **38 个测试用例**：[tests/services/security/rollback-generator.test.ts](tests/services/security/rollback-generator.test.ts) 覆盖全部规则 + 边界场景 + 不可逆命令
- **sandbox-approval.ts 集成**：[src/main/ipc/sandbox-approval.ts](src/main/ipc/sandbox-approval.ts) 的 `deriveRollbackCommand` 委托给 `generateRollbackCommand`，替换原硬编码 `xxx.bak` 占位

#### Phase C：异步 Embedding 回填服务（[backfill-service.ts](src/main/services/tutorial/backfill-service.ts)）

- **`EmbeddingBackfillService` 单例**：分页查询 + 事务外推理 + 事务内写入 + 进度推送 + 取消机制 + 断点续传
- **4 个新 IPC 通道**：
  - `tutorial:backfill-start` — 启动异步回填，立即返回 `taskId`
  - `tutorial:backfill-cancel` — 标记取消，下页检查后退出
  - `tutorial:backfill-status` — 查询当前状态
  - `tutorial:backfill-progress` — push 推送进度（每页完成后触发）
- **IPC 4 步同步全完成**：通道常量 → `ipcMain.handle` → preload 暴露 → `ElectronAPI` 类型声明
- **6 个新共享类型**：`BackfillStatus` / `BackfillProgress` / `BackfillStartOptions` / `BackfillStartResult` / `BackfillCancelResult` / `BackfillStatusResult`
- **22 个测试用例**：[tests/services/tutorial/backfill-service.test.ts](tests/services/tutorial/backfill-service.test.ts) 覆盖单例守卫、并发启动、取消、错误隔离、进度推送、ETA 估算
- **替代旧通道**：`tutorial:backfill-embeddings`（同步阻塞 UI 1-3 分钟），新通道为推荐用法，旧通道保留兼容

### 变更（Changed）

#### Phase D1：hybrid-search 测试迁移

- **52 行注释测试代码 → 18 个 vitest 用例**：[tests/services/tutorial/hybrid-search.test.ts](tests/services/tutorial/hybrid-search.test.ts)
- 覆盖纯 FTS 检索、纯向量检索、RRF 融合、FTS 查询转义、空结果降级等场景
- 原 [hybrid-search.ts](src/main/services/tutorial/hybrid-search.ts) 注释代码已清理，留下迁移说明

#### Phase D2：path-recommender 注释逻辑清理

- 移除 [path-recommender.ts](src/main/services/tutorial/path-recommender.ts) 中"跳过比当前水平低的分类"的注释代码
- 保留更精细的难度过滤逻辑（filter），避免粗暴跳过低难度分类剥夺用户复习机会

#### Phase D3：8 个文件 `xxx` 占位替换为具体示例

- [logger.ts](src/main/services/log/logger.ts)：`sessionId: 'xxx'` → `'sess_abc123'`
- [registry.ts](src/main/services/llm/tools/registry.ts)：`'xxx.ts'` → `'my-tool.ts'`
- [redact.ts](src/main/core/agent/providers/redact.ts)：`'sk-xxx'` → `'sk-ant-api03-xxx'`
- [dispatcher.ts](src/main/core/agent/subagents/dispatcher.ts)：`'sess_xxx'` → `'sess_abc123'`
- [openhands-runner.ts](src/main/services/sandbox/openhands-runner.ts)：`'xxx.yml'` → `'sandbox.yml'`
- [ask-prompt.ts](src/main/core/agent/modes/ask-prompt.ts)：`'[KB:xxx]'` → `'[KB:disk-full]'`
- [mode-registry.ts](src/main/core/agent/modes/mode-registry.ts)：`'[LOG:xxx]'` → `'[LOG:auth]'`
- [plan-prompt.ts](src/main/core/agent/modes/plan-prompt.ts)：`'1. xxx'` → `'1. 检查磁盘空间'`

### 文档（Documentation）

#### 归档与交接

- **新建归档目录**：[docs/archive/v2.5-loop-engineering-archive/](docs/archive/v2.5-loop-engineering-archive/)
  - `tasks.md` — 任务清单 + 关键交付物 + Hard Constraint 对齐
  - `verify-report.md` — 构建检查 + IPC 4 步同步验证 + 回归测试 + 风险评估
  - `learnings.md` — 技术决策 + 流程学习 + 踩坑记录 + 可复用资产
- **方案书**：[docs/v2.5-loop-engineering-plan.md](docs/v2.5-loop-engineering-plan.md) 状态总览同步更新
- **IPC 契约文档**：[docs/handoff/ipc-contract.md](docs/handoff/ipc-contract.md) 新增 4 个 backfill 通道 + 附录 C v2.5 完成度速查
- **前后端边界文档**：[docs/handoff/frontend-backend-boundary.md](docs/handoff/frontend-backend-boundary.md) 新增第 7 节 v2.5 新增能力清单
- **数据流文档**：[docs/handoff/data-flow.md](docs/handoff/data-flow.md) 新增第 7 节 Embedding 异步回填流（时序图 + 11 子节）

---

## [v2.4] - 2026-07-24 — 后端完善 Phase A/B/C

> 后端三大 Phase 落地：工具调用统计、预算告警、校准模块恢复。

### 新增（Added）

#### Phase A：工具调用统计

- **`tool_call_log` 表**：记录每次工具调用的工具名 + 时间戳
- **`recordToolCall(db, toolName)` 函数**：[src/main/ipc/model-stats.ts](src/main/ipc/model-stats.ts)
- **`model:toolCalls` IPC 通道**：返回 `ToolCallStat[]`（按 count 降序 + percent 计算）
- **`ssh:exec` 接入**：[src/main/ipc/ssh.ts](src/main/ipc/ssh.ts) 第 273-277 行调用 `recordToolCall('终端命令执行')`
- **`kb:search` 接入**：执行后调用 `recordToolCall('知识库检索')`

#### Phase B：预算告警

- **`budget_alerts` 表**：记录告警级别（alert / error）+ 文本 + 时间戳
- **`budget-alerter.ts` 模块**：[src/main/services/llm/budget-alerter.ts](src/main/services/llm/budget-alerter.ts)
  - `alertLlmSlowResponse(method, durationMs)` — 响应 > 5000ms 触发 alert
  - `alertLlmFailure(method, error)` — 连续失败 ≥ 3 次触发 error
  - `alertLlmSuccess()` — 成功重置失败计数
  - `alertTokenBudgetExceeded(cost, threshold, dimension)` — 月成本超阈值触发 alert（当日去重）
- **`budget:alerts` IPC 通道**：返回最近 N 条告警（默认 20，上限 100）
- **`token:stats` 内嵌检查**：[src/main/ipc/agent-runtime.ts](src/main/ipc/agent-runtime.ts) handler 内检查月成本

#### Phase C：校准模块恢复

- **从 git 历史恢复**：[src/main/core/agent/credibility/calibration/](src/main/core/agent/credibility/calibration/)
  - `types.ts` — `EceResult` / `BucketStats` / `TemperatureScalingResult` / `ProviderCalibration` / `CalibrationState` / `CalibrationChannelMap`
  - `ece.ts` — ECE（Expected Calibration Error）+ MCE 计算
  - `temperature-scaling.ts` — T ∈ R+ 优化（NLL 最小化）
  - `calibration-tuner.ts` — Provider-aware 校准调优器（`getCalibrationTuner()` 单例）
- **FusionEngine 集成**：[fusion-engine.ts](src/main/core/agent/credibility/fusion-engine.ts) 的 `fuseAndAssess(massFunctions, options?)` 接受 `applyCalibration?: boolean` + `providerId?: string`，二者均提供时填充 `calibratedConfidence` 与 `eceReport`
- **D-S 证据理论完善**：Shafer Discounting 替代线性权重调整，用户可配置 6 源证据权重

#### Phase D：审计报告与 HTML 导出

- **EU AI Act / NIST AI RMF 合规报告**：`credibility:export-audit-report` / `credibility:list-audit-reports` / `credibility:load-audit-report` / `credibility:format-audit-report` / `credibility:export-decision-html` 5 个 IPC 通道
- **HTML 格式化器**：完整 HTML 模板 + 内联 CSS + XSS 防护（DOMPurify 包裹）
- **JSON / Markdown 格式化器**：三种格式互转

### 文档（Documentation）

- **IPC 契约文档**：[docs/handoff/ipc-contract.md](docs/handoff/ipc-contract.md) 全面更新
- **前后端边界文档**：[docs/handoff/frontend-backend-boundary.md](docs/handoff/frontend-backend-boundary.md) 全面更新
- **数据流文档**：[docs/handoff/data-flow.md](docs/handoff/data-flow.md) 6 条核心数据流
- **v2.4 完成度方案书**：[docs/v2.4-backend-completion-plan.md](docs/v2.4-backend-completion-plan.md) Phase A-D 状态追踪

---

## [v2.3] - 2026-07-22 — P3 审计 P0 红线修复

> 第五波 P3 审计中 9 个 P0 红线问题修复。

### 安全（Security）

- **ssh:exec zod 校验补齐**：新增 `sshExecSchema`（sessionId 非空 1-200 + command 非空 1-10000），`safeParse` 失败时 throw Error
- **dangerouslySetInnerHTML XSS 防护**：DOMPurify.sanitize 包裹
- **ssh.ts console.error 脱敏**：`redactSecrets` + `logger` 替代 console

### 重构（Refactored）

- **preload 87 处字面量常量化**：11 个新常量对象 + 12 个常量扩展 + 87 处字面量替换为常量引用
- **main.tsx 28 处硬编码颜色 token 化**：新建 [antd-tokens.ts](src/renderer/src/styles/antd-tokens.ts) 集中管理
- **AIPanel.tsx 拆分**：1921 → 274 行（84.9% 缩减），16 个新文件全部 ≤ 500 行
- **两套脱敏函数 DRY 合并**：`redactSensitiveInfo` 包装 `redactSecrets`

---

## [v2.0] - 2026-06 — UI 重设计 + 内联补全 + 文件监听

> 主导前端整体重设计对齐设计稿，新增内联补全、Diff 应用、远程文件监听。

### 新增（Added）

- **LLM 内联补全 + Diff**：`llm:inline-completion` / `llm:inline-completion:cancel` / `llm:apply-diff` / `llm:diff-preview` 4 个 IPC 通道
- **SFTP 搜索 + 内容 grep**：`sftp:search`（3 秒超时，最多 50 条）+ `sftp:grep`（3 秒超时，最多 100 条）
- **远程文件监听**：`file:watch:start` / `file:watch:stop` / `file:changed` 3 个 IPC 通道，inotifywait 优先 + 5s 轮询降级

---

[Unreleased]: https://github.com/your-repo/tdsf-linux-desktop/compare/v2.5...HEAD
[v2.5]: https://github.com/your-repo/tdsf-linux-desktop/compare/v2.4...v2.5
[v2.4]: https://github.com/your-repo/tdsf-linux-desktop/compare/v2.3...v2.4
[v2.3]: https://github.com/your-repo/tdsf-linux-desktop/compare/v2.0...v2.3
[v2.0]: https://github.com/your-repo/tdsf-linux-desktop/releases/tag/v2.0
