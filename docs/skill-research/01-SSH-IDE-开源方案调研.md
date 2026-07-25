# 主流/小众 IDE 编程产品的 SSH 连接服务器与文件展示功能开源方案调研

> 调研目标：为 TDSF Linux Desktop（Electron + React + TypeScript）在桌面应用内实现类似 VS Code Remote SSH 的 SFTP 文件浏览、编辑、上传下载，筛选可借鉴、可复用的开源方案与技术路线。
> 调研日期：2026-07-25
> 数据来源：GitHub API、`gh repo view`、官方文档、社区评测

---

## 1. 概览

### 1.1 背景

TDSF Linux Desktop 已具备 SSH 终端（`ssh2` + `xterm.js`）与 AI 辅助能力，但在文件侧仍需要补齐：

- 远程文件树浏览（懒加载、大目录虚拟滚动）
- 远程文件双击编辑（Monaco Editor）
- 上传/下载进度可视化
- 拖拽移动与批量操作

本调研覆盖主流/小众 IDE 编程产品、专业 SSH 终端、IDE 框架三类项目，重点评估其**SFTP 实现库**、**文件树组件**、**Electron 嵌入可行性**与**License 兼容性**。

### 1.2 目标

1. 找出与 TDSF 技术栈（Electron + React + TS）最匹配的开源实现。
2. 明确可直接复用的底层库（SSH2/SFTP/文件树/编辑器）。
3. 输出短期可落地的集成方案与中长期演进路线。

---

## 2. 主流方案表格对比

| 项目 | License | Stars | 技术栈 | 集成成本 | 适用场景 |
|------|---------|-------|--------|----------|----------|
| **Eclipse Theia** | EPL-2.0 | 21.6k | TypeScript / Node.js / React | 中 | 自研云/桌面 IDE 框架，需自建 SSH Remote |
| **Coder / code-server** | MIT | 78.5k | TypeScript / Node.js | 中 | 浏览器版 VS Code，远端跑 Server + Electron BrowserView 嵌入 |
| **OpenSumi** | MIT | 3.6k | TypeScript / React / Node.js | 中 | 阿里 IDE 框架，100% VS Code 插件兼容，需自建 Remote FS |
| **Electerm** | MIT | 14.6k | JavaScript / Electron / React | 低-中 | 直接抽取 SFTP 模块，技术栈 100% 匹配 |
| **Tabby** | MIT | 73.5k | TypeScript / Electron / Angular | 中 | 终端 + SFTP，Angular 栈不易直接复用 UI |
| **WindTerm** | Apache-2.0 | 31.7k | C / Qt | 高 | 高性能原生终端，仅可作为 UI/功能参照 |
| **Lapce** | Apache-2.0 | 38.7k | Rust / Floem | 极高 | Rust 原生远程开发，无法嵌入 Electron |
| **Zed** | 混合（GPL3+Apache2+AGPL） | 87.5k | Rust / GPUI | 极高 | 高性能 AI 原生 IDE，无法嵌入 Electron |
| **XTerminal** | 闭源 | - | 闭源（Electron 疑似） | ❌ | 国产商业软件，仅作产品形态参照 |
| **VS Code OSS / VSCodium** | MIT | 187.9k / 32.5k | TypeScript / Electron | 极高 | 生态最大，但 Remote-SSH 闭源，嵌入需 fork |

> 注：Stars 为 2026-07-25 GitHub API 实时数据；WindTerm README 明确 Apache-2.0，但 GitHub license 字段未声明。

---

## 3. 可复用开源项目清单

### 3.1 完整 IDE / 终端项目

