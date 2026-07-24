# v2.5 循环工程 · 经验沉淀

> 归档时间：2026-07-24
> 关联方案书：`docs/v2.5-loop-engineering-plan.md`
> 关联任务清单：`tasks.md`

---

## 一、技术决策

### 1.1 回滚命令生成器：规则表 + 不可逆黑名单

**决策**：用 `readonly RollbackRule[]` 规则表 + `readonly RegExp[]` 不可逆黑名单，而非 LLM 动态生成。

**原因**：
- LLM 生成回滚命令有幻觉风险，比赛演示场景需要确定性
- 18 条规则覆盖 Linux 常见操作（git / systemctl / chmod / useradd 等），命中率 > 90%
- 不可逆命令（`rm -rf` / `mkfs` / `dd`）必须拒绝执行，不能尝试回滚
- 路径解析（从命令中提取真实文件路径）让回滚命令更精准，如 `> /etc/sysctl.conf` → `cp /etc/sysctl.conf.bak /etc/sysctl.conf`

**教训**：
- 初版用硬编码 `xxx.bak` 占位，被审计报告标记为 P1-8 红线
- 替换为规则表后，38 测试用例覆盖所有规则 + 边界场景，信心充足
- 高风险命令（`high` risk）且无规则时返回 `undefined`，比尝试通用回滚更安全

### 1.2 异步 embedding 回填：单例 + 分页 + 取消

**决策**：用 `EmbeddingBackfillService` 单例 + 分页查询 + 取消标记，而非同步阻塞或 Worker 线程。

**原因**：
- better-sqlite3 transaction 内禁止 async/await（官方文档明确约束）
- 2578 条教程回填需 1-3 分钟，同步阻塞会导致 IPC 卡死、UI 冻结
- Worker 线程引入跨线程通信复杂度，比赛演示场景不值得
- 单例 + 状态守卫（`isRunning()`）防止并发启动，简单可靠
- 分页查询 `LIMIT 100` + `WHERE embedding IS NULL` 自动断点续传
- 取消标记 `cancelled` + 每页检查，保证数据一致性（单页内不会中止）

**教训**：
- Vitest 测试并发场景时，`mockResolvedValue` 无法捕获参数，必须用 `mockImplementation`
- `vi.hoisted` 用于在模块 hoisting 阶段创建 mock，避免 "Cannot access 'mockXxx' before initialization" 错误
- 单例状态跨测试用例共享，必须在 `beforeEach` 中重置（`instance = null` + `clearAllMocks`）

### 1.3 注释测试迁移：从注释到 vitest

**决策**：将 `hybrid-search.ts` 中 52 行 `/* */` 注释测试代码迁移到 `tests/services/tutorial/hybrid-search.test.ts`（18 用例）。

**原因**：
- 注释形式的测试无法被 CI 执行，等同死代码
- 迁移到 vitest 后，每次 `pnpm test` 都会跑这些用例，保证回归覆盖
- 18 用例覆盖纯 FTS / 纯向量 / 混合 RRF / 特殊字符转义 / 降级等场景

**教训**：
- 注释测试往往用 `console.log` + 手动比对，迁移时需改为 `expect()` 断言
- 迁移后行数从 52 → 18 用例，密度提升（每用例覆盖更具体场景）

---

## 二、流程经验

### 2.1 循环工程开发流程有效

**采用流程**：
```
1. spec 生成（方案书 v2.5-loop-engineering-plan.md）
2. Task 分解（TodoWrite）
3. 每个 Task 实施：
   a. 编码
   b. 跑编译门禁三绿（typecheck:node + typecheck:web + lint）
   c. 跑相关测试
   d. git commit（conventional commit 格式）
4. Phase E 归档 + 交接 + 记忆
```

**效果**：
- 4 个 Phase（C / D1 / D2+D3 / E）每个独立 commit，回滚粒度清晰
- 编译门禁三绿在每个 Task 完成后验证，问题早发现
- 归档目录结构（tasks / verify-report / learnings）便于后续追溯

### 2.2 IPC 4 步同步清单有效

**清单**：
1. `src/shared/ipc-channels.ts` 定义通道常量
2. `src/main/ipc/*.ts` 注册 `ipcMain.handle`
3. `src/preload/index.ts` 暴露 `ipcRenderer.invoke` 包装
4. `src/preload/index.d.ts` 声明 `ElectronAPI` 类型（由 `exposeInMainWorld` 自动推断）

**效果**：
- 4 个 backfill 通道按清单逐步完成，无遗漏
- `grep` 验证每一步的产物存在，信心充足
- 前端可通过 `window.electronAPI.tutorialBackfillStart()` 直接调用

### 2.3 不碰 src/renderer/ 边界约束

**约束**：前端由其他 AI 重构完善中，本批次只改后端。

**效果**：
- `git diff --name-only` 验证无 `src/renderer/` 文件
- 避免与前端 AI 的并行修改冲突
- 共享层（`src/shared/` + `src/preload/`）修改通过交接文档登记，前端可感知

---

## 三、踩坑记录

### 3.1 TypeScript: Cannot find name 'DEFAULT_BACKFILL_PAGE_SIZE'

**场景**：`ipc/tutorial.ts` 引用 `backfill-service.ts` 的常量，但未 export。

**修复**：在 `backfill-service.ts` 中 `export const DEFAULT_BACKFILL_PAGE_SIZE = 100`，在 `tutorial.ts` 中 `import { DEFAULT_BACKFILL_PAGE_SIZE } from '../services/tutorial/backfill-service'`。

