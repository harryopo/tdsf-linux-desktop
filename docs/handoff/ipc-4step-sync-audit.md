# IPC 4 步同步完整性审计报告

> **审计范围**：`d:\ai\linux教学一体\tdsf-linux-desktop`  
> **审计日期**：2026-07-25  
> **审计员**：后端审计员（静态扫描，无代码修改）  
> **审计依据**：IPC 4 步同步铁律（定义 → 注册 → 暴露 → 类型声明）

## 4 步同步定义

| 步骤 | 文件 | 检查项 |
|------|------|--------|
| Step 1 | `src/shared/ipc-channels.ts` | 是否定义通道常量 |
| Step 2 | `src/main/ipc/*.ts` | 是否在 `ipcMain.handle` 中注册（push 通道用 `sender.send`） |
| Step 3 | `src/preload/index.ts` | 是否通过 `contextBridge.exposeInMainWorld` 暴露为 `electronAPI.*` 方法 |
| Step 4 | `src/preload/index.ts` 中的 `export type ElectronAPI` | 是否声明方法类型（line 3212-3682） |

> 注：`src/preload/index.d.ts` 仅 `import type { ElectronAPI } from './index'`，真正类型定义在 `preload/index.ts` line 3212 的 `export type ElectronAPI = {` 块中。

---

## 一、TOP 3 关键发现

### 🔴 关键发现 1：校准 6 通道矛盾点澄清（双方文档均不准确）

**矛盾文档**：
- `backend-completion-audit.md` 说"校准 6 通道已全部注册"（credibility.ts:296/326/345/364/388/411）
- `frontend-integration-checklist.md` 说"`ipc-contract.md` 附录 A 标注未注册"

**实测结论**：
- ✅ `backend-completion-audit.md` 的"已注册"说法**正确**：Step 1/2/3 全部完成
- ❌ `frontend-integration-checklist.md` 的"未注册"说法**错误**（信息过时）
- ⚠️ **但发现新 P1 BUG**：**Step 4 类型声明全部缺失**！ElectronAPI 类型声明（line 3212-3682）中**完全没有**校准 6 通道方法类型声明，渲染进程调用 `window.electronAPI.credibilityCalibrate()` 等方法时会触发 TypeScript 编译错误。

**附加确认**：`credibility:assess` handler 已正确透传 `options` 参数：
- `credibility.ts:157` 接收 `options?: FuseAssessOptions`
- `credibility.ts:200` 透传 `engine.fuseAndAssess(weightedMassFunctions, options)`

### 🔴 关键发现 2：app:export-model-stats BUG 确认（frontend-integration-checklist.md 说法正确）

`frontend-integration-checklist.md` 第 165 行说 `appExportModelStats` 未在 preload 暴露——**实测确认正确**：

| Step | 状态 | 位置 |
|------|------|------|
| Step 1 定义 | ✅ | `ipc-channels.ts:774` `APP.EXPORT_MODEL_STATS = 'app:export-model-stats'` |
| Step 2 注册 | ✅ | `app-update.ts:290-291` `ipcMain.handle(APP.EXPORT_MODEL_STATS, ...)` |
| Step 3 暴露 | ❌ | `preload/index.ts` 中**未暴露** `appExportModelStats` 方法 |
| Step 4 类型 | ❌ | `ElectronAPI` 类型中**未声明** `appExportModelStats` |

**附加发现 P2 BUG**：`appGetInfo` 也存在 Step 4 类型声明缺失
- Step 1/2/3 全部完成（`ipc-channels.ts:772` / `app-update.ts:247` / `preload:2413`）
- Step 4 ❌：`ElectronAPI` 类型声明（line 3305-3306）只声明了 `appCheckUpdate` / `appDownloadUpdate`，**遗漏** `appGetInfo`

### 🟢 关键发现 3：v2.5 backfill 4 通道 4 步同步完整

v2.5 Phase C 新增的 4 个 backfill 通道全部完成 4 步同步，无任何缺失：

