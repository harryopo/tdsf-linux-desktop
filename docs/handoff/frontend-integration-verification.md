# 前端集成验证报告

> 生成时间：2026-07-25
> 验证范围：`tdsf-linux-desktop/src/renderer/src/**/*.{ts,tsx}` + `src/preload/index.ts` + `src/main/ipc/**`
> 验证目标：核对 `frontend-integration-checklist.md` 中 P0 项的实际状态
> 验证方式：静态代码扫描（Grep / Read / Glob）+ git log + 主进程 handler 注册核对
> 当前分支：`feat/design-migration`（HEAD: `94b7cf1`）
> 编译门禁：`pnpm typecheck:web` 通过（exit 0）

---

## 1. TOP 5 关键发现

### 🟢 发现 1：P0-1 ModelSettings 导出统计 BUG 已被静默修复

原 checklist 标注 `ModelSettings.tsx:396` 调用不存在的 `exportModelStats`，且 preload 未暴露该 API。**实际状态：已修复**。

- `src/preload/index.ts:1009-1012` 已暴露 `exportModelStats`（注意：是 `exportModelStats` 而非 checklist 建议的 `appExportModelStats`）
- `src/main/ipc/app-update.ts:291` 已注册 `APP.EXPORT_MODEL_STATS` handler
- `src/renderer/src/pages/ModelSettings.tsx:395-396` 调用 `window.electronAPI.exportModelStats(stats)` 三端一致

修复方式与 checklist 建议不同（建议改名为 `appExportModelStats`，实际是 preload 暴露了 `exportModelStats` 这个名字），但功能闭环正确。

### 🟡 发现 2：P0-3 PAOR 审批响应链已接入，但启动入口缺失

原 checklist 标注 PAOR 完全未接入。**实际状态：部分修复**。

- ✅ `AIPanel.tsx:90-105` 订阅 `onPaorApprovalRequest` + 调用 `paorApprove`
- ✅ `PaorApprovalCard.tsx` 已实现（位于 `components/workbench/panels/PaorApprovalCard.tsx`，82 行，含批准/拒绝按钮 + 60 秒自动拒绝提示）
- ✅ `MessageList.tsx:12,78,94` 引用 PaorApprovalCard 渲染审批队列
- ❌ **`agentPaor` 在 renderer 中无任何调用**（Grep `agentPaor\s*\(` 仅命中 `types/electron.d.ts:835` 类型声明）
- ❌ ChatPanel.tsx / Composer.tsx 均无 PAOR 启动入口按钮

即：审批弹窗链路已通，但用户无法主动触发 PAOR 自动循环。当前只能由后端主动推送审批请求时才生效。

### 🔴 发现 3：P0-2 v2.5 异步 backfill 4 通道完全未接入

原 checklist 标注未接入。**实际状态：仍存在，前端未接入**。

- ✅ 后端就绪：`src/main/ipc/tutorial.ts:340/399/419` 注册 `TUTORIAL.BACKFILL_START/CANCEL/STATUS` + progress push 通道
- ✅ preload 暴露：`src/preload/index.ts:3387-3392` 暴露 `tutorialBackfillStart/Cancel/Status/onTutorialBackfillProgress` 4 个 API
- ❌ 前端 `useHybridSearch.ts:335` 仍调用旧版同步 `tutorialBackfillEmbeddings`，未替换为异步通道
- ❌ 无进度条订阅、无取消按钮、无页面刷新后状态恢复

风险：2578 条教程首次回填仍会阻塞 UI 1-3 分钟。

### 🔴 发现 4：P0-4 CalibrationSettings 组件仍未创建 + checklist 关于主进程的描述有误

原 checklist 标注组件不存在，且 ipc-contract.md 附录 A 标注"主进程未注册 handler"。**实际状态：组件确实不存在，但主进程已注册全部 6 个 handler**。

