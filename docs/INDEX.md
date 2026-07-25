# TDSF-Linux Desktop · 项目文档总索引

> **更新时间**：2026-07-25 Asia/Shanghai（v2.2 同步：docs/ 目录归档 + 索引同步）
> **比赛截止**：2026-07-30（剩 5 天）
> **战略定位**：做大做精 · 不降级 · 不卡死阈值 · 保留所有技术亮点
> **当前状态**：后端 95%+ / 前端重构中 / 三绿硬门禁全过 / 1282 测试通过

---

## 0. 一分钟速读

| 维度 | 数值 |
|------|------|
| 后端 IPC handler 总数 | 211（全部真实业务逻辑） |
| 后端完成度 | 95%+ |
| 前端 electronAPI 调用次数 | 231 |
| 前端孤儿 API 数 | ~75 |
| 后端就绪但前端未接入 | ~50 |
| 测试通过率 | 1282/1282 (100%) |
| 编译门禁 | ✅ 三绿硬门禁全过 |
| 比赛截止 | 2026-07-30（剩 5 天） |

**5 份核心交付物**（2026-07-25 生成）：

1. [TDSF高质量做大方案-终稿.md](../../TDSF高质量做大方案-终稿.md) — 核心交付物（简化 CLAUDE.md + 治理工具 + 5 天作战计划）
2. [官方建议与项目实际对比分析.md](../../官方建议与项目实际对比分析.md) — 35 项 Gap 分析
3. [Electron-高效开发-调研报告.md](../../Electron-高效开发-调研报告.md) — 必装库清单
4. [AI辅助开发-调研报告.md](../../AI辅助开发-调研报告.md) — Anthropic 官方最佳实践
5. [项目开发经验与约束合理性分析.md](../../项目开发经验与约束合理性分析.md) — 12 类问题时间线

---

## 1. 顶层文档（必读）

| 文档 | 路径 | 用途 | 行数 |
|------|------|------|------|
| **AI 接手提示词 v2.2** | [docs/handoff/AI_HANDOVER_PROMPT.md](handoff/AI_HANDOVER_PROMPT.md) | 接手 AI 第一条消息模板（v2.2 修正 backfill 4 方法失实描述） | ~580 行 |
| **交接总说明** | [docs/handoff/HANDOVER.md](handoff/HANDOVER.md) | 统一入口 + TOP 5 关键发现 | ~350 行 |
| **交接文档索引** | [docs/handoff/README.md](handoff/README.md) | 8 份交接文档清单 | ~75 行 |
| **高质量做大方案** | [../../TDSF高质量做大方案-终稿.md](../../TDSF高质量做大方案-终稿.md) | 简化 CLAUDE.md + 治理工具 + 5 天作战 | ~540 行 |

---

## 2. 项目规范（开发约束）

| 文档 | 路径 | 用途 | 状态 |
|------|------|------|------|
| 项目簇入口 | [../../CLAUDE.md](../../CLAUDE.md) | 工作区入口 + CodeGraph 使用 | ✅ 当前 |
| 子项目入口 | [CLAUDE.md](../CLAUDE.md) | AI Agent 工作入口 | ⚠️ 建议替换为终稿 §1 模板 |
| 编码规范 | [CODING.md](../CODING.md) | 80 行核心规范 | ⚠️ 建议按终稿 §2 调整 |
| Agent 工作指南 | [AGENTS.md](../AGENTS.md) | v10.0 模块状态 + 两周路线 | ✅ 当前 |
| 技术栈教程 | [docs/技术栈教程注意事项-v1.0.md](技术栈教程注意事项-v1.0.md) | 8 篇技术栈本地化教程 | ✅ 当前 |
| Agent 边界 | [docs/AGENT-BOUNDARY.md](AGENT-BOUNDARY.md) | 多 AI 协作边界 | ✅ 当前 |
| 主路径指南 | [docs/AGENT_MAIN_PATH.md](AGENT_MAIN_PATH.md) | Agent 主路径 | ✅ 当前 |
| UI 设计规范 v2.0 | [docs/UI设计规范-v2.0.md](UI设计规范-v2.0.md) | UI 设计规范 | ✅ 当前 |
| 技术栈参考索引 | [docs/TECH-STACK-REFERENCE-INDEX.md](TECH-STACK-REFERENCE-INDEX.md) | 官方文档索引 | ✅ 当前 |

