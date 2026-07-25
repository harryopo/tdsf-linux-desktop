# TDSF Linux Desktop — 前后端交接文档索引

> 生成时间：2026-07-25
> 适用版本：v2.5
> 编译门禁：✅ 四绿全过（typecheck:node / typecheck:web / lint / test 1282/1282 通过）

## 快速入口

👉 **接手 AI 请先读 [HANDOVER.md](./HANDOVER.md)**（统一入口，5 分钟速读）

## 文档清单

### 核心交接文档（5 份）

| # | 文档 | 路径 | 用途 |
|---|------|------|------|
| 1 | **HANDOVER.md** ⭐ | [./HANDOVER.md](./HANDOVER.md) | 统一入口，TOP 5 关键发现 + P0-P3 行动清单 |
| 2 | IPC 契约 | [./ipc-contract.md](./ipc-contract.md) | 36 域 / 211 handler / 全量参数与返回值 |
| 3 | 前后端职责边界 | [./frontend-backend-boundary.md](./frontend-backend-boundary.md) | 共享层契约 + v2.4/v2.5 新增能力清单 |
| 4 | 核心数据流 | [./data-flow.md](./data-flow.md) | 7 条数据流时序图（含 v2.5 异步回填流） |
| 5 | 后端完成度审计 | [./backend-completion-audit.md](./backend-completion-audit.md) | 211 handler + 15 services + 30+ core 模块 |
| 6 | 前端待接入清单 | [./frontend-integration-checklist.md](./frontend-integration-checklist.md) | 231 调用 + 75 孤儿 API + P0-P3 行动项 |

### 验证报告（3 份，2026-07-25 生成）

| # | 报告 | 路径 | 用途 |
|---|------|------|------|
| 1 | IPC 4 步同步审计 | [./ipc-4step-sync-audit.md](./ipc-4step-sync-audit.md) | 4 步同步缺失项 + 校准 6 通道矛盾点澄清 |
| 2 | 前端集成验证 | [./frontend-integration-verification.md](./frontend-integration-verification.md) | P0 项实测状态 + git log 重构进度 |
| 3 | 编译门禁验证 | [./build-gate-verification.md](./build-gate-verification.md) | 四绿实测报告 |

## 阅读顺序建议

### 给接手 AI（5 分钟起步）

1. **必读**：[HANDOVER.md](./HANDOVER.md) — 一分钟速读 + TOP 5 关键发现 + P0 行动清单
2. **必读**：[frontend-integration-verification.md](./frontend-integration-verification.md) — P0 项实际状态
3. **参考**：[ipc-4step-sync-audit.md](./ipc-4step-sync-audit.md) — 类型声明缺失项修复清单

### 给后端维护者

1. [backend-completion-audit.md](./backend-completion-audit.md) — 后端完成度 + 已知问题
2. [ipc-contract.md](./ipc-contract.md) — IPC 通道契约
3. [data-flow.md](./data-flow.md) — 数据流时序

### 给前端开发者

1. [HANDOVER.md](./HANDOVER.md) — P0-P3 行动清单
2. [frontend-integration-checklist.md](./frontend-integration-checklist.md) — 完整待接入清单
3. [frontend-backend-boundary.md](./frontend-backend-boundary.md) — 职责边界 + IPC 4 步同步铁律

## 关键数字

| 维度 | 数值 |
|------|------|
| 后端 IPC handler 总数 | 211 |
| 后端完成度 | 95%+ |
| 前端 electronAPI 调用次数 | 231 |
| 前端孤儿 API 数 | ~75 |
| 后端就绪但前端未接入 | ~50 |
| 编译门禁 | ✅ 四绿全过 |
| 测试通过率 | 1282/1282 (100%) |
| P0 待办项 | 4 项 |

## 配套资源

- **v2.5 循环工程归档**：`docs/archive/v2.5-loop-engineering-archive/`
- **v2.5 方案书**：`docs/v2.5-loop-engineering-plan.md`
- **CHANGELOG**：`CHANGELOG.md`
- **项目根 CLAUDE.md**：`../../CLAUDE.md`（工作区入口 + CodeGraph 使用指引）
- **CodeGraph 图谱**：542 files / 7,193 nodes / 20,567 edges

---

**有问题先查 HANDOVER.md 第 3 节 TOP 5 关键发现，90% 的疑问能在那里找到答案。**
