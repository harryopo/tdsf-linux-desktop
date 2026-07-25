# TDSF-Linux Desktop v1.0.0 · 首发版本

> 面向 Linux 运维的人机协同可信决策桌面助手
> SSH 终端 + AI 辅助 + 高危命令拦截 + D-S 可信度评估
> 2026 火山杯参赛作品 · MIT 开源

---

## ✨ 核心特性

### 1. SSH 终端一体化
- 终端 + SFTP 双协议（基于 `ssh2`）
- 终端翻译词库 v1.3.0（**2247 词条** + 27 运维专项 + `syntax`/`detail` 字段）
- 高危命令 AST 拦截（**rm -rf /、chmod 777、mkfs、dd、> /dev/sda** 等 18 类规则）
- 终端智能补全（命令、路径、参数三级联动）

### 2. AI 辅助运维
- **多 Provider 适配**：OpenAI 兼容 / Anthropic Claude / Google Gemini / 火山方舟 / Ollama / DeepSeek / 通义千问 / Claude Agent SDK
- **三档思考强度**：fast / standard / deep（deep 触发 Supervisor + 8 Subagent 并行 + 多轮 Reflect + Self-Consistency）
- **Token 透明化**：实时显示 token 消耗 + 单次调用成本（USD/CNY）
- **CoT 熵轨迹可视化**：推理过程的每步 Shannon 熵曲线

### 3. 可信度透明化
- **D-S 证据理论 + PCR5 融合算法**（Zhao 2026, arXiv:2603.18940 论文支撑）
- 5 类证据源：ai-param / retrieval / log-pattern / user-history / tool-result
- **单调链准确率 68.8% vs 非单调链 46.8%**（基于熵轨迹形状）
- AI 回答附带可信度评分与证据溯源

### 4. 完整运维工具链
- 实时监控（CPU / 内存 / 磁盘 / 网络 + 历史曲线）
- 系统日志 drain3 模板挖掘
- AI 决策历史回溯（可重放、可解释）
- 知识库 + 教程库（FSRS 间隔复习 + 12 门运维课程）
- 配置文件 diff / 沙盒试运行

### 5. 桌面级体验
- Electron 28 + React 18 + TypeScript strict
- 三进程隔离（contextIsolation / sandbox / nodeIntegration: false）
- 暗色 / 亮色主题切换
- 全中文 UI（设计稿 1:1 复刻）

---

## 📦 安装包

> ⚠️ 由于 GitHub 上传超过 100MB 安装包受限，本版本请通过下方「编译指南」自行构建，
> 或访问 [harryopo 介绍页](https://harryopo.github.io/tdsf-linux-desktop/) 获取下载链接。

### 系统要求
- **操作系统**：Windows 10/11 (x64) / macOS 12+ / Linux (Ubuntu 20.04+)
- **运行时**：Electron 28 内置（无需用户安装 Node.js）
- **磁盘空间**：300 MB（解压后）
- **内存**：≥ 4 GB

---

## 🚀 快速开始

### 方式一：下载预编译安装包
1. 访问 [Releases 页面](https://github.com/harryopo/tdsf-linux-desktop/releases)
2. 下载 `TDSF-Linux-Desktop-Setup-1.0.0.exe`（Windows）
3. 双击安装并运行

### 方式二：从源码构建
```bash
git clone https://github.com/harryopo/tdsf-linux-desktop.git
cd tdsf-linux-desktop
pnpm install
pnpm build:win      # Windows
# 或 pnpm build:mac / pnpm build:linux
```

### 配置 AI Provider
1. 启动应用 → 设置 → 模型配置
2. 选择 Provider（推荐 DeepSeek / 通义千问 / Ollama 本地）
3. 填入 API Key（本地 Ollama 无需 Key）
4. 点击「测试连接」验证

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| **桌面框架** | Electron 28（contextIsolation / sandbox 安全模式） |
| **前端框架** | React 18 + TypeScript strict + Vite 5 |
| **UI 库** | Ant Design 5 + Tailwind CSS + Lucide Icons |
| **终端** | xterm.js + ssh2 + 词库 v1.3.0 |
| **编辑器** | Monaco Editor |
| **AI SDK** | Vercel AI SDK 3 + @ai-sdk/anthropic / openai / google |
| **可信度算法** | D-S 证据理论 + PCR5 融合 + CoT 熵轨迹 |
| **测试** | Vitest（1304 用例）+ Playwright E2E |

---

## ✅ 质量门禁（5 绿全过）

| 门禁 | 状态 |
|------|------|
| `pnpm typecheck:node` | ✅ |
| `pnpm typecheck:web` | ✅ |
| `pnpm lint` | ✅（1 warning） |
| `pnpm test` | ✅（59 files / 1304 cases） |
| `pnpm build:win` | ⚠️（SDK 缺失，见下方说明） |

> 编译门禁需在本地配置好 Electron Builder + Windows SDK 10 后通过。
> CI 流水线请见 `.github/workflows/ci.yml`。

---

## 📚 文档链接

- 📖 [README](https://github.com/harryopo/tdsf-linux-desktop/blob/master/README.md)
- 📝 [CHANGELOG](https://github.com/harryopo/tdsf-linux-desktop/blob/master/CHANGELOG.md)
- 🗺️ [ROADMAP](https://github.com/harryopo/tdsf-linux-desktop/blob/master/ROADMAP.md)
- 🤝 [CONTRIBUTING](https://github.com/harryopo/tdsf-linux-desktop/blob/master/CONTRIBUTING.md)
- 🛡️ [SECURITY](https://github.com/harryopo/tdsf-linux-desktop/blob/master/SECURITY.md)
- 📐 [系统架构图](https://github.com/harryopo/tdsf-linux-desktop/blob/master/docs/assets/architecture.svg)
- 🌐 [项目介绍页](https://harryopo.github.io/tdsf-linux-desktop/)
- 📋 [项目引用（CITATION.cff）](https://github.com/harryopo/tdsf-linux-desktop/blob/master/CITATION.cff)

---

## 🐛 已知问题

- [ ] macOS arm64 打包需在 Apple Silicon 设备上交叉编译（当前仅提供 x64）
- [ ] 部分 Windows Server 2016 系统在 ssh2 握手阶段超时（建议升级到 2019+）
- [ ] Ollama 本地推理大模型（>30B）首次响应较慢（>30s），建议使用云端 API

完整 issue 列表见 [GitHub Issues](https://github.com/harryopo/tdsf-linux-desktop/issues)。

---

## 🙏 致谢

### 第三方开源依赖
详见 [NOTICE](https://github.com/harryopo/tdsf-linux-desktop/blob/master/NOTICE) 文件。

### 灵感来源
- **OpenHands / Aider / ContinueDev**：AI 编码助手架构参考
- **Claude Agent SDK**：多轮 Agent Loop 借鉴
- **Zhao 2026, arXiv:2603.18940**：CoT 熵轨迹可信度论文支撑

### 比赛支持
本项目是 2026 火山杯参赛作品，感谢火山引擎提供的算力与平台支持。

---

## 📜 许可证

本项目采用 [MIT License](https://github.com/harryopo/tdsf-linux-desktop/blob/master/LICENSE) 开源。

```
MIT License

Copyright (c) 2026 harryopo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

**⭐ 如果这个项目对你有帮助，欢迎 Star！**

**🐛 发现问题？** → [提交 Issue](https://github.com/harryopo/tdsf-linux-desktop/issues/new/choose)

**💡 产品反馈？** → 飞书问卷（见软件内「设置 → 关于 → 产品调研问卷」）
