# CLAUDE.md · TDSF Linux Desktop

> 本文件是 AI Agent 在本项目工作时的入口指引。
> 详细编码规范见 **`CODING.md`**，开发工作流见 **`AGENTS.md`**。
> 旧版归档于 `docs/archive/CLAUDE-v2.5.md`。

---

## 核心红线（详见 CODING.md）

1. IPC 必须 4 步同步（main → ipc/index → preload → electron.d.ts）
2. TypeScript strict 模式，禁止 any / 隐式 any
3. catch 块 error 写入日志前必须脱敏
4. 质量门禁五绿全过才能合并（typecheck:node + typecheck:web + lint + test + build:win）
5. 所有 CSS 颜色使用 `var(--trae-*)` token，禁止硬编码

## 技术栈

Electron 30 + React 18 + TypeScript strict + Antd 5 + Zustand + ssh2 + xterm.js + Vercel AI SDK

## 开发命令

```bash
pnpm dev             # 启动
pnpm typecheck:node  # 主进程类型检查
pnpm typecheck:web   # 渲染进程类型检查
pnpm lint            # ESLint
pnpm test            # 测试
pnpm build:win       # 打包
```

---

*规则全文见 CODING.md · 删比加重要*
