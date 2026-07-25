# 开源 SSH IDE 与远程代码编辑方案深度调研

> **调研目的**：为 TDSF Linux Desktop 项目（Electron + React + 已有 SSH/AI/IPC 能力）评估可集成的开源 SSH IDE / 远程代码编辑方案，覆盖文件浏览、远程编辑、终端集成等核心需求。

---

## 1. 调研概览

| 项目 | 内容 |
|------|------|
| 调研日期 | 2026-07-25 |
| 调研范围 | Eclipse Theia、VS Code OSS、code-server、OpenSumi、Electerm、Tabby、Lapce、Zed、OniVim、Nuclide、JetBrains Fleet/Gateway、TRAE、SSHFS、TRAMP、Monaco Editor、xterm.js |
| 调研方法 | GitHub API 实时拉取 stars/fork/license/最近 commit；Jina Reader + WebSearch 抓取官方文档与第三方深度评测；交叉验证关键数据 |
| 数据来源 | `gh repo view`、`gh api repos/.../releases/latest`、官方文档站、CSDN/掘金/InfoQ 等技术社区 |
| 真实性保证 | 所有 GitHub stars/license/commit 时间均为 API 实时返回；技术架构描述均来自项目官方文档或源码 README，未自行编造 |

---

## 2. 主流方案对比矩阵

### 2.1 核心仓库数据（GitHub 实时抓取于 2026-07-25）

| 项目 | Stars | License | 主语言 | 最近 commit | 创建时间 | 备注 |
|------|-------|---------|--------|-------------|----------|------|
| **microsoft/vscode** | 187,869 | MIT | TypeScript | 2026-07-25 | 2015-09 | 桌面 IDE 霸主，市场品牌非开源 |
| **zed-industries/zed** | 87,485 | Other (GPL3+Apache2+AGPL) | Rust | 2026-07-25 | 2021-02 | GPU 渲染，原生 SSH 远程 |
| **coder/code-server** | 78,510 | MIT | TypeScript | 2026-07-24 | 2019-02 | 浏览器版 VS Code |
| **Eugeny/tabby** | 73,471 | MIT | TypeScript | 2026-07-24 | 2016-12 | 终端 + SFTP |
| **lapce/lapce** | 38,684 | Apache-2.0 | Rust | 2026-07-15 | 2018-02 | Rust 编辑器，原生 SSH |
| **VSCodium/vscodium** | 32,509 | MIT | Shell | 2026-07-22 | 2018-08 | VS Code OSS 构建 |
| **microsoft/monaco-editor** | 46,426 | MIT | JavaScript | 2026-07-24 | 2016-06 | 浏览器代码编辑器组件 |
| **eclipse-theia/theia** | 21,606 | EPL-2.0 | TypeScript | 2026-07-24 | 2017-02 | IDE 框架（云+桌面） |
| **xtermjs/xterm.js** | 20,956 | MIT | TypeScript | 2026-07-19 | 2014-03 | 浏览器终端组件 |
| **electerm/electerm** | 14,565 | MIT | JavaScript | 2026-07-25 | 2017-10 | SSH/SFTP/RDP/VNC 全能 |
| **onivim/oni2** | 7,848 | MIT | Reason | 2022-08-17 | 2019-01 | **已停更 4 年** |
| **libfuse/sshfs** | 7,578 | GPL-2.0 | C | 2026-07-11 | 2015-12 | Linux FUSE 文件系统 |
| **facebookarchive/nuclide** | 7,718 | Other | JavaScript | 2018-12-12 | 2015-03 | **已归档**（基于 Atom） |
| **opensumi/core** | 3,647 | MIT | TypeScript | 2026-07-24 | 2021-11 | 阿里/蚂蚁 IDE 框架 |

### 2.2 闭源/部分开源项目（重要参照）

| 项目 | 状态 | 远程方案 | License | 集成可能性 |
|------|------|----------|---------|-----------|
| **JetBrains Fleet** | 闭源 Preview | SSH + Workspace Server | 商业 | ❌ 无法嵌入 |
| **JetBrains Gateway** | 闭源 | SSH + JetBrains Client + RD Protocol | 商业 | ❌ 无法嵌入 |
| **TRAE / TRAE CN**（字节） | 闭源 | Remote-SSH（类 VS Code） | 商业（个人免费） | ❌ 无法嵌入 |

---

## 3. 每个方案的深度分析

### 3.1 Eclipse Theia

