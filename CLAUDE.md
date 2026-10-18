# CLAUDE.md · TDSF-Linux Desktop

> AI 入口指引。当前状态不在这里写——本文件只放**规矩**，进度走 git log 与 CHANGELOG。

## 项目定位

**TDSF-Linux Desktop** = SSH 终端 + AI 辅助 + 高危命令拦截 + 日志分析 + 可信决策
帮助 Linux 初学者不怕命令行的桌面工具。

## 技术栈（与 package.json 逐条对过）

- Electron 43 + React 19 + TypeScript strict + Tailwind 4
  —— **渲染层不用 Ant Design**：`design-contract` 把"引用 antd 的文件数"钉在 0
- 状态：Zustand 5
- 终端与远端：ssh2 + @xterm/xterm（addon-fit / search / web-links）+ node-pty（本机终端，走 utilityProcess）
- AI：Vercel AI SDK 7（多模型路由，@ai-sdk/openai·anthropic·google）
  —— **没有 Anthropic Claude Agent SDK，也没有 Mastra**：两者都不是依赖，
  历史注释里提到它们的段落描述的是没接上的架构
- MCP：@modelcontextprotocol/sdk 1.32
- 数据库：better-sqlite3 + @photostructure/sqlite-vec（向量；扩展加载失败会降级并在界面显示原因）
- 编辑器：monaco-editor + web-tree-sitter（语法）
- 安全：dompurify + zod
- 可观测：langfuse SDK（**无 Key 时自动关闭**，不静默上报；没有接 OpenTelemetry）

## 6 条核心红线（违反 = 不能合并）

1. **IPC 通道名只有一个来源**：`src/shared/ipc-channels.ts`。新增通道要同时登记契约
   （`src/shared/ipc-contract.ts` + `invokeChecked`），否则 `ipc:check` 与未入契约上限会红。
2. **catch 脱敏**：error 写日志前必须过 `redactSensitiveInfo()`，禁止泄漏 SSH 凭据/密钥。
   打码要递归到每一层，且**两个出口都要收口**（抛错与"把失败当数据返回"）。
3. **高危命令必须过闸**：SSH exec 与用户键入/粘贴都走 `command-gate.ts`。
   口径不是"12 条黑名单"，而是 8 个结构性拦截器 + 7 条 argv 规则 + 226 项词表
   （`src/main/core/command-rules.json`；结构性那 8 条**故意不放进数据文件**，见文件头注释）。
4. **Electron 安全三原则**：`contextIsolation:true` / `nodeIntegration:false` / `sandbox:true`（不可绕过）。
   改 preload 必须 `build` + 跑 e2e——静态门禁一条都不证明它活着（曾因此把 `require("zod")` 带进 sandbox preload）。
5. **XSS 防护**：渲染层 `dangerouslySetInnerHTML` 必须 `DOMPurify.sanitize()`。
6. **做事与打分分离**：声明"任务完成"前必须 dispatch 独立 verifier subagent，贴实际命令输出（不是总结）。
   **未当轮实测的一律不许说"完成"**；取退出码不许接管道（`cmd | tail; echo $?` 量的是 tail）。

## 硬门禁（必须全过才能合并）

```bash
pnpm typecheck:node   # tsc --noEmit -p tsconfig.node.json
pnpm typecheck:web    # tsc --noEmit -p tsconfig.web.json
pnpm types:tests      # tests/ 硬零闸：类型错误 0 条 + as never 只降不升
pnpm lint             # eslint src --ext .ts,.tsx（0 errors，warnings 允许）
```

> `typecheck:node` 与 `typecheck:web` 的 include **都不含 `tests/`**，`pnpm lint` 只扫 `src`。
> 所以测试曾经从来没被类型检查过——产品改了字段名，测试不会红，它会继续用旧形状
> 构造对象、断言一个不存在的东西，然后绿着。`types:tests` 就是补这一片的（2026-10-14 立闸）。

还有一把管"门禁自己"的：`node scripts/quality/scripts-syntax-check.cjs`（秒级）。
`scripts/` 下那些 .cjs/.mjs 是密钥闸/拓扑闸/协作闸/设计闸的载体，而上面四条**一条都不覆盖它们**。
2026-10-14 我给 `tests-typecheck` 加注释时，块注释里那段通配路径的"星号紧跟斜杠"提前关掉了
注释、整个脚本变成语法错误——门坏了不会报"门通过"，它只是不再说话。这把闸把它变成会说话的红。