- ❌ `pages/CalibrationSettings.tsx` 不存在（Glob 无结果）
- ❌ `pages/SettingsLayout.tsx` 6 项导航无"校准"项（仅通用/SSH/AI引擎/告警阈值/外观/关于）
- ✅ **主进程已注册全部 6 个 handler**（`src/main/ipc/credibility.ts:297/327/346/365/389/412`）：
  - `CREDIBILITY.CALIBRATE` / `GET_CALIBRATION` / `GET_CALIBRATION_STATE` / `RESET_CALIBRATION` / `COMPUTE_ECE` / `ADD_CALIBRATION_SAMPLE`
- ✅ preload 已暴露 6 个 API

**checklist 与 ipc-contract.md 关于"主进程未注册 handler"的描述是错误的**，接手 AI 可直接新建组件接入，无需先验证主进程。

### 🔴 发现 5：前端正在被其他 AI 重构，但 P0 项修复进度有限

- HEAD 分支：`feat/design-migration`
- 自 2026-07-24 起 3 次提交：
  1. `94b7cf1` feat(ui): 视觉优化 — design-app 精华移植 + Agent 链路 UI 打磨
  2. `48d3ea3` feat(v2.4): 后端完善循环工程 - Phase A-D 全部完成 + 前后端交接契约
  3. `a104e71` refactor(ui-v3.0): phase 1 - 清理 3850+ 行死代码
- 未提交变更：`MainLayout.css/ts` / `AIPanel.tsx` / `WorkbenchPage.tsx`（视觉优化进行中）
- 重构方向：UI 设计稿对齐 + 死代码清理，**未涉及 P0 项的功能性修复**（除 P0-1 exportModelStats 和 P0-3 PAOR 审批响应链）

---

## 2. P0 项状态矩阵

| P0 项 | checklist 标注 | 实际状态 | 修复进度 |
|-------|---------------|---------|---------|
| **P0-1** ModelSettings 导出统计 BUG | 仍存在 | ✅ **已修复** | preload 第 1009 行暴露 `exportModelStats` + 主进程注册 handler + 前端调用一致 |
| **P0-2** v2.5 异步 backfill 4 通道 | 未接入 | ❌ **仍存在** | 前端 useHybridSearch 仍用旧版同步 `tutorialBackfillEmbeddings`，未接入 4 个异步通道 |
| **P0-3** PAOR 自动循环 | 完全未接入 | ⚠️ **部分修复** | 审批响应链已通（AIPanel + PaorApprovalCard + MessageList），但 `agentPaor` 启动入口缺失 |
| **P0-4** CalibrationSettings 组件 | 不存在 | ❌ **仍存在** | 组件未创建 + SettingsLayout 无"校准"导航项；但主进程 6 个 handler 已注册（与 checklist 描述不符） |
| **P0-5** 高风险孤儿 API | 未接入 | ❌ **仍存在** | `agentPaor` / `tutorialBackfillStart` / `credibilityCalibrate` 等 P0 级 API 仍孤儿（renderer 中无调用） |

---

## 3. 前端重构进度

### 3.1 最近 20 次前端提交（src/renderer/）

```
94b7cf1 feat(ui): 视觉优化 — design-app 精华移植 + Agent 链路 UI 打磨
48d3ea3 feat(v2.4): 后端完善循环工程 - Phase A-D 全部完成 + 前后端交接契约
a104e71 refactor(ui-v3.0): phase 1 - 清理 3850+ 行死代码
88317af refactor(redesign): SettingsLayout nav 6 项对齐设计稿
ddbe5ce refactor(redesign): HistoryPage 卡片阴影 1:1 对齐设计稿
4910d50 refactor(redesign): TutorialPage + Detail 1:1 对齐最新设计稿
06c4468 refactor(settings): 修正 GeneralSettings/AppearanceSettings Page Header icon
fb8d911 refactor(redesign): KnowledgePage + KnowledgeDetailPage 1:1 对齐设计稿
a65bc5a refactor(redesign): LogsPage 1:1 对齐最新设计稿
1e455ce refactor(redesign): ModelSettings 1:1 对齐最新设计稿
278ab65 refactor(redesign): SshSettings 1:1 对齐最新设计稿
e43b862 refactor(redesign): MonitorPage 1:1 对齐设计稿（KpiCard 环形图 + spacer 压缩）
28413c0 refactor(redesign): SettingsPage 1:1 对齐设计稿 9 卡片网格 + 控件预览
69424d1 refactor(redesign): WorkbenchPage 1:1 对齐最新设计稿
24cb742 refactor(M5): SshSettings 832 行拆分为 4 Card 组件
6102a50 refactor(M5): ModelSettings 1276 行拆分为 7 Section 组件
c6e2cef feat(M5): SettingsPage 9 卡片增加字段预览
e5b09df feat(M5): DecisionSettings 6 源权重影响 credibilityAssess
14debeb feat(M5): BootPage 进度条对接真实加载阶段
a79e465 feat(M5): SettingsLayout nav 补齐 6 项（新增决策控制 + 风险控制）
```

