# v2.5 循环工程 · 任务清单

> 归档时间：2026-07-24
> 关联方案书：`docs/v2.5-loop-engineering-plan.md`
> 范围：后端功能收尾 + 前后端交接契约更新 + 循环工程开发流程配置
> 约束：前端由其他 AI 重构完善中，本批次只改后端（src/main/ + src/shared/ + src/preload/），不碰 src/renderer/

---

## 一、任务总览

| Phase | Task ID | 任务 | 优先级 | 状态 | 提交 commit |
|-------|---------|------|--------|------|-------------|
| Pre | P1-8 | 回滚命令动态生成（18 条规则 + 5 不可逆黑名单 + 路径解析） | P1 | ✅ 完成 | `82a3132` |
| C | P1-9 | EmbeddingBackfillService 异步分批回填 + IPC 进度推送 | P1 | ✅ 完成 | `e89c0be` |
| D1 | P2-1 | hybrid-search.ts 注释测试迁移到 vitest | P2 | ✅ 完成 | `35ccc85` |
| D2 | P2-2 | path-recommender.ts 注释逻辑清理 | P2 | ✅ 完成 | `fc1c58f` |
| D3 | P2-3 | 8 个文件 xxx 占位注释替换为具体示例 | P2 | ✅ 完成 | `fc1c58f` |
| E | 收尾 | v2.5 归档 + 交接文档更新 + CHANGELOG + 记忆保存 | 收尾 | ✅ 完成 | 本次提交 |

**总完成度**：6/6 ✅

---

## 二、关键交付物

### 2.1 P1-8：回滚命令动态生成

**文件**：
- 新建：`src/main/services/security/rollback-generator.ts`
- 修改：`src/main/ipc/sandbox-approval.ts`（替换硬编码 `deriveRollbackCommand`）
- 新建测试：`tests/services/security/rollback-generator.test.ts`（38 用例）

**能力清单**：
- 18 条 Linux 常见操作的回滚规则（git / systemctl / chmod / useradd / file-overwrite 等）
- 5 条不可逆命令黑名单（`rm -rf` / `mkfs` / `dd if=` / `shutdown` / `> /dev/sd`）
- 路径解析：从命令中提取真实文件路径生成针对性回滚（如 `> /etc/sysctl.conf` → `cp /etc/sysctl.conf.bak /etc/sysctl.conf`）
- 备份优先策略：高风险命令先建议 `cp xxx xxx.bak` 再执行
- 风险等级联动：`high` 风险且无规则时返回 `undefined`（拒绝执行），`medium` 风险尝试通用回滚

**集成方式**：
```typescript
// src/main/ipc/sandbox-approval.ts
import { generateRollbackCommand } from '../services/security/rollback-generator'

function deriveRollbackCommand(
  command: string,
  risk: CommandRiskLevel
): string | undefined {
  return generateRollbackCommand(command, risk)
}
```

### 2.2 P1-9：异步 embedding 回填服务

**文件**：
- 新建：`src/main/services/tutorial/backfill-service.ts`（单例 + 状态守卫 + 分页 + 取消）
- 修改：`src/main/ipc/tutorial.ts`（3 新 invoke handler + 旧 handler 委托）
- 修改：`src/shared/ipc-channels.ts`（4 新常量）
- 修改：`src/shared/tutorial-types.ts`（5 新类型）
- 修改：`src/preload/index.ts`（4 新方法 + 注释）
- 新建测试：`tests/services/tutorial/backfill-service.test.ts`（22 用例）

**IPC 4 步同步验证**：

| 步骤 | 文件 | 内容 | 状态 |
|------|------|------|------|
| Step 1 | `src/shared/ipc-channels.ts` | `BACKFILL_START` / `BACKFILL_CANCEL` / `BACKFILL_STATUS` / `BACKFILL_PROGRESS` 常量 | ✅ |
| Step 2 | `src/main/ipc/tutorial.ts` | 3 个 `ipcMain.handle` + push 推送 | ✅ |
| Step 3 | `src/preload/index.ts` | `tutorialBackfillStart` / `tutorialBackfillCancel` / `tutorialBackfillStatus` / `onTutorialBackfillProgress` | ✅ |
| Step 4 | `src/preload/index.d.ts`（由 `exposeInMainWorld` 字面量自动推断） | 类型声明 | ✅ |

**核心设计**：
- **单例 + 状态守卫**：`EmbeddingBackfillService.getInstance()` + `isRunning()` 防止并发启动
- **分页查询**：`LIMIT 100` + `WHERE embedding IS NULL` 自动断点续传
- **事务边界**：embedding 推理在事务外（async），写入在事务内（同步），符合 better-sqlite3 约束
- **取消机制**：`cancelled` 标记，每页处理后检查，单页内不会中止
- **错误隔离**：单批 embedding 失败记录 `failed` 计数，继续下一页
- **ETA 估算**：`elapsed / processed * remaining`
- **进度推送频率**：2578 条 / 100 页 ≈ 26 次推送

**保留向后兼容**：旧通道 `tutorial:backfill-embeddings` 保持不变，内部委托给新 service 的同步等待版本。

