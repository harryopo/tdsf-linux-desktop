# TDSF-Linux Desktop · 项目最新总结报告

> **生成时间**：2026-07-25 Asia/Shanghai（v2.2 二次实测核查更新）
> **比赛截止**：2026-07-30（剩 5 天）
> **战略定位**：做大做精 · 不降级 · 不卡死阈值 · 保留所有技术亮点
> **本文件**：项目最新状态总结，覆盖技术栈、完成度、约束、问题、解决方案、5 天作战计划

---

## 0. 一句话总结

**TDSF-Linux Desktop 是一个 SSH 终端 + AI 辅助 + 高危命令拦截 + 日志分析 + 可信决策的 Electron 桌面应用，后端完成度 95%+ / 211 个 IPC handler / 1282 测试全过，比赛剩 5 天，需接入前端 P0 项 + 启用治理工具。**

> ⚠️ **v2.2 二次实测核查重要修正**（2026-07-25）：
> - P0-2 范围从 v2.1 的"仅校准 6 方法"修正为"**校准 6 方法（双位置缺失）+ backfill 4 方法（renderer 层缺失）= 10 个方法**"
> - v2.1 中"backfill 4 方法已声明"是**失实描述**：实际仅 preload 声明 ✅，renderer 层缺失 ❌
> - P0-1 依赖 P0-2：必须先补齐 backfill 4 方法 renderer 类型声明才能调用
> - P0 执行顺序修正：**P0-2 → P0-1 → P0-4 → P0-3**（不再是 P0-1 → P0-2）
> - preload/index.ts 实测 3388 行（非 3283）
> - 真正的 ElectronAPI 类型声明双声明位置：`src/preload/index.ts:3212-3682` + `src/renderer/src/types/electron.d.ts`（1911 行）
> - P0 总工作量从 ~6.5h 上调为 ~7h（P0-2 从 ~30min 扩展为 ~1h）

---

## 1. 项目定位

```
TDSF-Linux Desktop
= SSH 终端 + AI 辅助 + 高危命令拦截 + 日志分析 + 可信决策
= 帮助 Linux 初学者不怕命令行的桌面工具
```

**核心功能**：
- SSH 远程连接 + xterm 终端 + SFTP 文件管理
- AI 多模型问答（DeepSeek + Claude + 火山方舟 + OpenAI + Google）
- 高危命令拦截（12 条黑名单正则）
- 日志分析（Drain3 模板提取）
- 可信决策（D-S 证据理论 + PCR5 + ECE 校准）
- Task Protocol 14 步（PAOR 自动循环 + 三态审批）
- MCP 工具集（25 个工具 / 6 域覆盖）

---

## 2. 技术栈（实际版本）

| 类别 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 桌面框架 | Electron | 43.1.1 | 已升级（不是文档说的 30） |
| 构建 | electron-vite | 2.3.0 | 建议升 4.x |
| 打包 | electron-builder | 24.13.0 | 建议升 25.x |
| 前端框架 | React | 18.3.0 | |
| 类型系统 | TypeScript | 5.4.0 | strict 模式 |
| UI 库 | Antd | 5.20.0 | + Radix UI 部分组件 |
| CSS | Tailwind | 4.3.3 | + PostCSS |
| 状态管理 | Zustand | 4.5.0 | 建议升 5.x |
| SSH | ssh2 | 1.15.0 | |
| 终端 | @xterm/xterm | 5.5.0 | + addon-fit/search/web-links |
| AI SDK | ai (Vercel AI SDK) | 7.0.29 | 多模型路由 |
| AI SDK | @ai-sdk/anthropic | 2.0.86 | Claude |
| AI SDK | @ai-sdk/openai | 2.0.112 | GPT |
| AI SDK | @ai-sdk/google | 2.0.81 | Gemini（保留，不删） |
| Claude SDK | @anthropic-ai/claude-agent-sdk | 0.3.211 | 扩展思考（保留，不删） |
| Agent 框架 | @mastra/core | 1.51.0 | Agent 编排 |
| MCP | @modelcontextprotocol/sdk | 1.0.4 | |
| 数据库 | better-sqlite3 | 13.0.1 | 同步事务 |
| 向量库 | @photostructure/sqlite-vec | 1.2.0 | 向量检索 |
| 编辑器 | monaco-editor | 0.56.0 | + @monaco-editor/react |
| 语法 | web-tree-sitter | 0.26.11 | + tree-sitter-bash |
| 3D | three | 0.185.1 | Credibility DAG（保留，不删） |
| 流程图 | reactflow | 11.11.4 | Task Protocol 14 步可视化（保留，不删） |
| 安全 | dompurify | 3.4.12 | XSS 防护 |
| 验证 | zod | 3.25.76 | |
| 测试 | vitest | 2.0.0 | |
| 测试 | @playwright/test | 1.61.1 | 已装未用，立即启用 |
| 测试 | @testing-library/react | 16.3.2 | |
| Linter | eslint | 9.6.0 | + typescript-eslint 7.15 |
| Python | 3.11+ | | 仅 sidecar-a |

