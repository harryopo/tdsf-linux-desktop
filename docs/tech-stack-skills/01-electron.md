# 01 · Electron 核心栈 Skill 调研

> **项目版本**：Electron 43.1.1 · electron-vite 2.3.0 · electron-builder 24.13.0
> **核心定位**：AI 驱动的 Linux 运维桌面助手（2026 火山杯 Agent 创新大赛参赛项目）
> **最后更新**：2026-07-22

---

## 1. 核心 Skill 速查

| Skill | 评级 | 来源 | 触发词 | 核心价值 |
|-------|------|------|--------|----------|
| `electron-dev` | ⭐⭐⭐必装 | clawdbot 社区 | "Electron 安全" / "preload 写法" | 12 大安全 + 架构反模式 |
| `electron` | ⭐⭐推荐 | 社区（基于 agent-browser） | "E2E 测 Electron" / "调试渲染层" | agent-browser CDP 自动化 |
| `electron-builder` 官方文档 | ⭐⭐⭐必装 | 官方 | "打包" / "安装包" / "Win/Mac/Linux" | 多平台配置 |
| `electron-vite` 官方文档 | ⭐⭐推荐 | 官方 | "三进程构建" / "preload 配置" | 主/预/渲分离 |
| `electron-auto-updater` | ⭐可选 | 社区 | "自动更新" | v1.0 暂不需要 |

> **Skill 路径**：`c:\Users\Lenovo\.trae-cn\skills\electron-dev\SKILL.md`（已在本地）

---

## 2. electron-dev Skill 12 大必看（精简版）

来自 `c:\Users\Lenovo\.trae-cn\skills\electron-dev\SKILL.md` 完整内容，标注项目已踩/已用。

### 2.1 Security Non-Negotiables（安全铁律）

| 规则 | 项目已用 | 验证位置 |
|------|---------|----------|
| `nodeIntegration: false` | ✅ | `electron.vite.config.ts` 渲染层 webPreferences |
| `contextIsolation: true` | ✅ | 同上 |
| 白名单 IPC 通道 | ✅ | `src/main/ipc/index.ts` 集中注册 |
| 验证所有 IPC 消息内容 | ✅ | 各 handler 内 zod 校验 |
| 不用 `eval()` / `new Function()` | ✅ | 已知反模式 |

### 2.2 Preload Script 规则

| 规则 | 项目做法 |
|------|----------|
| `contextBridge.exposeInMainWorld()` 唯一安全桥 | ✅ |
| 跨桥数据先 clone | ✅（contextBridge 默认行为） |
| **最小化 API 表面**（不要 generic send/receive） | ✅ **扁平化所有 preload API**（参考 DEV_SKILLS v1.2 §7.2） |

> **反模式**：嵌套结构如 `window.electronAPI.ssh.connect()` 会因函数未定义崩溃；正确做法是 `window.electronAPI.sshConnect()`。

### 2.3 Architecture Traps（架构陷阱）

| 陷阱 | 后果 | 项目规避方案 |
|------|------|------------|
| `webPreferences` 在 window 创建后锁定 | 后续开 nodeIntegration 无效 | 在 BrowserWindow 构造时一次配齐 |
| 阻塞主进程冻结所有窗口 | UI 卡死 | 严格 async（无 sync fs/child_process） |
| 每个 BrowserWindow 独立渲染进程 | 不能直接共享 JS 变量 | 通过主进程 IPC 中转 |
| `show: false` + `ready-to-show` | 避免白屏闪烁 | 项目 v0.4 起已用 |

### 2.4 Native Module 痛点

| 痛点 | 项目对应 |
|------|----------|
| Pre-built native modules 不兼容 | 项目用 `electron-rebuild` |
| `electron-rebuild` 每次升级必跑 | `pnpm rebuild` 脚本 |
| N-API 模块更稳 | 项目 `better-sqlite3` / `ssh2` 都是 N-API |

### 2.5 Packaging Pitfalls（打包陷阱）

| 陷阱 | 项目处理 |
|------|----------|
| devDependencies 默认打包 | `electron-builder` 配置 `files` 字段排除 |
| macOS auto-update 要签名 | v1.0 不上 Squirrel 暂不签名 |
| Windows 通知要 `app.setAppUserModelId()` | v1.5+ 加 |
| **ASAR 不是加密** | 不放 secret 在源码 |

---

## 3. 项目 IPC 4 步同步铁律（必备）

> **来源**：项目 `DEV_SKILLS.md` v1.2 §7.2 + `AGENTS.md` v8.4

新增任何 IPC 通道必须同步完成 4 步，缺一步必报错：

```
[1] 定义 Handler     src/main/ipc/xxx.ts           (ipcMain.handle)
[2] 注册到 index.ts  src/main/ipc/index.ts         (import + register)
[3] Preload 暴露     src/preload/index.ts          (contextBridge.exposeInMainWorld)
[4] d.ts 类型声明    src/preload/electron.d.ts     (window.electronAPI.xxx 类型)
```

**典型错误**：`error TS2552: Cannot find name 'registerXxxIpcHandlers'` — 因为 [2] 漏了 import。

**跨进程类型**（必须放 `src/shared/`，不能放 main 或 renderer）：

```typescript
// ✅ src/shared/xxx-types.ts
export interface XxxParams { ... }

// src/main/services/xxx/types.ts
export * from '../../../shared/xxx-types'  // 兼容层
```

> **历史教训**：v0.4 之前把 `deploy-types` / `tutorial-types` 放主进程导致 `tsconfig.web.json` 引用 `Cannot find module '../../../main/...'`（TS2307）。

---

## 4. electron-vite 三进程构建（v0.4 起项目已用）

### 4.1 目录约定