## 其余常驻闸

```bash
pnpm test                 # vitest（单元 + 组件）
pnpm test:e2e             # Playwright 直驱真实应用窗口
pnpm build                # electron-vite 构建
pnpm design:gate          # 设计契约 + 令牌 + 设置键
node scripts/design/ui-audit.mjs --gate   # 真机量：标题/对比度/遮挡/图标/底部
                                          # 窗口不在前台时报 rc=3（环境红 ≠ 产品红），无人值守加 --no-shots
pnpm ipc:check            # 契约生成物与代码不漂移
pnpm deadcode:gate        # Knip ratchet（只降不升）
pnpm security:secrets     # 凭据形状闸（--all 扫跟踪集，--staged 由 pre-commit 跑）
pnpm security:topology    # 内网拓扑值：按值 + 按 /24 网段
pnpm security:history     # 全历史按值回归（pre-push 也跑）
pnpm doc:links            # 文档断链：相对链接必须落在跟踪集里
pnpm promo:check          # 对外发布页的读数逐行对账
```

## 改界面额外两把（动 `src/renderer/**` 必过）

界面规范**唯一权威是 `DESIGN.md`**（刻度在 `styles/ui-tokens.css` 定义一次）。四条不可协商：
标题只用 `<PageHeader>`；不写内联 `style={{ color/fontSize }}`；弹层/菜单/提示只用
`src/renderer/src/ui/` 原语；文案不许出现没实现的能力。细则见 `DESIGN.md` §9-§11。

```bash
pnpm build && pnpm design:gate
node scripts/design/ui-audit.mjs --gate
```

## 终端 OSC 规矩（动 xterm 之前必读）

注册 OSC handler 一律 `return false`（判据：`tests/unit/xterm-osc-return-false.test.ts`）。
读屏幕只能读 `term.buffer.active`，不要缓存行内容——滚动后行号会整体位移。
命令-输出块切分在 `src/renderer/src/terminal/block-model.ts`（纯函数，可单测）。

## 开发命令

```bash
pnpm dev              # electron-vite dev
pnpm lint:fix         # 自动修复
pnpm test:watch       # 监听模式
pnpm deadcode         # Knip（不报错，本地建议）
pnpm build:win        # Windows 打包（electron-builder 26）
pnpm rebuild          # 重编译原生模块（better-sqlite3, ssh2, sqlite-vec）
```

## AI 协作协议

> **协作模式唯一权威：`AGENTS.md` §文件所有权**。
> 并行数、claim/release 工作流、高共享文件禁并行清单、分支策略均以该节为准，本文件不另行定义。

## 跨进程类型规则

- 跨进程共享类型必须放 `src/shared/`（不是 main/services/types）
- 渲染层 `ElectronAPI` 必须是 `extends PreloadElectronAPI`，不许再手抄第三份类型真相源
- 主进程 types.ts 用 `export type { X } from '../../../shared/x-types'` 兼容

## 降级保留原则（关键）

- "降级"≠"完全切除"：保留代码文件 + 接口签名 + 类型声明，界面必须显示降级原因
- 当前真降级的几项写在 README §已知边界，别在文案里把它们说成已启用

## 删除前检查

1. `grep -r "import.*filename"` 确认无引用（**也要扫 `scripts/**` 里的探针**，改结构最容易漏它）
2. `git log --oneline -5 -- <file>` 查看最近修改
3. PR 里说明删除理由

## 环境要求

- Node 20+ / pnpm 9+ / Python 3.11+（仅 sidecar-a，缺 venv 时整条日志聚类走降级）
- Windows 11 + VS Build Tools（编译原生模块）

## 参考文档

- 编码规范：`CODING.md`
- 界面规范唯一权威：`DESIGN.md`
- 产品定位与反例清单：`PRODUCT.md`
- 协作与文件所有权：`AGENTS.md`
- 技术栈教程：`docs/tech-stack-skills/README.md`
- 在跑的文档全索引：`docs/INDEX.md`
- 第三方依赖致谢：`NOTICE`