**依赖总数**：92 个（保留全部，不删任何依赖）

---

## 3. 模块完成度

### 3.1 后端（来源：AGENTS.md v10.0）

| 模块 | 代码量 | 完成度 | 说明 |
|------|--------|--------|------|
| Task Protocol（14步） | ~1,920 行 | 95% | 全部真实逻辑，借鉴 Kilo Code |
| MCP 工具（25个） | ~1,500 行 | 90% | 6 域覆盖，SSH 域最完整 |
| Credibility（D-S+PCR5） | ~2,000 行 | 90% | 代码完整但生产降级为简单规则 |
| Langfuse 追踪 | ~600 行 | 95% | 3 主干路径集成，无 Key 自动降级 |
| Supervisor（PAOR） | ~1,146 行 | 95% | 流式 + 审批 + 循环编排 |
| Claude SDK 集成 | ~1,000 行 | 90% | 双重包装 + 动态 import |
| 前端 AI UI | ~5,000 行 | 85% | 25+ 组件，CoT 可视化待实现 |
| IPC 暴露 | ~3,000 行 | 90% | 55+ 通道，90% 符合 4 步规范 |
| **合计** | **~16,000 行** | **90%+** | **核心逻辑完整可用** |

### 3.2 前端（来源：HANDOVER.md）

| 维度 | 数值 | 状态 |
|------|------|------|
| 前端调用 electronAPI 总次数 | 231 | — |
| 涉及方法数（去重） | ~115 | — |
| preload 暴露 API 总数 | ~231 | — |
| **孤儿 API（preload 暴露但前端未调用）** | **~75** | ⚠️ |
| **后端就绪但前端未接入** | **~50** | ⚠️ |
| 前端占位代码 | 8 处 | 多为 mock-data fallback，可保留 |
| 严重 BUG | 0（P0-1 已被前端 AI 修复） | ✅ |

### 3.3 编译门禁

| 门禁 | 类型 | 状态 |
|------|------|------|
| `pnpm typecheck:node` | 三绿硬 | ✅ exit 0 |
| `pnpm typecheck:web` | 三绿硬 | ✅ exit 0 |
| `pnpm lint` | 三绿硬 | ✅ exit 0（1 warning 非阻塞） |
| `pnpm test` | 两绿软 | ✅ 1282/1282 通过 |
| `pnpm build:win` | 两绿软 | ⏳ 未执行（建议在 windows-latest CI 跑） |

---

## 4. 6 条核心红线（不可绕过）

| # | 红线 | 官方依据 |
|---|------|---------|
| 1 | IPC 4 步同步（main → ipc/index → preload → electron.d.ts） | Electron 官方安全 |
| 2 | catch 脱敏（`redactSensitiveInfo()`） | 安全底线 |
| 3 | 高危命令黑名单（12 条正则） | 业务核心 |
| 4 | Electron 安全三原则（contextIsolation/sandbox/nodeIntegration） | Electron 官方 |
| 5 | DOMPurify XSS 防护 | Electron 官方 |
| 6 | **做事与打分分离**（声明完成前必 dispatch verifier subagent） | Anthropic L4 + arXiv:2310.01798 |

---

## 5. 治理工具（必装必用）