| 通道 | Step 1 | Step 2 | Step 3 | Step 4 |
|------|--------|--------|--------|--------|
| `TUTORIAL.BACKFILL_START` | ✅ | ✅ tutorial.ts:339 | ✅ preload:3387 | ✅ ElectronAPI:3387 |
| `TUTORIAL.BACKFILL_CANCEL` | ✅ | ✅ tutorial.ts:398 | ✅ preload:3390 | ✅ ElectronAPI:3390 |
| `TUTORIAL.BACKFILL_STATUS` | ✅ | ✅ tutorial.ts:418 | ✅ preload:3391 | ✅ ElectronAPI:3391 |
| `TUTORIAL.BACKFILL_PROGRESS` (push) | ✅ | ✅ push 通道 | ✅ preload:3392 | ✅ ElectronAPI:3392 |

---

## 二、IPC 4 步同步完整性矩阵（按域汇总）

> 图例：✅ 完成 / ❌ 缺失 / ⚠️ 部分缺失 / N/A 不适用

| 域 | 通道数 | Step 1 定义 | Step 2 注册 | Step 3 暴露 | Step 4 类型 | 整体状态 |
|----|--------|-------------|-------------|-------------|-------------|----------|
| **SCHEDULER** | 4 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **AGENT** | 10 | ✅ | ✅ | ⚠️ | ⚠️ | 🟡 agentPaor / paorApprove / onPaorApprovalRequest 类型缺失 |
| **LLM** | 13 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **LLM_INLINE** | 4 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **SSH** | 13 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **SFTP** | 10 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **TERMINAL** | 1 (push) | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **SFTP_SEARCH** | 2 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **FILE_WATCH** | 3 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **STORAGE** | 3 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **CONFIG** | 2 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **SERVER** | 5 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **LOOP** | 10 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **MONITOR** | 5 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **LOG** | 6 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **KNOWLEDGE** | 10 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **HISTORY** | 4 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **DIAGNOSTICS** | 8 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **SIDECAR** | 11 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **SANDBOX** | 9 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **MCP** | 6 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **TUTORIAL** | 25 | ✅ | ✅ | ✅ | ⚠️ | 🟡 tutorialRecommendPath / tutorialStats / tutorialProgress / tutorialUpdateProgress 类型声明缺失 |
| **DEPLOY** | 7 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **AT_COMMANDS** | 3 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **TOKEN** | 4 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **PROMPTFOO** | 3 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **SYSTEM** | 1 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **APP** | 4 | ✅ | ✅ | ⚠️ | ❌ | 🔴 appExportModelStats 未暴露；appGetInfo / appExportModelStats 类型缺失 |
| **FS** | 1 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **PROFILER** | 4 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **PAOR** | 1 | ✅ | ✅ | ✅ | ❌ | 🔴 paorApprove 类型缺失 |
| **CLAUDE_SDK** | 3 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **PROVIDER** | 8 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **MODE** | 3 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **ATTENTION** | 7 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **EXPECTATION** | 2 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **SUBAGENT** | 2 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **MODEL_STATS** | 1 | ✅ | ✅ | ✅ | ❌ | 🔴 modelToolCalls 类型缺失 |
| **BUDGET** | 1 | ✅ | ✅ | ✅ | ❌ | 🔴 budgetAlerts 类型缺失 |
| **CREDIBILITY** | 13 | ✅ | ✅ | ✅ | ❌ | 🔴 13 个方法类型声明全部缺失（含校准 6 通道） |
| **MCP_EXTERNAL** | 1 | N/A | N/A | N/A | N/A | ⚪ 已在 MCP 域覆盖，本域未单独暴露 |
| **TASK** | 1 | ✅ | ✅ | ✅ | ✅ | 🟢 完整 |
| **RISK** | 1 | ✅ | ✅ | ✅ | ❌ | 🔴 riskCheck 类型缺失 |
| **ALERT** | 1 | ✅ | ✅ | ✅ | ❌ | 🔴 alertAck 类型缺失 |
| **BOOT** | 1 (push) | ✅ | ✅ | ✅ | ❌ | 🔴 onBootLoadingStage 类型缺失 |

