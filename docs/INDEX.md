# 文档索引

> 这个仓库公开在跑的文档只有这些。历次内部审查报告、交接文档、比赛材料与故障复盘
> 不入库（2026-10-18 仓库公开时收口），所以这里也不列它们——列了就是一条断链。
>
> 文档链接完整性由 `node scripts/quality/doc-links.cjs` 钉着：
> 任何指向"仓库里没有的文件"的链接都会让这道闸红。

## 工程规范

| 文档 | 讲什么 | 什么时候要读 |
|---|---|---|
| [CODING.md](../CODING.md) | 编码规范核心 | 提交前 |
| [DESIGN.md](../DESIGN.md) | **界面规范唯一权威** | 动 `src/renderer/**` 之前必读 |
| [PRODUCT.md](../PRODUCT.md) | 产品定位、目标用户、反例清单 | 决定要不要加一个功能之前 |
| [AGENTS.md](../AGENTS.md) | 开发指南与文件所有权（多 AI 协作规则） | 接手这个项目 |
| [CLAUDE.md](../CLAUDE.md) | AI 入口指引：核心红线与门禁 | 第一次跑门禁 |

## 现状与目标

| 文档 | 讲什么 | 什么时候要读 |
|---|---|---|
| [功能实景清单](功能实景清单.md) | **此刻真的能用什么**：A 可用 / B 有条件 / C 断线，每条带 `file:line` | 介绍产品、评估工作量、决定要不要接一条死通道之前 |
| [长期优化目标](长期优化目标.md) | 往前做什么、每条凭哪处代码欠账、做完的判据是哪条命令 | 排下一轮工作、想知道"为什么还没做" |
| [Discussions 配置](guides/discussions-setup.md) | 仓库讨论区的三个板块是怎么来的 | 调整反馈渠道 |

## 发布与贡献

| 文档 | 讲什么 |
|---|---|
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献流程、门禁链、怎么让 PR 一次过 |
| [SECURITY.md](../SECURITY.md) | 漏洞私密披露渠道 |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | 行为准则 |
| [CHANGELOG.md](../CHANGELOG.md) | 变更历史 |
| [ROADMAP.md](../ROADMAP.md) | 路线图 |
| [RELEASE.md](../RELEASE.md) | 发布流程 |
| [../NOTICE](../NOTICE) | 第三方依赖致谢 |

## 技术栈教程

面向"想看懂这个仓库怎么搭起来的"读者：

- [Electron](tech-stack-skills/01-electron.md)
- [React](tech-stack-skills/02-react.md)
- [TypeScript](tech-stack-skills/03-typescript.md)
- [Vite](tech-stack-skills/04-vite.md)
- [Tailwind](tech-stack-skills/05-tailwind.md)
- [Ant Design（历史：已退出渲染层）](tech-stack-skills/06-antd.md)
- [Monaco + xterm.js](tech-stack-skills/07-monaco-xterm.md)
- [状态与数据](tech-stack-skills/08-state-data.md)
- [这套教程怎么用](tech-stack-skills/项目使用指南.md)
- [技术栈教程总览](tech-stack-skills/README.md)

> `06-antd.md` 保留作历史参考：**当前渲染层不用 antd**，
> `design-contract` 把"引用 antd 的文件数"钉在 0。

## 运维技能卡（应用内置）

这些是程序里真会加载执行的技能定义，不是文档：

- [磁盘满](../src/main/services/skills/builtin/diagnose-disk-full.md)
- [网络不通](../src/main/services/skills/builtin/diagnose-network-issue.md)
- [OOM killer](../src/main/services/skills/builtin/diagnose-oom-killer.md)
- [权限拒绝](../src/main/services/skills/builtin/diagnose-permission-denied.md)
- [服务启动失败](../src/main/services/skills/builtin/diagnose-service-failure.md)

## 附属组件

- [Python 侧车](../sidecar-a/README.md) — Drain3 日志模板挖掘，缺依赖时整条链路走可见降级