### 5.1 已配置

| 工具 | 用途 | 配置位置 | 状态 |
|------|------|---------|------|
| Stop Hook | 确定性门禁（不依赖模型遵守） | `.claude/settings.json` | ⏳ 待配置 |
| PreEdit Hook | 防止误删关键文件 | `scripts/hooks/pre-edit-check.cjs` | ⏳ 待创建 |
| Knip | 死代码扫描 | `knip.json` | ⏳ 待安装 |
| @playwright/test | E2E + 视觉对比 | `playwright.config.ts` | ✅ 已装未用 |
| GitHub Actions CI | windows-latest 跑 build:win | `.github/workflows/ci.yml` | ⏳ 待配置 |

### 5.2 立即安装命令

```bash
cd tdsf-linux-desktop
pnpm add -D knip
pnpm add electron-log
# @playwright/test 已装 1.61.1
```

### 5.3 Verifier Subagent 调用模板

每次声明"任务完成"前必须 dispatch 独立 verifier subagent：

```text
Task tool:
  subagent_type: general_purpose_task
  description: "Verify <task-name>"
  query: |
    你是独立 verifier subagent，任务是验证 <task-name> 是否真正完成。
    
    必须执行的检查：
    1. 跑三绿硬门禁，贴实际输出：
       pnpm typecheck:node 2>&1 | tail -20
       pnpm typecheck:web 2>&1 | tail -20
       pnpm lint 2>&1 | tail -20
    
    2. 跑死代码扫描：
       npx knip --no-exit-code 2>&1 | tail -30
    
    3. 验证功能完整性（grep 关键函数 + Read 实现代码）
    4. 检查 IPC 4 步是否完整
    5. 检查"降级保留"原则（代码+接口+类型都在）
    6. 输出验证报告（贴实际命令输出，不要总结）
    
    严格规则：
    - 你不是 implementer，不要修改任何代码
    - 不要相信 implementer 的总结，只相信实际命令输出
    - 报告必须包含实际命令输出
```

---

## 6. P0 任务清单（剩 5 天）

### P0-1：接入 v2.5 异步 backfill 4 通道（~2h，**依赖 P0-2 完成**）

> ⚠️ **v2.2 修正**：v2.1 中"backfill 4 方法已声明"是**失实描述**。实际：
> - preload 已声明（`src/preload/index.ts:3387-3394`）✅
> - renderer 层类型声明缺失（`src/renderer/src/types/electron.d.ts`）❌
> - 因此 P0-1 依赖 P0-2：必须先在 renderer 层补齐 4 个方法类型签名才能调用

**问题**：`useHybridSearch.ts:335` 仍用旧版同步 `tutorialBackfillEmbeddings`，2578 条教程首次回填阻塞 UI 1-3 分钟。

**实施**：
1. `tutorialBackfillStart({ pageSize: 100, inferenceBatch: 8 })` 替换 `tutorialBackfillEmbeddings()`
2. 订阅 `onTutorialBackfillProgress(cb)`，写入 progress state
3. `TutorialPage` 加"取消回填"按钮调用 `tutorialBackfillCancel()`
4. 页面挂载调用 `tutorialBackfillStatus()` 恢复 UI 状态

**验证**：UI 不阻塞 + 进度条平滑 + 取消可中断 + 刷新恢复 + 写 E2E

### P0-2：补齐 10 个方法的类型声明（~1h，校准 6 + backfill 4，**v2.2 二次实测修正**）

> ⚠️ **v2.2 关键修正**：v2.1 中"backfill 4 方法已声明"是**失实描述**。二次实测核查（2026-07-25）发现：
> - **校准 6 方法**：❌ **双位置缺失**（preload/index.ts:3212-3682 的 ElectronAPI 中无 + renderer/src/types/electron.d.ts 中也无）
> - **backfill 4 方法**：⚠️ **renderer 层缺失**（preload/index.ts:3387-3394 已声明 ✅，但 renderer/src/types/electron.d.ts 中未声明 ❌）
> - PAOR 3 方法 / `exportModelStats` 已在 renderer 层声明 ✅（无需补）