### 2.3 P2-1：hybrid-search 注释测试迁移

**文件**：
- 修改：`src/main/services/tutorial/hybrid-search.ts`（删除 52 行 `/* */` 注释测试代码 + 添加迁移说明）
- 新建：`tests/services/tutorial/hybrid-search.test.ts`（18 用例）

**迁移原因**：注释形式的测试无法被 CI 执行，转为 vitest 用例保证覆盖。

**测试覆盖**：
- 纯 FTS 检索（无向量）→ `source=fts`, `vecDistance=-1`
- 纯向量检索（无 FTS 命中）
- 混合检索 + RRF 融合排序
- FTS 查询特殊字符转义（`"` / `'` / `;`）
- 向量路径禁用时的降级
- limit 参数约束
- source 字段正确标注（`fts` / `vector` / `hybrid`）

### 2.4 P2-2：path-recommender 注释清理

**文件**：`src/main/services/tutorial/path-recommender.ts`

**变更**：删除注释掉的"跳过比当前水平低的分类"逻辑块，添加废弃说明。

**决策依据**：分类级过滤过于粗暴，会完全跳过低难度分类的教程，剥夺用户复习基础内容的机会。当前的难度过滤（filter 层）已足够保证推荐结果的难度匹配。

### 2.5 P2-3：xxx 占位注释替换

**8 个文件的占位符替换为具体示例**（仅注释和示例字符串，不改业务逻辑）：

| 文件 | 占位 | 替换为 |
|------|------|--------|
| `services/log/logger.ts` | `sessionId: 'sess_xxx'` | `sessionId: 'sess_abc123'` |
| `services/llm/tools/registry.ts` | `'xxx.ts'` | `'my-tool.ts'` |
| `core/agent/providers/redact.ts` | `sk-xxx` | `sk-ant-api03-xxx` |
| `core/agent/subagents/dispatcher.ts` | `sess_xxx` | `sess_abc123` |
| `services/sandbox/openhands-runner.ts` | `xxx.yml` | `sandbox.yml` |
| `core/agent/modes/ask-prompt.ts` | `[KB:xxx]` | `[KB:disk-full]` |
| `core/agent/modes/mode-registry.ts` | `[LOG:xxx]` | `[LOG:auth]` |
| `core/agent/modes/plan-prompt.ts` | `1. xxx` | `1. 检查磁盘空间` |

### 2.6 Phase E：归档 + 交接 + CHANGELOG

**交付物**：
- 归档目录：`docs/archive/v2.5-loop-engineering-archive/`（本目录）
  - `tasks.md`（本文件）
  - `verify-report.md`（编译门禁 + 测试结果）
  - `learnings.md`（经验沉淀）
- 交接文档更新：
  - `docs/handoff/ipc-contract.md`（追加 4 个 backfill 通道 + 附录 C v2.5 完成度）
  - `docs/handoff/frontend-backend-boundary.md`（追加第 7 节 v2.5 新增能力清单）
  - `docs/handoff/data-flow.md`（追加第 7 节 embedding 回填数据流）
- CHANGELOG：`CHANGELOG.md`（新建，记录 v2.5.0 变更）
- 方案书状态更新：`docs/v2.5-loop-engineering-plan.md`（第七节执行状态总览）
- 项目记忆更新：`C:\Users\Lenovo\.trae-cn\memory\projects\-d-ai-linux----\project_memory.md`

---

## 三、Hard Constraint 对齐

| 约束 | 对齐情况 |
|------|---------|
| HC-1 网络日志可见 | ✅ 所有新 IPC handler 通过 `logger.info/debug/error` 记录关键操作 |
| HC-6 沙箱隔离 | ✅ 回滚命令生成器对不可逆操作返回 `undefined`（拒绝执行） |
| 不碰 src/renderer/ | ✅ 本批次所有改动均在 src/main/ + src/shared/ + src/preload/ + tests/ + docs/ |
| IPC 4 步同步铁律 | ✅ backfill 4 个新通道全部完成 4 步同步 |
| 编译门禁五绿 | ✅ typecheck:node + typecheck:web + lint + test 全部 exit 0（详见 verify-report.md） |
| 质量绝对优先 | ✅ 未为节省资源跳步，所有 Phase C/D/E 任务全量完成 |
| 检查跳步 | ✅ Phase E 归档完整，未省略 learnings / verify-report |

---

## 四、Git 提交记录

```
82a3132 feat(security): P1-8 回滚命令动态生成（18 条规则 + 不可逆黑名单 + 路径解析）
e89c0be feat(tutorial): v2.5 Phase C - 异步 embedding 回填服务 + IPC 进度推送
35ccc85 refactor(test): v2.5 Phase D1 - hybrid-search 注释测试迁移到 vitest
fc1c58f refactor(docs): v2.5 Phase D2+D3 - 注释逻辑清理 + xxx 占位替换
本次     docs: v2.5 Phase E - 归档 + 交接文档更新 + CHANGELOG
```

---

**归档完成**。v2.5 循环工程后端任务全部交付，前端可基于更新后的交接文档接入新 IPC。