```
src/
├── main/        # Node 进程（主进程）    → tsconfig.node.json
├── preload/     # 桥接（预加载）          → tsconfig.node.json
└── renderer/    # 浏览器进程（渲染层）   → tsconfig.web.json
└── shared/      # 跨进程类型             → 两个都 include
```

### 4.2 关键配置（`electron.vite.config.ts`）

```typescript
// ✅ 渲染层 webPreferences
new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,    // 必关
    contextIsolation: true,     // 必开
    sandbox: true,             // v1.0 启用
    preload: path.join(__dirname, '../preload/index.cjs')
  }
})
```

### 4.3 常见错误

| 错误 | 根因 | 修复 |
|------|------|------|
| `tsconfig.web.json` 引入 main 目录 | Node 内置模块污染渲染层 | include 限定为 `src/renderer/src/**` + `src/shared/**` |
| Preload API 嵌套 | 函数未定义崩溃 | 扁平化所有 API |
| `db.transaction()` 不可用 | DatabaseManager 不暴露 | `db.getRawConnection().transaction(...)` |

---

## 5. electron-builder 打包（多平台）

### 5.1 三平台命令

```json
// package.json
{
  "scripts": {
    "build:win":   "pnpm build && electron-builder --win",
    "build:mac":   "pnpm build && electron-builder --mac",
    "build:linux": "pnpm build && electron-builder --linux"
  }
}
```

### 5.2 必须配置（`electron-builder.yml`）

```yaml
appId: com.tdsf.linuxdesktop
productName: TDSF-Linux Desktop
directories:
  output: dist  # 安装包输出
files:
  - out/**/*
  - package.json
  - "!**/*.map"
asar: true
win:
  target: nsis
  artifactName: TDSF-Setup-${version}.${ext}
mac:
  target: dmg
  category: public.app-category.developer-tools
linux:
  target: AppImage
  category: Development
```

### 5.3 当前限制

- **v1.0 体积预算 ~400 MB**（含 3 个 Python Sidecar + Electron + 依赖）
- Win 平台需 NSIS / Mac 需 DMG / Linux 需 AppImage
- **T5.5 打包验证** 等待 VS Build Tools Windows SDK 装好后跑

---

## 6. electron Skill（E2E 自动化测试）

> **路径**：`c:\Users\Lenovo\.trae-cn\skills\electron\SKILL.md`

基于 agent-browser + Chrome DevTools Protocol（CDP）的 Electron 应用自动化：

```bash
# 启动应用 + 远程调试
"C:\path\to\app.exe" --remote-debugging-port=9222

# agent-browser 连接
agent-browser connect 9222

# 后续走标准 web 自动化流程
agent-browser snapshot -i
agent-browser click @e5
agent-browser screenshot app.png
```

**项目用途**：
- v1.0 dogfood 模式：对真实 SSH 连接 + AI 对话做端到端测试
- 配合 Playwright：`@playwright/test` + `electron-playwright-helpers`

---

## 7. 项目已踩坑 + 修复方案（v0.x → v1.0 演进）

| 踩坑 | 版本 | 根因 | 修复 |
|------|------|------|------|
| 主进程 IPC 全部就绪但渲染层 UI 空白 | v0.9 | IPC 就绪 ≠ 功能就绪 | v1.0 加 visual-regression E2E |
| 主进程同步 fs 阻塞 UI | v0.5 | 用了 sync API | 全切 async/await |
| 跨进程类型放 main 目录 | v0.4 | tsconfig.web.json 找不到 | 移到 shared/ |
| Preload 嵌套 API 崩溃 | v0.6 | 函数未定义 | 全量扁平化 |
| Windows 端口占用 `winerror 10048` | v0.8 | health check 未识别 | 跨平台日志关键词 |

---

## 8. 最佳实践清单（项目内规约）

1. **contextBridge 是唯一安全桥**，禁止直接暴露 `ipcRenderer`
2. **preload API 扁平化**（`window.electronAPI.sshConnect()`，不嵌套）
3. **每个新 IPC 通道 4 步同步**（定义 → 注册 → preload → d.ts）
4. **跨进程类型放 `src/shared/`**
5. **`nodeIntegration: false` + `contextIsolation: true` + `sandbox: true`**
6. **不用 `eval` / `new Function`**
7. **主进程严禁 sync 操作**
8. **升级 Electron 必跑 `pnpm rebuild`**
9. **打包前排除 devDependencies**
10. **macOS 上 Squirrel 要签名**（v1.5+ 再启用）

---

## 9. 推荐阅读顺序

1. `c:\Users\Lenovo\.trae-cn\skills\electron-dev\SKILL.md`（12 大原则，5 分钟）
2. [Electron 官方安全白皮书](https://www.electronjs.org/docs/latest/tutorial/security)（深读）
3. [electron-vite 官方文档](https://electron-vite.org/)（项目用）
4. [electron-builder 配置](https://www.electron.build/)（打包时查）
5. 项目 `docs/方案书-v0.9.2-Agent架构设计深度调研.md`（架构选型背景）

---

## 10. 引用文档

- `c:\Users\Lenovo\.trae-cn\skills\electron-dev\SKILL.md` — 必读
- `c:\Users\Lenovo\.trae-cn\skills\electron\SKILL.md` — E2E 自动化
- `d:\ai\linux教学一体\tdsf-linux-desktop\DEV_SKILLS.md` v1.2 §7.2 — IPC 反模式
- `d:\ai\linux教学一体\tdsf-linux-desktop\AGENTS.md` v8.4 — 架构规约
- `d:\ai\linux教学一体\tdsf-linux-desktop\docs\技术栈教程注意事项-v1.0.md` — 教程