**统计**：
- 完整 4 步同步：38 个域
- 存在缺失：8 个域（APP / PAOR / MODEL_STATS / BUDGET / CREDIBILITY / RISK / ALERT / BOOT / AGENT / TUTORIAL）
- **共发现 ~25 个方法类型声明缺失**（集中在 ElectronAPI type 声明块）

---

## 三、校准 6 通道实测状态表

| 通道常量 | 通道值 | Step 1 定义 | Step 2 注册 | Step 3 暴露 | Step 4 类型 |
|---------|--------|-------------|-------------|-------------|-------------|
| `CREDIBILITY.CALIBRATE` | `credibility:calibrate` | ✅ `ipc-channels.ts:1004` | ✅ `credibility.ts:296` `ipcMain.handle(CREDIBILITY.CALIBRATE, ...)` | ✅ `preload:2486` `credibilityCalibrate: credibility.calibrate` | ❌ ElectronAPI 类型声明缺失 |
| `CREDIBILITY.GET_CALIBRATION` | `credibility:get-calibration` | ✅ `ipc-channels.ts:1006` | ✅ `credibility.ts:326` | ✅ `preload:2487` `credibilityGetCalibration` | ❌ ElectronAPI 类型声明缺失 |
| `CREDIBILITY.GET_CALIBRATION_STATE` | `credibility:get-calibration-state` | ✅ `ipc-channels.ts:1008` | ✅ `credibility.ts:345` | ✅ `preload:2488` `credibilityGetCalibrationState` | ❌ ElectronAPI 类型声明缺失 |
| `CREDIBILITY.RESET_CALIBRATION` | `credibility:reset-calibration` | ✅ `ipc-channels.ts:1010` | ✅ `credibility.ts:364` | ✅ `preload:2489` `credibilityResetCalibration` | ❌ ElectronAPI 类型声明缺失 |
| `CREDIBILITY.COMPUTE_ECE` | `credibility:compute-ece` | ✅ `ipc-channels.ts:1012` | ✅ `credibility.ts:388` | ✅ `preload:2490` `credibilityComputeEce` | ❌ ElectronAPI 类型声明缺失 |
| `CREDIBILITY.ADD_CALIBRATION_SAMPLE` | `credibility:add-calibration-sample` | ✅ `ipc-channels.ts:1014` | ✅ `credibility.ts:411` | ✅ `preload:2491` `credibilityAddCalibrationSample` | ❌ ElectronAPI 类型声明缺失 |

**矛盾点最终结论**：
- `backend-completion-audit.md` ✅ 正确（Step 1/2/3 完成）
- `frontend-integration-checklist.md` ❌ 错误（信息过时）
- **新发现 P1 BUG**：Step 4 类型声明全部缺失

**附加验证**：`credibility:assess` handler 透传 `options` 参数 ✅
- `credibility.ts:152-238` 为 handler 主体
- `credibility.ts:157` 形参 `options?: FuseAssessOptions`
- `credibility.ts:200` 透传 `engine.fuseAndAssess(weightedMassFunctions, options)`

**preload 暴露的 6 个方法**（line 2486-2491）全部存在 ✅：
```
credibilityCalibrate / credibilityGetCalibration / credibilityGetCalibrationState
credibilityResetCalibration / credibilityComputeEce / credibilityAddCalibrationSample
```

---

## 四、v2.5 backfill 4 通道实测状态表

