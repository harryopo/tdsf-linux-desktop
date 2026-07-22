# 技术栈 Skill 调研目录 v1.0

> 本目录是 **TDSF-Linux Desktop 项目核心技术栈** 的 Skill 调研汇总，回答"项目用 Electron + React + TS + Vite + Tailwind + Antd + Monaco + xterm 开发，有哪些 Skill 能帮我写得更好"。
>
> 与 `docs/SKILL-CATALOG-v1.0.md`（16 类约 100 个全项目 Skill）配套：本目录**只聚焦技术栈本身**，SKILL-CATALOG 关注全栈工作流。
>
> 更新日期：2026-07-22 · 适用版本：v1.0+

---

## 1. 为什么需要这份目录

按"质量优先，不重复造轮子"原则，开发任何技术栈组件前，**先查 Skill 看看别人踩过什么坑、最佳实践是什么**，比从零摸索快 10 倍。本目录把项目 8 大核心技术栈的可用 Skill 集中整理，方便按需取用。

## 2. 8 大核心栈速查

| # | 技术栈 | 项目版本 | 调研文件 | 关键 Skill | 必装 | 推荐 | 可选 |
|---|--------|---------|---------|-----------|------|------|------|
| 1 | **Electron** | 43.1.1 | [01-electron.md](./01-electron.md) | electron / electron-dev / electron-builder | 2 | 1 | 1 |
| 2 | **React 18** | 18.3.0 | [02-react.md](./02-react.md) | vercel-react-best-practices / react-expert / vercel-composition-patterns | 2 | 1 | 1 |
| 3 | **TypeScript** | 5.4 strict | [03-typescript.md](./03-typescript.md) | typescript | 1 | 0 | 0 |
| 4 | **Vite** | 5.4.0 + electron-vite 2.3 | [04-vite.md](./04-vite.md) | （官方文档为主） | 0 | 0 | 0 |
| 5 | **Tailwind CSS** | 4.3.3 | [05-tailwind.md](./05-tailwind.md) | tailwind-v4-shadcn / shadcn | 2 | 0 | 0 |
| 6 | **Ant Design** | 5.20.0 | [06-antd.md](./06-antd.md) | （官方文档为主） | 0 | 0 | 0 |
| 7 | **Monaco + xterm** | 0.56 / 5.5 | [07-monaco-xterm.md](./07-monaco-xterm.md) | （官方文档为主） | 0 | 0 | 0 |
| 8 | **状态/数据** | Zustand 4.5 / SQLite | [08-state-data.md](./08-state-data.md) | zustand-patterns / sqlite | 2 | 0 | 0 |

## 3. 评级说明

- **⭐⭐⭐ 必装**：直接关系到代码质量或安全，缺失等于"踩坑反复"。
- **⭐⭐ 推荐**：能显著提升开发效率或代码一致性，但可手动弥补。
- **⭐ 可选**：仅在特定场景下有用（如 v2.0 升级、迁移等）。

## 4. 目录结构

```
docs/tech-stack-skills/
├── README.md                    ← 你正在看的（本文件）
├── 01-electron.md               ← Electron 三进程架构 + 安全 + 打包
├── 02-react.md                  ← React 18 组件设计 + Hooks + 性能
├── 03-typescript.md             ← TypeScript 5.4 strict 类型约定
├── 04-vite.md                   ← Vite 5 + electron-vite 构建配置
├── 05-tailwind.md               ← Tailwind v4 主题/暗色/原子化
├── 06-antd.md                   ← Ant Design 5 企业级组件
├── 07-monaco-xterm.md           ← Monaco 编辑器 + xterm 终端
├── 08-state-data.md             ← Zustand 状态 + better-sqlite3 持久化
└── 项目使用指南.md               ← 按开发场景反向索引
```

## 5. 快速使用

### 5.1 场景化查询

- 写新 Electron 主进程 IPC 通道？ → [01-electron.md §3 IPC 4 步同步](./01-electron.md)
- React 组件出现莫名 re-render？ → [02-react.md §2 Vercel 性能规则集](./02-react.md)
- TS strict 模式编译失败？ → [03-typescript.md §2 常见错误清单](./03-typescript.md)
- Tailwind 暗色模式不工作？ → [05-tailwind.md §2 四步主题架构](./05-tailwind.md)
- Antd Form + React Hook Form 集成？ → [06-antd.md §3 Form 模式](./06-antd.md)
- Monaco 在 Electron 渲染层卡顿？ → [07-monaco-xterm.md §1 性能调优](./07-monaco-xterm.md)
- Zustand Store 设计？ → [08-state-data.md §1 14 模块生产经验](./08-state-data.md)
- better-sqlite3 事务？ → [08-state-data.md §2 SQLite 并发/事务](./08-state-data.md)

### 5.2 安装 Skill 命令

```bash
# 必装 5 个（已装可跳过）
npx -y skills add electron-dev           # Electron 安全 + 架构
npx -y skills add vercel-react-best-practices
npx -y skills add typescript
npx -y skills add tailwind-v4-shadcn
npx -y skills add zustand-patterns

# 推荐 3 个
npx -y skills add react-expert
npx -y skills add vercel-composition-patterns
npx -y skills add shadcn
```

## 6. 与已有文档关系

| 文档 | 关注点 | 关系 |
|------|--------|------|
| `DEV_SKILLS.md` v1.2 | Skill 调用流程（何时调） | 调度规范 |
| `docs/SKILL-CATALOG-v1.0.md` | 全项目 16 类 Skill 索引（有什么） | 全景索引 |
| `docs/SKILL-INSTALL-GUIDE.md` | 一键安装脚本 | 工具 |
| `docs/TECH-STACK-REFERENCE-INDEX.md` | 官方文档下载清单 | 文档 |
| `docs/tech-stack-skills/`（本目录） | **技术栈本身的 Skill 调研** | **深度** |

## 7. 质量保证

- 每份调研文件遵循统一结构：**项目版本 / 核心 Skill / 必踩坑 / 最佳实践 / 与项目集成**
- 所有 Skill 评级必填：必装/推荐/可选
- 所有引用 Skill 必带 SKILL.md 路径和来源（Vercel / 社区 / 官方文档）
- 2026-07-22 起每季度复审一次（关注版本变化、Skill 闭源化、归档情况）
