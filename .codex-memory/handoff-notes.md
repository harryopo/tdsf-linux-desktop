# 给后续智能体的接手说明

## 工作原则

1. 先读文档，再动代码
2. 不要碰 Trae 正在改的文件，除非任务要求直接修复冲突点
3. 每次新增能力，都要同时检查 `src/shared`、`src/main/ipc`、`src/preload`、`src/renderer` 是否同步
4. 交付前至少看一遍 `typecheck`、`build`、核心测试结果

## 优先级建议

1. 对齐 `docs/UI接入接线图-v0.9.5.md` 的 P0 接口和组件
2. 修复渲染层当前的类型导出问题
3. 梳理 mock 页面和真实 IPC 页面边界
4. 把主进程新能力逐步落到 UI
5. 保持 `src/shared` 作为跨进程类型唯一来源

## 当前最值得盯住的点

- `sandbox` 闭环
- `provider` 配置闭环
- `token` 成本透明
- `mode` 五模式切换
- `claude-sdk` 流式对话
- `tool approval` 与 `attention` / `subagent` / `provider info`
- 教程爬虫入口

## 继续推进前先看

- `AGENTS.md`
- `DEV_SKILLS.md`
- `docs/UI接入接线图-v0.9.5.md`
- `docs/v1.0-重构总方案书.md`
- `docs/v1.0-页面结构与视觉规范报告.md`