### 3.2 交接文档生成后（2026-07-24 起）的变更

仅 3 次提交：
1. **UI 视觉优化**（design-app 精华移植 + Agent 链路 UI 打磨）—— 视觉层面
2. **v2.4 后端完善循环工程**（Phase A-D 全部完成 + 前后端交接契约）—— 后端为主
3. **ui-v3.0 phase 1 死代码清理**（3850+ 行）—— 重构

### 3.3 未提交变更（git status）

```
 M src/renderer/src/components/layout/MainLayout.css
 M src/renderer/src/components/layout/MainLayout.tsx
 M src/renderer/src/components/workbench/AIPanel.tsx
 M src/renderer/src/pages/WorkbenchPage.tsx
```

视觉优化进行中，AIPanel.tsx 有未提交修改（与 PAOR 审批响应链接入可能是同一波改动）。

### 3.4 重构方向总结

- **重构重点**：UI 设计稿 1:1 对齐 + 死代码清理 + 视觉打磨
- **未涉及**：P0 项的功能性接入（v2.5 backfill / CalibrationSettings / agentPaor 启动入口）
- **已顺带修复**：P0-1 exportModelStats（preload 补暴露）、P0-3 PAOR 审批响应链（AIPanel 接入）
- **编译门禁**：`pnpm typecheck:web` 通过（exit 0）

---

## 4. 建议行动清单（按优先级排序）

### 🔴 P0 最高优先级（阻塞核心功能 / 比赛演示路径）

1. **接入 v2.5 异步 backfill 4 通道**（`useHybridSearch.ts`）
   - 工作量：~2 小时
   - 步骤：
     1. 在 `useHybridSearch.ts:335` 用 `tutorialBackfillStart()` 替换 `tutorialBackfillEmbeddings()`
     2. 订阅 `onTutorialBackfillProgress`，将 `p.pct` / `p.eta` 写入 progress state（替换当前 indeterminate 进度）
     3. 任务结束时（status = completed/cancelled/failed）调用 unsubscribe + 重新拉取 `tutorialSearchStatus`
     4. 在 TutorialPage 提供「取消回填」按钮调用 `tutorialBackfillCancel`
     5. 页面刷新后用 `tutorialBackfillStatus` 恢复 UI 状态
   - 验证：2578 条教程首次回填时 UI 不阻塞，进度条 0-100% 平滑推进
   - **理由**：比赛演示核心场景，当前会阻塞 UI 1-3 分钟

2. **补齐 PAOR 启动入口**（`AIPanel.tsx` / `Composer.tsx`）
   - 工作量：~1 小时
   - 步骤：
     1. 在 AIPanel 工具栏或 Composer 增加「PAOR 自动循环」按钮
     2. 按钮调用 `agentPaor(task, sshSessionId, maxIterations?)`（需传入当前任务描述 + activeSessionId）
     3. 复用已有的 `paorApprovals` 队列 + `PaorApprovalCard` 渲染
   - 验证：点击按钮后触发 PAOR，遇到 HIGH/CRITICAL 风险命令时弹出 PaorApprovalCard
   - **理由**：审批响应链已通，缺一个启动入口即可闭环