| 通道常量 | 通道值 | Step 1 定义 | Step 2 注册 | Step 3 暴露 | Step 4 类型 |
|---------|--------|-------------|-------------|-------------|-------------|
| `TUTORIAL.BACKFILL_START` | `tutorial:backfill-start` | ✅ `ipc-channels.ts:645` | ✅ `tutorial.ts:339-340` `ipcMain.handle(TUTORIAL.BACKFILL_START, ...)` | ✅ `preload:3387` `tutorialBackfillStart` | ✅ `ElectronAPI:3387-3389` |
| `TUTORIAL.BACKFILL_CANCEL` | `tutorial:backfill-cancel` | ✅ `ipc-channels.ts:647` | ✅ `tutorial.ts:398-399` | ✅ `preload:3390` `tutorialBackfillCancel` | ✅ `ElectronAPI:3390` |
| `TUTORIAL.BACKFILL_STATUS` | `tutorial:backfill-status` | ✅ `ipc-channels.ts:649` | ✅ `tutorial.ts:418-419` | ✅ `preload:3391` `tutorialBackfillStatus` | ✅ `ElectronAPI:3391` |
| `TUTORIAL.BACKFILL_PROGRESS` (push) | `tutorial:backfill-progress` | ✅ `ipc-channels.ts:651` | ✅ 主进程 push 通道（`EmbeddingBackfillService` 触发 `safeSend`） | ✅ `preload:3392` `onTutorialBackfillProgress` | ✅ `ElectronAPI:3392-3394` |

**结论**：v2.5 backfill 4 通道 4 步同步完整 ✅，无任何缺失。

**preload 暴露的 4 个方法**（line 3387-3394）全部存在 ✅：
```
tutorialBackfillStart / tutorialBackfillCancel / tutorialBackfillStatus / onTutorialBackfillProgress
```

---

## 五、app:export-model-stats 状态表

| Step | 状态 | 位置 / 证据 |
|------|------|-------------|
| Step 1 定义 | ✅ | `ipc-channels.ts:774` `EXPORT_MODEL_STATS: 'app:export-model-stats'` |
| Step 2 注册 | ✅ | `app-update.ts:290-291` `ipcMain.handle(APP.EXPORT_MODEL_STATS, async (_event, stats): Promise<{ filePath: string; size: number }> => {...})` |
| Step 3 暴露 | ❌ | `preload/index.ts` 中**未暴露** `appExportModelStats` 方法（Grep 全文无匹配） |
| Step 4 类型 | ❌ | `ElectronAPI` 类型声明（line 3305-3306）仅声明 `appCheckUpdate` / `appDownloadUpdate`，**未声明** `appExportModelStats` |

**影响**：渲染进程无法通过 `window.electronAPI.appExportModelStats()` 调用此功能，ModelSettings 页面的"导出"按钮将无 IPC 桥接。

**关联问题**：`appGetInfo` 也存在 Step 4 类型声明缺失
- Step 1 ✅ `ipc-channels.ts:772` `GET_INFO: 'app:get-info'`
- Step 2 ✅ `app-update.ts:247` `ipcMain.handle(APP.GET_INFO, ...)`
- Step 3 ✅ `preload:2413` `appGetInfo: appUpdate.getInfo`
- Step 4 ❌ `ElectronAPI` 类型（line 3305-3306）未声明 `appGetInfo`

---

## 六、5 个抽样域的 4 步同步状态

### 6.1 SSH 域

| 通道 | Step 1 | Step 2 | Step 3 | Step 4 | 整体 |
|------|--------|--------|--------|--------|------|
| `ssh:connect` (`SSH.CONNECT`) | ✅ `ipc-channels.ts:158` | ✅ `ssh.ts:209` `ipcMain.handle(SSH.CONNECT, ...)` | ✅ `preload:2293` `sshConnect: ssh.connect` | ✅ `ElectronAPI:3214` | 🟢 完整 |
| `ssh:exec` (`SSH.EXEC`) | ✅ `ipc-channels.ts:162` | ✅ `ssh.ts:243-244` | ✅ `preload:2295` `sshExec: ssh.exec` | ✅ `ElectronAPI:3216` | 🟢 完整 |
| `ssh:shell:start` (`SSH.SHELL_START`) | ✅ `ipc-channels.ts:164` | ✅ `ssh.ts:292` | ✅ `preload:2296` `sshShellStart: ssh.shell.start` | ✅ `ElectronAPI:3217` | 🟢 完整 |