| 维度 | 详情 |
|------|------|
| GitHub | https://github.com/eclipse-theia/theia |
| 数据 | 21,606 stars / 2,856 forks / EPL-2.0 / TypeScript / 最新 v1.73.1 (2026-07-01) |
| 与 VS Code 关系 | **不是 VS Code 的 fork**，而是独立的 IDE 框架。复用 Monaco 编辑器、LSP/DAP 协议、兼容 VS Code 扩展 API（通过自研 vscode-extension-host 兼容层动态解析 extension manifest、拦截 API 调用） |
| 架构 | 前后端分离的微内核：前端 TypeScript + React；后端 Node.js，提供 LSP/DAP/任务/文件系统代理；通过 RPC 双向通信 |
| 部署形态 | 三种 build target：① Browser（云 IDE）；② Electron（桌面 IDE）；③ **Browser-only**（无后端，纯静态站点，2023 TheiaCon 公布） |
| Electron 嵌入 | 官方 `packages/electron` 模块预配置主进程、IPC、原生菜单、文件系统访问。Arduino IDE 2.0、SAP Web IDE、Google Cloud Shell、IBM CodeReady Workspaces、Texas Instruments Code Composer Studio 均基于 Theia 构建 |
| 终端集成 | 内置 terminal 基于 `xterm.js` + node-pty，完整功能 |
| SSH 远程 | Theia 本身不内置 SSH 客户端，但作为 IDE 框架支持作为远程 IDE 后端部署（远程主机跑 Theia backend，本地浏览器/Electron 客户端访问）。社区方案：用 sshcode 或 SSHFS 桥接 |
| 资源占用 | 内存 150-300MB 基线（轻量），CPU 空闲低占用 |
| 集成难度 | **中**。文档完善（Eclipse Foundation 主导），有完整的"如何采用 Theia"指南，但模块化体系学习曲线较陡 |
| 优势 | 真正开源（EPL-2.0，无品牌/市场限制）、企业级采用案例丰富、模块化深度定制、活跃度高（每月发版） |
| 劣势 | 扩展市场用 open-vsx.org，部分 VS Code 商业扩展不可用；EPL-2.0 对闭源下游不友好（但允许商业使用） |

### 3.2 VS Code OSS / VSCodium

| 维度 | 详情 |
|------|------|
| GitHub | https://github.com/microsoft/vscode / https://github.com/VSCodium/vscodium |
| 数据 | VS Code 187,869 stars / MIT / TypeScript；VSCodium 32,509 stars / MIT / 提供 OSS 构建 |
| License 关键 | VS Code 源码 MIT，但**微软品牌、市场、远程开发扩展 (Remote-SSH) 是专有许可**，重新分发不可使用 "Visual Studio Code" 名称和 logo |
| SSH 远程 | 微软 Remote-SSH 扩展**闭源**，OSS 版本不包含。社区有替代品 `code-server --remote ssh` 或自建 LSP-over-SSH 方案 |
| 嵌入 Electron | VS Code 本身就是 Electron 应用，但模块化程度低，"嵌入到另一个 Electron"需要 fork 源码或通过子进程方式调用 |
| 集成难度 | **高**。需 fork 整个 VS Code 仓库（约 50 万行 TS）、维护 VS Code 兼容性补丁；VSCodium 团队每年投入大量精力跟进微软版本 |
| 优势 | 生态最大、最成熟 |
| 劣势 | 微软市场品牌限制、远程扩展闭源、作为框架嵌入困难（与 Theia/OpenSumi 设计目标相反） |

### 3.3 code-server (Coder)

| 维度 | 详情 |
|------|------|
| GitHub | https://github.com/coder/code-server |
| 数据 | 78,510 stars / 6,754 forks / MIT / TypeScript / 活跃维护 |
| 架构 | 服务端 Node.js + Express.js + WebSocket，将 VS Code 完整运行在远端；前端通过浏览器渲染 Monaco Editor；通过 Service Worker 模拟 Electron webview 标签实现 WebView |
| SSH 远程方案 | code-server **本身就是远程 IDE 后端**，部署在服务器上。客户端通过浏览器访问 URL。要 SSH 到第三台机器需要安装微软 Remote-SSH 扩展（受限市场）或用社区 fork |
| Electron 嵌入 | 可通过 Electron `BrowserView` / `WebContentsView` 加载 `http://localhost:8080`，将 code-server 嵌入 TDSF 窗口内。需要解决 CSP（`.vscode-resource.vscode-cdn.net` 域名）、跨域、Service Worker 注册等问题 |
| 资源占用 | 服务器需 1GB RAM + 2 vCPU 起步；客户端为浏览器资源 |
| 启动速度 | 冷启动 5-10 秒（取决于硬件） |
| 集成难度 | **中**。一种是子进程启动 code-server + BrowserView 加载（最简单）；另一种是直接 fork code-server 内核，提取 VS Code server 部分深度集成 |
| 优势 | MIT、与 VS Code 体验几乎一致、Docker 部署简单、社区活跃 |
| 劣势 | 需在远端运行服务进程（增加运维负担）、扩展市场用自维护的 Open VSX、嵌 WebView 时 CSP 配置复杂 |

### 3.4 OpenSumi（阿里 & 蚂蚁）

