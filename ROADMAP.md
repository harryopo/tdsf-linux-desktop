# 路线图 (Roadmap)

> TDSF-Linux Desktop 的版本演进计划
> 包含已完成、进行中、规划中的功能
> 最后更新：2026-07-25

---

## 已发布

### v1.0.0 — 火山杯首发版本 (2026-07-25)

**核心交付：**

- [x] SSH 终端完整链路（ssh2 + xterm.js）
- [x] AI 辅助问答（多 Provider + Supervisor + Subagent 编排）
- [x] 高危命令拦截（12 条黑名单 + 三态权限审批）
- [x] SFTP 文件管理（react-arborist + Monaco Editor）
- [x] 可信度评估（D-S + PCR5 融合 + 6 源证据可视化）
- [x] CoT-shape 熵轨迹分析（基于 Zhao 2026 论文）
- [x] 教程词库 v1.2.0（2236 词条）
- [x] 8 爬虫源教程聚合（鸟哥 / 阮一峰 / Linux 中国等）
- [x] 中英对照翻译 + 课程联动
- [x] 内置设置中心（5 大类 9 子页）
- [x] MIT 开源协议 + GitHub 开源仓库
- [x] GitHub Pages 介绍页（[harryopo.github.io/tdsf-linux-desktop](https://harryopo.github.io/tdsf-linux-desktop/)）

**已知限制：**

- Docker 沙箱（未来切换为 Firecracker microVM）
- 单语言（仅简体中文 UI）
- 仅支持本地 Sidecar（无远程 AI 网关）

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

### v1.5.0 — 沙箱升级 (2026 Q4)

- [ ] **Firecracker microVM 沙箱**（替代 Docker，启动 < 125ms，内存 < 5MB）
- [ ] **OpenTelemetry 完整集成**（Langfuse + Tempo 全链路追踪）
- [ ] 实时协同（多人编辑同一文件）
- [ ] Web Terminal 模式（可在浏览器访问 SSH 终端）
- [ ] i18n 完整国际化（英文 / 繁体）

### v2.0.0 — IDE 化 (2027 Q1)

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

## 反馈

如果你有想法或建议：

- 创建 [Feature Request Issue](https://github.com/harryopo/tdsf-linux-desktop/issues/new?template=feature_request.md)
- 参与 [Discussions 讨论](https://github.com/harryopo/tdsf-linux-desktop/discussions)（即将开放）
- 填写 [产品调研问卷](https://harryopo.github.io/tdsf-linux-desktop/)（嵌入式入口在 软件 → 设置 → 关于 → 产品调研问卷）

---

最后更新：2026-07-25 · [在 GitHub 上编辑](https://github.com/harryopo/tdsf-linux-desktop/edit/master/ROADMAP.md)
