# CLAUDE.md · TDSF-Linux Desktop

> 比赛截止 2026-07-30。质量优先，做大做精。

## 项目定位

**TDSF-Linux Desktop** = SSH 终端 + AI 辅助 + 高危拦截 + 日志分析 + 可信决策
帮助 Linux 初学者不怕命令行的桌面工具。

## 技术栈

- Electron 43 + React 18 + TypeScript strict + Antd 5 + Tailwind 4
- 状态：Zustand 4（计划升 5）
- SSH：ssh2 + @xterm/xterm + addon-fit/search/web-links
- AI：Vercel AI SDK 7（多模型路由）+ Anthropic Claude SDK（扩展思考）+ Mastra（Agent 编排）
- MCP：@modelcontextprotocol/sdk 1.0
- 数据库：better-sqlite3 + @photostructure/sqlite-vec（向量）
- 编辑器：monaco-editor + web-tree-sitter（语法）
- 安全：dompurify + zod

## 6 条核心红线（违反 = 不能合并）

1. **IPC 4 步同步**：main/ipc/handler → main/ipc/index.ts 注册 → preload 扁平暴露 → electron.d.ts 类型声明
2. **catch 脱敏**：error 写日志前必须 `redactSensitiveInfo()`，禁止泄漏 SSH 凭据/密钥
3. **高危命令黑名单**：SSH exec 必须经过 12 条高危命令拦截（rm -rf /、:(){:|:&};:、dd if=/dev/zero 等）
4. **Electron 安全三原则**：contextIsolation:true / nodeIntegration:false / sandbox:true（不可绕过）
5. **XSS 防护**：渲染层 `dangerouslySetInnerHTML` 必须 `DOMPurify.sanitize()`
6. **做事与打分分离**：声明"任务完成"前必须 dispatch 独立 verifier subagent，贴实际命令输出（不是总结）

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

## 开发命令

```bash
pnpm dev              # electron-vite dev
pnpm typecheck        # typecheck:node + typecheck:web
pnpm lint:fix         # 自动修复
pnpm test:watch       # 监听模式
pnpm test:e2e         # Playwright E2E
pnpm deadcode         # Knip 死代码扫描（不报错，本地建议）
pnpm deadcode:strict  # Knip 严格模式（本地建议、非 CI 强制；当前有已知 default 导出误报，需清理后才能作硬门禁）
pnpm build:win        # Windows 打包
pnpm rebuild          # 重编译原生模块（better-sqlite3, ssh2）
```

## AI 协作协议

> **协作模式唯一权威：`AGENTS.md` §文件所有权**。
> 当前允许几个 AI 并行、claim/release 工作流、高共享文件禁并行清单、
> 分支策略与冲突处理均以该节为准，本文件不另行定义协作模式。
> 模式变更只改 `AGENTS.md`；历史教训（calibration 误删）已沉淀于 `../.learnings/LEARNINGS.md`。

## 跨进程类型规则

- 跨进程共享类型必须放 `src/shared/`（不是 main/services/types）
- 主进程 types.ts 用 `export type { X } from '../../../shared/x-types'` 兼容
- 渲染层 `import type { X } from '@/shared/x-types'`

## 降级保留原则（关键）

- "降级"≠"完全切除"
- 任何功能废弃必须保留：代码文件 + 接口签名 + 类型声明
- 不允许"接口没了，类型没了，文件没了"
- v3.x 恢复时只需开关 flag，不需要重写

## 大文件治理（建议非强制）

- 单文件 > 800 行：PR 中说明拆分计划
- 单文件 > 1500 行：必须拆分（除非有充分理由）
- 单文件 > 3000 行：硬限制，必须拆分

## 删除前检查

删除任何文件前必须：
1. `grep -r "import.*filename"` 确认无引用
2. `git log --oneline -5 -- <file>` 查看最近修改
3. 在 PR 中说明删除理由

## 环境要求

- Node 18+ / pnpm 11+ / Python 3.11+（仅 sidecar-a）
- Windows 11 + VS Build Tools（编译原生模块）
- 缺 SDK 时 `pnpm rebuild` 重建 better-sqlite3 / ssh2

## 参考文档

- 编码规范：`CODING.md`
- 技术栈教程：`docs/技术栈教程注意事项-v1.0.md`
- 开源复用清单：`../docs/technical/开源项目复用清单.md`
- 项目救援盘点：`../docs/reports/项目救援盘点.md`
- 经验沉淀：`../.learnings/LEARNINGS.md`