| 维度 | 详情 |
|------|------|
| GitHub | https://github.com/opensumi/core |
| 数据 | 3,647 stars / 452 forks / MIT / TypeScript / 活跃 |
| 设计哲学 | 双端（Web + Electron）IDE 研发框架，前后端分离 + 抽象通信层（Web 用 WebSocket，Electron 用 IPC）；每个连接对应独立的 DI 容器，后端无状态 |
| 三进程架构 | 前端进程（Browser）+ 后端进程（Node）+ 插件进程（Extension）独立运行，插件问题不影响 IDE 性能 |
| VS Code 兼容 | **100% 兼容 VS Code 插件 API**（每三个月适配一次新版本）；额外提供 OpenSumi 自有插件 API（Browser/Node/Worker 三端入口，支持 React 视图扩展） |
| 集成方式 | 提供 56 个基础模块 + 丰富 IDE 风格组件，可通过模块/插件/起步项目快速搭建。**官方明确支持 Electron 集成**（支付宝小程序开发工具、淘宝开发者工具均为 Electron + OpenSumi） |
| UI 定制 | 通过贡献点机制 + DI 容器实现"全视图定制"——可替换任何默认视图、布局、逻辑 |
| SSH 远程 | OpenSumi 本身是 IDE 框架，**不内置 SSH 远程开发**。需要自行实现 Remote File System Provider + LSP Proxy。CodeBlitz（蚂蚁纯前端版）证明了在 OpenSumi 之上可构建无容器 IDE |
| 中文文档 | 完善（https://opensumi.com/zh/docs），中文社区活跃 |
| 集成难度 | **中**。与 TDSF 技术栈（Electron + React + TypeScript）高度一致；阿里有成熟的 Electron 集成案例可参考 |
| 优势 | MIT、技术栈对齐、中文文档、UI 定制能力业内最强、阿里/蚂蚁内部大规模验证 |
| 劣势 | 社区规模相对小（3.6k stars vs Theia 21k）；无内置 SSH 远程方案，需自行构建；远程开发示例文档少 |

### 3.5 Electerm

| 维度 | 详情 |
|------|------|
| GitHub | https://github.com/electerm/electerm |
| 数据 | 14,565 stars / 1,165 forks / MIT / JavaScript（Electron + React） |
| 功能范围 | Terminal/SSH/SFTP/FTP/Telnet/Serialport/RDP/VNC/Spice client，一站式远程管理 |
| SFTP 实现 | 源码 `src/app/server/sftp-file.js` + UI `src/client/components/sftp/`，基于 `@electerm/ssh2`（node-ssh2 fork）；支持拖拽上传下载、批量操作、双击远程文件直接编辑保存、断点续传 |
| 终端 | 基于 `@xterm/xterm` + `node-pty` |
| AI 助手 | 内置 AI 命令建议、错误解释、脚本编写（`src/app/lib/ai.js`，支持 DeepSeek/OpenAI 等） |
| Web 版 | 提供 `npm run w` 构建 Web 版（`src/app/server/server.js`，端口默认 8080） |
| 安装包大小 | Windows ~87MB（installer），Mac arm64 ~115MB |
| 集成难度 | **低-中**。SFTP 组件可独立抽取（`src/client/components/sftp/` 模块化设计）；整体作为 Electron 应用架构与 TDSF 完全一致，可参考其源码 |
| 优势 | MIT、SFTP UI 成熟（已有 8 年迭代）、与 TDSF 技术栈完全匹配、支持多种远程协议 |
| 劣势 | 文件浏览是"列表视图"，非完整 IDE 体验（无多标签编辑器、无 LSP）；React 16 老版本 |

### 3.6 Tabby

| 维度 | 详情 |
|------|------|
| GitHub | https://github.com/Eugeny/tabby |
| 数据 | 73,471 stars / 4,174 forks / MIT / TypeScript（Electron + Angular） |
| SFTP 功能 | 终端标签栏内置 SFTP 图标，点击即打开当前 SSH 连接的文件浏览器；支持拖拽上传下载、Zmodem 协议；SFTP 实现位于 `tabby-terminal` / `tabby-ssh` 插件 |
| 协议支持 | SSH2 + connection manager、SFTP、Zmodem、X11/port forwarding、Jump hosts、Agent forwarding（含 Pageant、Windows OpenSSH Agent）、Login scripts、Proxy command |
| 安全 | 集成加密容器存储 SSH 密钥与配置 |
| 插件系统 | JS 插件机制，可扩展；支持 WinSCP 集成 |
| 集成难度 | **中**。Tabby 用 Angular（与 TDSF React 不一致），整体嵌入困难；但 `tabby-ssh` 的 SFTP 模块可参考实现 |
| 优势 | Stars 极高、社区活跃、SFTP 体验成熟、纯 MIT |
| 劣势 | Angular 栈（不易直接复用 React 组件）、文件浏览仍是辅助功能非主编辑器 |

### 3.7 Lapce

