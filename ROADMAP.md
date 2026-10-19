# 路线图 (Roadmap)

> TDSF-Linux Desktop 的版本演进设想。
>
> **这份文件是设想，不是承诺。** 下面带日期的版本号（v1.1 / v1.5 / v2.0 / v2.5 / v3.0）
> 都是当时写的方向，**没有一条按那个时间表落地过**。
> 想知道"现在真有什么"看 [README.md](README.md) 与本文的 §实际完成的；
> 想知道"正在做什么"看 git log，不看这份文件。
>
> 最后更新：2026-10-18

---

## 已发布

### v1.0.0 — 首发版本 (2026-07-25)

**核心交付：**

- [x] SSH 终端完整链路（ssh2 + xterm.js）
- [x] AI 辅助问答（多 Provider + Supervisor + Subagent 编排）
- [x] 高危命令拦截（当时是 12 条黑名单 + 三态权限审批；**现已换成结构判定，见下**）
- [x] SFTP 文件管理（react-arborist + Monaco Editor）
- [x] 可信度评估（多源证据可视化）
- [x] CoT-shape 熵轨迹分析与可视化（基于 Zhao 2026 论文）
      —— 2026-10-18 回代码核对：收集与画图**都在链路上**（`supervisor.ts:1369` 收尾时取轨迹 →
      `ChatResult.cotEntropyTrajectory` → `agent-store.ts:405` 落到消息 →
      `ChatCredibility.tsx:120` → `ConfidenceBreakdown.tsx:117` 的 SVG 折线图）。
      前提是那一轮真采到熵点（`collected = points.length > 0`，来源依次是 thinking-block /
      分段文本 / logprobs），采不到就不画——不是"没做"。
      （本条原先写着"可视化至今未做"，那是照抄 2026-07-25 的旧表没回代码核对，已纠正。）
