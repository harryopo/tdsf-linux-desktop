# v2.1 功能修复循环工程 · Hard Constraint 对齐清单

> 对照 project_memory.md 中的 Hard Constraints 逐项检查

---

## A 类红线（不可违反）

| ID | 约束 | 对齐状态 | 说明 |
|----|------|----------|------|
| A7 | 质量绝对优先 | ✅ | 未跳步降级，SSH心跳实现真实重连(非return true)，known_hosts实现HMAC-SHA1真实比对 |
| A8 | 避免重复造轮子 | ✅ | known-hosts.ts 参考 electerm MIT License 实现，不从头造 |
| A9 | 技术栈Skill调用前置 | ✅ | SSH/IPC/Electron 相关修改均查阅现有代码后实施 |

## 通用 Hard Constraints

| ID | 约束 | 对齐状态 | 说明 |
|----|------|----------|------|
| HC-1 | IDE基于SftpManager扩展 | ✅ | v2.1未改变架构 |
| HC-2 | Agent主进程TS优先 | ✅ | 所有Agent代码用TS |
| HC-3 | 可信度算法论文支撑 | ✅ | 未修改可信度算法 |
| HC-4 | @命令鼠标划选注入 | ✅ | 未修改@命令 |
| HC-5 | 运维Agent人工审批闸门 | ✅ | 未修改审批流程 |
| HC-6 | 不反编译Claude Code | ✅ | 未涉及 |
| HC-7 | 所有网络请求UI可见 | ✅ | SSH连接状态通过IPC推送UI |
| HC-8 | 敏感文件默认redact | ✅ | 未修改redact逻辑 |
| HC-9 | 本地优先 | ✅ | DeepSeek API需用户显式配置 |
| HC-10 | Token消耗透明 | ✅ | 未修改Token显示 |
| HC-11 | CSS用var(--color-*) | ✅ | HostKeyPromptDialog.css 全部用var(--trae-*) |
| HC-12 | 主色低饱和靛蓝 | ✅ | 未引入新主色 |
| HC-13 | 卡片hover仅阴影变化 | ✅ | 未修改卡片hover |
| HC-14 | 质量绝对优先(重申) | ✅ | 同A7 |
| HC-15 | 开源源码全量分析 | ✅ | electerm ssh-known-hosts.js 已全量阅读(452行) |
| HC-16 | 前端严格按设计稿1:1复现 | ✅ | v2.1未涉及设计稿变更 |
| HC-17 | 软件支持窗口尺寸调整及全屏 | ✅ | 未修改窗口逻辑 |
| HC-18 | 字体优先Inter和JetBrains Mono | ✅ | 未修改字体 |

## v1.0 特定约束

| ID | 约束 | 对齐状态 | 说明 |
|----|------|----------|------|
| F1 | Stars<1k必查10项安全清单 | ✅ | electerm Stars>1k 豁免 |
| R10 | 沙箱化代码执行 | ✅ | 未修改沙箱 |
| R11 | OpenTelemetry观测性 | ✅ | 未修改Langfuse |
| R12 | 三态权限审批 | ✅ | 未修改权限 |
| R13 | License黑名单 | ✅ | electerm MIT License 通过 |
| R14 | HITL CoPilot模式 | ✅ | 未修改HITL |
| R15 | 后台Review解耦 | ✅ | 未修改后台Review |
| R16 | 多AI协作冲突预防 | ✅ | 单AI模式(v8.4降级) |
| R17 | 体积预算+250MB | ✅ | v2.1未增加大依赖 |
| R18 | Python多Sidecar隔离 | ✅ | 未修改Sidecar |

## 工程约定

| 约束 | 对齐状态 | 说明 |
|------|----------|------|
| IPC 4步同步铁律 | ✅ | Phase K/L/M 所有新增IPC通道均完成4步同步 |
| Agent工具调用走MCP | ✅ | 未修改MCP |
| 事件流存储用Dexie | ✅ | 未修改事件流 |
| 可信度计算透明化 | ✅ | 未修改可信度 |
| IDE编辑器用@monaco-editor/react | ✅ | 未修改编辑器 |
| 远程路径作为唯一ID | ✅ | 未修改路径逻辑 |
| 颜色系统一个主蓝+黑白灰 | ✅ | 未引入新颜色 |
| 输入框border聚焦变蓝无glow | ✅ | 未修改输入框 |
| subagent完整UI集成 | ✅ | HostKeyPromptDialog通过subagent实施 |
| 字体通过Google Fonts CDN | ✅ | 未修改字体引入 |
| 暗色模式默认开启 | ✅ | 未修改暗色模式 |

---

## 总结

- **A类红线**：3/3 通过
- **通用Hard Constraints**：18/18 通过
- **v1.0特定约束**：10/10 通过
- **工程约定**：11/11 通过
- **总计**：42/42 全部对齐 ✅