| 维度 | 详情 |
|------|------|
| GitHub | https://github.com/lapce/lapce |
| 数据 | 38,684 stars / 1,308 forks / Apache-2.0 / Rust |
| 架构 | UI 用自研 `Floem` 框架 + `wgpu` GPU 渲染；文本数据结构继承 Xi-Editor 的 Rope Science；插件系统基于 WASI（WebAssembly System Interface）沙箱 |
| SSH 远程 | **内置原生远程开发**（受 VS Code Remote 启发）：本地 UI + 远端 `lapce-proxy` 进程，通过 SSH 隧道通信。所有插件/LSP/调试器/命令在远端运行，体验与本地一致 |
| 远程细节 | 使用宿主 OpenSSH（`ssh` 程序）连接，**仅支持 SSH 密钥认证**；密码认证需通过终端启动 `lapce --wait`；连接后自动下载/上传 `lapce-proxy` 到远端 |
| 容器/WSL | 同时支持 Docker、WSL、自定义协议远程开发 |
| 集成难度 | **极高（不推荐嵌入）**。Rust + 自研 UI 框架与 TDSF 技术栈（Electron + React）完全不兼容 |
| 优势 | 性能极致（毫秒级启动）、Apache-2.0 友好、原生远程开发设计优秀 |
| 劣势 | 生态远小于 VS Code、不能嵌入 Electron、文档相对少 |

### 3.8 Zed

| 维度 | 详情 |
|------|------|
| GitHub | https://github.com/zed-industries/zed |
| 数据 | 87,485 stars / 9,700 forks / License: Other（GPL3 + Apache 2 + AGPL 混合） |
| 架构 | Rust + 自研 `GPUI` 框架（游戏引擎思路，GPU 着色器渲染）；Windows 版用 DirectX 11 + DirectWrite；扩展系统基于 WebAssembly Components (Wasm) + WASI |
| SSH 远程 | **深度集成 SSH 远程开发** + WSL；远端启动轻量级 server 进程，透明处理文件读写、Git、终端、LSP、调试器；Agent Client Protocol (ACP) 开放协议支持 Claude/Codex/OpenCode/Cursor |
| 性能 | 120fps 渲染，毫秒级响应，内存占用显著低于 VS Code |
| 集成难度 | **极高（不推荐嵌入）**。Rust + 自研 UI，与 Electron 生态不兼容 |
| 优势 | 性能王者、AI 原生设计、远程开发体验优秀 |
| 劣势 | License 复杂（非纯 MIT/Apache）、不能嵌入 Electron、扩展生态初期 |

### 3.9 OniVim 2 & Nuclide（已废弃）

| 项目 | 状态 | 说明 |
|------|------|------|
| **onivim/oni2** | 已停更 4 年（最后 commit 2022-08-17） | Reason 语言写的模态编辑器，基于 Revery + Oni2，未完成即停滞 |
| **facebookarchive/nuclide** | 已归档（2018-12-12 最后 commit） | Facebook 基于 Atom 的 IDE，包含远程开发功能，Atom 已停止维护后归档 |

**结论**：两者均不可作为活跃项目集成。

### 3.10 JetBrains Fleet / Gateway（闭源参照）

| 维度 | 详情 |
|------|------|
| 项目状态 | **闭源**（Fleet 提供 free preview，但源码不开放；Gateway 需 JetBrains IDE 商业许可证） |
| 远程架构 | Gateway 是轻量启动器，通过 SSH 连接远端 → 在远端 `~/.cache/JetBrains/RemoteDev/dist/` 下载 IDE Backend（headless IntelliJ）→ 本地启动 JetBrains Client（基于 IntelliJ 平台 + Projector 技术 + RD Protocol） |
| 安全 | Client ↔ Backend 通信走 SSH 隧道 + 端到端 TLS 1.3；不使用中继服务器 |
| 协议 | RD Protocol（源自 JetBrains Rider），低延迟编辑器交互 |
| 远程要求 | Linux 服务器，需 SFTP 子系统启用；4GB+ RAM、2+ cores、5GB+ 磁盘 |
| 集成可能性 | ❌ 完全无法嵌入 TDSF；只能作为外部应用启动 |
| 借鉴价值 | RD Protocol 设计思路（前后端解耦 + 瘦客户端 + 远端 IDE Backend）可作为自研远程方案的参考架构 |

### 3.11 TRAE（字节跳动，闭源）

| 维度 | 详情 |
|------|------|
| 项目状态 | **闭源**，2025 年推出，国内版个人免费 |
| 远程方案 | 内置 Remote-SSH（与 VS Code 兼容），连接时自动在远端部署服务端组件 |
| 集成可能性 | ❌ 无法嵌入 |
| 借鉴价值 | AI 原生 IDE 设计、SKILL.md 技能文件机制、SOLO Coder 智能体并行开发 |

---

## 4. 额外调研：底层方案