3. **新建 CalibrationSettings 组件**（`pages/CalibrationSettings.tsx`）
   - 工作量：~3 小时
   - 步骤：
     1. 新建 `pages/CalibrationSettings.tsx`，接入 6 个 API（`credibilityCalibrate` / `GetCalibration` / `GetCalibrationState` / `ResetCalibration` / `ComputeEce` / `AddCalibrationSample`）
     2. 在 `pages/SettingsLayout.tsx:33` 的 `SETTINGS_NAV` 数组添加「校准」导航项（建议插入在「AI 引擎」之后）
     3. 在路由配置注册 `/settings/calibration` 路由
   - 验证：调用 `credibilityComputeEce('deepseek', 10)` 返回 ECE 值
   - **理由**：主进程 6 个 handler 已就绪（credibility.ts:297-412），preload 已暴露，仅缺前端组件

### 🟡 P1 中优先级（提升功能完整度）

4. **修正 ipc-contract.md 附录 A 关于校准 handler 的描述**
   - 文档标注「主进程未注册 credibility:calibrate handler」—— 实际已注册全部 6 个
   - 避免接手 AI 误判

5. **接入 historySave**（决策卡片入库）
   - 主进程 P-8 已修复，前端未消费
   - 在 DecisionPage / DecisionDetailPage 完成 / 修改时调用 `historySave(card)`

6. **接入 Claude Agent SDK 6 通道**
   - 根据 Provider 类型分流：`provider.type === 'claude-sdk'` → 走 `claudeSdkStream`

### 🟢 P2 低优先级（可选，提升体验）

7. 接入 Provider 能力 + 定价矩阵（`providerCapabilities/Pricing` 4 个）
8. 接入合规审计报告（`credibilityExportAuditReport` 等 4 个）
9. 接入知识库 CRUD 完整链（`kbDelete/Export/Import`）
10. 接入沙箱容器生命周期（`sandboxDetectDocker/Start/Stop/Status/Delete` 5 个）

---

## 5. 附录：验证证据

### 5.1 P0-1 修复证据

```
src/preload/index.ts:1009-1012
  exportModelStats: (
    stats: unknown
  ): Promise<{ filePath: string; size: number }> =>
    ipcRenderer.invoke(APP.EXPORT_MODEL_STATS, stats),

src/main/ipc/app-update.ts:291
    APP.EXPORT_MODEL_STATS,

src/renderer/src/pages/ModelSettings.tsx:395-396
  if (isElectronAPIAvailable() && window.electronAPI?.exportModelStats) {
    const { filePath, size } = await window.electronAPI.exportModelStats(stats)
```

### 5.2 P0-3 PAOR 接入证据

```
src/renderer/src/components/workbench/AIPanel.tsx:90-105
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onPaorApprovalRequest) return
    return api.onPaorApprovalRequest((request: PaorApprovalRequest) => {
      setPaorApprovals((prev) => [...prev, request])
    })
  }, [])

  const handlePaorApprove = async (callId: string, approved: boolean) => {
    const api = window.electronAPI
    if (!api?.paorApprove) return
    await api.paorApprove(callId, approved)
    setPaorApprovals((prev) => prev.filter((r) => r.callId !== callId))
  }

src/renderer/src/components/workbench/panels/PaorApprovalCard.tsx（82 行，完整实现）
src/renderer/src/components/workbench/MessageList.tsx:12
  import PaorApprovalCard from './panels/PaorApprovalCard'
```

### 5.3 P0-2 v2.5 backfill 未接入证据

```
src/renderer/src/hooks/useHybridSearch.ts:335
  const fn = api!.tutorialBackfillEmbeddings as (
    options?: { batchSize?: number }
  ) => Promise<BackfillResult>

src/preload/index.ts:3387-3392（已暴露但未消费）
  tutorialBackfillStart: (
  tutorialBackfillCancel: () => Promise<BackfillCancelResult>
  tutorialBackfillStatus: () => Promise<BackfillStatusResult>
  onTutorialBackfillProgress: (

src/main/ipc/tutorial.ts:340/399/419（handler 已注册）
  TUTORIAL.BACKFILL_START
  TUTORIAL.BACKFILL_CANCEL
  TUTORIAL.BACKFILL_STATUS
```