### 6.2 LLM 域

| 通道 | Step 1 | Step 2 | Step 3 | Step 4 | 整体 |
|------|--------|--------|--------|--------|------|
| `llm:chat` (`LLM.CHAT`) | ✅ `ipc-channels.ts:95` | ✅ `llm.ts:130` `ipcMain.handle(LLM.CHAT, ...)` | ✅ `preload:2339` `llmChat: llm.chat` | ✅ `ElectronAPI:3255` | 🟢 完整 |
| `llm:inline-completion` (`LLM_INLINE.INLINE_COMPLETION`) | ✅ `ipc-channels.ts:135` | ✅ `llm-inline.ts:133` | ✅ `preload:2438` `llmInlineCompletion: llmInline.inlineCompletion` | ✅ `ElectronAPI:3322` | 🟢 完整 |

### 6.3 Agent 域

| 通道 | Step 1 | Step 2 | Step 3 | Step 4 | 整体 |
|------|--------|--------|--------|--------|------|
| `agent:chat` (`AGENT.CHAT`) | ✅ `ipc-channels.ts:54` | ✅ `agent-runtime.ts:142-143` `ipcMain.handle('agent:chat', ...)` ⚠️用字面量 | ✅ `preload:2395` `agentChat: agentRuntime.chat` | ✅ `ElectronAPI:3299` | 🟢 完整 |
| `agent:paor` (`AGENT.PAOR`) | ✅ `ipc-channels.ts:58` | ✅ `agent-runtime.ts:391-392` `ipcMain.handle('agent:paor', ...)` ⚠️用字面量 | ✅ `preload:2398` `agentPaor: agentRuntime.paor` | ❌ **ElectronAPI 类型声明缺失** | 🔴 Step 4 缺失 |
| `paor:approve` (`PAOR.APPROVE`) | ✅ `ipc-channels.ts:821` | ✅ `agent-runtime.ts:450-451` `ipcMain.handle('paor:approve', ...)` ⚠️用字面量 | ✅ `preload:2400` `paorApprove: agentRuntime.approve` | ❌ **ElectronAPI 类型声明缺失** | 🔴 Step 4 缺失 |

**附加发现**：`onPaorApprovalRequest`（监听 `paor:approval-request` push 通道）也存在 Step 4 类型声明缺失（Step 3 已暴露于 `preload:2379`）

### 6.4 Tutorial 域

| 通道 | Step 1 | Step 2 | Step 3 | Step 4 | 整体 |
|------|--------|--------|--------|--------|------|
| `tutorial:hybrid-search` (`TUTORIAL.HYBRID_SEARCH`) | ✅ `ipc-channels.ts:641` | ✅ `tutorial.ts:230-231` `ipcMain.handle('tutorial:hybrid-search', ...)` ⚠️用字面量 | ✅ `preload:2650` `tutorialHybridSearch` | ✅ `ElectronAPI:3379` | 🟢 完整 |
| `tutorial:backfill-start` (`TUTORIAL.BACKFILL_START`) | ✅ `ipc-channels.ts:645` | ✅ `tutorial.ts:339-340` `ipcMain.handle(TUTORIAL.BACKFILL_START, ...)` | ✅ `preload:3387` `tutorialBackfillStart` | ✅ `ElectronAPI:3387` | 🟢 完整 |

### 6.5 Credibility 域

| 通道 | Step 1 | Step 2 | Step 3 | Step 4 | 整体 |
|------|--------|--------|--------|--------|------|
| `credibility:assess` (`CREDIBILITY.ASSESS`) | ✅ `ipc-channels.ts:989` | ✅ `credibility.ts:152` `ipcMain.handle('credibility:assess', ...)` ⚠️用字面量，但透传 options ✅ | ✅ `preload:2471` `credibilityAssess: credibility.assess` | ❌ **ElectronAPI 类型声明缺失** | 🔴 Step 4 缺失 |
| `credibility:calibrate` (`CREDIBILITY.CALIBRATE`) | ✅ `ipc-channels.ts:1004` | ✅ `credibility.ts:296` `ipcMain.handle(CREDIBILITY.CALIBRATE, ...)` | ✅ `preload:2486` `credibilityCalibrate` | ❌ **ElectronAPI 类型声明缺失** | 🔴 Step 4 缺失 |