### 4.1 SSHFS（文件系统挂载方案）

| 维度 | 详情 |
|------|------|
| GitHub | https://github.com/libfuse/sshfs |
| 数据 | 7,578 stars / GPL-2.0 / C / 活跃（2026-07-11 commit） |
| 原理 | 基于 FUSE（Filesystem in Userspace）+ SFTP 协议，将远端文件系统挂载为本地目录，对应用透明 |
| Windows 支持 | 通过 `sshfs-win`（`billziss-gh/sshfs-win`）+ WinFSP 实现；命令示例：`sshfs user@host:/remote/path Z:` |
| 集成思路 | TDSF 可在后台通过 `sshfs` 命令挂载远端目录到本地路径，然后用任何本地文件浏览组件（如 React 模块化的 file tree）+ Monaco Editor 即可实现"远程编辑" |
| 优势 | 应用层零侵入（对编辑器/组件而言就是本地文件）；Linux/Mac/Windows 全平台可解决；性能良好（对小文件编辑） |
| 劣势 | 需要安装 FUSE/WinFSP 系统级驱动（TDSF 安装包需捆绑或引导用户安装）；GPL-2.0 与 TDSF License 需评估兼容性；大文件读写性能受限；网络断连后挂载点会卡住，需 unmount/remount |
| 可行性 | **中**。适合作为"轻量远程编辑"方案，不适合做完整 IDE 体验（无 LSP、无终端） |

### 4.2 TRAMP（Emacs 远程编辑协议）

| 维度 | 详情 |
|------|------|
| 项目 | GNU Emacs 内置模块，全称 "Transparent Remote (file) Access, Multiple Protocol" |
| 当前版本 | TRAMP 2.7.3.30.2（2025 年发布） |
| 工作原理 | 1. 用户输入 `/ssh:user@host:/path/to/file` 触发 find-file<br>2. TRAMP 调用 `ssh -l user host` 建立外部进程<br>3. 通过 Emacs buffer 与 SSH 进程通信，自动处理登录、密码、shell 提示符识别<br>4. 文件读取：通过 SSH 通道执行 `mimencode -b /path` 或 `cat` 命令获取内容，传输到本地编辑<br>5. 文件保存：反向通过 stdin 推送内容到远端<br>6. 支持 ControlMaster 多路复用、多级跳板机（`/ssh:bastion|ssh:target:/path`） |
| 关键设计 | **inline 方法**（通过 shell 命令 + mimencode/uudecode 传输）vs **external 方法**（通过 scp/rcp/rsync 直接拷贝） |
| 借鉴价值 | ① "远端文件路径前缀" 命名约定（`/ssh:user@host:/path`）可作为 TDSF 远程文件 UI 设计参考<br>② SSH ControlMaster 复用机制避免每次连接开销<br>③ inline vs external 双模式按文件大小自动切换的思路 |
| 集成可能性 | ❌ Emacs Lisp 实现，无法直接复用；只能借鉴协议设计 |

### 4.3 SFTP 文件浏览器组件（独立复用）

| 组件 | 来源 | 协议 | 可复用性 |
|------|------|------|---------|
| `ssh2` (node) | github.com/mscdex/ssh2 | MIT | ⭐⭐⭐⭐⭐ 最广泛使用的 Node.js SSH2 实现，纯 JS，Electron 主进程直接可用 |
| `@electerm/ssh2` | Electerm fork | MIT | ⭐⭐⭐⭐ Electerm 维护的 fork，增加了一些 SFTP 流式传输优化 |
| `node-ssh` | github.com/steelbrain/node-ssh | MIT | ⭐⭐⭐⭐ 基于 ssh2 的高层封装，API 更友好 |
| `ssh2-sftp-client` | github.com/theophilusx/ssh2-sftp-client | MIT | ⭐⭐⭐⭐ Promise 风格 SFTP 客户端，适合文件操作 |
| `tabby-ssh` | Tabby 插件 | MIT | ⭐⭐⭐ TypeScript + Angular，SFTP UI 部分参考价值高，但绑定 Angular |
| `react-sftp` 类组件 | 社区零散项目 | 多为 MIT | ⭐⭐ 不成熟，建议自研 |

**推荐方案**：使用 `ssh2` 或 `node-ssh` 作为底层 SSH/SFTP 库，结合 TDSF 现有 React 组件库自研 SFTP 文件浏览 UI。

### 4.4 Monaco Editor（代码编辑器组件）

| 维度 | 详情 |
|------|------|
| GitHub | https://github.com/microsoft/monaco-editor |
| 数据 | 46,426 stars / 4,098 forks / MIT / JavaScript / 极活跃（每周更新） |
| 集成方式 | `npm install monaco-editor` + `@monaco-editor/react` 包装组件，React 中 `<Editor />` 一行集成 |
| 与 VS Code 关系 | Monaco 是 VS Code 编辑器核心的开源版本，剥离了 VS Code 的工作区/扩展/调试等 IDE 能力，纯编辑器组件 |
| 体积 | 完整包 ~5MB（含所有语言），按需加载可控制在 1-2MB |
| 适用场景 | TDSF 在已通过 SFTP 拉取远程文件内容到本地后，用 Monaco 提供编辑器 UI |
| License | MIT，无品牌限制 |