### 5.4 P0-4 CalibrationSettings 未创建证据

```
Glob: src/renderer/src/pages/*Calibration* → No file found
Glob: src/renderer/src/**/Calibration* → No file found

src/renderer/src/pages/SettingsLayout.tsx:33-40（6 项导航无"校准"）
  const SETTINGS_NAV: SettingsNavItem[] = [
    { to: '/settings/general', label: '通用', ... },
    { to: '/settings/ssh', label: 'SSH 连接', ... },
    { to: '/settings/model', label: 'AI 引擎', ... },
    { to: '/settings/alerts', label: '告警阈值', ... },
    { to: '/settings/appearance', label: '外观', ... },
    { to: '/settings/about', label: '关于', ... },
  ]

src/main/ipc/credibility.ts:297/327/346/365/389/412（主进程已注册 6 个 handler，与 checklist 描述不符）
  CREDIBILITY.CALIBRATE
  CREDIBILITY.GET_CALIBRATION
  CREDIBILITY.GET_CALIBRATION_STATE
  CREDIBILITY.RESET_CALIBRATION
  CREDIBILITY.COMPUTE_ECE
  CREDIBILITY.ADD_CALIBRATION_SAMPLE
```

### 5.5 P0-5 高风险孤儿 API 验证

| API | preload 暴露 | 主进程 handler | renderer 调用 | 状态 |
|-----|-------------|---------------|--------------|------|
| `agentPaor` | ✅ | ✅ | ❌ 仅类型声明 | 孤儿 |
| `paorApprove` | ✅ | ✅ | ✅ AIPanel.tsx:103 | 已接入 |
| `onPaorApprovalRequest` | ✅ | ✅ | ✅ AIPanel.tsx:94 | 已接入 |
| `tutorialBackfillStart` | ✅ | ✅ | ❌ | 孤儿 |
| `tutorialBackfillCancel` | ✅ | ✅ | ❌ | 孤儿 |
| `tutorialBackfillStatus` | ✅ | ✅ | ❌ | 孤儿 |
| `onTutorialBackfillProgress` | ✅ | ✅ | ❌ | 孤儿 |
| `credibilityCalibrate` | ✅ | ✅ | ❌ | 孤儿 |
| `credibilityGetCalibration` | ✅ | ✅ | ❌ | 孤儿 |
| `credibilityGetCalibrationState` | ✅ | ✅ | ❌ | 孤儿 |
| `credibilityResetCalibration` | ✅ | ✅ | ❌ | 孤儿 |
| `credibilityComputeEce` | ✅ | ✅ | ❌ | 孤儿 |
| `credibilityAddCalibrationSample` | ✅ | ✅ | ❌ | 孤儿 |

---

## 6. 结论

- **5 项 P0 中**：1 项已修复（P0-1）、1 项部分修复（P0-3）、3 项仍存在（P0-2 / P0-4 / P0-5）
- **前端重构方向**：UI 设计稿对齐 + 死代码清理，未系统性推进 P0 功能接入
- **后端就绪度高**：v2.5 backfill 4 通道、PAOR 3 通道、Calibration 6 通道的主进程 handler + preload 暴露均已就绪，前端接入即可消费
- **checklist 描述偏差**：P0-4 关于"主进程未注册 calibration handler"的描述与代码不符（实际已注册），接手 AI 可直接新建组件

**接手 AI 起步建议**：
1. 先做 P0 第 2 项（v2.5 backfill）—— 比赛演示核心场景，2 小时可完成
2. 再做 P0 第 1 项（PAOR 启动入口）—— 审批链已通，补一个按钮即可闭环，1 小时可完成
3. P0 第 3 项（CalibrationSettings）—— 主进程已就绪，新建组件即可，3 小时可完成
