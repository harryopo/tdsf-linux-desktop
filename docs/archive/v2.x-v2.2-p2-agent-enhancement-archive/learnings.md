# v2.2 P2 Agent 架构强化循环工程 · 经验教训

> **归档时间**：2026-07-22
> **完成版本**：v2.2 P2 Agent 架构强化（commit: c5a5599）

---

## LRN-20260722-P2-001 · PowerShell 不支持 heredoc 语法

**问题**：在 PowerShell 中使用 `git commit -m "$(cat <<'EOF' ... EOF)"` 传递多行 commit message 时报错 `Missing file specification after redirection operator`。

**根因**：PowerShell 不支持 bash 的 heredoc `<<'EOF'` 语法，`<<` 被 PowerShell 解析为重定向操作符但缺少文件参数。

**解决方案**：使用 `git commit -F <文件路径>` 从临时文件读取 commit message：
```powershell
# 1. 写入临时文件
Set-Content -Path .git/COMMIT_MSG.txt -Value @"多行内容...
"@
# 2. 用 -F 读取
git commit -F .git/COMMIT_MSG.txt
# 3. 删除临时文件
Remove-Item .git/COMMIT_MSG.txt
```

**通用教训**：跨 shell 编写命令时，避免使用 shell 特有语法（heredoc / process substitution / brace expansion），改用通用的文件中转方式。

---

## LRN-20260722-P2-002 · vi.mock hoisting 必须用 vi.hoisted

**问题**：vitest 中 `vi.mock(factory)` 的 factory 函数会被 hoisted 到文件顶部，导致无法访问顶层 `const` 声明的 mock 对象，报错 `ReferenceError: Cannot access 'mockFs' before initialization`。

**根因**：vitest 的 `vi.mock` 工厂函数在模块加载前执行，但顶层 `const` 声明遵循 TDZ（Temporal Dead Zone）规则，此时还未初始化。

**解决方案**：使用 `vi.hoisted()` 声明 mock 对象，确保在 hoisted factory 中可访问：
```typescript
const mocks = vi.hoisted(() => ({
  fs: { mkdir: vi.fn(), access: vi.fn(), appendFile: vi.fn() },
  knowledgeRepo: { add: vi.fn(), getById: vi.fn() },
}))

vi.mock('node:fs/promises', () => mocks.fs)
vi.mock('../../src/main/services/db/knowledge-repo', () => ({
  KnowledgeRepository: function () { return mocks.knowledgeRepo },
}))
```

**通用教训**：vitest mock 中的对象引用必须用 `vi.hoisted()` 包裹，不能用普通 `const`。

---

## LRN-20260722-P2-003 · Electron 模块导入不能用 require

**问题**：`task-sediment.ts` 中使用 `const { app } = require('electron')` 触发 lint 错误 `Require statement not part of import statement`（`@typescript-eslint/no-var-requires`）。

**根因**：ESLint 规则禁止 `require` 语句，必须用 ES Module `import` 语法。

**解决方案**：改为顶层 `import { app } from 'electron'`，函数内直接使用 `app.getPath('userData')`。非 Electron 环境下 `app` 为 undefined → 抛错 → 走 catch 降级到 `os.homedir()`。

**通用教训**：Electron 主进程代码统一用 ES Module `import`，不用 `require`；降级逻辑用 try-catch 包裹。

---

## LRN-20260722-P2-004 · 跨目录 import 路径回退层级

**问题**：`task-protocol.ts` 中 `import { sedimentTaskMemory } from '../memory/task-sediment'` 报错模块找不到。

**根因**：`task-protocol.ts` 位于 `src/main/core/agent/subagents/`，`task-sediment.ts` 位于 `src/main/core/memory/`，从 `subagents/` 到 `memory/` 需要回退两层（`../../`），不是一层。

**解决方案**：改为 `from '../../memory/task-sediment'`。

**通用教训**：跨目录 import 时仔细计算回退层级：
- `subagents/` → `agent/` 是 1 层（`../`）
- `subagents/` → `core/` 是 2 层（`../../`）
- `subagents/` → `main/` 是 3 层（`../../../`）

---

## LRN-20260722-P2-005 · TS 对象方法返回类型标注必须用冒号

**问题**：TypeScript 对象方法返回类型标注 `): ReturnType =>` 与 `) => ReturnType =>` 容易混淆，后者会被 esbuild 误解析为函数返回函数导致启动失败。

**根因**：`) => ReturnType =>` 中的第二个 `=>` 被 esbuild 解析为箭头函数返回另一个箭头函数，而非类型标注。

**解决方案**：始终用 `): ReturnType =>`（冒号 + 空格 + 类型 + 空格 + 箭头）：
```typescript
// ✅ 正确
function foo(): ReturnType => { ... }

// ❌ 错误（双箭头）
function foo() => ReturnType => { ... }
```