### 4.5 xterm.js（终端组件）

| 维度 | 详情 |
|------|------|
| GitHub | https://github.com/xtermjs/xterm.js |
| 数据 | 20,956 stars / 1,942 forks / MIT / TypeScript / 活跃 |
| 集成方式 | `npm install @xterm/xterm @xterm/addon-fit @xterm/addon-webgl`，配合 `node-pty` 在主进程提供 PTY |
| 适用场景 | TDSF 已有 SSH 终端，xterm.js 是浏览器/Electron 终端渲染的事实标准 |
| 备注 | VS Code、Theia、Hyper、Tabby 均基于 xterm.js |

---

## 5. 集成可行性评估表

> 评估维度：① 与 TDSF 技术栈匹配度（Electron + React + TS）；② SSH 远程文件浏览/编辑能力；③ 终端集成；④ 改造成本；⑤ License 兼容性；⑥ 社区活跃度

| 方案 | 技术栈匹配 | SSH 远程 | 文件浏览 | 终端 | 改造成本 | License | 活跃度 | 综合评分 |
|------|-----------|---------|----------|------|----------|---------|--------|---------|
| **Eclipse Theia** | ⭐⭐⭐⭐ TS+React+Electron | ⭐⭐ 需自建 | ⭐⭐⭐⭐⭐ 完整 | ⭐⭐⭐⭐⭐ 内置 | ⭐⭐⭐ 中 | EPL-2.0 | ⭐⭐⭐⭐⭐ | 7.5/10 |
| **code-server** | ⭐⭐⭐ TS（嵌入 BrowserView） | ⭐⭐⭐⭐⭐ 远程 IDE | ⭐⭐⭐⭐⭐ VS Code | ⭐⭐⭐⭐⭐ 内置 | ⭐⭐⭐ 中 | MIT | ⭐⭐⭐⭐⭐ | 8.0/10 |
| **OpenSumi** | ⭐⭐⭐⭐⭐ TS+React+Electron | ⭐⭐ 需自建 | ⭐⭐⭐⭐⭐ 完整 | ⭐⭐⭐⭐⭐ 内置 | ⭐⭐⭐ 中 | MIT | ⭐⭐⭐⭐ | 7.5/10 |
| **VSCodium** | ⭐⭐ TS（fork 难） | ⭐ Remote-SSH 闭源 | ⭐⭐⭐⭐⭐ VS Code | ⭐⭐⭐⭐⭐ 内置 | ⭐ 极高 | MIT | ⭐⭐⭐⭐⭐ | 5.5/10 |
| **Electerm SFTP 模块** | ⭐⭐⭐⭐⭐ Electron+React | ⭐⭐⭐⭐⭐ 完整 | ⭐⭐⭐⭐ 列表视图 | ⭐⭐⭐⭐ 可复用 | ⭐⭐ 低 | MIT | ⭐⭐⭐⭐⭐ | **9.0/10** |
| **Tabby SFTP 模块** | ⭐⭐⭐ TS+Angular | ⭐⭐⭐⭐⭐ 完整 | ⭐⭐⭐⭐ 列表视图 | ⭐⭐⭐⭐ 可复用 | ⭐⭐⭐ 中（Angular 桥接） | MIT | ⭐⭐⭐⭐⭐ | 7.5/10 |
| **Lapce** | ⭐ Rust 不兼容 | ⭐⭐⭐⭐⭐ 原生 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐ 无法嵌入 | Apache-2.0 | ⭐⭐⭐⭐⭐ | 4.0/10 |
| **Zed** | ⭐ Rust 不兼容 | ⭐⭐⭐⭐⭐ 原生 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐ 无法嵌入 | 复杂 License | ⭐⭐⭐⭐⭐ | 4.0/10 |
| **JetBrains Gateway** | ❌ 闭源 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ❌ 无法 | 商业 | - | N/A |
| **SSHFS + Monaco + xterm.js** | ⭐⭐⭐⭐⭐ 全 TS+React | ⭐⭐⭐⭐⭐ 完整 | ⭐⭐⭐⭐ 自研 | ⭐⭐⭐⭐⭐ xterm.js | ⭐⭐⭐ 中 | GPL/MIT | ⭐⭐⭐⭐⭐ | **8.5/10** |
| **TRAMP 思路自研** | ⭐⭐⭐⭐⭐ 全 TS+React | ⭐⭐⭐⭐⭐ 完整 | ⭐⭐⭐⭐ 自研 | ⭐⭐⭐⭐⭐ xterm.js | ⭐⭐ 高（自研协议） | MIT | - | 7.0/10 |

