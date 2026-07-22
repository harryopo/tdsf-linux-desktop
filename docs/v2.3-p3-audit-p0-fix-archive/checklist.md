# v2.3 第五波 P3 审计 P0 红线修复 · 勾选清单

> 归档时间：2026-07-22

## P3-A 安全类（4 项）

- [x] P3-A1: ssh:exec zod 校验补齐（B9 用户输入 IPC 必须校验）
  - [x] 新增 `sshExecSchema` zod schema
  - [x] ssh:exec handler 中添加 safeParse 校验
  - [x] 校验失败时 throw Error + logger.warn
- [x] P3-A2: dangerouslySetInnerHTML XSS 防护（之前版本已完成）
  - [x] TutorialPage.tsx 已 import DOMPurify
  - [x] DOMPurify.sanitize 包裹 renderMarkdown
- [x] P3-A3: ssh.ts console.error 脱敏 + logger（之前版本已完成）
  - [x] ssh.ts 无 console 调用
  - [x] 全部使用 logger + redactSecrets
- [x] P3-A4: 两套脱敏函数 DRY 合并（之前版本已完成）
  - [x] redactSensitiveInfo 是 redactSecrets 的兼容包装
  - [x] 单一数据源在 core/agent/providers/redact.ts

## P3-B 红线类（4 项）

- [x] P3-B1: ssh:exec 字面量常量化（之前版本已完成）
  - [x] ssh.ts 使用 SSH.EXEC 常量
- [x] P3-B2: preload 87 处字面量常量化
  - [x] ipc-channels.ts 新增 11 个常量对象
  - [x] ipc-channels.ts 扩展 12 个已有常量对象
  - [x] preload/index.ts 87 处字面量替换为常量引用
  - [x] preload 0 处字面量（grep 验证）
  - [x] 修复 app-update.ts 预先存在 lint 错误
- [x] P3-B3: main.tsx 28 处硬编码颜色 token 化
  - [x] 新建 antd-tokens.ts 集中管理颜色
  - [x] main.tsx 从 190 行缩减到 100 行
  - [x] main.tsx 0 处硬编码颜色（grep 验证）
- [x] P3-B4: main/index.ts console 替换 logger（之前版本已完成）
  - [x] main/index.ts 无 console 调用

## P3-C 维护类（1 项）

- [x] P3-C1: AIPanel.tsx 拆分（B1 单文件 ≤500 行）
  - [x] 8 个内联子组件迁出到 panels/ 目录
  - [x] AIPanelHeader.tsx 提取（115 行）
  - [x] MessageList.tsx 提取（163 行）
  - [x] Composer.tsx 提取（463 行）
  - [x] ContextBadge.tsx 提取（81 行）
  - [x] TokenCostRow.tsx 提取（95 行）
  - [x] AIPanel.tsx 从 1921 行缩减到 274 行
  - [x] 所有新文件 ≤500 行

## P3-D 编译门禁三绿 + 全量测试

- [x] `pnpm typecheck:node` exit 0
- [x] `pnpm typecheck:web` exit 0
- [x] `pnpm lint` exit 0
- [x] 全量测试 1313/1314 通过（99.92%）
- [x] 唯一失败为历史已知 llm-client 问题

## P3-E 归档五件套

- [x] tasks.md（任务清单）
- [x] checklist.md（勾选清单，本文件）
- [x] verify-report.md（验证报告）
- [x] learnings.md（经验教训）
- [ ] Git commit
- [ ] 记忆保存