**问题**：v2.0 描述"跨 8 域约 25 个方法未声明类型"是失实的。v2.1 修正为"仅校准 6 方法"也仍不准确。v2.2 二次实测确认**真实缺失 10 个方法**：

**A. 校准 6 方法（双位置同步缺失，需补两处）**：
- `credibilityCalibrate` / `credibilityGetCalibration` / `credibilityGetCalibrationState` / `credibilityResetCalibration` / `credibilityComputeEce` / `credibilityAddCalibrationSample`
- preload 实际绑定在 `src/preload/index.ts:2486-2491`（credibility.calibrate 等），但 ElectronAPI 类型声明中无
- 类型定义位于 `src/main/core/agent/credibility/calibration/types.ts`

**B. backfill 4 方法（仅 renderer 层缺失，需补一处）**：
- `tutorialBackfillStart` / `tutorialBackfillCancel` / `tutorialBackfillStatus` / `onTutorialBackfillProgress`
- preload 已声明于 `src/preload/index.ts:3387-3394` ✅，仅 renderer 层缺

**实施位置**：
1. **A 部分**：`src/preload/index.ts:3212` 的 `ElectronAPI` 类型声明 + `src/renderer/src/types/electron.d.ts` 双位置同步追加校准 6 方法签名
2. **B 部分**：仅 `src/renderer/src/types/electron.d.ts` 追加 backfill 4 方法签名（参照 preload/index.ts:3387-3394）

**实测验证命令**：
```bash
# 校准 6 方法 - renderer 层缺失（应输出空）
grep -n "credibilityCalibrate\|credibilityComputeEce" src/renderer/src/types/electron.d.ts

# backfill 4 方法 - renderer 层缺失（应输出空，v2.1 误判为已声明）
grep -n "tutorialBackfillStart\|onTutorialBackfillProgress" src/renderer/src/types/electron.d.ts
```

**验证**：`pnpm typecheck:web` exit 0，调用 `window.electronAPI.credibilityComputeEce('deepseek', 10)` 和 `window.electronAPI.tutorialBackfillStart({ pageSize: 100 })` 不报类型错误

### P0-3：接入 PAOR 启动入口（~1h，独立任务无依赖）

**问题**：审批响应链已通，但 `agentPaor` 启动入口缺失。

> ✅ 类型声明已存在（`src/renderer/src/types/electron.d.ts:835/842/1457`），无需补

**实施**：
1. `AIPanel.tsx` 增加"PAOR 自动循环"按钮
2. 调用 `agentPaor(task, sshSessionId, maxIterations?)`（位置参数，**非对象参数**）
3. 订阅 `onPaorApprovalRequest(cb)` 弹出 `PaorApprovalCard`
4. 用户批准/拒绝后调用 `paorApprove(callId, approved)`（位置参数）

**验证**：触发 PAOR 后遇高危命令弹窗，批准继续，拒绝停止

### P0-4：新建 CalibrationSettings 组件（~3h，**依赖 P0-2 完成**）

**问题**：`CalibrationSettings.tsx` 不存在，SettingsLayout 缺"校准"项。
**依赖**：必须先完成 P0-2 校准 6 方法类型声明，否则调用 `credibilityComputeEce` 会报类型错误。

**实施**：
1. 新建 `src/renderer/src/pages/CalibrationSettings.tsx`
2. `SettingsLayout.tsx` 添加"校准"导航项
3. UI：校准状态卡片 + 触发校准按钮 + ECE 值显示 + 重置按钮 + 校准样本列表
4. 调用 `credibilityComputeEce('deepseek', 10)` 测试

**验证**：进入设置页"校准"项，能触发校准并看到 ECE 值

---

## 7. 5 天作战计划

### Day 1（2026-07-25）：基础设施 + 治理工具

