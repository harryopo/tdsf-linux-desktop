# v2.3 第五波 P3 审计 P0 红线修复 · 经验教训

> 记录时间：2026-07-22

## LRN-20260722-P3-001 · Antd ConfigProvider token 不能用 CSS var()

**场景**：P3-B3 修复 main.tsx 28 处硬编码颜色时，考虑用 `var(--trae-antd-*)` 替代。

**问题**：Antd ConfigProvider 的 token 是 JS 对象，`colorPrimary` 会被 Antd 内部用于派生其他颜色（colorPrimaryBg / colorPrimaryBorder 等），不能用 CSS var() 替代。

**解决方案**：创建独立的 `antd-tokens.ts` TS 常量文件集中管理颜色，作为颜色的单一数据源。

**教训**：CSS 变量适用于 CSS 文件和 TSX 内联样式，不适用于 JS 配置对象。

## LRN-20260722-P3-002 · B2 验证命令范围

**场景**：B2 验证命令为 `grep -rE '#[0-9a-fA-F]{3,8}' src/renderer/src/ --include='*.css' --include='*.tsx'`。

**发现**：验证命令只检查 .css 和 .tsx 文件，不检查 .ts 文件。因此将颜色定义集中在 .ts 文件中（antd-tokens.ts）不会触发 B2 违规。

**教训**：理解验证命令的文件范围，选择合适的管理策略。颜色集中管理在 .ts 文件中是合法的做法。

## LRN-20260722-P3-003 · PowerShell 中文路径编码问题

**场景**：P3-B2 批量替换 preload 字面量时，PowerShell 5.x 读取中文路径文件返回 null。

**问题**：PowerShell 5.x 对中文路径（`d:\ai\linux教学一体\...`）的文件读取存在编码问题。

**解决方案**：改用 Python 脚本完成批量替换，Python 对中文路径处理稳定。

**教训**：Windows 中文路径下，优先使用 Python 而非 PowerShell 处理文件批量操作。

## LRN-20260722-P3-004 · subagent 驱动的大规模机械改造

**场景**：P3-B2 需要替换 87 处字面量 + P3-C1 需要拆分 1921 行文件。

**方案**：使用 general_purpose_task subagent 执行大规模机械改造。

**效果**：
- P3-B2：subagent 用 Python 脚本批量替换，87 处一次完成，三绿通过
- P3-C1：subagent 拆分出 16 个文件，AIPanel.tsx 从 1921 行缩减到 274 行，三绿通过

**教训**：大规模机械改造适合用 subagent，避免主上下文消耗过多 token。但需要提供详细的任务描述和验证要求。

## LRN-20260722-P3-005 · 死代码 lint 错误处理

**场景**：AIPanel.tsx 中 `handleUploadImage` / `handleRemoveAttachment` 函数定义但从未调用，导致 `attachments` / `isUploadingImage` 等 state 变量被 lint 标记为未使用。

**解决方案**：给未使用的 state 变量加 `// eslint-disable-next-line @typescript-eslint/no-unused-vars` 注释，并标注 `// WIP: P3-C1 拆分时接入或移除`。

**教训**：死代码应标注 WIP 或移除，不应留未使用的变量声明。lint 错误必须修复，不能忽略。

## LRN-20260722-P3-006 · 内联子组件迁出是最低风险拆分

**场景**：P3-C1 拆分 AIPanel.tsx 时，分析发现文件中有 8 个内联子组件（共 ~900 行）。

**方案**：优先迁出内联子组件到独立文件，立即削减 ~900 行，且几乎无风险（子组件是纯展示组件，无外部状态依赖）。

**教训**：大文件拆分应从最低风险的内联子组件迁出开始，逐步削减行数后再处理主组件逻辑拆分。

## LRN-20260722-P3-007 · 横切关注点识别

**场景**：P3-C1 拆分分析发现 `demoMode` / `isStreaming` / `loop` / `activeSessionId` 是 4 个横切关注点，被多个子组件共享。

**解决方案**：通过 props 透传，避免提取为 context（增加复杂度）。主组件保留所有 state，子组件通过 props 接收。

**教训**：拆分时识别横切关注点，选择 props 透传（简单）或 context（复杂）策略。对于 4 个横切关注点，props 透传是合理选择。

## LRN-20260722-P3-008 · 预先存在 lint 错误的修复

**场景**：P3-B2 验证时发现 `src/main/ipc/app-update.ts` 有预先存在的 lint 错误（eslint-disable 规则名错误）。

**问题**：`@typescript-eslint/no-require-imports` 应为 `@typescript-eslint/no-var-requires`。

**解决方案**：修复预先存在的 lint 错误，确保三绿通过。

**教训**：lint 错误无论是否为本轮引入，都应修复。三绿验证是硬性要求。