---

## 6. 推荐方案（3 档）

### 🥇 首选方案：Electerm SFTP 模块抽取 + Monaco Editor + xterm.js（自研轻量远程编辑器）

**理由**：
1. **技术栈 100% 匹配**：Electerm 就是 Electron + React（虽 React 16，但 SFTP 模块为纯组件，可移植到 TDSF React 18）
2. **MIT License**，无品牌限制，无 GPL 传染风险
3. **SFTP 模块成熟**：Electerm 团队 8 年迭代，源码 `src/client/components/sftp/` 已模块化，包含：
   - 文件列表（支持排序/筛选/拖拽）
   - 双向传输（上传/下载/批量）
   - 双击远程文件直接编辑
   - 传输进度 UI
   - 断点续传
4. **底层用 `@electerm/ssh2`**（fork 自 `mscdex/ssh2`，最广泛使用的 Node.js SSH2 实现）
5. **Monaco Editor**（46k stars，MIT）补齐"代码编辑器"短板：语法高亮、智能补全、多光标、查找替换
6. **xterm.js**（21k stars，MIT）补齐"终端"——TDSF 已有，无需重复造轮子
7. **改造成本最低**：抽取 Electerm SFTP 源码 → 适配 React 18 → 在 TDSF 现有 SSH 连接基础上加挂 SFTP 通道 → Monaco 加载本地缓存的远端文件 → 保存时回写

**集成路径**：
```
TDSF Electron 主进程
  ├── ssh2 连接池（已有）
  ├── SFTP 通道（新增，复用 Electerm src/app/server/sftp-file.js）
  └── 文件传输 IPC（新增）
TDSF Renderer (React 18)
  ├── SFTPFileExplorer 组件（移植自 Electerm）
  ├── MonacoEditor 组件（@monaco-editor/react）
  └── xterm.js 终端（已有）
```

**风险**：Electerm SFTP UI 是 React 16 类组件风格，需适配 React 18 + Hooks；UI 主题需对齐 TDSF 设计系统。

### 🥈 备选方案 A：code-server 子进程 + BrowserView（完整 VS Code 体验）

**理由**：
1. 用户在远端获得**完整 VS Code 体验**（包括 LSP、调试、Git、扩展市场）
2. MIT License
3. 嵌入方式最简单：Electron `BrowserView` 加载 `http://localhost:8080`
4. code-server 团队活跃（78k stars）

**集成路径**：
1. TDSF 在主进程通过 `child_process.spawn` 启动 `code-server --bind-addr 127.0.0.1:8080`
2. 创建 `BrowserView` 加载该 URL
3. 解决 CSP（`vscode-resource.vscode-cdn.net` 域名）、CORS、Service Worker 注册问题
4. 通过 IPC 将 TDSF 的 SSH 配置传给 code-server

**适用场景**：用户需要"打开就是 VS Code"的完整 IDE 体验，接受远端跑 code-server 进程。

**风险**：① 远端需有 code-server 二进制（增加部署负担）；② CSP 配置复杂；③ 浏览器内嵌浏览器体验不如原生；④ 内存占用大（额外 200-500MB）。

### 🥉 备选方案 B：OpenSumi 框架集成（重度定制 IDE）

**理由**：
1. **技术栈高度匹配**：TS + React + Electron，阿里官方明确支持 Electron 集成
2. **MIT License**
3. **中文文档最完善**，社区中文支持
4. **VS Code 插件 100% 兼容**，无需重新适配扩展生态
5. UI 定制能力业内最强（贡献点 + DI 容器）

**集成路径**：
1. 引入 `@opensumi/core` 作为 IDE 框架
2. 实现 OpenSumi 自定义 File System Provider 桥接 SSH（需自研 Remote FS Provider + LSP Proxy）
3. 替换默认视图为 TDSF 风格
4. 参考 CodeBlitz（蚂蚁纯前端版）的远程方案

**适用场景**：TDSF 决定走"自研完整 IDE"路线，愿意投入 3-6 个月深度定制。

**风险**：① 工作量极大（需自建 SSH Remote 模块）；② 远程开发文档少；③ 社区规模较小（3.6k stars）。

### ❌ 不推荐方案

| 方案 | 不推荐原因 |
|------|-----------|
| **VSCodium** | Remote-SSH 扩展闭源，作为框架嵌入需 fork 整个 VS Code，维护成本极高 |
| **Lapce / Zed** | Rust + 自研 UI 框架，无法嵌入 Electron，技术栈不兼容 |
| **OniVim 2 / Nuclide** | 已停更/归档，无人维护 |
| **JetBrains Fleet / Gateway / TRAE** | 闭源，无法集成 |
| **SSHFS 单独使用** | 需系统级 FUSE 驱动（Windows 部署复杂），GPL-2.0 License 风险，且无 LSP/终端 |