| 时段 | 任务 | 验收 |
|------|------|------|
| 上午 | 用终稿 §1 简化 CLAUDE.md 替换 [CLAUDE.md](CLAUDE.md) | 行数 ≤ 150 |
| 上午 | 用终稿 §2 调整 CODING.md（4 调整 + 6 新增 + 4 删除） | 改动可追溯 |
| 上午 | 安装 knip + electron-log | `pnpm add -D knip && pnpm add electron-log` |
| 下午 | 配置 Stop Hook + PreEdit Hook 脚本 | 实测拦截受保护文件 |
| 下午 | 配置 Knip + 跑第一次 `pnpm deadcode` | 死代码清单 |
| 下午 | 配置 Playwright + 写第一个 E2E 测试 | `pnpm test:e2e` 跑通 |
| 晚上 | 配置 GitHub Actions CI | push 后 CI 自动跑 |
| 晚上 | 跑三绿门禁确认基线 | typecheck + lint 全过 |
| 晚上 | dispatch 第一次 verifier subagent | 验证报告产出 |

### Day 2（2026-07-26）：Demo 9 步主路径 + P0 任务

> ⚠️ **v2.2 执行顺序修正**：P0-1 → P0-2 改为 **P0-2 → P0-1 → P0-4 → P0-3**
> - P0-1 调用 backfill 4 方法，但 renderer 层缺类型声明，会触发 TS 错误
> - 必须先做 P0-2（补齐 10 个方法类型声明），再做 P0-1

| 时段 | 任务 | 验收 |
|------|------|------|
| 上午 | **P0-2**：补齐 10 个方法类型声明（校准 6 + backfill 4，~1h，**前置依赖**） | `typecheck:web` exit 0 |
| 上午 | P0-1：接入 v2.5 异步 backfill 4 通道（依赖 P0-2 完成） | UI 不阻塞 + E2E |
| 下午 | P0-4：新建 CalibrationSettings 组件（依赖 P0-2 校准 6 方法） | 设置页有"校准"项 |
| 下午 | P0-3：接入 PAOR 启动入口（独立任务，无依赖） | 触发 PAOR 弹窗 |
| 晚上 | dispatch verifier subagent 验证 P0-1/2/3/4 | 报告产出 |

### Day 3（2026-07-27）：打包 + 演示材料

| 时段 | 任务 | 验收 |
|------|------|------|
| 上午 | 在 windows-latest CI 上跑 build:win | 生成 .exe artifact |
| 上午 | 本地双击安装测试 | 另一台电脑能装能用 |
| 下午 | 制作 PPT 演示脚本（6 段每段 50 秒） | 脚本完整 |
| 下午 | 演示彩排走通 Demo 9 步主路径 | 流畅无卡顿 |
| 晚上 | dispatch verifier subagent 验证打包 | 报告产出 |

### Day 4（2026-07-28）：Bug 修复 + 质量加固

| 时段 | 任务 | 验收 |
|------|------|------|
| 上午 | 修复 P1 严重问题（IPC 字面量、类型不符） | 三绿门禁仍过 |
| 上午 | 修复死占位 UI（EditorArea / StatusBar / LogsPage） | 实际行为验证 |
| 下午 | 跑 `pnpm deadcode` 清理死代码 | 死代码 < 10 个 |
| 下午 | 跑 `pnpm test:e2e` 回归 | 全过 |
| 晚上 | dispatch verifier subagent 验证 | 报告产出 |

### Day 5（2026-07-29）：冻结 + 演示彩排

| 时段 | 任务 | 验收 |
|------|------|------|
| 上午 | 全量回归测试（typecheck + lint + test + e2e + build:win） | 五绿全过 |
| 上午 | 最终打包 | .exe 生成 |
| 下午 | 演示彩排（按 PPT 脚本走一遍） | 流畅无卡顿 |
| 下午 | 冻结代码（不再合并新 PR） | git tag v1.0 |
| 晚上 | dispatch 最终 verifier subagent | 完整验证报告 |

### Day 6（2026-07-30）：比赛日

| 时段 | 任务 |
|------|------|
| 上午 | 仅修紧急 Bug |
| 下午 | 演示 |

---

## 8. 已识别的 12 类问题与对策