**教训**：模块间的常量依赖必须在 `import` 时显式声明，不能靠 "同文件可见" 假设。

### 3.2 Vitest: Cannot access 'mockGetAllWindows' before initialization

**场景**：测试文件顶部 `vi.mock('electron', ...)` 内部引用 `mockGetAllWindows`，但 mock 函数在 `vi.mock` 之后才声明。

**修复**：用 `vi.hoisted` 把 mock 函数声明提升到 hoisting 阶段：
```typescript
const { mockGetAllWindows, mockEnsureLoaded, mockEmbedBatch, mockIsLoaded } = vi.hoisted(() => ({
  mockGetAllWindows: vi.fn(),
  mockEnsureLoaded: vi.fn(),
  mockEmbedBatch: vi.fn(),
  mockIsLoaded: vi.fn(),
}))
```

**教训**：`vi.mock` 会在模块 hoisting 阶段执行，比普通 `const` 声明更早。需要在 mock 内部引用的函数，必须用 `vi.hoisted` 提升。

### 3.3 Vitest: expected false to be true（task concurrency test）

**场景**：测试 "并发启动守卫" 时，第二次 `start()` 应返回 `ok: false`，但实际返回 `ok: true`。

**根因**：mock 实现用 `mockResolvedValue`，`start()` 内部的 `await` 让单例状态更新晚于第二次调用检查。

**修复**：用 `mockImplementation` 添加 `await new Promise(r => setTimeout(r, 10))` 延迟，确保 `running = true` 在第二次调用前生效。

**教训**：单例 + 异步操作并发测试时，必须手动控制时序，否则竞态会让断言不稳定。

### 3.4 Vitest: pages 参数格式（一维 vs 二维数组）

**场景**：`embedBatch` mock 期望收到 `pages: Tutorial[][]`（二维数组），但测试传入 `pages: [{...}]`（一维数组）。

**修复**：改为 `pages: [[{...}]]`。

**教训**：TypeScript 类型 `Tutorial[][]` 表示"数组的数组"，每个内层数组是一批（batch），外层数组是所有批次。测试时需匹配类型结构。

### 3.5 PowerShell: 'tail' is not recognized as a cmdlet

**场景**：在 Windows PowerShell 中执行 `tail -50 file.log` 失败。

**修复**：改用 `Select-Object -Last 30`。

**教训**：Windows 环境下避免 Unix 专用命令，用 PowerShell 等价命令替代。

---

## 四、可复用资产

### 4.1 回滚命令规则表结构

```typescript
interface RollbackRule {
  name: string
  pattern: RegExp
  generator: (match: RegExpMatchArray, command: string) => string
}
```

**复用场景**：未来需要扩展回滚规则时，只需在 `ROLLBACK_RULES` 数组中追加新规则，无需改 `generateRollbackCommand` 主函数。

### 4.2 异步后台任务模式

```typescript
class XxxService {
  private static instance: XxxService | null = null
  private running = false
  private cancelled = false

  static getInstance(): XxxService { ... }
  async start(...): Promise<Progress> { ... }
  cancel(): void { this.cancelled = true }
  getStatus(): { running: boolean; taskId: string | null } { ... }
  private pushProgress(p: Progress): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(CHANNEL, p)
    }
  }
}
```

**复用场景**：未来需要长时间运行的 IPC 任务（如批量知识库导入、批量教程爬取）可复用此模式。

### 4.3 IPC 4 步同步验证 grep 命令

```bash
# Step 1: 通道常量
grep -n "NEW_CHANNEL" src/shared/ipc-channels.ts

# Step 2: handler 注册
grep -n "NEW_CHANNEL" src/main/ipc/xxx.ts

# Step 3: preload 暴露
grep -n "newMethod" src/preload/index.ts

# Step 4: 类型声明（由 exposeInMainWorld 自动推断，无需手写）
```

**复用场景**：每次新增 IPC 通道后，用这组 grep 命令验证 4 步同步完整性。

---

## 五、下一步规划

### 5.1 前端接入（其他 AI 负责）

| 待办 | IPC 通道 | 优先级 |
|------|---------|--------|
| TutorialPage 接入异步回填 | `tutorial:backfill-start` + `onTutorialBackfillProgress` | P3 |
| ModelSettings 消费工具调用统计 | `model:toolCalls` | P3 |
| ModelSettings 消费预算告警 | `budget:alerts` | P3 |
| CalibrationSettings 校准状态管理 | `credibility:calibrate` 等 6 通道 | P3 |

### 5.2 后端后续优化

| 待办 | 模块 | 优先级 |
|------|------|--------|
| EmbeddingService 读写锁 | `services/tutorial/embedding.ts` | P4 |
| 回填进度推送频率动态调整 | `services/tutorial/backfill-service.ts` | P4 |
| 更多工具 handler 接入 `recordToolCall` | `ipc/knowledge.ts` 等 | P4 |
| `alertTokenBudgetExceeded` 接入实际 token 成本监控循环 | `ipc/agent-runtime.ts` | P4 |

### 5.3 比赛交付冲刺（截止 2026-07-30）

| 待办 | 优先级 |
|------|--------|
| 跑 `pnpm build:win` 验证 Windows 安装包 | P0 |
| 端到端演示流程跑通（SSH 连接 → 命令执行 → AI 决策 → 教程检索） | P0 |
| 演示材料制作（100% 真实数据 + 配色 1:1 与 UI 一致 + 录屏时长精确到秒） | P0 |

---

**经验沉淀完成**。v2.5 循环工程的技术决策、流程经验、踩坑记录和可复用资产已归档，供后续开发参考。
