# SSH 文件操作协议与实现方案调研

> 调研目标：为 TDSF Linux Desktop 的 SFTP 文件浏览器增强提供协议层、组件层与工程实现参考，重点评估可直接复用的开源方案与技术路线。
> 调研日期：2026-07-25
> 数据来源：GitHub API（`gh repo view`）、官方文档、已有项目代码 `09-SSH文件操作协议与实现调研.md`

---

## 1. 概览

### 1.1 背景与目标

TDSF Linux Desktop 已具备 SSH 终端（`ssh2` + `xterm.js`），当前需要在桌面应用内实现类似 VS Code Remote SSH 的文件浏览器：

- 远程目录树懒加载与流畅滚动
- 文件双击编辑、保存回传
- 上传/下载进度可视化
- 拖拽、批量操作、错误恢复

本调研覆盖 **SSH 文件操作协议**（SFTP/SCP/rsync/SSHFS）、**Node.js 实现库**、**文件树虚拟滚动组件**、**会话复用与大文件传输优化**、**错误处理**等关键环节。

### 1.2 调研结论速览

| 维度 | 结论 |
|------|------|
| **协议层** | TDSF 已使用 `ssh2 ^1.15.0`，**继续用 SFTP 协议**，无需切换到 SCP/rsync/SSHFS |
| **实现层** | 在现有 `SftpManager` 基础上增强，**优先使用 `fastGet/fastPut` 获得并发 + 进度回调** |
| **会话复用** | 同一 SSH 会话复用同一 `SFTPWrapper`，关闭/重连时显式 `end()`，避免句柄泄漏 |
| **文件树** | 前端首选 `react-arborist`：原生虚拟滚动 + 拖拽 + 内联重命名 + ARIA |
| **大文件** | `fastGet/fastPut` 的 `concurrency/chunkSize` + 流式 `start/end` 断点续传 |
| **进度实现** | 后端 `webContents.send('sftp:progress', ...)` 推送，前端订阅更新 |

---

## 2. 主流方案表格对比

| 项目 / 方案 | License | Stars | 技术栈 | 集成成本 | 适用场景 |
|-------------|---------|-------|--------|----------|----------|
| **ssh2（SFTP 底层）** | MIT | 5.8k | JavaScript | 极低 | TDSF 已集成，Node.js 最完整的 SSHv2/SFTP 实现 |
| **electerm** | MIT | 14.6k | Electron / React / `ssh2` | 低 | 直接抽取 SFTP 文件浏览器模块，技术栈 100% 匹配 |
| **ssh2-sftp-client** | Apache-2.0 | 922 | JavaScript | 低 | `ssh2` 的 Promise 封装，适合从零封装 SFTP 管理器 |
| **node-ssh** | MIT | 1.0k | TypeScript | 低 | 高层 Promise API，含连接池与命令执行 |
| **react-arborist** | MIT | 3.7k | TypeScript / React | 低 | 虚拟滚动文件树，VS Code 风格 |
| **react-window** | MIT | 17.2k | TypeScript / React | 低 | 通用虚拟滚动底层，可自搭文件树 |
| **react-complex-tree** | MIT | 1.4k | TypeScript / React | 低 | 可拖拽树，API 更精细 |
| **WinFsp / SSHFS-Win** | Other | 8.8k / 6.3k | C | 高 | Windows 挂载远程目录为本地盘符，不适合教学工具 |
| **VS Code Remote SSH** | 闭源 | - | TypeScript / Node.js | 极高 | 完整远程 IDE，需注入 Server，不适合 TDSF |
| **rsync** | GPL-3.0 | - | C | 中 | 批量/增量同步，不适合交互式浏览 |

> Stars 为 2026-07-25 GitHub API 实时数据。

---

## 3. 协议层分析

### 3.1 SFTP vs SCP vs rsync vs SSHFS