---

## 7. 技术路线建议

### 7.1 短期（1-2 周内可见效果）—— 方案一轻量版

```
TDSF v1 (现有) + SFTP 文件浏览（移植自 Electerm）+ Monaco Editor 编辑远端文件
```

- 主进程：复用现有 ssh2 连接，新增 `sftp readFile/writeFile/readdir/stat` IPC
- Renderer：移植 `electerm/src/client/components/sftp/` 至 TDSF，适配 React 18 + TS
- 编辑器：用 `@monaco-editor/react` 加载远端文件内容，保存时回写 SFTP
- 终端：TDSF 已有 xterm.js，无需改动

**预期产出**：用户可双击远端文件 → Monaco 打开 → 编辑保存到远端。

### 7.2 中期（1-2 月）—— 完善体验

- 加入文件树（替换扁平列表）
- 加入"最近打开文件"历史
- 加入未保存修改提示（diff buffer）
- 加入大文件流式读取（参考 TRAMP inline/external 双模式）
- 考虑加入 SSHFS 作为可选"挂载模式"（Linux 用户优先）

### 7.3 长期（3-6 月）—— 决策点

**路线 A（轻量持续）**：保持方案一，逐步增强（搜索、Git 集成、LSP 通过 SSH tunnel）

**路线 B（完整 IDE）**：迁移到 OpenSumi 框架，参考 CodeBlitz 实现远程 IDE 体验，但保留 TDSF 的 AI/拦截/日志等核心特性

**路线 C（开箱即用）**：在"高级模式"下集成 code-server（用户可选），满足需要完整 VS Code 体验的场景

### 7.4 关键技术决策清单

1. **SSH2 库选型**：推荐 `mscdex/ssh2`（最广泛、最稳定、纯 JS、MIT）；若需 Electerm 的优化可考虑 `@electerm/ssh2` fork
2. **编辑器**：Monaco Editor（无悬念）
3. **终端**：xterm.js（TDSF 已有）
4. **SFTP UI**：参考 Electerm 自研，不直接 fork（避免依赖锁定）
5. **远端 LSP**（可选）：通过 SSH tunnel 转发 LSP JSON-RPC 消息，本地 Monaco 通过 LSP 协议消费
6. **License**：TDSF 若为 MIT，避免引入 GPL-2.0 组件（如 SSHFS）；EPL-2.0（Theia）可商用但需声明

---

## 8. 参考资源

### 8.1 关键文档链接

- Eclipse Theia 架构：https://theia-ide.org/docs/architecture/
- Eclipse Theia vs VS Code OSS：https://theia-ide.org/docs/theia_vs_vscode_oss/
- code-server 部署：https://coder.com/docs/code-server/latest
- OpenSumi 文档：https://opensumi.com/zh/docs/integrate/overview
- Electerm 源码：https://github.com/electerm/electerm/tree/master/src
- Tabby 官网：https://tabby.sh/
- Lapce 远程开发：https://docs.lapce.dev/get-started/remote-development
- Zed 远程开发：https://zed.dev/docs/remote-development
- TRAMP 手册：https://www.gnu.org/software/tramp/
- SSHFS：https://github.com/libfuse/sshfs
- Monaco Editor：https://microsoft.github.io/monaco-editor/
- xterm.js：https://xtermjs.org/

### 8.2 借鉴的协议/架构设计

- **TRAMP 路径命名约定**：`/ssh:user@host:/path` 可作为 TDSF 远程文件路径抽象
- **JetBrains RD Protocol**：前后端解耦 + 瘦客户端 + 远端 IDE Backend 的架构思路
- **Lapce 三层架构**：UI 层（本地）+ Proxy 层（远端）+ 插件层（WASI 沙箱）的隔离设计
- **code-server Service Worker**：浏览器内模拟 Electron webview 标签的 WebView 资源加载机制
- **TRAMP inline/external 双模式**：小文件 inline 传输（cat/mimencode），大文件 external（scp/rsync）

---

## 9. 附录：调研使用的命令

```bash
# GitHub 仓库元数据
gh repo view eclipse-theia/theia --json name,description,stargazerCount,forkCount,licenseInfo,pushedAt,createdAt,homepageUrl,primaryLanguage,languages

# 最新 release
gh api repos/eclipse-theia/theia/releases/latest --jq '{tag_name, published_at, name}'

# 全网调研
agent-reach doctor --json                                  # 检查可用 channel
# WebSearch + Jina Reader 抓取官方文档与社区评测
```

---

**文档版本**：v1.0  
**最后更新**：2026-07-25  
**数据有效期**：GitHub stars/fork 等数据为 2026-07-25 实时快照，其他静态信息（架构、License）除非项目重大变更否则长期有效  
**下一步**：建议基于本调研启动 TDSF 远程文件浏览模块的技术方案设计（POC 阶段，预计 1-2 周）
