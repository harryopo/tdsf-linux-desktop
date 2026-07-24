# v2.3 后端修复完善任务清单

**日期**：2026-07-24

## 后端能力补齐

- [x] 合规审计 HTML 报告与 JSON Schema 校验（formatters.ts）
- [x] LLM fallback 置信度对齐测试预期（client.ts）
- [x] scheduler 归档 repository 适配器（archive-repo-adapter.ts）
- [x] exporter 支持三格式同时导出（exporter.ts）
- [x] Mastra Ops Agent API Key 非空校验（ops-agent.ts）
- [x] OpenHands batchGetSandbox 实现（openhands-client.ts）
- [x] MCP 知识库占位内容修复（resources.ts）
- [x] scheduler IPC 接入真实适配器（scheduler.ts）

## 测试与构建修复

- [x] Vitest 添加 `@/` 别名（vitest.config.ts）
- [x] BootPage 进度条可访问性属性（BootPage.tsx）
- [x] 清理已删除 calibration 模块的过期测试
- [x] electron-builder 禁用原生依赖重建（electron-builder.json）
- [x] 配置 npmmirror 镜像（.npmrc）

## 验证

- [x] `pnpm typecheck:node` exit 0
- [x] `pnpm typecheck:web` exit 0
- [x] `pnpm lint` exit 0
- [x] `pnpm test` 55 files / 1204 tests passed
- [x] `pnpm build:win` 成功生成 NSIS 安装包

## 归档

- [x] project_memory.md 更新
- [x] docs/v2.3-backend-fix-archive/ 归档创建
