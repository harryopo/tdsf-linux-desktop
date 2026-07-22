# v2.3 UI 与功能平衡修复 · 验收清单

## 编译门禁

- [x] `pnpm typecheck:node` exit 0
- [x] `pnpm typecheck:web` exit 0
- [x] `pnpm lint` exit 0

## 功能真实化

- [x] HistoryPage 时间范围筛选可真实过滤历史记录
- [x] GeneralSettings 在 Electron 环境下调用真实 IPC 保存设置
- [x] KnowledgePage 在 Electron 环境下调用 `kbList` 加载真实数据
- [x] LogsPage 在 Electron 环境下调用 `log:query` 加载真实日志
- [x] TutorialDetailPage 在 Electron 环境下调用 tutorial 详情 IPC
- [x] DecisionDetailPage loopConfirm 支持 newCommand 参数
- [x] AIPanel 实现上下文压缩策略
- [x] AboutSettings 通过 `app:get-info` IPC 获取真实版本/构建时间/安装路径

## UI 交互细节

- [x] 所有页面内容区可滚动
- [x] 按钮有合适的 hover/active 反馈
- [x] Modal/Dialog ESC 和蒙层关闭行为一致
- [x] 表单提交前验证并提示错误
- [x] 列表空状态使用 Empty 组件
- [x] 窗口缩小时布局不崩

## 规范符合性

- [x] 未因行数而拆分大文件
- [x] 新增/修改 IPC 完成 4 步同步
- [x] 颜色使用 token，无硬编码色值