**通用教训**：TypeScript 类型标注必须用冒号 `:`，不能用箭头 `=>`；函数声明的返回类型位置在参数列表闭括号之后、箭头之前。

---

## LRN-20260722-P2-006 · 任务记忆沉淀的错误降级链设计

**场景**：任务记忆沉淀是 finally 块中的副作用操作，绝不能影响主任务返回。

**设计原则**：
1. **静默吞错**：沉淀失败仅记录日志，不抛出异常
2. **错误降级链**：知识库失败 → 仅 Markdown；Markdown 失败 → 仅日志；日志失败 → 静默吞错
3. **幂等保证**：`sediment-{taskId}` 跨进程幂等（getById 检查）
4. **守卫条件**：`if (!ctx.cancelled)` 确保取消任务不沉淀

**实现**：
```typescript
if (!ctx.cancelled) {
  try {
    const sedimentResult = await sedimentTaskMemory(ctx)
    log.info('任务记忆沉淀完成', { ... })
  } catch (err) {
    // 静默吞错：仅记录日志，不影响主任务返回
    log.warn('任务记忆沉淀异常（静默吞错）', { ... })
  }
}
```

**通用教训**：finally 块中的副作用操作必须：
- 用 try-catch 包裹
- 失败仅记录日志，不抛出
- 有幂等保证（避免重复执行）
- 有守卫条件（避免不该执行的场景）

---

## LRN-20260722-P2-007 · AttentionTracker.reset 调用点缺失

**问题**：AttentionTracker 单例有 `reset()` 方法（归档当前 attention 到 history），但全工程之前无任何代码调用 `reset()`，导致 attention 永远不归档。

**根因**：原设计意图是任务完成后归档 attention，但 task-protocol.ts 的 finally 块之前没有调用 reset 的逻辑。

**解决方案**：P2-I 在 sedimentTaskMemory 中调用 `AttentionTracker.getInstance().reset()`，补全缺失的调用点。

**通用教训**：单例模式的 `reset`/`clear`/`archive` 方法必须有明确的调用点，否则等于死代码。代码审查时要专门检查"有定义无调用"的方法。

---

## LRN-20260722-P2-008 · 三态权限审批的降级策略

**场景**：R12 要求三态权限审批（ALWAYS/AUTO/NEVER），但 MainWindow 可能不存在（CLI 模式 / 测试环境 / 启动早期）。

**降级策略**：
| 模式 | MainWindow 存在 | MainWindow 不存在 |
|------|-----------------|-------------------|
| always | IPC 推送审批请求，等待用户决定 | 降级默认允许（source=default-allow-no-mainwindow） |
| auto | 自动允许（source=mode-auto） | 自动允许（source=mode-auto） |
| never | 自动拒绝 | 自动拒绝 |

**设计原则**：
- `auto` 和 `never` 不依赖 MainWindow，行为确定性
- `always` 依赖 MainWindow，无 MainWindow 时降级默认允许（避免阻塞）
- 降级原因记录在 source 字段，便于审计

**通用教训**：依赖 UI 的审批流程必须有降级策略，降级原因要记录在审计字段中，便于事后追溯。

---

## LRN-20260722-P2-009 · 启发式 lessons 提取的 5 类条件

**场景**：任务记忆沉淀需要提取 lessons（经验教训），但 LLM 不可用或成本高时需要降级到启发式。

**5 类条件**：
1. **失败步骤**：`failedSteps.length > 0` → 记录失败步骤名
2. **错误指示词**：output 包含 ERROR_INDICATORS（error/failed/exception/timeout）→ 记录错误关键词
3. **超时**：`totalDurationMs > 30000` → 记录超时
4. **token 消耗**：`tokenUsage.total > 5000` → 记录高消耗
5. **attention errors**：attention.files 中包含 .error 后缀 → 记录错误文件

**设计原则**：
- 启发式提取是 LLM 降级方案，不是替代方案
- 5 类条件覆盖常见失败场景，但不追求完备
- lessons 用于后续知识库搜索，关键词提取要精确

**通用教训**：启发式提取要基于具体可观察的信号（步骤/关键词/时长/计数），不要基于抽象推断。

---

## LRN-20260722-P2-010 · 全量测试套件的历史已知问题

**问题**：`tests/services/llm-client.test.ts:128` 断言 `expected 0.3 to be less than or equal to 0.2` 失败。

**根因**：规则引擎无匹配时返回的默认置信度 0.3 大于测试期望的 0.2，是置信度阈值的边界问题。

**处理策略**：
- 标记为历史已知问题，非本轮回归
- 不在 P2 收尾阶段修复（避免范围蔓延）
- 记录到第五波开发的待办列表

**通用教训**：全量测试套件中的历史失败要明确标记，区分"本轮回归"和"历史问题"，避免范围蔓延。修复历史问题要单独安排，不与当前任务混合。
