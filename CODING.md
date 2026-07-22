# CODING.md · TDSF Linux Desktop 开发规范

> 替代旧版 CLAUDE.md + AGENTS.md（归档至 `docs/archive/`）
> 核心理念：删比加重要 · 先验证再架构 · 为删而建
> 80 行核心规则。没有 B 级约束、没有 WIP 豁免、没有"开发阶段可临时违反"。

---

## 技术栈
Electron 30 + React 18 + TypeScript strict + Antd 5 + Zustand + ssh2 + xterm.js + Vercel AI SDK

## 目录结构
- `src/main/` → 主进程：IPC handlers, services, core
- `src/preload/` → 预加载：contextBridge 暴露 API
- `src/renderer/` → 渲染进程：React 组件、页面、stores
- `src/shared/` → 共享类型和常量

## IPC 铁律（不可绕过的 4 步）
1. `main/ipc/{domain}.ts` 定义 handler
2. `main/ipc/index.ts` 注册
3. `preload/index.ts` 暴露 API
4. `types/electron.d.ts` 声明类型
缺一步 = 不能合并。

## 安全底线
1. 所有 catch 块的 error.message 写入日志前必须 `redactSensitiveInfo()` 脱敏
2. SSH exec 必须经过高危命令黑名单（12 条正则）
3. 渲染层 `dangerouslySetInnerHTML` 必须经 `DOMPurify.sanitize()`
4. `.env` / `.ssh/` / `*_key` 相关内容在日志中自动替换为 `[REDACTED]`

## 质量门禁（CI 硬编码，不靠人记）
- `pnpm typecheck:node` → exit 0
- `pnpm typecheck:web` → exit 0
- `pnpm lint` → 0 errors
- `pnpm test` → 全量通过
- `pnpm build:win` → 成功生成 .exe

**五条全过才能合并。没有任何例外。**

## CSS 约定
所有颜色使用 `var(--trae-*)` 引用，禁止 `#ffffff` / `#fafafa` / `#0071e3` 等硬编码。

## Git 约定
- commit: `type(scope): description`（feat/fix/docs/refactor/test/chore）
- 分支: 直接 main，不需要多余分支策略
- 不在 commit message 中带 session ID

## 环境要求
- Node 18+
- pnpm 9+
- Python 3.11+（仅 sidecar-a 需要）
- Windows 11 + VS Build Tools

## 快速开始
```bash
pnpm install
pnpm dev
```

---

*CODING.md v1.0 · 2026-07-23 · 删比加重要*