---

## 3. 交接文档（docs/handoff/）

### 3.1 核心交接文档（6 份）

| # | 文档 | 路径 | 用途 |
|---|------|------|------|
| 1 | **HANDOVER.md** ⭐ | [handoff/HANDOVER.md](handoff/HANDOVER.md) | 统一入口 + TOP 5 关键发现 + P0-P3 行动清单 |
| 2 | IPC 契约 | [handoff/ipc-contract.md](handoff/ipc-contract.md) | 36 域 / 211 handler / 全量参数与返回值 |
| 3 | 前后端职责边界 | [handoff/frontend-backend-boundary.md](handoff/frontend-backend-boundary.md) | 共享层契约 + v2.4/v2.5 新增能力清单 |
| 4 | 核心数据流 | [handoff/data-flow.md](handoff/data-flow.md) | 7 条数据流时序图 |
| 5 | 后端完成度审计 | [handoff/backend-completion-audit.md](handoff/backend-completion-audit.md) | 211 handler + 15 services + 30+ core 模块 |
| 6 | 前端待接入清单 | [handoff/frontend-integration-checklist.md](handoff/frontend-integration-checklist.md) | 231 调用 + 75 孤儿 API |

### 3.2 验证报告（3 份）

| # | 报告 | 路径 | 用途 |
|---|------|------|------|
| 1 | IPC 4 步同步审计 | [handoff/ipc-4step-sync-audit.md](handoff/ipc-4step-sync-audit.md) | 4 步同步缺失项 + 类型声明修复清单 |
| 2 | 前端集成验证 | [handoff/frontend-integration-verification.md](handoff/frontend-integration-verification.md) | P0 项实测状态 + git log 重构进度 |
| 3 | 编译门禁验证 | [handoff/build-gate-verification.md](handoff/build-gate-verification.md) | 三绿 + test 四绿实测报告 |

### 3.3 接手 AI 提示词

| 文档 | 路径 | 版本 | 说明 |
|------|------|------|------|
| **AI_HANDOVER_PROMPT.md** | [handoff/AI_HANDOVER_PROMPT.md](handoff/AI_HANDOVER_PROMPT.md) | v2.2 | 接手 AI 第一条消息模板（v2.2 修正 backfill 4 方法 renderer 层缺失描述 + P0 执行顺序调整） |

---

## 4. 最新调研报告（项目根目录，2026-07-25 生成）

| # | 文档 | 路径 | 字数 | 核心价值 |
|---|------|------|------|---------|
| 1 | **TDSF高质量做大方案-终稿** | [../../TDSF高质量做大方案-终稿.md](../../TDSF高质量做大方案-终稿.md) | ~6000 字 | 核心交付物（简化 CLAUDE.md + 治理工具 + 5 天作战） |
| 2 | 官方建议与项目实际对比分析 | [../../官方建议与项目实际对比分析.md](../../官方建议与项目实际对比分析.md) | ~7000 字 | 35 项 Gap 分析 + 改进优先级矩阵 |
| 3 | Electron 高效开发调研 | [../../Electron-高效开发-调研报告.md](../../Electron-高效开发-调研报告.md) | ~8000 字 | 必装库清单 + 主流桌面应用架构 |
| 4 | AI 辅助开发调研 | [../../AI辅助开发-调研报告.md](../../AI辅助开发-调研报告.md) | ~8000 字 | Anthropic 官方最佳实践 + 4 级 Verification Gate |
| 5 | 项目开发经验与约束合理性分析 | [../../项目开发经验与约束合理性分析.md](../../项目开发经验与约束合理性分析.md) | ~5200 字 | 12 类问题时间线 + 约束合理性评估 |
| 6 | 桌面开发经验总结与约束完善方案 | [../../桌面开发经验总结与约束完善方案.md](../../桌面开发经验总结与约束完善方案.md) | ~3500 字 | 综合方案 + 行动清单 |

---

## 5. 项目报告（docs/reports/，工作区根）

