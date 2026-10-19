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
2. SSH 命令必须过结构判定闸 `evaluateCommand`（`src/main/core/command-gate.ts:768`）：
   8 个结构性拦截器 + 7 条 argv 规则 + 226 项词表，四个出口（远程 exec / 交互键入 / AI 代写 / MCP）都要过。
   **旧口径"12 条正则黑名单"已作废**——照它实现就会绕过结构闸，见 CLAUDE.md 同一条。
3. 渲染层 `dangerouslySetInnerHTML` 必须经 `DOMPurify.sanitize()`
4. `.env` / `.ssh/` / `*_key` 相关内容在日志中自动替换为 `[REDACTED]`

## TypeScript 约束
- **允许边界 any**（如第三方库类型不全），**禁止业务 any**
- 禁止隐式 any（必须显式标注）
- 边界 any 必须配 `// @ts-expect-error` 注释说明原因

## 界面规范：唯一权威是 `DESIGN.md`
- 动前端（`src/renderer/**`）前先读 `DESIGN.md`；它与代码不一致时，以 `DESIGN.md` 为准并改代码。
  数值刻度（字阶 / 圆角 / 间距 / 图标尺寸 / 外壳尺寸）只在 `styles/ui-tokens.css` 定义一次。
- 四条不可协商：
  1. 页面标题只用 `<PageHeader>`，不许自写 `<h1>`（字号忽大忽小的根因）；
  2. 文字用 `text-*` 档、颜色用语义类，**不写内联 `style={{ color/fontSize }}`**；
  3. 弹层/确认/菜单/提示只用 `src/renderer/src/ui/` 里的原语，不再引 antd 同类件；
  4. 界面文案不许出现没实现的能力和内部黑话（见 `DESIGN.md` §10）。
- 旧 `--trae-*` 令牌是待清债务：只许减少，新代码一律用 `--ui-*`（`design-contract.mjs` 盯刻度）。

## 质量门禁（三绿硬 + 两绿软）
- **三绿硬门禁**（必须全过才能合并）：
  - `pnpm typecheck:node` → exit 0
  - `pnpm typecheck:web` → exit 0
  - `pnpm lint` → 0 errors（warnings 允许）
- **两绿软门禁**（尽量过，不过要在 PR 说明原因）：
  - `pnpm test` → 全量通过（含 `design-contract` 与 `ui-tokens` 两把设计闸）
  - `pnpm build:win` → 成功生成 .exe（缺 SDK 时允许 SKIP，发布前必须 CI 跑通）
- **改界面额外两把**（`pnpm build` 之后跑）：
  - `node scripts/design/design-contract.mjs` → 文档与令牌不漂移、债务刻度未回涨
  - `node scripts/design/ui-audit.mjs --gate` → 真机量：标题统一 / 对比度 / 遮挡 / 图标刻度 / 底部不裁

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
- 冲刺阶段强制单 AI 模式
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

*CODING.md v1.2 · 2026-10-19 · 改比加重要，加比删重要*

---

## 这些规矩是怎么来的（经验沉淀）

每条都对应一次真实返工。写在这里是为了让人**不必再踩一遍**，而不是为了记录发生过什么。

1. **约束事实，不约束文风。** 规则要能落在判定表、公式、门禁上（比如"注册 OSC handler 必须 `return false`"
   配一条扫全仓的测试）。句式、语气、注释风格这类规则会被删掉——它们管不住错，只会制造摩擦。
2. **"目前为 0"必须落成常驻闸。** 一次审计的结论没有执行体就只对当天负责。复核时先问两句：
   哪条命令在守它？我能不能故意改坏让它红？答不出来的，那条结论等于没做过。
3. **判据别钉源码字符串。** `toContain('await foo()')` 这类断言在重构时假红、在语义坏时假绿。
   要抽成可注入的模块跑行为；非要钉结构就用 AST 读，别用正则猜。
4. **mock 的形状必须与生产信封同形。** 写接口返回 `{updated: true}` 而 mock 回 `undefined`，
   新加的成败判定在测试层就被抹平了；顶替类的 mock 还得可 `new`（箭头函数不可构造）。
5. **清单要从单源反查。** 手抄的档位表、类名表、通道清单迟早与单源分叉。
   判据写成"效果还在不在"，而不是"抄本对不对"。
6. **删除会咬到量具。** 撤掉一条能力，同一轮一定会红三类东西：按当天文件数钉死的地板、
   历史台账里的死引用、把某天基线抄成副本的测试。正确修法分别是按"掏空"定地板、登记撤掉的名单、
   期望值改成现场推导——**不是改历史让门闭嘴**。
7. **数字只有一个出口。** 对外读数一律走 `npm run promo:check`（`scripts/quality/promo-readout.mjs`）。
   文档里出现一个没有测法的数字，就是给下一个人埋一颗雷。
