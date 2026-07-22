# CLAUDE.md · TDSF Linux Desktop

> 本文件是 Claude Code / Trae / Codex 等 AI Agent 在本项目工作时的**硬约束清单**。
> 与 `AGENTS.md` 互补：AGENTS.md 是「如何工作」的指南，CLAUDE.md 是「不可违反」的红线。
> 更新日期：2026-07-21 夜间 · polish-tdsf-p1-issues Phase F 归档

---

## A 红线（必须遵守 · 违反即返工）

### A1 · IPC 4 步同步铁律

任何新增 IPC 通道必须完成 4 步同步，**缺一不可**：

1. **main 定义**：在 `src/main/ipc/<domain>.ts` 中实现 `ipcMain.handle('<channel>', ...)` handler
2. **ipc/index.ts 注册**：在 `src/main/ipc/index.ts` 中导入并注册该 handler
3. **preload 暴露**：在 `src/preload/index.ts` 中通过 `contextBridge.exposeInMainWorld` 暴露给渲染进程
4. **d.ts 类型声明**：在 `src/renderer/src/types/electron.d.ts` 中声明 TypeScript 类型

**验证**：`pnpm typecheck:node && pnpm typecheck:web` 双绿。如出现「Property does not exist on type 'Window'」错误，说明 4 步中至少一步缺失。

### A2 · 单文件 ≤ 500 行

任何 `.ts` / `.tsx` 文件**行数不得超过 500 行**（含空行、注释、import）。

- 超过 500 行必须拆分：按功能职责拆为多个模块（如 `service.ts` + `service-helpers.ts` + `service-types.ts`）
- 测试文件可放宽至 800 行（测试用例天然较长）
- 验证：`wc -l src/main/**/*.ts src/renderer/**/*.tsx | sort -rn | head -20`

### A3 · TypeScript strict 模式

`tsconfig.json` 必须启用 `"strict": true`，禁止：

- `any` 类型（如必须使用，需 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` 并附注释说明原因）
- 隐式 `any`（函数参数、变量声明必须显式标注类型）
- `as unknown as T` 双重断言（除非有明确的类型边界冲突，需注释说明）
- `!` 非空断言（除非有运行时保证，需注释说明）

**验证**：`pnpm typecheck:node && pnpm typecheck:web` 双绿 + `pnpm lint` 0 errors（warnings 允许 ≤ 3 个 pre-existing）。

### A4 · 全部用 var(--trae-*) token

所有 CSS 颜色必须使用 `var(--trae-*)` 设计 Token，**禁止硬编码颜色**：

```css
/* ✅ 允许 */
color: var(--trae-text-primary);
background: var(--trae-bg-elevated);
border: 1px solid var(--trae-border-subtle);

/* ❌ 禁止 */
color: #ffffff;
background: #fafafa;
border: 1px solid #e5e7eb;
```

**例外**：`rgba()` 半透明叠加见 B2 白名单。

**验证**：`grep -rE '#[0-9a-fA-F]{3,8}' src/renderer/src/ --include='*.css' --include='*.tsx'` 应仅返回 Token 定义文件 `tokens.css` 中的颜色值。

### A5 · 无 mock 数据运行时 fallback

生产环境（`NODE_ENV=production`）禁止任何 mock 数据 fallback：

```typescript
/* ❌ 禁止 */
const data = await window.api.someMethod() || MOCK_DATA;

/* ❌ 禁止 */
if (!realData) {
  console.warn('使用 mock 数据');
  return MOCK_DATA;
}
```

**例外**：DEV 模式下允许 import sample data 用于演示，见 B1 白名单。

**验证**：`grep -rn 'MOCK_\|mock-data\|fallback.*mock' src/main/ src/renderer/src/ --include='*.ts' --include='*.tsx'` 应仅返回 DEV 模式条件分支。

### A6 · IPC 通道必须使用 @shared/ipc-channels 常量（polish-tdsf-p1-issues Phase A 新增）

**所有 IPC 通道字符串必须引用 `src/shared/ipc-channels.ts` 中的常量**，禁止在代码中使用字面量字符串：

```typescript
/* ✅ 允许 */
import { IPC_CHANNELS } from '@shared/ipc-channels'
ipcMain.handle(IPC_CHANNELS.LOOP.START, handler)
ipcRenderer.invoke(IPC_CHANNELS.SCHEDULER.LIST)

/* ❌ 禁止 */
ipcMain.handle('loop:start', handler)
ipcRenderer.invoke('scheduler:list')
```

**约束**：
- 新增 IPC 通道时，必须先在 `src/shared/ipc-channels.ts` 中定义常量（用 `as const` 标注）
- 每域用 `as const` 标注，确保字面量类型推断（避免类型推断为 `string`）
- 三层引用同步：main (`ipcMain.handle`) / preload (`ipcRenderer.invoke`) / renderer (`window.electronAPI.xxx`)

**验证**：`grep -rn "ipcMain.handle\(['\"]" src/main/ --include='*.ts'` 应仅返回 `IPC_CHANNELS.` 引用，无字面量字符串。

**违反处置**：首次违反返工替换为常量引用；重复违反全仓扫描 + 记录 LEARNINGS。

### A7 · catch 块 error.message 写入日志前必须脱敏（polish-tdsf-p1-issues Phase C 新增）

**所有 `catch` 块中的 `error.message` / `error.stack` 在写入日志、数据库、IPC 响应前必须经过 `redactSensitiveInfo()` 脱敏**：

```typescript
/* ✅ 允许 */
import { redactSensitiveInfo } from '@/main/services/security/redact'
catch (error: unknown) {
  const safeMessage = error instanceof Error
    ? redactSensitiveInfo(error.message)
    : redactSensitiveInfo(String(error))
  logger.error({ msg: safeMessage, ... })
  await db.run('INSERT INTO logs(message) VALUES(?)', safeMessage)
}

