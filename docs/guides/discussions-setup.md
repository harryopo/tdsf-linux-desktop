# Discussions 启用引导

> **💬 加入讨论** — 我们欢迎任何形式的交流（提问、想法、Show & Tell）！
> 请按下方步骤启用 Discussions：

## 启用步骤（仓库 Maintainer）

1. 访问 https://github.com/harryopo/tdsf-linux-desktop/settings
2. 找到 **Features** 区域
3. 勾选 ✅ **Discussions**
4. 点击 **Set up discussions**
5. 选择模板：**Welcome / Q&A / Ideas / Show and tell**（推荐 4 个分类）
6. 创建以下初始 Discussion 模板：

### 📌 Welcome
- 项目简介 + 链接
- 行为准则链接（CODE_OF_CONDUCT.md）
- 贡献指南链接（CONTRIBUTING.md）

### ❓ Q&A
- 提问格式：`## 问题描述` + `## 复现步骤` + `## 期望行为` + `## 实际行为`
- 标签：`question` / `help wanted`

### 💡 Ideas
- 功能建议 + 投票机制
- 标签：`enhancement` / `discussion`

### 🎉 Show and tell
- 用户作品展示
- 标签：`show and tell` / `showcase`

## 模板文件位置

启用后，模板将存放在 `.github/DISCUSSION_TEMPLATE/` 目录，本项目已预置：

- `.github/DISCUSSION_TEMPLATE/ideas.yml` — 功能建议模板
- `.github/DISCUSSION_TEMPLATE/qna.yml` — 问答模板
- `.github/DISCUSSION_TEMPLATE/show-and-tell.yml` — 作品展示模板

## 替代方案：使用 Issue + Label

如果暂时不启用 Discussions，所有交流可通过 Issue 完成：

- **问题反馈**：https://github.com/harryopo/tdsf-linux-desktop/issues/new/choose
- **Bug 报告**：选择 `Bug Report` 模板
- **功能建议**：选择 `Feature Request` 模板
- **使用问题**：选择 `Question` 模板

---

**为什么建议启用 Discussions？**
- Issue 用于**具体任务**（Bug / Feature），应该关闭
- Discussions 用于**开放式交流**（想法 / 经验），可以长期活跃
- 让仓库同时具备"问题追踪"和"社区交流"两套机制