| 文档 | 路径 | 用途 |
|------|------|------|
| 项目交接文档 | [../../docs/reports/TDSF_DESKTOP_HANDOVER.md](../../docs/reports/TDSF_DESKTOP_HANDOVER.md) | 工作区级别交接 |
| 项目救援盘点 | [../../docs/reports/项目救援盘点.md](../../docs/reports/项目救援盘点.md) | 多 AI 并行冲突复盘 |
| 循环工程质量根因分析 | [../../docs/reports/循环工程质量根因分析与改进方案.md](../../docs/reports/循环工程质量根因分析与改进方案.md) | AI 自检失效分析 |
| 开发方向优化报告 | [../../docs/reports/开发方向优化报告.md](../../docs/reports/开发方向优化报告.md) | 开发方向优化 |

---

## 6. 技术参考（docs/technical/，工作区根）

| 文档 | 路径 | 用途 |
|------|------|------|
| **开源项目复用清单** | [../../docs/technical/开源项目复用清单.md](../../docs/technical/开源项目复用清单.md) | 18 个开源参考项目详细复用矩阵 |

---

## 7. 归档目录（docs/archive/）

> 详见 [docs/archive/README.md](archive/README.md)

### 7.1 版本归档（完整工程记录）

| 目录 | 版本 | 主要内容 |
|------|------|----------|
| `archive/v2.5-loop-engineering-archive/` | v2.5 | 循环工程（Phase C/D/E） |
| `archive/v2.x-v2.0-backend-agent-archive/` | v2.0 | 后端 + Agent 架构循环工程 |
| `archive/v2.x-v2.1-functional-fix-archive/` | v2.1 | 功能修复循环工程 |
| `archive/v2.x-v2.2-deep-fix-archive/` | v2.2 | 深度审计 + 修复 |
| `archive/v2.x-v2.2-p2-agent-enhancement-archive/` | v2.2 | P2 Agent 架构强化 |
| `archive/v2.x-v2.3-p3-audit-p0-fix-archive/` | v2.3 | 第五波 P3 审计 P0 红线修复 |
| `archive/v2.x-v2.3-ui-function-balance-archive/` | v2.3 | UI 与功能平衡修复 |
| `archive/v2.3-backend-fix-archive/` | v2.3 | 后端修复 |
| `archive/v0.x-root-docs-archive/` | v0.x | **根目录旧版文档归档**（HANDOVER/TUTORIAL/TUTORIAL_ARCHITECTURE/DEV_SKILLS/问答归档 等 5 个文件，2026-07-25 归档） |

### 7.2 docs/ 根目录冗余文档归档（2026-07-25）

> 7 个 docs/ 根目录下的过期方案书/审查报告已归档至 `archive/` 顶层：

| 原路径 | 归档路径 | 归档原因 |
|--------|---------|---------|
| `docs/救赎之路-项目重塑方案.md` | `archive/救赎之路-项目重塑方案-v2026-07-23.md` | 已被 TDSF高质量做大方案-终稿.md 取代 |
| `docs/v2.3-外部独立审查报告.md` | `archive/v2.3-外部独立审查报告.md` | v2.3 已归档版本 |
| `docs/v2.4-backend-completion-plan.md` | `archive/v2.4-backend-completion-plan.md` | v2.4 已归档版本 |
| `docs/v2.5-research-backend-enhancement.md` | `archive/v2.5-research-backend-enhancement.md` | v2.5 已归档版本 |
| `docs/后端功能审计报告-2026-07-24.md` | `archive/后端功能审计报告-2026-07-24.md` | 已被 handoff/backend-completion-audit.md 取代 |
| `docs/项目救援盘点.md` | `archive/项目救援盘点-v2026-07-23.md` | 2026-07-23 时的复盘，已失去时效性 |
| `docs/问答归档.md` | `archive/问答归档-v2026-07-20-4buttons.md` | 已被 handoff/ + qa-archive/ 取代 |

### 7.3 历史方案书（按需查阅）

60+ 份历史方案书归档在 `archive/` 目录下，按版本号命名：
- `方案书-v0.5.0-LLM-Tool-Calling与MCP双暴露.md`
- `方案书-v0.6.0-教程爬虫与权威源同步.md`
- `方案书-v0.9.x-Agent架构设计*.md`
- `方案书-v1.0-重构总方案书.md`
- `方案书-v2.3-第五波P3审计P0红线修复.md`
- 等等