| 特性 | SFTP | SCP | rsync | SSHFS |
|------|------|-----|-------|-------|
| 协议层 | SSH v2 子系统，二进制协议 | SSH v2 上的 RCP 简化封装 | SSH 通道上跑 rsync 算法 | FUSE + SFTP |
| 端口 | 22 | 22 | 22 | 22 |
| 操作粒度 | 完整文件系统操作（list/stat/rename/chmod/symlink） | 仅复制文件 | 增量同步（块级 delta） | 透明文件系统访问 |
| 交互性 | 支持交互、断点续传 | 非交互 | 非交互 | OS 级透明 |
| 适用场景 | **文件浏览/编辑（TDSF 场景）** | 一次性复制 | 大批量同步/备份 | 需要本地 fs 语义 |
| 教学价值 | **高**（显式 SFTP 操作） | 低 | 低 | 低（隐藏远程性） |

**结论**：TDSF 的核心场景是交互式文件浏览 + 编辑，**SFTP 是唯一合适选择**。SCP 无法列目录；rsync 不适合实时浏览；SSHFS 会掩盖 SFTP 教学过程且 Windows 打包复杂。

### 3.2 SFTP 消息格式（v3，OpenSSH 默认）

SFTP 是基于 SSH 加密通道的二进制包协议：

```
+--------+--------+--------+...+--------+
| uint32 | uint8  |  payload (variable) |
| length | type   |                      |
+--------+--------+--------+...+--------+
```

- `length`：包体长度（不含自身 4 字节）
- `type`：1 字节消息类型码
- `payload`：按类型序列化的字段

常用消息类型：

| 类型码 | 常量 | 说明 |
|--------|------|------|
| 1 / 2 | INIT / VERSION | 版本协商 |
| 3 / 4 | OPEN / CLOSE | 打开/关闭文件 handle |
| 5 / 6 | READ / WRITE | 读写数据 |
| 7 / 17 | LSTAT / STAT | 获取属性（是否跟踪符号链接） |
| 11 / 12 | OPENDIR / READDIR | 列目录 |
| 13 / 14 / 15 | REMOVE / MKDIR / RMDIR | 删除文件/创建目录/删除目录 |
| 16 / 18 | REALPATH / RENAME | 解析绝对路径 / 重命名 |
| 19 / 20 | READLINK / SYMLINK | 符号链接操作 |

每个请求带 `request id`，响应携带相同 id，**支持管道化（multiple outstanding requests）**，这是 `fastGet/fastPut` 并发传输的协议基础。

### 3.3 Node.js `ssh2` 的 SFTP API

`client.sftp()` 返回 `SFTPWrapper`，核心方法：

| 方法 | 说明 | 建议 |
|------|------|------|
| `readdir` | 列目录 | 已使用 |
| `stat` / `lstat` | 获取属性 | 已使用 |
| `createReadStream` / `createWriteStream` | 流式读写 | 已使用 |
| `fastGet` / `fastPut` | 并发下载/上传，带 `step` 进度 | **建议引入** |
| `realPath` | 解析绝对路径 | 建议引入 |
| `readlink` / `symlink` | 符号链接 | 建议引入 |
| `unlink` / `mkdir` / `rmdir` / `rename` / `chmod` | 基础操作 | 已使用 |

---

## 4. 可复用开源项目清单

### 4.1 协议 / 传输实现