| 项目 | GitHub | License | Stars | 技术栈 | 可复用模块 | 集成成本 |
|------|--------|---------|-------|--------|------------|----------|
| **Electerm** | [electerm/electerm](https://github.com/electerm/electerm) | MIT | 14.6k | Electron / React / `ssh2` | `src/client/components/sftp/` 文件浏览器、`src/app/server/sftp-file.js` | 低 |
| **Tabby** | [Eugeny/tabby](https://github.com/Eugeny/tabby) | MIT | 73.5k | Electron / Angular / `ssh2` | `tabby-ssh` 插件的 SFTP 逻辑、连接管理 | 中 |
| **Eclipse Theia** | [eclipse-theia/theia](https://github.com/eclipse-theia/theia) | EPL-2.0 | 21.6k | TypeScript / React / Node.js | IDE 框架、Monaco 集成、终端模块 | 中 |
| **OpenSumi** | [opensumi/core](https://github.com/opensumi/core) | MIT | 3.6k | TypeScript / React / Node.js | IDE 框架、DI 容器、视图定制、Electron 集成示例 | 中 |
| **code-server** | [coder/code-server](https://github.com/coder/code-server) | MIT | 78.5k | TypeScript / Node.js / Express | 完整 VS Code 服务端，BrowserView 嵌入 | 中 |

### 3.2 底层库与组件

| 项目 | GitHub | License | Stars | 技术栈 | 作用 | 集成成本 |
|------|--------|---------|-------|--------|------|----------|
| **ssh2** | [mscdex/ssh2](https://github.com/mscdex/ssh2) | MIT | 14.7k | JavaScript | Node.js SSH2/SFTP 协议实现 | 极低（TDSF 已集成） |
| **@electerm/ssh2** | electerm fork | MIT | - | JavaScript | Electerm 维护的 ssh2 fork，含 SFTP 流式优化 | 低 |
| **node-ssh** | [steelbrain/node-ssh](https://github.com/steelbrain/node-ssh) | MIT | 1.0k | TypeScript | ssh2 高层封装，Promise API | 低 |
| **ssh2-sftp-client** | [theophilusx/ssh2-sftp-client](https://github.com/theophilusx/ssh2-sftp-client) | Apache-2.0 | 922 | JavaScript | Promise 风格 SFTP 客户端 | 低 |
| **react-arborist** | [brimdata/react-arborist](https://github.com/brimdata/react-arborist) | MIT | 3.7k | TypeScript / React | 虚拟滚动文件树组件 | 低 |
| **react-complex-tree** | [lukasbach/react-complex-tree](https://github.com/lukasbach/react-complex-tree) | MIT | 1.4k | TypeScript / React | 可拖拽树组件 | 低 |
| **Monaco Editor** | [microsoft/monaco-editor](https://github.com/microsoft/monaco-editor) | MIT | 46.4k | JavaScript | 代码编辑器组件 | 极低 |
| **xterm.js** | [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js) | MIT | 21.0k | TypeScript | 终端渲染组件 | 极低（TDSF 已集成） |

### 3.3 闭源/参照项目

| 项目 | 状态 | 可借鉴点 | 集成可能性 |
|------|------|----------|------------|
| **JetBrains Gateway** | 闭源商业 | RD Protocol（前后端解耦 + 远端 IDE Backend） | ❌ 无法嵌入 |
| **TRAE / TRAE CN** | 闭源 | AI 原生 IDE 设计、Remote-SSH 体验 | ❌ 无法嵌入 |
| **XTerminal** | 闭源 | 国产一体化运维终端产品形态 | ❌ 无法复用 |

---

## 4. Stars < 1000 项目安全清单初筛

### 4.1 ssh2-sftp-client（922 stars）

| 检查项 | 结果 | 说明 |
|--------|------|------|
| **License** | ✅ Apache-2.0 | 仓库根目录 LICENSE 明确，商用友好 |
| **首次 commit** | ✅ 2016-04-10 | 项目已有 10 年历史 |
| **最近 commit** | ✅ 2026-03-25 | 近 4 个月内仍有维护 |
| **README 质量** | ✅ 高 | 含完整 API 文档、示例、版本迁移说明 |
| **Issue 活跃度** | ⚠️ 中 | 有未关闭 issue，但维护者定期回复 |
| **preinstall 脚本** | ✅ 无 | `package.json` 无 preinstall/postinstall |
| **隐藏二进制** | ✅ 无 | 纯 JavaScript，无预编译二进制 |
| **C2 外连** | ✅ 无 | 源码无网络遥测/上报逻辑 |
| **异常 tag 数** | ✅ 正常 | 32 releases，版本号规则清晰 |
| **可疑维护者** | ✅ 无 | 维护者 `theophilusx` 长期活跃，多项目贡献 |

**结论**：可安全复用，但 TDSF 已有 `SftpManager` 封装，切换收益有限。

### 4.2 node-ssh（1002 stars，临界）

| 检查项 | 结果 | 说明 |
|--------|------|------|
| **License** | ✅ MIT | 明确 |
| **首次 commit** | ✅ 2014-12-23 | 超过 11 年 |
| **最近 commit** | ✅ 2026-06-29 | 活跃 |
| **README 质量** | ✅ 高 | 含 TypeScript 类型、Promise 示例 |
| **Issue 活跃度** | ✅ 中 | 维护者 steelbrain 活跃 |
| **preinstall 脚本** | ✅ 无 | 无异常脚本 |
| **隐藏二进制** | ✅ 无 | 纯 TS/JS |
| **C2 外连** | ✅ 无 | 无遥测 |
| **异常 tag 数** | ✅ 正常 | 版本稳定 |
| **可疑维护者** | ✅ 无 | steelbrain 为知名 Atom/Prettier 贡献者 |

**结论**：可安全复用，API 比原生 ssh2 更友好，但会多一层抽象。

---

## 5. 方案深度分析

### 5.1 Electerm（首选复用对象）

- **技术栈**：Electron + React + `ssh2` + `node-pty` + `@xterm/xterm`
- **可复用点**：
  - `src/client/components/sftp/`：文件浏览器 UI（列表视图、排序、拖拽、批量操作、传输进度）
  - `src/app/server/sftp-file.js`：SFTP 服务端封装
  - 双击远程文件直接编辑并保存回传的流程
- **优势**：与 TDSF 技术栈几乎 100% 匹配；MIT 无品牌限制；SFTP UI 已迭代 8 年。
- **风险**：React 16 类组件风格，需适配 React 18 + Hooks；UI 主题需对齐 TDSF 设计系统。

### 5.2 code-server（备选完整体验）

- **技术栈**：TypeScript / Node.js / Express / Service Worker
- **嵌入方式**：Electron `BrowserView` / `WebContentsView` 加载 `http://localhost:8080`
- **优势**：用户获得完整 VS Code 体验（LSP、调试、Git、扩展）。
- **风险**：远端需跑 code-server 进程；CSP/Service Worker 配置复杂；内存占用额外 200-500MB。

### 5.3 OpenSumi（长期完整 IDE 路线）

- **技术栈**：TypeScript / React / Node.js / DI 容器
- **优势**：阿里/蚂蚁内部验证；100% VS Code 插件兼容；UI 定制能力极强；中文文档完善。
- **风险**：社区规模较小；无内置 SSH Remote，需自建 Remote FS Provider + LSP Proxy；投入 3-6 个月。

### 5.4 WindTerm / XTerminal（仅作参照）

- **WindTerm**：C++ / Qt，Apache-2.0，31.7k stars，性能极高，但无法嵌入 Electron，仅可借鉴其 SFTP 布局与快捷键设计。
- **XTerminal**：国产闭源商业软件，功能全面（SSH/SFTP/RDP/监控/AI/笔记），仅作产品形态参照。

---

## 6. 推荐技术路线

### 6.1 短期（1-2 周）—— Electerm SFTP 模块抽取 + Monaco

```
TDSF v1 (现有)
  ├── 主进程：复用 ssh2 连接，新增 sftp readFile/writeFile/readdir/stat IPC
  ├── Renderer：移植 Electerm SFTP 组件，适配 React 18 + TS
  └── 编辑器：@monaco-editor/react 加载远端文件，保存时回写 SFTP
```

**产出**：双击远端文件 → Monaco 打开 → 编辑保存到远端。

### 6.2 中期（1-2 月）—— 完善文件浏览器体验

- 用 `react-arborist` 替换扁平列表为虚拟滚动文件树
- 加入上传/下载进度条（`fastGet/fastPut` + `sftp:progress` IPC 事件）
- 加入拖拽上传/移动、递归删除、目录传输（tar 流）
- 加入未保存修改提示与 mtime 冲突检测

### 6.3 长期（3-6 月）—— 决策点

| 路线 | 描述 | 适用条件 |
|------|------|----------|
| **A. 轻量持续** | 保持 Electerm + Monaco + xterm.js 自研增强 | 资源有限，聚焦 SSH/SFTP 教学工具 |
| **B. 完整 IDE** | 迁移到 OpenSumi 框架，自建 Remote FS + LSP Proxy | 决定做完整远程 IDE |
| **C. 高级模式** | 可选集成 code-server（BrowserView） | 用户需要开箱即用的 VS Code 体验 |

---

## 7. 关键决策建议

1. **SSH2 库**：保持 `mscdex/ssh2`，不切换到 `ssh2-sftp-client` 或 `node-ssh`（现有封装已足够）。
2. **文件树组件**：首选 `react-arborist`（虚拟滚动 + 拖拽 + 内联重命名）。
3. **编辑器**：`Monaco Editor`（无悬念）。
4. **进度回调**：新增 `sftp:progress` IPC 事件通道，主进程用 `webContents.send` 推送。
5. **License 红线**：避免引入 GPL-2.0（如 SSHFS）；EPL-2.0（Theia）可商用但需声明。

---

## 8. 参考资料

- Eclipse Theia 架构：https://theia-ide.org/docs/architecture/
- code-server 文档：https://coder.com/docs/code-server/latest
- OpenSumi 文档：https://opensumi.com/zh/docs/integrate/overview
- Electerm 源码：https://github.com/electerm/electerm/tree/master/src
- Tabby 官网：https://tabby.sh/
- WindTerm 仓库：https://github.com/kingToolbox/WindTerm
- react-arborist：https://github.com/brimdata/react-arborist
- ssh2：https://github.com/mscdex/ssh2
- Monaco Editor：https://microsoft.github.io/monaco-editor/
- xterm.js：https://xtermjs.org/

---

**文档版本**：v1.0  
**最后更新**：2026-07-25