### 7.4 历史规范（已归档）

| 文档 | 路径 | 说明 |
|------|------|------|
| CLAUDE-v2.5.md | `archive/CLAUDE-v2.5.md` | 旧版 CLAUDE.md（350 行，已简化） |
| AGENTS-v8.7.md | `archive/AGENTS-v8.7.md`（如有） | 旧版 AGENTS.md（800 行，已简化） |

---

## 8. 其他资源

### 8.1 Skill 研究

| 目录 | 路径 | 用途 |
|------|------|------|
| Skill 研究目录 | [docs/skill-research/](skill-research/) | 5 份 Skill 综合开发方案 |
| 技术栈 Skill | [docs/tech-stack-skills/](tech-stack-skills/) | 8 篇技术栈 Skill 教程 |

### 8.2 设计稿

| 目录 | 路径 | 用途 |
|------|------|------|
| 审计截图 | [docs/audit-screenshots/](audit-screenshots/) | 21 张设计稿 + 21 张实际截图对比 |
| 视觉审计 HTML | [docs/visual-audit-report.html](visual-audit-report.html) | 视觉审计交互报告 |

### 8.3 经验沉淀

| 文档 | 路径 | 用途 |
|------|------|------|
| 经验沉淀 | [../../.learnings/LEARNINGS.md](../../.learnings/LEARNINGS.md) | 跨会话经验沉淀 |
| 错误记录 | [../../.learnings/ERRORS.md](../../.learnings/ERRORS.md) | 错误案例 |
| 项目记忆 | `C:\Users\Lenovo\.trae-cn\memory\projects\-d-ai-linux----\project_memory.md` | 项目级规则与约束 |

### 8.4 调试与图谱

| 工具 | 命令 | 用途 |
|------|------|------|
| CodeGraph | `codegraph query <Symbol>` | 符号级调用图谱（542 files / 7,193 nodes / 20,567 edges） |
| CodeGraph 同步 | `pwsh -NoProfile -File "d:\ai\linux教学一体\scripts\codegraph-sync-all.ps1"` | 大改动后同步索引 |

---

## 9. 文档阅读顺序建议

### 9.1 给接手 AI（5 分钟起步）

1. **必读**：[AI_HANDOVER_PROMPT.md](handoff/AI_HANDOVER_PROMPT.md) v2.2 — 接手 AI 第一条消息（v2.2 修正 backfill 4 方法失实描述 + P0 执行顺序调整）
2. **必读**：[HANDOVER.md](handoff/HANDOVER.md) — 一分钟速读 + TOP 5 关键发现
3. **必读**：[../../TDSF高质量做大方案-终稿.md](../../TDSF高质量做大方案-终稿.md) — 最新约束与治理工具
4. **必读**：[frontend-integration-verification.md](handoff/frontend-integration-verification.md) — P0 项实测状态
5. **参考**：[ipc-4step-sync-audit.md](handoff/ipc-4step-sync-audit.md) — 类型声明修复清单（注意：文档中"类型声明缺失"描述可能过时，以 AI_HANDOVER_PROMPT.md v2.2 实测为准）

### 9.2 给后端维护者

1. [backend-completion-audit.md](handoff/backend-completion-audit.md) — 后端完成度 + 已知问题
2. [ipc-contract.md](handoff/ipc-contract.md) — IPC 通道契约
3. [data-flow.md](handoff/data-flow.md) — 数据流时序

### 9.3 给前端开发者

1. [AI_HANDOVER_PROMPT.md](handoff/AI_HANDOVER_PROMPT.md) v2.2 — 工作流约束（含 P0 执行顺序：P0-2 → P0-1 → P0-4 → P0-3）
2. [frontend-integration-checklist.md](handoff/frontend-integration-checklist.md) — 完整待接入清单
3. [frontend-backend-boundary.md](handoff/frontend-backend-boundary.md) — 职责边界 + IPC 4 步同步铁律

### 9.4 给项目决策者

1. [../../TDSF高质量做大方案-终稿.md](../../TDSF高质量做大方案-终稿.md) — 核心交付物
2. [../../官方建议与项目实际对比分析.md](../../官方建议与项目实际对比分析.md) — 35 项 Gap 分析
3. [../../项目开发经验与约束合理性分析.md](../../项目开发经验与约束合理性分析.md) — 12 类问题时间线