- [x] 教程词库 v1.2.0（2236 词条）
- [x] 教程源聚合（`tutorial-source-registry.ts` 现为 14 个源，不是当年写的 8 个）
- [x] 中英对照翻译 + 课程联动
- [x] 内置设置中心（`settings-sections.ts` 现为扁平 10 节，无「大类」分层）
- [x] MIT 开源协议 + GitHub 开源仓库
- [x] GitHub Pages 介绍页（[harryopo.github.io/tdsf-linux-desktop](https://harryopo.github.io/tdsf-linux-desktop/)）

**当时的已知限制，现在的实际状态：**

| 那条限制 | 现在 |
|---|---|
| Docker 沙箱（未来切 Firecracker microVM） | **Docker / OpenHands 链路已接并被教程页真调**（`ipc/sandbox.ts` + `services/sandbox/{docker-detector,openhands-runner}.ts`，消费点 `TutorialDetailPage.tsx:351-579`）；没做的只有 Firecracker |
| 单语言（仅简体中文 UI） | 仍然仅简体中文 |
| 仅支持本地 Sidecar（无远程 AI 网关） | 仍然如此 |

### 2026-08 → 2026-10 实际完成的（原路线图没记）

- [x] 渲染层整层重做：退出 Ant Design，改自研原语 + lucide 图标 + 设计令牌单源
- [x] React 19 / Zustand 5 / recharts 3 升级
- [x] 终端优先外壳：三栏可拖 + 多终端标签 + 命令-输出块切分
- [x] 本机终端（node-pty，在主进程 require；「走 utilityProcess」是后加的错话，2026-10-19 删）
- [x] 第二个应用窗口 + 预览面板（端口转发）
- [x] 远端 shell 集成（OSC 133/633，逐台确认后写入、可撤）
- [x] 跨进程契约单源（zod 入参判定 + 类型生成 + 漂移即红）
- [x] 浅色主题真做（对比度由界面审计逐元素量过）
- [x] 命令闸改结构判定：8 个结构性拦截器 + 7 条 argv 规则 + 226 项词表
- [x] 凭据边界收口（safeStorage 加密、两个出口都打码、git 历史抹除）
- [x] 常驻门禁一批：密钥闸 / 拓扑闸（按值 + 按 /24）/ 历史回归闸 / 设计契约闸 / 断链闸

---

## 进行中

### v1.1.0 — 体验优化 (2026-08 计划)

**核心改进：**

- [ ] Sidecar 健康检查 + 自动重启
- [ ] SSH 连接池 + 多 tab 并发
- [ ] 教程词库 v1.3.0（目标 3000 词条）
- [ ] AI 回答引用来源（连接到具体命令/教程章节）
- [ ] 离线模式（基础命令无需 AI 也能跑）

---

## 近期规划

> 下面两节的版本号与季度都是 2026-07 写的**设想**，没有排期。留着是为了说明方向，不是承诺。

### v1.5.0 — 沙箱升级（无时间表）

- [ ] **沙箱隔离执行**（原写"Firecracker microVM，启动 < 125ms，内存 < 5MB"——那两个数字是编的，
      没有任何实测支撑，2026-10-18 删掉；真做的时候再量）
- [ ] **OpenTelemetry 完整集成**（目前只有 langfuse SDK，没有接 OTel）
- [ ] 实时协同（多人编辑同一文件）
- [ ] Web Terminal 模式（可在浏览器访问 SSH 终端）
- [ ] i18n 完整国际化（英文 / 繁体）

### v2.0.0 — IDE 化（无时间表）

- [ ] **code-server / Theia IDE 嵌入**（开箱即用的 Web IDE）
- [ ] **WASM 沙箱替代方案**（无需 Sidecar，纯前端执行）
- [ ] 多 LLM Provider 同时调度（自动选最佳）
- [ ] 自托管 AI 网关（自部署 Llama / Qwen）

---

## 远期愿景

### v2.5 — 教学平台化

- [ ] 班级 / 课程 / 作业管理系统
- [ ] 教师端 Dashboard（学生进度实时监控）
- [ ] 一键搭建标准实验环境
- [ ] 与高校教务系统对接

### v3.0 — 多人协同

- [ ] **Multiplayer Terminal**（多人同时操作同一终端，类似 Google Docs）
- [ ] 自托管 AI 网关（企业版支持私有部署）
- [ ] 插件市场（第三方扩展机制）
- [ ] 移动端适配（iPad / Android 平板）

---

## 长期方向

- **AI Agent 联邦**：用户训练的 AI 策略可在隐私保护下共享
- **跨平台支持深化**：Linux 桌面（GNOME / KDE）原生支持
- **教育认证对接**：与高校 Linux 课程标准（如 LPI / RHCE）打通

---

## 不在路线图中

以下功能明确**不会**加入（避免范围蔓延）：

- ❌ 完整 Linux 桌面环境（VS Code Remote 已做得很好）
- ❌ 通用聊天机器人（与本项目"运维可信决策"定位不符）
- ❌ 商业云服务深度集成（保持中立开源）

---

## 长期优化目标

这份文件只记「已经发生什么」；**往前要做什么、每条凭什么、什么时候算做完**，
统一写在 [docs/长期优化目标.md](docs/长期优化目标.md)——那里每一条都绑一处代码里的欠账，
不写没有执行体的排期。

---

## 反馈

如果你有想法或建议：

- 创建 [Feature Request Issue](https://github.com/harryopo/tdsf-linux-desktop/issues/new?template=feature_request.md)
- 参与 [Discussions 讨论](https://github.com/harryopo/tdsf-linux-desktop/discussions)（已开放：问答 / 想法 / 作品展示三个板块）
- 或在软件内：设置 → 关于 → 「问题反馈」卡片直接跳到 Issue 模板

---

最后更新：2026-07-25 · [在 GitHub 上编辑](https://github.com/harryopo/tdsf-linux-desktop/edit/master/ROADMAP.md)
