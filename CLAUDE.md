# CLAUDE.md · TDSF Linux Desktop

> 本文件是 Claude Code / Trae / Codex 等 AI Agent 在本项目工作时的**硬约束清单**。
> 与 `AGENTS.md` 互补：AGENTS.md 是「如何工作」的指南，CLAUDE.md 是「不可违反」的红线。
> 更新日期：2026-07-21 · Phase 7.6 归档

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

### B3 · 3 个 pre-existing lint warnings

当前仓库存在 **3 个 pre-existing `no-explicit-any` warnings**，已记录在 `LEARNINGS.md`，**允许保留**：

- 涉及文件：第三方库类型补全 + 历史遗留 any
- 位置：详见 `pnpm lint` 输出
- 处置：暂不修复，待 Phase 7.7 verifier review 时统一评估

**约束**：
- 不得新增任何 `any` warning（新增代码必须显式标注类型）
- 修复 pre-existing warnings 时必须独立 commit，不得混入功能修改
- 一旦 warnings 数量超过 3 个，必须立即修复新增的

---

## 验证清单（每次 commit 前必跑）

```bash
# 1. 编译门禁三绿
pnpm typecheck:node   # exit 0
pnpm typecheck:web    # exit 0
pnpm lint             # exit 0，warnings ≤ 3

# 2. 冒烟测试（如涉及 main 进程）
pnpm test:smoke       # 23/23 通过

# 3. 单元测试（如涉及 scheduler）
tsx scripts/test-cron-parser.ts   # 37/37 通过

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

---

*CLAUDE.md 结束 · Phase 7.6 归档 · 2026-07-21*
