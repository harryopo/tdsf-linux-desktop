# 接手 AI 提示词（可直接复制粘贴）

> **更新时间**：2026-07-25 Asia/Shanghai
> **版本**：v2.2（基于二次实测核查修正 backfill 4 方法失实描述）
> **v2.2 变化**：
> - 修正 v2.1 中"backfill 4 方法已声明"的失实描述
> - 真实情况：backfill 4 方法**仅在 `src/preload/index.ts:3387-3394` 声明**，**`src/renderer/src/types/electron.d.ts` 中缺失**
> - 修正 P0-2 范围：从"仅校准 6 方法"扩展为"**校准 6 方法（双位置缺失）+ backfill 4 方法（renderer 层缺失）= 10 个方法**"
> - 修正 P0-1 依赖关系：P0-1 **依赖 P0-2** 完成（必须在 renderer 层补齐 backfill 4 方法类型声明才能调用）
> - 修正执行顺序：P0-2 → P0-1 → P0-4 → P0-3（不再是 P0-1 独立先行）
> - 修正 P0-2 工作量：从 ~30min 上调为 ~1h
> - 保留 v2.0/v2.1 所有治理工具与约束
>
> 复制下方 `---` 之间的内容发给接手 AI 即可。

---

## 项目背景

你是 TDSF Linux Desktop 项目的接手 AI。这是一个 Electron + React + TypeScript + Python Sidecar 的桌面应用，核心功能是 SSH 终端 + AI 辅助 + 高危命令拦截 + 日志分析 + 可信决策，用于 Linux 教学辅助。当前处于比赛交付冲刺阶段（截止 2026-07-30，剩 5 天）。

后端已由前一个 AI 完成开发（完成度 95%+，三绿硬门禁全过 + 1282 测试用例通过），前端正在由其他 AI 重构优化中（分支 `feat/design-migration`，HEAD `94b7cf1`）。你的任务是**接入后端已就绪但前端未接入的功能**，并补齐**校准 6 方法**的类型声明（这是真实缺失项）。

**战略定位**：做大做精，不降级，不卡死阈值，保留所有技术亮点。

## 工作目录

```
d:\ai\linux教学一体\tdsf-linux-desktop
```

## 起步流程（5 分钟）

```bash
cd d:/ai/linux教学一体/tdsf-linux-desktop

# 1. 拉最新代码
git fetch origin
git checkout feat/design-migration
git pull

# 2. 确认三绿硬门禁基线
pnpm typecheck:node && pnpm typecheck:web && pnpm lint

# 3. 跑死代码扫描（如已装 knip）
npx knip --no-exit-code

# 4. 按顺序读交接文档
# 必读 1：统一入口
cat docs/handoff/HANDOVER.md
# 必读 2：P0 项实测状态
cat docs/handoff/frontend-integration-verification.md
# 必读 3：IPC 4 步同步缺失项 + 类型声明修复清单
cat docs/handoff/ipc-4step-sync-audit.md
# 必读 4：完整 IPC 契约（按需查阅）
cat docs/handoff/ipc-contract.md

# 5. 查阅最新方案（如已落地）
cat ../TDSF高质量做大方案-终稿.md
```

## 当前项目状态

- **后端**：211 个 IPC handler 全部为真实业务逻辑，3 处占位实现不阻塞前端接入
- **三绿硬门禁**：✅ 全过（typecheck:node / typecheck:web / lint）
- **测试**：✅ 1282/1282 通过
- **build:win**：⏳ 未执行（发布前最后一步，建议在 windows-latest CI 跑）
- **前端重构**：分支 `feat/design-migration`（HEAD: `94b7cf1`），UI 视觉优化 + 死代码清理进行中
- **前端集成度**：231 次 electronAPI 调用，~115 个方法，~75 个孤儿 API，~50 个后端就绪但前端未接入
- **真实 Electron 版本**：43.1.1（package.json L108，**不是文档中说的 30**）
- **preload/index.ts 实际行数**：3388 行（大文件治理对象，建议拆分但非阻塞）
- **ElectronAPI 类型声明双声明位置**：
  - `src/preload/index.ts:3212-3682`（470 行，preload 自用 + 通过 index.d.ts re-export）
  - `src/renderer/src/types/electron.d.ts`（1911 行，**渲染层真正使用的类型声明**）

## 6 条核心红线（违反 = 不能合并）