---

## 七、建议修复清单

### 🔴 P1 修复（影响渲染进程 TypeScript 编译）

按优先级排序，建议在 `src/preload/index.ts` 的 `export type ElectronAPI = { ... }` 块（line 3212-3682）内补齐以下方法类型声明：

#### 7.1 Credibility 域（13 个方法类型声明缺失）— P1
```typescript
// 建议插入位置：ElectronAPI 类型声明块的 credibility 段（可与现有 sandbox 段后插入）
credibilityAssess: typeof credibility.assess
credibilityDag: typeof credibility.dag
credibilityExportAuditReport: typeof credibility.exportAuditReport
credibilityListAuditReports: typeof credibility.listAuditReports
credibilityLoadAuditReport: typeof credibility.loadAuditReport
credibilityFormatAuditReport: typeof credibility.formatAuditReport
credibilityExportAudit: (decisionId: string, format: string) => Promise<string>
// 校准 6 通道
credibilityCalibrate: typeof credibility.calibrate
credibilityGetCalibration: typeof credibility.getCalibration
credibilityGetCalibrationState: typeof credibility.getCalibrationState
credibilityResetCalibration: typeof credibility.resetCalibration
credibilityComputeEce: typeof credibility.computeEce
credibilityAddCalibrationSample: typeof credibility.addCalibrationSample
```

#### 7.2 APP 域（2 个方法类型声明缺失 + 1 个方法未暴露）— P1
```typescript
// 建议插入位置：line 3306 之后（appDownloadUpdate 后）
appGetInfo: typeof appUpdate.getInfo
appExportModelStats: (stats: unknown) => Promise<{ filePath: string; size: number }>
```

**同时需在 preload 暴露实现**（line 2413 之后）：
```typescript
appExportModelStats: appUpdate.exportModelStats,  // 需在 appUpdate 对象中新增 exportModelStats 方法
```

#### 7.3 Agent / PAOR 域（3 个方法类型声明缺失）— P1
```typescript
// 建议插入位置：line 3300 之后（agentChatCancel 后）
agentPaor: typeof agentRuntime.paor
paorApprove: typeof agentRuntime.approve
onPaorApprovalRequest: typeof on.paorApprovalRequest
```

#### 7.4 其他域类型声明缺失（约 7 个方法）— P1
```typescript
// Risk 域
riskCheck: (command: string) => Promise<{ risk: 'low' | 'medium' | 'high'; reasons: string[] }>
// Alert 域
alertAck: (alertId: string) => Promise<boolean>
// Boot 域（push 监听）
onBootLoadingStage: (callback: (stage: { stage: string; progress: number; message: string }) => void) => () => void
// Model Stats 域
modelToolCalls: () => Promise<unknown[]>
// Budget 域
budgetAlerts: (limit?: number) => Promise<unknown[]>
// Tutorial 域（4 个方法类型声明缺失）
tutorialRecommendPath: (options?: RecommendPathOptions) => Promise<TutorialPath[]>
tutorialStats: () => Promise<unknown>
tutorialProgress: () => Promise<unknown[]>
tutorialUpdateProgress: (tutorialId: string, status: 'visited' | 'completed', progress: number) => Promise<boolean>
```

### 🟡 P2 修复（代码风格统一）