---

## 10. 文档间交叉引用关系

```
项目根/
├── CLAUDE.md（项目簇入口）
├── TDSF高质量做大方案-终稿.md ⭐ 核心交付物
├── 官方建议与项目实际对比分析.md
├── Electron-高效开发-调研报告.md
├── AI辅助开发-调研报告.md
├── 项目开发经验与约束合理性分析.md
├── 桌面开发经验总结与约束完善方案.md
├── docs/
│   ├── reports/（项目报告）
│   │   ├── TDSF_DESKTOP_HANDOVER.md
│   │   ├── 项目救援盘点.md
│   │   ├── 循环工程质量根因分析与改进方案.md
│   │   └── 开发方向优化报告.md
│   └── technical/
│       └── 开源项目复用清单.md
└── tdsf-linux-desktop/
    ├── CLAUDE.md（子项目入口，建议替换为终稿 §1）
    ├── CODING.md（编码规范，建议按终稿 §2 调整）
    ├── AGENTS.md（Agent 工作指南 v10.0）
    └── docs/
        ├── INDEX.md（本文件，总索引）
        ├── handoff/（11 份交接文档，详见 §3）
        │   ├── AI_HANDOVER_PROMPT.md v2.2 ⭐ 接手 AI 第一条消息
        │   ├── HANDOVER.md（统一入口，2026-07-25 多 agent 协同审计版）
        │   └── ...（共 11 份）
        ├── archive/（60+ 份历史文档，详见 §7）
        │   ├── README.md
        │   ├── v0.x-root-docs-archive/（根目录旧版文档归档，2026-07-25）
        │   ├── 救赎之路-项目重塑方案-v2026-07-23.md（已归档）
        │   ├── v2.3-外部独立审查报告.md（已归档）
        │   ├── v2.4-backend-completion-plan.md（已归档）
        │   ├── v2.5-research-backend-enhancement.md（已归档）
        │   ├── 后端功能审计报告-2026-07-24.md（已归档）
        │   ├── 项目救援盘点-v2026-07-23.md（已归档）
        │   ├── 问答归档-v2026-07-20-4buttons.md（已归档）
        │   └── ...（共 60+ 份）
        ├── audit-screenshots/（21 张设计稿 + 21 张实际截图对比）
        ├── skill-research/（5 份 Skill 综合开发方案）
        ├── tech-stack-skills/（8 篇技术栈 Skill 教程，已取代 DEV_SKILLS.md）
        ├── superpowers/（plans + specs 子目录）
        ├── v2.3-backend-fix-archive/（v2.3 后端修复归档）
        ├── AGENT-BOUNDARY.md（多 AI 协作边界）
        ├── AGENT_MAIN_PATH.md（Agent 主路径冻结）
        ├── FRONTEND-VISUAL-COMPARISON.md（前端视觉对比）
        ├── VISUAL-OPTIMIZATION-REPORT.md（视觉优化报告）
        ├── TECH-STACK-REFERENCE-INDEX.md（技术栈参考索引）
        ├── UI设计规范-v2.0.md（UI 设计规范 v2.0）
        ├── 技术栈教程注意事项-v1.0.md（8 篇技术栈教程）
        ├── v2.3-ui-function-balance-plan.md（v2.3 UI 与功能平衡方案）
        ├── v2.5-loop-engineering-plan.md（v2.5 循环工程方案书）
        └── visual-audit-report.html（视觉审计交互报告）
```

---

## 11. 文档治理规则

### 11.1 文档新增规则

- 新文档必须在本文档（INDEX.md）登记
- 文档命名规范：`v{版本}-{主题}.md` 或 `{主题}-{版本}.md`
- 临时文档放 `docs/drafts/`（如有），正式文档放 `docs/`

### 11.2 文档归档规则

- 超过 30 天未更新的非核心文档移至 `docs/archive/`
- 归档前在 `docs/archive/README.md` 登记
- 归档文档不再维护，仅供查阅

### 11.3 文档删除规则

- 删除任何文档前必须 grep 引用确认无引用
- 在 `git log` 查看最近修改
- 在 PR 中说明删除理由

---

*索引维护：每次新增/删除/归档文档时同步更新本文档*
