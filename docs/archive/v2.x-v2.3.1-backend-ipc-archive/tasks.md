# v2.3.1 后端 IPC 补齐 · 任务清单

> 版本：v2.3.1
> 时间：2026-07-23
> 目标：按待开发功能清单补齐后端 IPC，将前端剩余估算数据转为真实数据
> 规范基线：CLAUDE.md v2.5 + AGENTS.md v8.7

---

## Phase P · 规划与后端调研
- [x] P.1 并行调研 4 模块后端结构（教程/知识库/决策/模型统计）
- [x] P.2 批量修改 ipc-channels.ts 添加所有新通道常量
- [x] P.3 后端 4 步同步（models + database + repos + handlers + preload + electron.d.ts）

## Phase T · 前端页面接入（9 Task）
- [x] T.A 教程学习进度（localStorage 过渡方案）
- [x] T.B 教程学习人次（tutorial:stats IPC）
- [x] T.C 知识库浏览记录（kb:view + kb:hot + kb:recentViews）
- [x] T.D 决策历史统计（history:stats IPC）
- [x] T.E 模型配置 KPI 真实成功率（复用 history:stats）
- [x] T.F 模型配置对话记录真实化（复用 token:records）
- [x] T.G 教程分类数量 UI 显示
- [x] T.H 知识库贡献后刷新
- [x] T.I 合规审计 HTML 报告导出按钮

## Phase Q · 验证与归档
- [x] Q.1 编译门禁三绿验证（typecheck:node + typecheck:web + lint）
- [x] Q.2 创建归档文档
- [x] Q.3 更新待开发功能清单

---

## 新增 IPC 通道汇总

| 通道 | 方向 | 用途 | 实现文件 |
|---|---|---|---|
| `tutorial:stats` | invoke | 教程统计聚合（总课程/总浏览/总课时/分类数） | `src/main/ipc/tutorial.ts` |
| `kb:view` | invoke | 记录浏览（自增 useCount + 写浏览历史） | `src/main/ipc/knowledge.ts` |
| `kb:hot` | invoke | 热门知识（按 useCount 降序） | `src/main/ipc/knowledge.ts` |
| `kb:recentViews` | invoke | 最近浏览记录（从浏览历史表查询） | `src/main/ipc/knowledge.ts` |
| `history:stats` | invoke | 决策统计聚合（成功率/平均耗时等） | `src/main/ipc/history.ts` |

## 数据库变更

| 变更 | 表 | 说明 |
|---|---|---|
| ADD COLUMN serverId | decision_cards | 目标服务器 ID |
| ADD COLUMN durationMs | decision_cards | 执行耗时（ms） |
| CREATE TABLE | kb_view_history | 知识库浏览历史记录 |