/* ❌ 禁止 */
catch (error: any) {
  logger.error(error.message)  // 未脱敏
  await db.run('INSERT INTO logs(message) VALUES(?)', error.message)
}
```

**约束**：
- 必须使用 `redactSensitiveInfo()` 工具（位于 `src/main/services/security/redact.ts`）
- 8 类正则规则覆盖：API Key / 密码 / 私钥 / JWT / IPv4 / 邮箱 / 手机号 / .env 文件路径
- `catch (error)` 子句一律用 `unknown` + 类型守卫，禁止 `catch (error: any)`（详见 A3）
- 已知安全的 IP / 邮箱可通过白名单豁免

**验证**：`grep -rn "catch.*error.*{" src/main/ --include='*.ts'` 检查每个 catch 块，确保 error.message 写入前调用 `redactSensitiveInfo()`。

**违反处置**：首次违反返工添加脱敏调用；重复违反全仓扫描 catch 块 + 记录 LEARNINGS。

---

## B 白名单（允许 · 不视为违规）

### B1 · DEV 模式下 import sample data 用于演示

在 `import.meta.env.DEV` 或 `process.env.NODE_ENV === 'development'` 条件下，允许：

```typescript
/* ✅ 允许（DEV 模式） */
import { SAMPLE_DECISIONS } from '@/__fixtures__/sample-data';

if (import.meta.env.DEV) {
  // 演示用 sample data，仅 DEV 模式
  setDecisions(SAMPLE_DECISIONS);
} else {
  // 生产模式走真实 IPC
  const data = await window.api.historyList();
  setDecisions(data);
}
```

**约束**：
- sample data 必须放在 `__fixtures__/` 或 `__mocks__/` 目录下
- 不得在生产构建中打包 sample data（通过 tree-shaking 或环境变量剔除）
- 必须有明确的 `if (DEV)` 分支，不得隐式 fallback

### B2 · rgba 半透明 background（设计稿玻璃质感）

设计稿中的玻璃质感（glassmorphism）需要 `rgba()` 半透明背景，**允许使用**：

```css
/* ✅ 允许（玻璃质感） */
background: rgba(255, 255, 255, 0.72);
backdrop-filter: blur(16px);

/* ✅ 允许（基于 Token 的 rgba） */
background: rgb(var(--trae-bg-elevated-rgb) / 0.72);
```

**约束**：
- 必须配合 `backdrop-filter: blur()` 使用，单独的 `rgba()` 背景不允许
- 优先使用 `rgb(var(--trae-*-rgb) / alpha)` 形式（基于 Token 的 alpha 叠加）
- 直接 `rgba(R, G, B, A)` 形式仅在设计稿明确要求玻璃质感时使用

### B3 · lint 0 warnings / 0 errors（polish-tdsf-p1-issues Phase G 更新）

**原 3 个 pre-existing `no-explicit-any` warnings 已于 Phase G（commit 2d3e348）全部修复**，当前仓库状态：

- `pnpm lint` → **0 errors / 0 warnings**（原 3 → 0）
- 修复方式：
  - `client-manager.ts:170` `catch (error: any)` → `catch (error: unknown)` + 类型守卫
  - `client-manager.ts:381` `metadata: any` → `metadata: Record<string, unknown>`
  - `langfuse.ts:138` SDK 返回值 `any` → 本地声明 interface + `as` 断言

**约束**：
- 不得新增任何 `any` warning（新增代码必须显式标注类型）
- `catch (error)` 子句一律用 `unknown` + 类型守卫，禁止 `catch (error: any)`（详见 A7）
- 函数参数禁止 `any`，必须用 `Record<string, unknown>` 或具体 interface
- pre-commit hook 应加入 `eslint --max-warnings=0` 阻止新 any 进入仓库

---

## 验证清单（每次 commit 前必跑）

```bash
# 1. 编译门禁三绿
pnpm typecheck:node   # exit 0
pnpm typecheck:web    # exit 0
pnpm lint             # exit 0，warnings = 0（Phase G 已清零）

# 2. 冒烟测试（如涉及 main 进程）
pnpm test:smoke       # 23/23 通过

# 3. 单元测试（如涉及 scheduler）
tsx scripts/test-cron-parser.ts   # 58/58 通过

# 4. 集成测试（如涉及 IPC）
tsx scripts/test-scheduler.ts      # 36/36 通过

# 5. 构建（如涉及生产打包）
pnpm build            # electron-vite build PASS

# 6. AI 协作
pnpm ai:check         # 无冲突
pnpm ai:release --all # 释放所有 claim
```

---

## 违反处置

| 红线 | 首次违反 | 重复违反 |
|------|---------|---------|
| A1 IPC 4 步 | 返工补全 | 父 agent 拒绝合并 + 记录 LEARNINGS |
| A2 单文件 500 行 | 拆分文件 | 返工拆分 + 记录 LEARNINGS |
| A3 TypeScript strict | 修复类型 | 返工 + 记录 LEARNINGS |
| A4 硬编码颜色 | 替换为 Token | 返工 + 全仓扫描 |
| A5 mock fallback | 移除 fallback | 返工 + 记录 LEARNINGS |
| A6 IPC 通道字面量 | 替换为常量引用 | 全仓扫描 + 记录 LEARNINGS |
| A7 catch 块未脱敏 | 添加 redactSensitiveInfo 调用 | 全仓扫描 catch 块 + 记录 LEARNINGS |

---

*CLAUDE.md 结束 · polish-tdsf-p1-issues Phase F 归档 · 2026-07-21 夜间*