1. **IPC 4 步同步**：main/ipc/handler → main/ipc/index.ts 注册 → preload 扁平暴露 → electron.d.ts 类型声明
2. **catch 脱敏**：error 写日志前必须 `redactSensitiveInfo()`，禁止泄漏 SSH 凭据/密钥
3. **高危命令黑名单**：SSH exec 必须经过 12 条高危命令拦截（rm -rf /、:(){:|:&};:、dd if=/dev/zero 等）
4. **Electron 安全三原则**：`contextIsolation:true` / `nodeIntegration:false` / `sandbox:true`（不可绕过）
5. **XSS 防护**：渲染层 `dangerouslySetInnerHTML` 必须 `DOMPurify.sanitize()`
6. **做事与打分分离**：声明"任务完成"前必须 dispatch 独立 verifier subagent，贴实际命令输出（不是总结）

> **官方依据**：红线 6 来自 Anthropic Claude Code Best Practices L4 + 论文 [arXiv:2310.01798](https://arxiv.org/abs/2310.01798) *"Large Language Models Cannot Self-Correct Reasoning Yet"*

## 三绿硬门禁（必须全过才能合并）

```bash
pnpm typecheck:node   # tsc --noEmit -p tsconfig.node.json
pnpm typecheck:web    # tsc --noEmit -p tsconfig.web.json
pnpm lint             # eslint src --ext .ts,.tsx（0 errors，warnings 允许）
```

## 两绿软门禁（尽量过，不过要在 PR 说明原因）

```bash
pnpm test             # vitest run（可降级为只跑改动模块）
pnpm build:win        # 缺 SDK 时允许 SKIP，但发布前必须在 windows-latest CI 跑通
```

## 治理工具（必装必用）

### 1. Stop Hook（确定性门禁）

已配置在 `.claude/settings.json`，每次 Claude 声明完成前自动跑三绿门禁。**不依赖模型遵守指令**。

### 2. 独立 Verifier Subagent（做事与打分分离）

每次声明"任务完成"前必须 dispatch 一个独立 verifier subagent，在新上下文中：

- 实际跑 `pnpm typecheck:node && pnpm typecheck:web && pnpm lint` 并贴输出
- 跑 `npx knip --no-exit-code` 死代码扫描
- grep 关键函数确认真实实现（不是占位符）
- 检查 IPC 4 步是否完整
- 检查"降级保留"原则（见下文）
- 输出验证报告（不要总结，要贴实际命令输出）

### 3. Knip 死代码扫描

```bash
pnpm deadcode         # 查看（不报错）
pnpm deadcode:strict  # 严格模式（CI 用）
```

### 4. Playwright E2E + 视觉对比

`@playwright/test` 1.61.1 已装。每个 P0 项完成后必须写 E2E 测试：

```bash
pnpm test:e2e         # 跑 E2E
pnpm test:e2e:ui      # UI 模式
pnpm test:e2e:visual  # 视觉对比
```

## 你的任务清单（按优先级）

### P0（必须先做，阻塞核心功能或比赛演示）

> ⚠️ **v2.2 执行顺序修正**：原顺序 P0-1 → P0-2 → P0-4 → P0-3，新顺序 **P0-2 → P0-1 → P0-4 → P0-3**
> - 原因：P0-1 调用 `tutorialBackfillStart` 等方法，但 renderer 层缺类型声明，会触发 TS 错误
> - 必须先做 P0-2（补齐 backfill 4 方法 + 校准 6 方法类型声明），再做 P0-1

#### P0-1：接入 v2.5 异步 backfill 4 通道（~2h，比赛演示核心场景，**依赖 P0-2**）

**问题**：前端 `src/renderer/src/hooks/useHybridSearch.ts:335` 仍用旧版同步 `tutorialBackfillEmbeddings`，2578 条教程首次回填会阻塞 UI 1-3 分钟。

**后端已就绪**（4 步同步完整）：
- `TUTORIAL.BACKFILL_START` / `BACKFILL_CANCEL` / `BACKFILL_STATUS` / `BACKFILL_PROGRESS`
- preload 已暴露：`tutorialBackfillStart` / `tutorialBackfillCancel` / `tutorialBackfillStatus` / `onTutorialBackfillProgress`（[preload/index.ts:3387-3394](file:///d:/ai/linux教学一体/tdsf-linux-desktop/src/preload/index.ts#L3387-L3394)）

**v2.2 关键修正**：
- v2.1 称"backfill 4 方法已声明"是**失实描述**
- 实测：backfill 4 方法**仅在 `src/preload/index.ts:3387-3394` 声明**，**`src/renderer/src/types/electron.d.ts` 中缺失**
- 因此 P0-1 **依赖 P0-2**：必须先在 `src/renderer/src/types/electron.d.ts` 补齐 4 个方法类型签名才能调用

**实施步骤**：
1. 在 `useHybridSearch.ts` 的 `backfill` 回调中，用 `tutorialBackfillStart({ pageSize: 100, inferenceBatch: 8 })` 替换 `tutorialBackfillEmbeddings()`
2. 订阅 `onTutorialBackfillProgress(cb)`，将 `p.pct` / `p.eta` / `p.processed` / `p.total` 写入 progress state
3. 在 `TutorialPage` 添加"取消回填"按钮调用 `tutorialBackfillCancel()`
4. 页面挂载时调用 `tutorialBackfillStatus()` 恢复 UI 状态（如已有运行中任务则显示进度）
5. 进度推送频率：2578 条 / 100 页 = 26 次推送，频率合理

**验证**：
- 首次回填时 UI 不阻塞，进度条 0-100% 平滑推进
- 取消按钮可中断回填
- 刷新页面后能恢复显示运行中任务
- 写 E2E 测试覆盖上述场景

#### P0-2：补齐 10 个方法的类型声明（~1h，校准 6 + backfill 4，**真实缺失项**）

> ⚠️ **v2.2 修正**：v2.1 中"backfill 4 方法已声明"是**失实描述**。二次实测核查（2026-07-25）发现：
> - **校准 6 方法**：❌ **双位置缺失**（preload/index.ts:3212-3682 的 ElectronAPI 中无 + renderer/src/types/electron.d.ts 中也无）
> - **backfill 4 方法**：⚠️ **renderer 层缺失**（preload/index.ts:3387-3394 已声明 ✅，但 renderer/src/types/electron.d.ts 中**未声明** ❌）
> - PAOR 3 方法（`agentPaor` / `paorApprove` / `onPaorApprovalRequest`）：✅ **已声明**于 `src/renderer/src/types/electron.d.ts:835/842/1457`
> - `exportModelStats`：✅ **已声明**于 `src/renderer/src/types/electron.d.ts:907`

**问题**：以下 10 个方法在 `src/renderer/src/types/electron.d.ts` 中缺失类型声明（其中 6 个在 preload 中也缺失）：

**A. 校准 6 方法（双位置缺失，需要补两处）**：
- `credibilityCalibrate` — 触发校准
- `credibilityGetCalibration` — 查询校准结果
- `credibilityGetCalibrationState` — 查询校准状态
- `credibilityResetCalibration` — 重置校准
- `credibilityComputeEce` — 计算 ECE（Expected Calibration Error）
- `credibilityAddCalibrationSample` — 添加校准样本

**B. backfill 4 方法（renderer 层缺失，仅需补 renderer）**：
- `tutorialBackfillStart` — 启动异步回填
- `tutorialBackfillCancel` — 取消回填
- `tutorialBackfillStatus` — 查询回填状态
- `onTutorialBackfillProgress` — 订阅进度推送

**实测证据**（接手 AI 可自行验证）：
```bash
# 1. 校准 6 方法 - preload 实际绑定（2486-2491 行）✅ 存在
grep -n "credibilityCalibrate:\|credibilityGetCalibration:\|credibilityComputeEce:" src/preload/index.ts
# 输出：2486: credibilityCalibrate: credibility.calibrate, ...

# 2. 校准 6 方法 - preload ElectronAPI 类型声明（3212-3682 行）❌ 缺失
awk 'NR>=3212 && NR<=3682' src/preload/index.ts | grep "credibilityCalibrate:\|credibilityGetCalibration:\|credibilityComputeEce:"
# 输出：空（说明类型声明缺失）

# 3. 校准 6 方法 - renderer 层类型声明也缺失
grep -n "credibilityCalibrate\|credibilityComputeEce" src/renderer/src/types/electron.d.ts
# 输出：空

# 4. backfill 4 方法 - preload 已声明 ✅
grep -n "tutorialBackfillStart\|tutorialBackfillCancel\|tutorialBackfillStatus\|onTutorialBackfillProgress" src/preload/index.ts
# 输出：3387-3394 行有声明

# 5. backfill 4 方法 - renderer 层缺失 ❌（v2.1 误判为已声明）
grep -n "tutorialBackfillStart\|tutorialBackfillCancel\|tutorialBackfillStatus\|onTutorialBackfillProgress" src/renderer/src/types/electron.d.ts
# 输出：空（说明 renderer 层类型声明缺失）

# 6. 旧版同步方法 tutorialBackfillEmbeddings 在 renderer 层已声明（1255 行）
grep -n "tutorialBackfillEmbeddings" src/renderer/src/types/electron.d.ts
# 输出：1255 行有声明（但这是旧版同步方法，将被 P0-1 替换）
```

**实施步骤**：
1. **A 部分 - 校准 6 方法**（双位置同步）：
   - 在 `src/preload/index.ts:3212` 的 `ElectronAPI` 类型声明中追加 6 个校准方法签名（参照 2486-2491 行的实际绑定类型）
   - 在 `src/renderer/src/types/electron.d.ts` 中追加同样的 6 个方法签名（参照已有的 `credibilityAssess` 写法）
2. **B 部分 - backfill 4 方法**（仅 renderer 层）：
   - 在 `src/renderer/src/types/electron.d.ts` 中追加 4 个 backfill 方法签名（参照 `src/preload/index.ts:3387-3394` 的签名）
   - 注意：preload 已有声明，无需重复
3. **类型签名示例**：

   校准 6 方法：
   ```typescript
   credibilityCalibrate: (providerId: ProviderId, options?: { tMin?: number; tMax?: number }) => Promise<ProviderCalibration>
   credibilityGetCalibration: (providerId: ProviderId) => Promise<ProviderCalibration>
   credibilityGetCalibrationState: () => Promise<CalibrationState>
   credibilityResetCalibration: (providerId: ProviderId) => Promise<boolean>
   credibilityComputeEce: (providerId: ProviderId, sampleSize?: number) => Promise<{ ece: number; samples: number }>
   credibilityAddCalibrationSample: (sample: CalibrationSample) => Promise<boolean>
   ```

   backfill 4 方法（参照 preload/index.ts:3387-3394）：
   ```typescript
   tutorialBackfillStart: (options?: BackfillStartOptions) => Promise<BackfillStartResult>
   tutorialBackfillCancel: () => Promise<BackfillCancelResult>
   tutorialBackfillStatus: () => Promise<BackfillStatusResult>
   onTutorialBackfillProgress: (callback: (progress: BackfillProgress) => void) => () => void
   ```
4. 相关类型已在以下位置定义，import 即可：
   - `ProviderCalibration` / `CalibrationState` / `CalibrationSample` → `src/main/core/agent/credibility/calibration/types`
   - `BackfillStartOptions` / `BackfillStartResult` / `BackfillCancelResult` / `BackfillStatusResult` / `BackfillProgress` → preload 中已有，可从 `src/preload/index.ts` 或共享类型位置 import

**验证**：
- `pnpm typecheck:web` exit 0
- 渲染进程调用 `window.electronAPI.credibilityComputeEce('deepseek', 10)` 不再报类型错误
- 渲染进程调用 `window.electronAPI.tutorialBackfillStart({ pageSize: 100 })` 不再报类型错误

#### P0-3：接入 PAOR 启动入口（~1h，审批链已通 + 类型已声明）

**问题**：审批响应链已通（AIPanel + PaorApprovalCard + MessageList），但 `agentPaor` 启动入口缺失，无按钮触发 PAOR 自动循环。

**后端已就绪**：
- `AGENT.PAOR` / `PAOR.APPROVE` / `PAOR.APPROVAL_REQUEST`（push）
- preload 已暴露：`agentPaor`（[preload/index.ts:2398](file:///d:/ai/linux教学一体/tdsf-linux-desktop/src/preload/index.ts#L2398)）/ `paorApprove`（2400）/ `onPaorApprovalRequest`（2379）
- ✅ **类型声明已存在**：`src/renderer/src/types/electron.d.ts:835/842/1457`（无需补类型声明）

**实施步骤**：
1. 在 `AIPanel.tsx` 增加"PAOR 自动循环"按钮（建议放在发送按钮旁）
2. 点击后调用 `agentPaor(task: string, sshSessionId: string, maxIterations?: number)` 启动
   - 注意：参数是位置参数（task, sshSessionId, maxIterations?），**不是对象参数**
3. 订阅 `onPaorApprovalRequest(cb)`，收到请求时弹出已有的 `PaorApprovalCard`
4. 用户批准/拒绝后调用 `paorApprove(callId: string, approved: boolean)` 响应

**验证**：触发 PAOR 后遇到高危命令时弹窗，用户批准后继续执行，拒绝后停止循环。

#### P0-4：新建 CalibrationSettings 组件（~3h，主进程 + preload 已就绪）

**问题**：`src/renderer/src/pages/CalibrationSettings.tsx` 不存在，SettingsLayout 6 项导航无"校准"项。

**后端已就绪**（主进程 `credibility.ts:296/326/345/364/388/411` 已注册 6 个 handler）：
- `credibilityCalibrate` — 触发校准
- `credibilityGetCalibration` — 查询校准结果
- `credibilityGetCalibrationState` — 查询校准状态
- `credibilityResetCalibration` — 重置校准
- `credibilityComputeEce` — 计算 ECE（Expected Calibration Error）
- `credibilityAddCalibrationSample` — 添加校准样本

**依赖**：必须先完成 P0-2（补齐 6 个校准方法的类型声明），否则调用 `window.electronAPI.credibilityComputeEce` 会报类型错误。

**实施步骤**：
1. 新建 `src/renderer/src/pages/CalibrationSettings.tsx`
2. 在 `src/renderer/src/components/settings/SettingsLayout.tsx` 添加"校准"导航项
3. UI 包含：校准状态卡片 / 触发校准按钮 / ECE 值显示 / 重置按钮 / 校准样本列表
4. 调用 `credibilityComputeEce('deepseek', 10)` 测试返回 ECE 值

**验证**：进入设置页"校准"项，能触发校准并看到 ECE 值。

### P1（建议接入，提升功能完整度）

详见 `docs/handoff/HANDOVER.md` 第 4 节 P1 清单（13 项），包括：
- Claude Agent SDK 6 通道
- Subagent 管理
- 外部 MCP 服务器
- 诊断服务
- 沙箱容器生命周期
- Sidecar 高级能力
- Provider 能力 + 定价
- 合规审计报告
- 知识库 CRUD 完整链
- historySave 决策卡片入库
- fsUploadImage 图片附件
- 内联补全取消 + Diff 应用
- SSH 心跳事件

### P2/P3（可选，提升体验或补全非核心能力）

详见 `docs/handoff/HANDOVER.md` 第 4 节 P2/P3 清单。

## 工作流约束（必读）

### 6 条核心红线（不可绕过）

1. **IPC 4 步同步铁律**：通道常量（`src/shared/ipc-channels.ts`）→ handler 注册（`src/main/ipc/`）→ preload 暴露（`src/preload/index.ts`）→ 类型声明（`src/preload/index.d.ts`），缺一不可
2. **catch 脱敏**：error 写日志前必须 `redactSensitiveInfo()`
3. **高危命令黑名单**：SSH exec 必须经过 12 条正则
4. **Electron 安全三原则**：`contextIsolation:true` / `nodeIntegration:false` / `sandbox:true`
5. **DOMPurify XSS 防护**：渲染层 `dangerouslySetInnerHTML` 必须 `DOMPurify.sanitize()`
6. **做事与打分分离**：声明"任务完成"前必须 dispatch 独立 verifier subagent

### 三绿硬门禁 + 两绿软门禁

- **三绿硬门禁**（必须全过）：`pnpm typecheck:node` + `pnpm typecheck:web` + `pnpm lint`
- **两绿软门禁**（尽量过）：`pnpm test` + `pnpm build:win`
- **不再使用"五绿全过"表述**（build:win 缺 SDK 时允许 SKIP，但发布前必跑）

### TypeScript 规则

- TypeScript strict 模式
- **允许边界 any**（如第三方库类型不全），**禁止业务 any**
- 大量 `as unknown as` 绕过 = 反模式，应补类型声明而非绕过

### CSS 颜色规则（Demo 阶段放宽）

- Demo 阶段允许硬编码颜色（如 `#4f46e5`），不强制 `var(--color-*)` token
- v1.1 统一 token 化（生产前必做）
- 主色：低饱和靛蓝 `#4f46e5`（亮）/ `#818cf8`（暗）
- 字体：Inter（UI）+ JetBrains Mono（代码）
- 暗色模式默认开启
- 卡片 hover：仅阴影变化，禁止同时变 border + 位移 + scale
- 输入框：border 聚焦变蓝，无 glow
- IDE 编辑器：必须用 `@monaco-editor/react`，不用 CodeMirror
- 远程路径作为唯一 ID（Tree key 和 Tab key）

### 降级保留原则（关键）

- **"降级"≠"完全切除"**
- 任何功能废弃必须保留：代码文件 + 接口签名 + 类型声明
- 不允许"接口没了，类型没了，文件没了"
- v3.x 恢复时只需开关 flag，不需要重写
- **教训**：calibration 曾被走样执行为"完全切除"，导致学术亮点丢失

### 多 AI 协作协议

- **比赛阶段强制单 AI 模式**：避免并发冲突重演
- 若必须并行：
  1. 用 `git worktree add` 隔离工作区
  2. 修改前 `git status` 确认工作区干净
  3. 修改后立即 `git commit` 提交
  4. 高共享文件禁止并行修改：`preload/index.ts` / `main/ipc/index.ts` / `electron.d.ts`
- 多 AI claim/release 协议保留：`pnpm ai:claim <file>` / `pnpm ai:release <file>`

### 大文件治理（建议非强制）

- 单文件 > 800 行：PR 中说明拆分计划
- 单文件 > 1500 行：必须拆分（除非有充分理由）
- 单文件 > 3000 行：硬限制，必须拆分

### 删除前检查

删除任何文件前必须：
1. `grep -r "import.*filename"` 确认无引用
2. `git log --oneline -5 -- <file>` 查看最近修改
3. 在 PR 中说明删除理由

### 不碰后端

- **不碰 `src/main/`**：后端已冻结，如需修改请先在 PR 描述中说明并征得后端负责人确认
- **共享层修改需同步**：`src/shared/` 和 `src/preload/index.d.ts` 的类型变更需在 PR 描述中登记

### commit message 规范

```
feat(frontend): P0-x xxx
fix(preload): 补齐 ElectronAPI 类型声明
refactor(renderer): xxx
```

### 分支策略

每个 P0 项独立分支：
- `feat/p0-backfill` — P0-1
- `feat/p0-type-declarations` — P0-2
- `feat/p0-paor` — P0-3
- `feat/p0-calibration` — P0-4

## 验证清单（每个 P0 项完成后）

### 三绿硬门禁（必过）

- [ ] `pnpm typecheck:node` exit 0
- [ ] `pnpm typecheck:web` exit 0
- [ ] `pnpm lint` exit 0（0 errors，warnings 允许）

### 两绿软门禁（尽量过）

- [ ] `pnpm test` 全绿（无回归）
- [ ] `pnpm build:win` 成功（如能跑）

### 治理工具验证

- [ ] `npx knip --no-exit-code` 无新增死代码
- [ ] 写了 E2E 测试覆盖本次改动（`pnpm test:e2e`）
- [ ] **dispatch 独立 verifier subagent** 验证（贴实际命令输出）

### 功能验证

- [ ] 手动验证：在 Electron 环境下实际触发功能，确认无运行时错误
- [ ] 更新 `docs/handoff/frontend-integration-verification.md` 中对应 P0 项状态为 ✅

## 重要文档参考

### 交接文档（docs/handoff/）

| 文档 | 路径 | 用途 |
|------|------|------|
| 统一入口 | `docs/handoff/HANDOVER.md` | TOP 5 关键发现 + P0-P3 行动清单 |
| IPC 契约 | `docs/handoff/ipc-contract.md` | 36 域 / 211 handler / 全量参数与返回值 |
| 前后端职责边界 | `docs/handoff/frontend-backend-boundary.md` | 共享层契约 + v2.4/v2.5 新增能力清单 |
| 核心数据流 | `docs/handoff/data-flow.md` | 7 条数据流时序图 |
| 后端完成度审计 | `docs/handoff/backend-completion-audit.md` | 211 handler + 15 services + 30+ core 模块 |
| 前端待接入清单 | `docs/handoff/frontend-integration-checklist.md` | 231 调用 + 75 孤儿 API |
| IPC 4 步同步审计 | `docs/handoff/ipc-4step-sync-audit.md` | 4 步同步缺失项 + 类型声明修复清单 |
| 前端集成验证 | `docs/handoff/frontend-integration-verification.md` | P0 项实测状态 |
| 编译门禁验证 | `docs/handoff/build-gate-verification.md` | 三绿 + test 实测报告 |
| v2.5 方案书 | `docs/v2.5-loop-engineering-plan.md` | v2.5 Phase C/D/E 任务清单 |

### 最新方案与调研（项目根目录）

| 文档 | 路径 | 用途 |
|------|------|------|
| **高质量做大方案终稿** | `../TDSF高质量做大方案-终稿.md` | 简化 CLAUDE.md + 治理工具配置 + 5 天作战计划 |
| 官方建议对比分析 | `../官方建议与项目实际对比分析.md` | 35 项 Gap 分析 + 改进优先级矩阵 |
| Electron 高效开发调研 | `../Electron-高效开发-调研报告.md` | 必装库清单 + 主流桌面应用架构 |
| AI 辅助开发调研 | `../AI辅助开发-调研报告.md` | Anthropic 官方最佳实践 + 4 级 Verification Gate |
| 项目开发经验分析 | `../项目开发经验与约束合理性分析.md` | 12 类问题时间线 + 约束合理性评估 |
| 桌面开发经验总结 | `../桌面开发经验总结与约束完善方案.md` | 综合方案 + 行动清单 |

### 项目规范

| 文档 | 路径 | 用途 |
|------|------|------|
| 项目簇入口 | `../../CLAUDE.md` | 工作区入口 + CodeGraph 使用指引 |
| 子项目入口 | `CLAUDE.md` | AI Agent 工作入口 |
| 编码规范 | `CODING.md` | 80 行核心规范 |
| Agent 工作指南 | `AGENTS.md` | v10.0 模块状态 + 两周路线 |
| 技术栈教程 | `docs/技术栈教程注意事项-v1.0.md` | 8 篇技术栈本地化教程 |
| 开源复用清单 | `../docs/technical/开源项目复用清单.md` | 18 个开源参考项目 |
| 项目救援盘点 | `../docs/reports/项目救援盘点.md` | 多 AI 并行冲突复盘 |

## CodeGraph 图谱（动工前先查）

```bash
# 找符号定义（替代 grep + Read 链）
codegraph query <SymbolName>          # 例：query DecisionEngine / query ssh

# 改函数前看影响范围
codegraph impact <SymbolName> --depth 2

# 追踪调用链
codegraph trace <Entry> <Target>      # 例：trace App login

# 看谁调用它 / 它调用了谁
codegraph callers <SymbolName>
codegraph callees <SymbolName>
```

图谱规模：542 files / 7,193 nodes / 20,567 edges（Electron 桌面端）

## 起步指令

请按以下顺序执行：

1. 读 `docs/handoff/HANDOVER.md`（5 分钟速读）
2. 读 `docs/handoff/frontend-integration-verification.md`（了解 P0 项实测状态）
3. 读 `docs/handoff/ipc-4step-sync-audit.md`（了解 4 步同步状态，**注意文档中"类型声明缺失"的描述可能过时，以本提示词 v2.2 实测为准**）
4. 读 `../TDSF高质量做大方案-终稿.md`（了解最新约束与治理工具）
5. 跑三绿硬门禁确认基线：`pnpm typecheck:node && pnpm typecheck:web && pnpm lint`
6. 跑死代码扫描：`npx knip --no-exit-code`
7. **从 P0-2 开始**（补齐 10 个方法类型声明：校准 6 + backfill 4，~1h，**这是其他 P0 项的前置依赖**）
8. 完成 P0-2 后做 P0-1（v2.5 backfill 接入，~2h，比赛演示核心场景，依赖 P0-2 完成）
9. 然后做 P0-4（CalibrationSettings 组件，~3h，依赖 P0-2 的校准 6 方法类型声明）
10. 最后做 P0-3（PAOR 启动入口，~1h，独立任务无依赖）
11. **每个 P0 项完成后必须 dispatch 独立 verifier subagent 验证**

**重要提示**：
- 动工前先 `git status` 确认工作区干净
- 每个 P0 项独立分支，独立 PR
- 不碰 `src/main/`，仅改 `src/renderer/` + `src/preload/index.ts`（ElectronAPI 类型声明）+ `src/renderer/src/types/electron.d.ts`
- 遇到文档与代码不一致时，**以代码为准**，并更新文档
- **声明"任务完成"前必须 dispatch 独立 verifier subagent**（贴实际命令输出）
- 如有疑问，对照 `ipc-contract.md` 核对通道细节，或对照 `data-flow.md` 核对数据流转
- **校准 6 方法类型签名**：参照 `src/preload/index.ts:2486-2491` 的实际绑定 + `src/main/core/agent/credibility/calibration/types.ts` 的类型定义
- **backfill 4 方法类型签名**：参照 `src/preload/index.ts:3387-3394` 的签名

---

## 复制说明

上方 `---` 之间的内容即为接手 AI 提示词，可直接复制粘贴发给接手 AI。

**使用建议**：
1. 将整段提示词作为接手 AI 的第一条用户消息
2. 接手 AI 完成每个 P0 项后，要求其 dispatch 独立 verifier subagent 验证
3. 要求接手 AI 更新 `docs/handoff/frontend-integration-verification.md` 状态
4. 所有 P0 项完成后，要求接手 AI 在 windows-latest CI 上跑 `pnpm build:win`

**预计工作量**（v2.2 修正）：
- P0-2 类型声明补齐（校准 6 + backfill 4 = 10 个方法）：~1h
- P0-1 backfill 接入：~2h（依赖 P0-2）
- P0-3 PAOR 启动入口：~1h
- P0-4 CalibrationSettings：~3h（依赖 P0-2）
- 合计 P0：~7h（接近 1 个工作日）

**P1（13 项）建议在 P0 全部完成后再开始**，每项独立 PR，避免与 P0 冲突。

## v2.2 更新日志（相比 v2.1）

| # | 修改项 | v2.1 | v2.2 | 理由 |
|---|--------|------|------|------|
| 1 | backfill 4 方法状态 | "✅ 已声明" | "preload 已声明 / renderer 层缺失" | 二次实测核查发现 v2.1 误判 |
| 2 | P0-2 范围 | 仅校准 6 方法 | 校准 6 + backfill 4 = 10 个方法 | renderer 层真实缺失项 |
| 3 | P0-2 工作量 | ~30min | ~1h | 范围扩大 |
| 4 | P0-1 依赖 | 独立任务 | **依赖 P0-2 完成** | renderer 层缺类型声明会触发 TS 错误 |
| 5 | P0 执行顺序 | P0-1 → P0-2 → P0-4 → P0-3 | **P0-2 → P0-1 → P0-4 → P0-3** | P0-1 依赖 P0-2，必须先做 P0-2 |
| 6 | 实测证据 | 仅校准 6 方法 grep | 新增 backfill 4 方法 grep（含 preload + renderer 双位置验证） | 接手 AI 可自行验证 |
| 7 | 类型签名示例 | 仅校准 6 方法 | 新增 backfill 4 方法类型签名 | 接手 AI 可直接复制 |
| 8 | 起步指令第 7 步 | "从 P0-1 开始" | "**从 P0-2 开始**（前置依赖）" | 执行顺序修正 |

## v2.1 更新日志（相比 v2.0，保留参考）

| # | 修改项 | v2.0 | v2.1 | 理由 |
|---|--------|------|------|------|
| 1 | P0-2 描述 | "跨 8 域约 25 个方法未声明类型" | "仅校准 6 方法真实缺失" | 实测核查发现 v2.0 描述失实（v2.2 进一步修正：实际是 10 个方法） |
| 2 | 类型声明位置 | 仅提及 `src/preload/index.d.ts` | 新增 `src/renderer/src/types/electron.d.ts`（1911 行，渲染层真正使用） | 接手 AI 需知道改哪里 |
| 3 | preload 行数 | 3283 行 | 3388 行 | 实测核查 |
| 4 | P0-2 工作量 | ~1h | ~30min | 范围从 25 个方法缩小到 6 个（v2.2 修正回 ~1h） |
| 5 | P0-3 参数描述 | `agentPaor({ task, sshSessionId, maxIterations? })` | `agentPaor(task, sshSessionId, maxIterations?)` 位置参数 | 实测 renderer/types/electron.d.ts:835 签名 |
| 6 | P0-3 类型声明状态 | 未明确 | 明确"已声明，无需补" | 减少接手 AI 重复工作 |
| 7 | P0-4 依赖 | 未明确 | 明确"依赖 P0-2 完成" | 类型错误阻塞 |
| 8 | P0 执行顺序 | P0-1 → P0-2 → P0-3/P0-4 | P0-1 → P0-2 → P0-4 → P0-3 | P0-4 依赖 P0-2，P0-3 独立（v2.2 进一步修正为 P0-2 → P0-1 → P0-4 → P0-3） |
| 9 | ElectronAPI 真实版本 | 仅说 Electron 43 | 明确 `43.1.1`（package.json L108） | 防止接手 AI 误信旧文档说 30 |
| 10 | 实测证据 | 无 | 新增 grep + awk 命令验证校准 6 方法缺失 | 接手 AI 可自行验证 |

## v2.0 更新日志（相比 v1.0，保留参考）

| # | 修改项 | v1.0 | v2.0 | 理由 |
|---|--------|------|------|------|
| 1 | 门禁描述 | 三绿/四绿/五绿混用 | 统一为"三绿硬 + 两绿软" | 解决文档内部矛盾 |
| 2 | CSS 颜色规则 | 必须 var(--color-*) + 矛盾硬编码 #4f46e5 | Demo 允许硬编码，v1.1 统一 token 化 | 解决规则矛盾 |
| 3 | TypeScript any | 禁止 any / 隐式 any | 允许边界 any，禁止业务 any | 避免大量 as unknown as 绕过 |
| 4 | 删比加重要 | "删比加重要" | "改比加重要，加比删重要" | 防止 calibration 误删重演 |
| 5 | 治理工具 | 未提及 | 新增 Stop Hook / Verifier / Knip / Playwright | Anthropic 官方 L3/L4 |
| 6 | 降级保留 | 未提及 | 新增"降级保留"原则 | 防止完全切除 |
| 7 | 多 AI 协作 | 未提及 | 新增多 AI 协作协议 | 防止并发冲突 |
| 8 | 删除前检查 | 未提及 | 新增删除前检查 | 防止误删 |
| 9 | 大文件治理 | 未提及 | 新增大文件治理（>1500 行必须拆分） | 防止 preload 3283 行重演 |
| 10 | Verifier subagent | 未提及 | 声明完成前必 dispatch | Anthropic L4 + arXiv:2310.01798 |
| 11 | Playwright E2E | 未提及 | 每个 P0 项必写 E2E | 已装未用，立即启用 |
| 12 | Electron 版本 | Electron 30 | Electron 43（实际版本） | 修正过时信息 |
| 13 | 最新方案引用 | 未引用 | 引用 5 份最新调研报告 | 信息同步 |