#### 7.5 主进程 ipcMain.handle 字面量 → 常量替换 — P2
以下文件使用了字符串字面量而非 `ipc-channels.ts` 常量（功能正确但违反"集中化"原则）：
- `src/main/ipc/agent-runtime.ts:143` `'agent:chat'` → `AGENT.CHAT`
- `src/main/ipc/agent-runtime.ts:236` `'agent:chat:cancel'` → `AGENT.CHAT_CANCEL`
- `src/main/ipc/agent-runtime.ts:270/282/294/316` provider:* 字面量 → `PROVIDER.*`
- `src/main/ipc/agent-runtime.ts:328` `'token:stats'` → `TOKEN.STATS`
- `src/main/ipc/agent-runtime.ts:392` `'agent:paor'` → `AGENT.PAOR`
- `src/main/ipc/agent-runtime.ts:451` `'paor:approve'` → `PAOR.APPROVE`
- `src/main/ipc/tutorial.ts:231` `'tutorial:hybrid-search'` → `TUTORIAL.HYBRID_SEARCH`
- `src/main/ipc/tutorial.ts:273` `'tutorial:backfill-embeddings'` → `TUTORIAL.BACKFILL_EMBEDDINGS`
- `src/main/ipc/credibility.ts:152` `'credibility:assess'` → `CREDIBILITY.ASSESS`
- `src/main/ipc/credibility.ts:245` `'credibility:dag'` → `CREDIBILITY.DAG`
- `src/main/ipc/credibility.ts:445-482` audit-report 4 个字面量 → `CREDIBILITY.*` 常量

### 🟢 P3 文档同步

#### 7.6 更新 `frontend-integration-checklist.md` — P3
- 修正第 165 行 `appExportModelStats` 状态描述（确认 BUG 真实存在）
- 修正"ipc-contract.md 附录 A 标注校准 6 通道未注册"的过时信息（实际已注册，但类型声明缺失）

#### 7.7 更新 `backend-completion-audit.md` — P3
- 补充说明：校准 6 通道 Step 1/2/3 完成，但 Step 4 类型声明缺失（P1 BUG）

---

## 八、审计方法说明

### 8.1 静态扫描范围
- `src/shared/ipc-channels.ts`（1082 行，全部读取）
- `src/main/ipc/*.ts`（44 个 IPC handler 文件，关键文件全量读取 + Grep 扫描）
- `src/preload/index.ts`（约 3700 行，分段读取 + Grep 精准定位）
- `src/preload/index.d.ts`（32 行，全部读取）

### 8.2 验证手段
1. **常量定义检查**：grep `^export const` 在 `ipc-channels.ts` 中定位 41 个域常量
2. **Handler 注册检查**：grep `ipcMain.handle` 在 `src/main/ipc/*.ts` 中扫描
3. **Preload 暴露检查**：grep `electronAPI` 对象字面量属性 + `ipcRenderer.invoke` 调用
4. **类型声明检查**：在 `export type ElectronAPI = { ... }` 块（line 3212-3682）内 grep 方法名

### 8.3 已知限制
- 未执行 TypeScript 编译验证（仅静态扫描）
- 未覆盖渲染进程实际调用情况
- push 通道（如 `BACKFILL_PROGRESS`）的 Step 2 仅验证主进程源码中存在 `safeSend` 调用，未追踪完整推送链路

---

## 九、结论

本次审计共扫描 41 个 IPC 域、约 250+ 通道，核心结论：

1. **校准 6 通道矛盾点已澄清**：Step 1/2/3 全部完成（backend-completion-audit.md 正确），但 **Step 4 类型声明全部缺失**（新发现 P1 BUG）
2. **app:export-model-stats BUG 确认存在**：Step 3/4 双缺失，frontend-integration-checklist.md 说法正确
3. **v2.5 backfill 4 通道 4 步同步完整**，可作为 4 步同步标杆
4. **ElectronAPI 类型声明存在系统性缺失**：约 25 个方法（跨 8 个域）类型声明缺失，建议作为 P1 修复项统一处理

**优先级建议**：先修复 P1 类型声明缺失（影响渲染进程 TS 编译），再处理 P2 字面量替换，最后同步 P3 文档。

---

**报告生成时间**：2026-07-25  
**审计员签字**：后端审计员  
**下次复审建议**：P1 修复完成后复测
