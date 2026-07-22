# v2.3 UI 与功能平衡修复 · 任务清单

> 版本：v2.3
> 时间：2026-07-23
> 目标：修复渲染层 WIP 功能 + UI 交互细节，保证质量优先，不为了拆分大文件而拆分
> 规范基线：CLAUDE.md v2.5 + AGENTS.md v8.7

---

## 一、规范调整（前置）

- [x] 更新 CLAUDE.md v2.5：B1 单文件行数从强制 ≤500 行放宽为质量优先按需拆分
- [x] 更新 AGENTS.md v8.7：同步大文件拆分模式为质量优先

---

## 二、Phase T · 功能真实化（8 Task）

- [x] T.1 HistoryPage 时间范围筛选接真实过滤
- [x] T.2 GeneralSettings 真实 IPC 接入
- [x] T.3 KnowledgePage 真实数据接入
- [x] T.4 LogsPage 真实数据接入
- [x] T.5 TutorialDetailPage 真实数据接入
- [x] T.6 DecisionDetailPage loopConfirm 支持新命令
- [x] T.7 AIPanel 上下文压缩实现
- [x] T.8 AboutSettings 真实应用信息

---

## 三、Phase U · UI 交互细节修复（6 Task）

- [x] U.1 检查所有页面滚动问题
- [x] U.2 检查所有按钮点击反馈
- [x] U.3 检查所有 Modal/Dialog 关闭行为
- [x] U.4 检查表单验证和错误提示
- [x] U.5 检查空状态和 loading 状态
- [x] U.6 检查响应式布局

---

## 四、Phase V · 验证与归档

- [x] V.1 编译门禁三绿验证
- [x] V.2 创建归档文档
- [x] V.3 更新 PROGRESS.md

---

## 五、关键约束

- 不拆分大文件（除非职责确实混杂）
- 所有新增 IPC 完成 4 步同步
- 所有颜色使用 `var(--color-*)` 或 `var(--trae-*)`
- 编译门禁三绿：`typecheck:node` + `typecheck:web` + `lint`
