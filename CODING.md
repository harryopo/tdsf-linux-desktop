# CODING.md · TDSF-Linux Desktop 开发规范

> 配套 `CLAUDE.md` 使用：CLAUDE.md 是 AI 入口指引，本文件是编码细则。
> 核心理念：改比加重要，加比删重要 · 先验证再架构 · 为删而建
> 80 行核心规则。Demo 阶段允许 WIP 标注，发布前必须收敛。

---

## 技术栈
Electron 43 + React 18 + TypeScript strict + Antd 5 + Tailwind 4 + Zustand 4 + ssh2 + @xterm/xterm + Vercel AI SDK 7

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

## TypeScript 约束
- **允许边界 any**（如第三方库类型不全），**禁止业务 any**
- 禁止隐式 any（必须显式标注）
- 边界 any 必须配 `// @ts-expect-error` 注释说明原因

## 质量门禁（三绿硬 + 两绿软）
- **三绿硬门禁**（必须全过才能合并）：
  - `pnpm typecheck:node` → exit 0
  - `pnpm typecheck:web` → exit 0
  - `pnpm lint` → 0 errors（warnings 允许）
- **两绿软门禁**（尽量过，不过要在 PR 说明原因）：
  - `pnpm test` → 全量通过（可降级为只跑改动模块）
  - `pnpm build:win` → 成功生成 .exe（缺 SDK 时允许 SKIP，发布前必须 CI 跑通）

## CSS 约定
- **Demo 阶段允许硬编码颜色**，v1.1 统一 token 化
- 推荐：所有颜色使用 `var(--trae-*)` 引用
- 主色：低饱和靛蓝 `#4f46e5`（亮）/ `#818cf8`（暗）
- 卡片 hover 仅允许一种变化：阴影；禁止同时变 border + 位移 + scale

## Git 约定
- commit: `type(scope): description`（feat/fix/docs/refactor/test/chore）
- 分支: 直接 main，不需要多余分支策略
- 不在 commit message 中带 session ID（单 AI 模式）

## 功能废弃规范（降级保留原则）
- "降级"≠"完全切除"
- 任何功能废弃必须保留：代码文件 + 接口签名 + 类型声明
- 不允许"接口没了，类型没了，文件没了"
- v3.x 恢复时只需开关 flag，不需要重写

## 大文件治理
- 单文件 > 800 行：PR 中说明拆分计划
- 单文件 > 1500 行：必须拆分（除非有充分理由）
- 单文件 > 3000 行：硬限制，必须拆分

## 删除前检查
删除任何文件前必须：
1. `grep -r "import.*filename"` 确认无引用
2. `git log --oneline -5 -- <file>` 查看最近修改
3. 在 PR 中说明删除理由

## 多 AI 协作协议
- 比赛阶段强制单 AI 模式
- 若并行：git worktree 隔离 + 高共享文件禁止并行修改（preload/index.ts / main/ipc/index.ts / electron.d.ts）

## 性能基测（建议非强制）
- 冷启动 / 内存 / IPC 延迟基线
- 每周回归测试

## 打包规范
- 发布前必须 `pnpm build:win` 在 windows-latest CI 上跑通
- 本地打包失败时优先检查 .npmrc mirror 配置（参考 LRN-20260724-001）

## 环境要求
- Node 18+ / pnpm 11+
- Python 3.11+（仅 sidecar-a 需要）
- Windows 11 + VS Build Tools

## 快速开始
```bash
pnpm install
pnpm dev
```

---

*CODING.md v1.1 · 2026-07-25 · 改比加重要，加比删重要*
