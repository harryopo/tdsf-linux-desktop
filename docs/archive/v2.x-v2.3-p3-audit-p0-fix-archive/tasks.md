# v2.3 第五波 P3 审计 P0 红线修复 · 任务清单

> 归档时间：2026-07-22
> 关联方案书：`docs/方案书-v2.3-第五波P3审计P0红线修复.md`
> 关联审计报告：`docs/v2.2-p2-agent-enhancement-archive/v2.2-audit-report.md`（68 问题，P0:9）

## 任务清单

| ID | 任务 | 约束 | 状态 | 实施方式 |
|----|------|------|------|---------|
| P3-A1 | ssh:exec zod 校验补齐 | B9 | ✅ 完成 | 新增 sshExecSchema + safeParse 校验 |
| P3-A2 | dangerouslySetInnerHTML XSS 防护 | 安全 | ✅ 已完成（之前版本） | DOMPurify.sanitize 包裹 |
| P3-A3 | ssh.ts console.error 脱敏 + logger | A3 | ✅ 已完成（之前版本） | redactSecrets + logger |
| P3-A4 | 两套脱敏函数 DRY 合并 | DRY | ✅ 已完成（之前版本） | redactSensitiveInfo 包装 redactSecrets |
| P3-B1 | ssh:exec 字面量常量化 | B4 | ✅ 已完成（之前版本） | SSH.EXEC 常量 |
| P3-B2 | preload 87 处字面量常量化 | B4 | ✅ 完成 | 11 新常量 + 12 常量扩展 + 87 处替换 |
| P3-B3 | main.tsx 28 处硬编码颜色 token 化 | B2 | ✅ 完成 | 新建 antd-tokens.ts 集中管理 |
| P3-B4 | main/index.ts console 替换 logger | A3 | ✅ 已完成（之前版本） | logger 替换 |
| P3-C1 | AIPanel.tsx 拆分（1921→274行） | B1 | ✅ 完成 | 16 个新文件全部 ≤500 行 |

## 关键交付物

### P3-A1: ssh:exec zod 校验
- 文件：`src/main/ipc/ssh.ts`
- 新增：`sshExecSchema` zod schema（sessionId 非空1-200 + command 非空1-10000）
- 新增：safeParse 校验逻辑 + 失败时 throw Error

### P3-B2: preload 字面量常量化
- 文件：`src/shared/ipc-channels.ts`（+11 新常量对象 +12 常量扩展）
- 文件：`src/preload/index.ts`（87 处字面量 → 常量引用）
- 文件：`src/main/ipc/app-update.ts`（修复预先存在 lint 错误）
- 新增常量对象：PROFILER / SYSTEM / CLAUDE_SDK / PROVIDER / CREDIBILITY / MODE / ATTENTION / EXPECTATION / TASK / SUBAGENT / PAOR
- 扩展常量对象：TOKEN / KNOWLEDGE / HISTORY / TUTORIAL / DEPLOY / LOG / SIDECAR / SANDBOX / MCP / DIAGNOSTICS / LOOP / AT_COMMANDS

### P3-B3: main.tsx 颜色 token 化
- 新建：`src/renderer/src/styles/antd-tokens.ts`（颜色单一数据源）
- 修改：`src/renderer/src/main.tsx`（190→100行，0 处硬编码颜色）

### P3-C1: AIPanel.tsx 拆分
- 新建 16 个文件：
  - `panels/MiniBar.tsx`（8行）
  - `panels/utils.ts`（16行）
  - `panels/RollbackPanel.tsx`（33行）
  - `panels/PausePanel.tsx`（43行）
  - `panels/LiveMessageRow.tsx`（66行）
  - `panels/ProgressPanel.tsx`（67行）
  - `panels/PaorApprovalCard.tsx`（81行）
  - `panels/MessageRow.tsx`（100行）
  - `panels/BlockRenderer.tsx`（110行）
  - `panels/ToolPanel.tsx`（389行）
  - `ContextBadge.tsx`（81行）
  - `TokenCostRow.tsx`（95行）
  - `AIPanelHeader.tsx`（115行）
  - `MessageList.tsx`（163行）
  - `Composer.tsx`（463行）
- 修改：`AIPanel.tsx`（1921→274行，84.9% 缩减）

## Hard Constraint 对齐

| 约束 | 对齐情况 |
|------|---------|
| A3 catch 块脱敏 | ✅ ssh.ts 全部使用 redactSecrets + logger |
| A4 诚实标注未完成 | ✅ WIP 标注图片上传死代码 |
| A7 质量绝对优先 | ✅ 不跳步不降级，全量替换 |
| A8 避免重复造轮子 | ✅ 复用 zod / DOMPurify / redactSecrets |
| B1 单文件 ≤500行 | ✅ AIPanel.tsx 274行，所有新文件 ≤500行 |
| B2 CSS 用 var(--trae-*) | ✅ main.tsx 0 处硬编码颜色 |
| B4 IPC 常量化 | ✅ preload 0 处字面量 |
| B9 用户输入 IPC zod 校验 | ✅ ssh:exec 补齐 zod schema |