| 项目 | GitHub | License | Stars | 技术栈 | 可复用内容 | 集成成本 |
|------|--------|---------|-------|--------|------------|----------|
| **ssh2** | [mscdex/ssh2](https://github.com/mscdex/ssh2) | MIT | 5.8k | JavaScript | SSH/SFTP 协议实现 | 极低（已集成） |
| **electerm** | [electerm/electerm](https://github.com/electerm/electerm) | MIT | 14.6k | Electron/React/`ssh2` | SFTP 文件浏览器 UI、拖拽、进度 | 低 |
| **ssh2-sftp-client** | [theophilusx/ssh2-sftp-client](https://github.com/theophilusx/ssh2-sftp-client) | Apache-2.0 | 922 | JavaScript | Promise 封装、`uploadDir/downloadDir` | 低 |
| **node-ssh** | [steelbrain/node-ssh](https://github.com/steelbrain/node-ssh) | MIT | 1.0k | TypeScript | 高层 Promise API、连接池 | 低 |
| **tar** | npm `tar` | ISC | - | JavaScript | 目录打包/解包，配合单文件传输 | 极低（已依赖 `^7.5.20`） |
| **WinFsp / SSHFS-Win** | [winfsp/winfsp](https://github.com/winfsp/winfsp) / [winfsp/sshfs-win](https://github.com/winfsp/sshfs-win) | Other | 8.8k / 6.3k | C | Windows 用户态文件系统 | 高 |

### 4.2 前端文件树 / 虚拟滚动

| 项目 | GitHub | License | Stars | 技术栈 | 可复用内容 | 集成成本 |
|------|--------|---------|-------|--------|------------|----------|
| **react-arborist** | [jameskerr/react-arborist](https://github.com/jameskerr/react-arborist) | MIT | 3.7k | TS/React | 虚拟滚动树、拖拽、内联重命名、键盘导航 | 低 |
| **react-window** | [bvaughn/react-window](https://github.com/bvaughn/react-window) | MIT | 17.2k | TS/React | 通用虚拟滚动底层 | 低-中（需自搭树） |
| **react-complex-tree** | [lukasbach/react-complex-tree](https://github.com/lukasbach/react-complex-tree) | MIT | 1.4k | TS/React | 可拖拽树、精细控制 | 低-中 |

---

## 5. Stars < 1000 项目安全清单初筛

### 5.1 ssh2-sftp-client（922 stars）

| 检查项 | 结果 | 说明 |
|--------|------|------|
| **License** | ✅ Apache-2.0 | 仓库根目录 LICENSE 明确，商用友好 |
| **首次 commit** | ✅ 2016-04-10 | 已有 10 年历史 |
| **最近 commit** | ✅ 2026-03-25 | 近 4 个月仍有维护 |
| **README 质量** | ✅ 高 | 含完整 API 文档、示例、版本迁移说明 |
| **Issue 活跃度** | ⚠️ 中 | 有未关闭 issue，维护者定期回复 |
| **preinstall 脚本** | ✅ 无 | `package.json` 无 preinstall/postinstall |
| **隐藏二进制** | ✅ 无 | 纯 JavaScript，无预编译二进制 |
| **C2 外连** | ✅ 无 | 源码无网络遥测/上报逻辑 |
| **异常 tag 数** | ✅ 正常 | 32 releases，版本号规则清晰 |
| **可疑维护者** | ✅ 无 | 维护者 `theophilusx` 长期活跃，多项目贡献 |

**结论**：可安全复用。但 TDSF 已有 `SftpManager` Promise 封装，切换收益有限，**建议仅在需要 `uploadDir/downloadDir` 时参考其源码实现**。

### 5.2 node-ssh（1002 stars，临界）

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

**结论**：可安全复用，API 比原生 ssh2 更友好，但会多一层抽象，且 Stars 刚超 1000。

---

## 6. 关键技术问题

### 6.1 会话复用策略

TDSF 当前每次 SFTP 操作都新建 `SFTPWrapper` 并立即 `end()`。建议改为：

- **同一 SSH Client 复用同一 `SFTPWrapper`**，减少反复初始化开销
- 在连接断开、显式关闭、错误不可恢复时调用 `sftp.end()`
- 维护 `Map<sessionId, SFTPWrapper>`，加锁避免并发创建

```typescript
private sftpCache = new Map<string, SFTPWrapper>()

async getSftp(sessionId: string): Promise<SFTPWrapper> {
  if (this.sftpCache.has(sessionId)) return this.sftpCache.get(sessionId)!
  const client = SshConnectionManager.getInstance().getClient(sessionId)
  const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((err, s) => err ? reject(err) : resolve(s))
  })
  this.sftpCache.set(sessionId, sftp)
  return sftp
}

releaseSftp(sessionId: string): void {
  const sftp = this.sftpCache.get(sessionId)
  if (sftp) { sftp.end(); this.sftpCache.delete(sessionId) }
}
```

### 6.2 大文件传输优化

**`fastGet` / `fastPut` 并发参数**：

| 参数 | 默认值 | 建议值 | 说明 |
|------|--------|--------|------|
| `concurrency` | 64 | 16-32 | 弱网/低配服务端适当降低 |
| `chunkSize` | 32768 | 32768-65536 | 权衡请求数与单次大小 |
| `step` | - | 回调函数 | 每完成一个 chunk 触发，用于进度条 |

**断点续传**：利用 `createReadStream` / `createWriteStream` 的 `start` / `end` 选项，在本地记录已传输字节，失败时从断点继续。

**进度推送频率控制**：后端每 100ms 或每 64KB 推送一次，避免 IPC 风暴；前端用 `requestAnimationFrame` 批量更新。

### 6.3 错误处理

SFTP 操作常见错误码映射：

| ssh2 错误 | 含义 | 处理建议 |
|-----------|------|----------|
| `NO_SUCH_FILE` | 路径不存在 | 提示用户并刷新父目录 |
| `PERMISSION_DENIED` | 权限不足 | 弹窗提示，尝试 sudo 或 chmod |
| `FAILURE` | 通用失败 | 重试 1 次，仍失败则记录日志 |
| `BAD_MESSAGE` / `CONNECTION_LOST` | 连接异常 | 触发 SSH 重连并释放 SFTPWrapper |

通用策略：

- 网络类错误自动重试（指数退避，最多 3 次）
- 用户操作类错误立即反馈，不重试
- 批量操作部分失败时收集错误列表，最后统一提示

---

## 7. 推荐技术路线

### 7.1 短期（1-2 周）—— 补齐核心体验

- `SftpManager.upload/download` 改用 `fastGet/fastPut`，暴露 `onProgress` 回调
- 新增 `sftp:progress` IPC 事件通道，主进程 `webContents.send` 推送
- `FileTree.tsx` 引入 `react-arborist`，替换原生 `map` 渲染，获得虚拟滚动
- 保持现有 `SftpManager` API 不变，降低回归风险

### 7.2 中期（1-2 月）—— 交互增强

- 拖拽上传（`onDrop` → `sftpUpload`）与拖拽移动（`onMove` → `sftpRename`）
- 递归删除非空目录
- 目录上传/下载：`tar` 流打包 → 单文件 `upload` → 远程 SSH `exec` 解包
- 文件编辑脏状态 + mtime 冲突检测

### 7.3 长期（3-6 月）—— 可选扩展

- 远程文件变更轮询（`stat` 比较 mtime）或可选 `inotifywait` 流
- 传输队列与并发控制（限制同时传输数）
- 如需完整 IDE 体验，再评估 code-server BrowserView 或 OpenSumi，当前阶段明确排除

---

## 8. 关键决策建议

1. **协议不动摇**：继续使用 SFTP over `ssh2`，不引入 SCP/rsync/SSHFS。
2. **库不切换**：不切换到 `ssh2-sftp-client` 或 `node-ssh`，现有 `SftpManager` 已足够。
3. **进度靠 `fastGet/fastPut`**：直接解决进度条与并发传输。
4. **文件树用 `react-arborist`**：虚拟滚动 + 拖拽 + 内联重命名，最契合 TDSF 技术栈。
5. **会话复用同一 `SFTPWrapper`**：关闭/重连时显式释放，防止句柄泄漏。
6. **错误分类处理**：网络错误重试，权限/不存在错误即时反馈。

---

## 9. 参考资料

- SFTP 协议草案：https://datatracker.ietf.org/doc/draft-ietf-secsh-filexfer/
- OpenSSH sftp-server man：https://man.openbsd.org/sftp-server
- ssh2：https://github.com/mscdex/ssh2
- ssh2 SFTPStream 文档：https://github.com/mscdex/ssh2-streams/blob/master/SFTPStream.md
- electerm：https://github.com/electerm/electerm
- ssh2-sftp-client：https://github.com/theophilusx/ssh2-sftp-client
- node-ssh：https://github.com/steelbrain/node-ssh
- react-arborist：https://github.com/jameskerr/react-arborist
- react-window：https://github.com/bvaughn/react-window
- react-complex-tree：https://github.com/lukasbach/react-complex-tree
- WinFsp：https://github.com/winfsp/winfsp
- SSHFS-Win：https://github.com/winfsp/sshfs-win
- VS Code Remote SSH：https://code.visualstudio.com/docs/remote/ssh

---

**文档版本**：v1.0  
**最后更新**：2026-07-25