| # | 问题 | 对策 | 状态 |
|---|------|------|------|
| 1 | 多 AI 并行冲突 | 强制单 AI 模式 + git worktree 隔离 | ✅ 已识别 |
| 2 | 文档膨胀（1150 行） | 简化 CLAUDE.md ≤ 150 行 | ⏳ 待执行 |
| 3 | 循环工程自噬 | Demo 阶段暂停文档同步 | ✅ 已识别 |
| 4 | 死占位 UI | Playwright E2E 检测 | ⏳ 待执行 |
| 5 | 超长文件（preload 3388 行） | 大文件治理（>1500 行必拆） | ⏳ Demo 后 |
| 6 | IPC 字面量 | electron-trpc（P1 引入） | ⏳ Demo 后 |
| 7 | 类型声明与实现不符 | P0-2 补齐 10 个方法类型（校准 6 + backfill 4） | ⏳ 待执行 |
| 8 | 学术算法堆叠 | 保留全部（做大方向） | ✅ 已决策 |
| 9 | 安装包 600-800MB | 不卡死（功能优先） | ✅ 已决策 |
| 10 | Sidecar 进程过多 | 保留全部 | ✅ 已决策 |
| 11 | 依赖膨胀（92 个） | 保留全部技术亮点 | ✅ 已决策 |
| 12 | 归档失控（6766 行） | 已有 archive/README.md 索引 | ✅ 已治理 |

---

## 9. 关键决策（做大版本）

### 9.1 保留全部技术亮点

| 依赖/功能 | 保留理由 |
|----------|---------|
| `@anthropic-ai/claude-agent-sdk` | 扩展思考分析高危命令，技术亮点 |
| `@ai-sdk/google` | 多模型路由，展示 BYOK 能力 |
| `@xenova/transformers` | 浏览器端 ML，技术深度 |
| `three` + `@types/three` | 3D 可视化（Credibility DAG） |
| `reactflow` | 流程图（Task Protocol 14 步可视化） |
| `@mastra/core` | Agent 编排框架，与 Vercel AI SDK 互补 |
| `turndown` + `cheerio` | HTML 处理双方案 |
| `tree-sitter-bash` + `web-tree-sitter` | 终端语法高亮 |

### 9.2 治理工具与做大不冲突

| 治理工具 | 作用 | 与做大的关系 |
|---------|------|------------|
| Stop Hook | 确定性门禁 | 让做大可持续 |
| Verifier Subagent | 做事与打分分离 | 防止自检假阳性 |
| Knip | 死代码扫描 | 让代码库健康 |
| Playwright E2E | UI 改动有客观证据 | 防止死占位 UI |
| GitHub Actions CI | build:win 必跑 | 防止门禁名存实亡 |

### 9.3 不卡死阈值

| 维度 | 阈值 | 说明 |
|------|------|------|
| CLAUDE.md 行数 | ≤ 150 行 | Anthropic 建议 ≤ 100，做大放宽到 150 |
| 单文件行数 | > 1500 必拆 | 不卡死 800/1000 |
| 依赖数量 | 不限制 | 保留全部技术亮点 |
| 安装包体积 | 不限制 | 功能优先 |
| Stop Hook 数量 | ≥ 1 | 必装 |
| Verifier subagent | 每次声明完成前 | 必装 |

---

## 10. 文档索引

> 完整索引见 [docs/INDEX.md](docs/INDEX.md)

### 10.1 必读文档（5 份）

1. [docs/INDEX.md](docs/INDEX.md) — 项目文档总索引
2. [docs/handoff/AI_HANDOVER_PROMPT.md](docs/handoff/AI_HANDOVER_PROMPT.md) v2.0 — 接手 AI 第一条消息
3. [docs/handoff/HANDOVER.md](docs/handoff/HANDOVER.md) — 统一入口
4. [../TDSF高质量做大方案-终稿.md](../TDSF高质量做大方案-终稿.md) — 核心交付物
5. [../官方建议与项目实际对比分析.md](../官方建议与项目实际对比分析.md) — 35 项 Gap 分析

### 10.2 项目规范（4 份）

1. [CLAUDE.md](CLAUDE.md) — 子项目入口（建议替换为终稿 §1）
2. [CODING.md](CODING.md) — 编码规范（建议按终稿 §2 调整）
3. [AGENTS.md](AGENTS.md) — Agent 工作指南 v10.0
4. [docs/技术栈教程注意事项-v1.0.md](docs/技术栈教程注意事项-v1.0.md) — 技术栈教程

### 10.3 交接文档（10 份）

详见 [docs/handoff/README.md](docs/handoff/README.md)

### 10.4 最新调研报告（6 份）

详见 [docs/INDEX.md §4](docs/INDEX.md)

---

## 11. 行动清单

### P0（今天 2026-07-25 必须完成）

- [ ] 用终稿 §1 的 CLAUDE.md 模板替换 [CLAUDE.md](CLAUDE.md)
- [ ] 用终稿 §2 的调整方案修改 [CODING.md](CODING.md)
- [ ] 删除 [AGENTS.md](AGENTS.md) 中的 22 条硬约束（保留 §1 已涵盖的）
- [ ] `cd tdsf-linux-desktop && pnpm add -D knip && pnpm add electron-log`
- [ ] 创建 `.claude/settings.json`（终稿 §3.2）
- [ ] 创建 `scripts/hooks/pre-edit-check.cjs`（终稿 §3.3）
- [ ] 创建 `knip.json`（终稿 §6.2）
- [ ] 创建 `playwright.config.ts`（终稿 §5.1）
- [ ] 创建 `tests/e2e/demo-9-steps.spec.ts`（终稿 §5.2）
- [ ] 创建 `../.github/workflows/ci.yml`（终稿 §8.1）
- [ ] 追加 package.json 脚本（deadcode / test:e2e:ui / test:e2e:visual）
- [ ] 跑 `pnpm typecheck:node && pnpm typecheck:web && pnpm lint` 确认三绿基线
- [ ] 跑 `pnpm deadcode` 生成死代码基线清单
- [ ] 跑 `pnpm test:e2e` 确认 Playwright 配置正确
- [ ] dispatch 第一次 verifier subagent，验证基线

### P1（明天 2026-07-26）

- [ ] **P0-2：补齐 10 个方法类型声明（校准 6 + backfill 4，~1h，前置依赖）**
- [ ] P0-1：接入 v2.5 异步 backfill 4 通道（依赖 P0-2 完成）
- [ ] P0-3：接入 PAOR 启动入口（独立任务，无依赖）
- [ ] P0-4：新建 CalibrationSettings 组件（依赖 P0-2 校准 6 方法）
- [ ] dispatch verifier subagent 验证

### P2（后天 2026-07-27）

- [ ] P0-4：新建 CalibrationSettings 组件
- [ ] 在 windows-latest CI 上跑 build:win
- [ ] 制作 PPT 演示脚本

### P3（2026-07-28~29）

- [ ] 修复死占位 UI
- [ ] 全量回归测试
- [ ] 最终打包 + 演示彩排

---

## 12. 核心理念

### 12.1 三句话

1. **做大不等于做散** — 保留所有技术亮点，但要引入治理工具
2. **质量不等于卡死** — 6 条硬红线不退让，行数/体积等指标卡的是"治理建议"
3. **治理工具与做大不冲突** — Stop Hook + Verifier + Playwright + Knip + CI 让做大可持续

### 12.2 与上版方案的关键差异

| 维度 | 上版方案 | 本方案（终稿） |
|------|---------|--------------|
| 战略 | 救援 + 简化 | **做大 + 治理** |
| 删依赖 | 7 个 | **0 个** |
| 删功能 | 砍 EU AI Act / three / Claude SDK | **0 个** |
| CLAUDE.md | ≤ 50 行 | **≤ 150 行** |
| 安装包体积 | ≤ 250MB | **不卡死** |
| 治理工具 | 全装 | **全装**（一致） |

### 12.3 给团队的承诺

- 不删任何技术亮点
- 不降级任何功能
- 不卡死任何阈值
- 但必装治理工具（Stop Hook / Verifier / Playwright / Knip / CI）
- 6 条硬红线不退让
- 4 条伪约束必删除
- 6 条新约束必新增

---

*报告完成于 2026-07-25 Asia/Shanghai*
*核心理念：做大做精，治理保障，质量绝对优先。*
*下次更新：每次重大节点（P0 完成 / 打包完成 / 比赛日前）*
