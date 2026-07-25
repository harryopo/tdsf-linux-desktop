# SSH 文件操作协议与 SFTP 文件浏览器实现调研

> 调研日期：2026-07-25
> 调研目标：为 TDSF Linux Desktop 集成 VS Code Remote 风格的 SFTP 文件浏览器，评估复用现有 ssh2 实现 vs 引入新方案
> 输出范围：协议基础、开源方案对比、文件树选型、TDSF 集成路线

---

## 1. 调研概览

### 1.1 背景与目标

TDSF Linux Desktop 已有 SSH 终端（ssh2 + xterm.js），需要增强 SFTP 文件浏览能力，对标的体验是 VS Code Remote SSH 的资源管理器：双击打开远程文件编辑、保存回传、目录树懒加载、大目录流畅滚动。

### 1.2 调研结论先行

| 维度 | 结论 |
|------|------|
| **协议层** | TDSF 现有 ssh2 v1.15+ 已足够，**无需切换到 ssh2-sftp-client / node-ssh**。现有 SftpManager 已封装 list/upload/download/delete/rename/chmod/mkdir/stat/readFile/writeFile |
| **架构层** | 直接 SFTP（按需读写）优于 SSHFS 挂载。TDSF 是教学工具，不需要 OS 级透明挂载；SSHFS 在 Windows 依赖 WinFsp + Cygwin，打包复杂 |
| **文件树** | **react-arborist 3.2** 是首选：原生虚拟滚动 + 拖拽 + 内联重命名 + 键盘导航 + ARIA，与 TDSF 的 antd 5 + @tanstack/react-virtual 体系兼容 |
| **大目录性能** | 懒加载 + 虚拟滚动 + 缓存已足够应对 10000+ 文件场景，**不需要 inotify over SSH** |
| **文件编辑** | 现有 readFile/writeFile 已支持双击编辑，**缺的是脏状态管理 + 冲突检测** |
| **集成难度** | 低。TDSF 已有 90% 的 SFTP 能力，缺口集中在：进度条、虚拟滚动、拖拽、传输队列 |

### 1.3 关键风险

- 现有 `FileTree.tsx` **没有虚拟滚动**，大目录（>500 节点）会卡顿
- `SftpManager.upload/download` 的进度回调未对外暴露（代码注释明确说"暂未对外回调"）
- 折叠不卸载子节点（`loaded` 保留），深层目录可能内存占用高
- 无文件 watcher，远程文件变更需要手动刷新

---

## 2. SFTP 协议基础

### 2.1 SFTP vs SCP vs rsync

| 特性 | SFTP | SCP | rsync |
|------|------|-----|-------|
| 协议层 | SSH v2 子系统，二进制协议 | SSH v2 上的 RCP 简化封装 | SSH 通道上跑 rsync 算法 |
| 端口 | 22 | 22 | 22 |
| 操作粒度 | 完整文件系统操作（open/read/write/readdir/stat/rename/chmod/symlink） | 仅复制文件 | 增量同步（块级 delta） |
| 交互性 | 支持交互命令、断点续传 | 非交互 | 非交互 |
| 标准化 | IETF draft-ietf-secsh-filexfer | SSH 扩展 | 独立协议 |
| 协议版本 | v3（OpenSSH 默认，最广泛）、v4-6（扩展 POSIX 属性） | — | — |
| 适用场景 | **文件浏览/编辑（TDSF 场景）** | 一次性复制 | 大批量同步、增量备份 |

**结论**：TDSF 是文件浏览 + 编辑场景，SFTP 是唯一合适的选择。SCP 不支持目录列表/属性查询；rsync 不适合交互式浏览。

### 2.2 SFTP 消息格式

SFTP 是基于 SSH 加密通道的二进制协议，所有操作以「包（packet）」为单位交换：

```
+--------+--------+--------+...+--------+
| uint32 | uint8  |  payload (variable) |
| length | type   |                      |
+--------+--------+--------+...+--------+
```

- `length`：包体长度（不含自身 4 字节）
- `type`：消息类型码（1 字节）
- `payload`：根据 type 序列化的字段（string / uint32 / uint64 / attrs 结构）

### 2.3 SFTP 消息类型（v3，OpenSSH 默认）

| 类型码 | 常量 | 说明 |
|--------|------|------|
| 1 | SSH_FXP_INIT | 客户端初始化，协商版本 |
| 2 | SSH_FXP_VERSION | 服务端版本响应 |
| 3 | SSH_FXP_OPEN | 打开文件（返回 handle） |
| 4 | SSH_FXP_CLOSE | 关闭 handle |
| 5 | SSH_FXP_READ | 读取数据（基于 handle + offset + length） |
| 6 | SSH_FXP_WRITE | 写入数据 |
| 7 | SSH_FXP_LSTAT | 获取属性（不跟踪符号链接） |
| 8 | SSH_FXP_FSTAT | 基于 handle 获取属性 |
| 9 | SSH_FXP_SETSTAT | 设置属性（chmod / utime） |
| 10 | SSH_FXP_FSETSTAT | 基于 handle 设置属性 |
| 11 | SSH_FXP_OPENDIR | 打开目录（返回 handle） |
| 12 | SSH_FXP_READDIR | 读取目录条目（迭代式） |
| 13 | SSH_FXP_REMOVE | 删除文件 |
| 14 | SSH_FXP_MKDIR | 创建目录 |
| 15 | SSH_FXP_RMDIR | 删除目录 |
| 16 | SSH_FXP_REALPATH | 解析为绝对路径 |
| 17 | SSH_FXP_STAT | 获取属性（跟踪符号链接） |
| 18 | SSH_FXP_RENAME | 重命名 |
| 19 | SSH_FXP_READLINK | 读取符号链接目标 |
| 20 | SSH_FXP_SYMLINK | 创建符号链接 |

每个请求带 `request id`，服务端响应（SSH_FXP_STATUS / SSH_FXP_DATA / SSH_FXP_NAME / SSH_FXP_ATTRS）携带相同 id，**支持管道化（multiple outstanding requests）**——这是 ssh2 `fastGet/fastPut` 并发下载的协议基础。

### 2.4 文件属性结构（Attributes）

```
struct Attributes {
    uint32 flags;          // 标志位，指示哪些字段有效
    uint64 size;           // SSH_FILEXFER_ATTR_SIZE       = 0x00000001
    uint64 uid, gid;       // SSH_FILEXFER_ATTR_UIDGID     = 0x00000002
    uint32 permissions;    // SSH_FILEXFER_ATTR_PERMISSIONS= 0x00000004
    uint64 atime, mtime;   // SSH_FILEXFER_ATTR_ACMODTIME  = 0x00000008
    string owner, group;   // v4+，v3 仅 uid/gid 数字
    // SSH_FILEXFER_ATTR_EXTENDED = 0x80000000
    // 扩展属性：ACL、xattr 等
}
```

`permissions` 字段同时编码「文件类型位」（S_IFREG / S_IFDIR / S_IFLNK）和「权限位」（rwxrwxrwx 9 位 + SetUID/SetGID/Sticky）。

### 2.5 Node.js ssh2 库的 SFTP API

TDSF 当前依赖 `ssh2 ^1.15.0`（mscdex/ssh2，Brian White 维护），这是 Node.js 生态最完整的 SSHv2 实现。

#### 核心 API（`client.sftp()` 返回 `SFTPWrapper`）

| 方法 | 说明 | TDSF 是否已用 |
|------|------|---------------|
| `readdir(path, cb)` | 列目录，返回 `{filename, longname, attrs}[]` | ✅ |
| `stat(path, cb)` / `lstat` | 获取属性，返回 `Stats`（含 `isDirectory()` / `isFile()` / `isSymbolicLink()`） | ✅ |
| `createReadStream(path, opts)` | 流式读取，`opts` 支持 `start` / `end` / `highWaterMark` | ✅ |
| `createWriteStream(path, opts)` | 流式写入，`opts` 支持 `flags` / `mode` / `highWaterMark` | ✅ |
| `fastGet(remotePath, localPath, opts, cb)` | 并发下载（`concurrency` / `chunkSize` / `step` 进度回调） | ❌ **未用，建议引入** |
| `fastPut(localPath, remotePath, opts, cb)` | 并发上传，同上 | ❌ **未用，建议引入** |
| `open(path, flags, attrs, cb)` | 底层打开，返回 handle | ❌ |
| `read(handle, buf, off, len, pos, cb)` | 底层读 | ❌ |
| `write(handle, buf, off, len, pos, cb)` | 底层写 | ❌ |
| `close(handle, cb)` | 关闭 handle | ❌ |
| `unlink(path, cb)` | 删除文件 | ✅ |
| `mkdir(path, cb)` / `rmdir` | 创建/删除目录 | ✅ |
| `rename(old, new, cb)` | 重命名 | ✅ |
| `chmod(path, mode, cb)` | 修改权限 | ✅ |
| `realPath(path, cb)` | 解析绝对路径 | ❌ |
| `readlink(path, cb)` / `symlink` | 符号链接操作 | ❌ |

#### 为什么不切换到 ssh2-sftp-client？

`ssh2-sftp-client` 是 ssh2 的 Promise 包装层，提供 `uploadDir` / `downloadDir` / `posixRename` / `rcopy` 等额外能力。**但 TDSF 不应切换**：

1. **现有 SftpManager 已经 Promise 化**（每个方法 async/await + Promise 包装）
2. ssh2-sftp-client 在 v12 移除了连接重试逻辑，与 TDSF 的 `SshConnectionManager` 重连机制重叠
3. 增加 1 个依赖 = 增加 1 个供应链风险，无净收益
4. TDSF 真正缺的 `uploadDir/downloadDir` 可以用 `tar` 流 + 单文件 `upload` 组合实现（项目已依赖 `tar ^7.5.20`）

#### 建议引入的 ssh2 能力

- **`fastGet` / `fastPut`**：替代当前 `createReadStream + pipe + createWriteStream`，获得内置并发 + `step` 进度回调，**直接解决进度条需求**
- **`realPath`**：解析 `..` 和符号链接，避免路径越界
- **`readlink` / `symlink`**：完整支持符号链接显示

---

## 3. TDSF 现有 SFTP 能力分析

### 3.1 后端 SftpManager（`src/main/services/ssh/sftp.ts`）

**已实现 10 个方法**：

| 方法 | 实现 | 备注 |
|------|------|------|
| `list(sessionId, remotePath)` | `sftp.readdir` + 排序（目录在前，按名排序） | 返回 `SftpEntry[]` |
| `upload(sessionId, localPath, remotePath)` | `fs.createReadStream → sftp.createWriteStream`（pipe） | 64KB 缓冲，**无进度回调** |
| `download(sessionId, remotePath, localPath)` | `sftp.createReadStream → fs.createWriteStream` | 自动 `mkdirSync` 父目录，**无进度回调** |
| `delete(sessionId, remotePath)` | stat 判断类型，目录用 `rmdir`，文件用 `unlink` | **不支持递归删除非空目录** |
| `rename` / `chmod` / `mkdir` | 直接调 ssh2 对应 API | — |
| `stat` | 返回 `SftpEntry` 或 `null` | 路径不存在返回 null（不抛错） |
| `readFile(sessionId, remotePath, maxSize=10MB)` | stat 检查 + 流式读到 Buffer + `toString('utf-8')` | 用于代码编辑器加载 |
| `writeFile(sessionId, remotePath, content)` | `createWriteStream.end(content, 'utf-8')` | 用于代码编辑器保存 |

**架构特点**：
- 每次 SFTP 操作独立 `client.sftp()` 获取 `SFTPWrapper`，操作完立即 `sftp.end()` 释放
- **无状态**，所有方法通过 `SshConnectionManager.getClient(sessionId)` 拿底层 Client
- 单例：`SftpManager.getInstance()`

**关键缺陷**：
- ❌ `upload/download` 的 `data` 事件统计了 `uploaded` 字节但**未对外回调**（代码注释明确写"暂未对外回调"）
- ❌ `delete` 不支持递归删除非空目录（注释建议"先用 list + 递归 delete 实现"）
- ❌ 没有用 `fastGet/fastPut`，丢失并发传输能力
- ❌ 没有断点续传（`createReadStream` 的 `start`/`end` 选项未用）

### 3.2 IPC 通道（12 个，已完整 4 步同步）

`src/shared/ipc-channels.ts` 中 `SFTP` 通道组：

| 通道 | 方法 | 后端实现 |
|------|------|----------|
| `sftp:list` | `sftpList(sessionId, remotePath)` | `SftpManager.list` |
| `sftp:upload` | `sftpUpload(sessionId, localPath, remotePath)` | `SftpManager.upload` |
| `sftp:download` | `sftpDownload(sessionId, remotePath, localPath)` | `SftpManager.download` |
| `sftp:delete` | `sftpDelete(sessionId, remotePath)` | `SftpManager.delete` |
| `sftp:rename` | `sftpRename(sessionId, oldPath, newPath)` | `SftpManager.rename` |
| `sftp:chmod` | `sftpChmod(sessionId, remotePath, mode)` | `SftpManager.chmod` |
| `sftp:readFile` | `sftpReadFile(sessionId, remotePath)` | `SftpManager.readFile`（10MB 上限） |
| `sftp:writeFile` | `sftpWriteFile(sessionId, remotePath, content)` | `SftpManager.writeFile` |
| `sftp:stat` | `sftpStat(sessionId, remotePath)` | `SftpManager.stat` |
| `sftp:mkdir` | `sftpMkdir(sessionId, remotePath)` | `SftpManager.mkdir` |
| `sftp:search` | `sftpSearch(sessionId, path, query)` | SSH exec `find ... \| head -50`，3 秒超时 |
| `sftp:grep` | `sftpGrep(sessionId, path, pattern, ...)` | SSH exec `grep -rn ... \| head -100`，3 秒超时 |

**设计亮点**：
- `search/grep` 不走 SFTP 而走 SSH exec，避开 SFTP 协议无 find 命令的限制
- 命令注入防护：`shellQuote()` 单引号转义
- 超时控制：`Promise.race` 3 秒，超时返回空结果不抛错

### 3.3 前端 FileTree.tsx

`src/renderer/src/components/workbench/FileTree.tsx`（200+ 行）：

**已实现**：
- 懒加载子目录：`toggleDir` 时按需 `loadDir`，未加载才请求
- `TreeNode` 三态：`loaded` / `loading` / `children`
- 排序：目录在前，按名 `localeCompare`
- 右键菜单（`FileTreeContextMenu`）：mkdir / delete / refresh / chmod / rename / upload
- chmod 对话框（`ChmodDialog`）、rename 对话框（`RenameDialog`）
- 上传：隐藏 `<input type="file">` + `sftpUpload`
- 错误用 antd `message.error` 显示

**关键缺陷**：
- ❌ **无虚拟滚动**：节点直接 `map` 渲染，10000+ 文件会卡死（这是最严重的性能问题）
- ❌ **无拖拽**：不支持拖入上传、拖动移动
- ❌ **无进度条**：上传/下载是 fire-and-forget
- ❌ **折叠不卸载子节点**（`loaded` 保留），深层目录内存占用累积
- ❌ 无文件 watcher，远程变更需手动刷新
- ❌ 无传输队列 / 并发控制

### 3.4 现有能力清单

| 能力 | 状态 | 备注 |
|------|------|------|
| 目录列表 | ✅ 完整 | `sftp:list` |
| 文件上传（单文件） | ✅ 但无进度 | 流式 pipe |
| 文件下载（单文件） | ✅ 但无进度 | 流式 pipe |
| 删除（文件/空目录） | ✅ | 非空目录需递归 |
| 重命名 / chmod / mkdir | ✅ | — |
| 读取文件到字符串 | ✅ 10MB 上限 | 用于代码编辑器 |
| 写字符串到文件 | ✅ | 用于代码编辑器保存 |
| stat | ✅ | 路径不存在返回 null |
| 模糊查找（find） | ✅ 3 秒超时 | SSH exec |
| 内容搜索（grep） | ✅ 3 秒超时 | SSH exec |
| **大目录虚拟滚动** | ❌ | 直接 map 渲染 |
| **上传/下载进度** | ❌ | 进度未对外回调 |
| **拖拽上传/移动** | ❌ | — |
| **断点续传** | ❌ | `start/end` 选项未用 |
| **并发传输队列** | ❌ | — |
| **递归删除非空目录** | ❌ | 需 list + 循环 |
| **目录上传/下载** | ❌ | 可用 tar 流组合实现 |
| **文件 watcher** | ❌ | 远程 inotify 需额外方案 |
| **符号链接显示** | ⚠️ stat 返回 `isSymlink` 但未显示目标 | `readlink` 未用 |

---

## 4. 主流方案对比

### 4.1 方案 A：直接 SFTP（TDSF 现状增强）

**技术方案**：保留 `ssh2 + SftpManager` 架构，按需读写，前端懒加载目录树。

**开源实现参考**：
- **electerm**（https://github.com/electerm/electerm）：Electron + ssh2 + node-pty + xterm.js + antd，深度集成 ssh2-streams，实现断点续传、多线程并发、符号链接解析、递归同步、拖拽传输。**与 TDSF 技术栈几乎完全一致**，是最直接的对标项目。
- **WinSCP**（Windows 原生，架构可参考）：图形化 SFTP 客户端，支持拖放、远程文件编辑、脚本化传输、主机指纹校验。文件队列管理是核心特性。
- **FileZilla**：双面板（本地 + 远程）+ 传输队列，支持并发传输、断点续传、目录比较。

**性能（大目录列表延迟）**：
- 单次 `readdir` 在 ssh2 中是「一次 OPENDIR + 多次 READDIR（每次约 100-1000 条目）+ CLOSE」
- 10000 文件目录：局域网 ~200-500ms，公网 ~1-3s
- **瓶颈在网络 RTT**，不是协议本身。可用 `fastGet/fastPut` 的并发（默认 `concurrency: 64`）缓解

**集成到 TDSF 的难度**：**低**。已有 90% 能力，仅需补：
1. `upload/download` 改用 `fastGet/fastPut`，暴露进度回调（IPC `webContents.send` 推送）
2. 前端 `FileTree.tsx` 引入 `react-arborist` 替换原生 map 渲染
3. 新增 `sftp:progress` 事件通道（IPC `on` 而非 `invoke`）

**需要新增的依赖**：
- `react-arborist`（前端虚拟滚动树）
- 无需新增后端依赖

**对现有架构的影响**：**最小**。SftpManager API 不变，仅内部实现替换；IPC 通道新增 1 个 progress 事件；前端 FileTree 重写渲染层但保留 TreeNode 数据结构。

### 4.2 方案 B：VS Code Remote SSH 架构（Server 注入 + Virtual FileSystem Provider）

**技术方案**：在远程主机注入一个 VS Code Server（Node.js 进程），通过 SSH 隧道通信。客户端用 `FileSystemProvider` API 注册 `vscode-remote://` scheme，所有文件操作走 RPC 到远程 Server，Server 直接调本地 fs（不走 SFTP）。

**开源实现参考**：
- VS Code Remote SSH（闭源，微软产品）：https://code.visualstudio.com/docs/remote/ssh
- 架构文档：https://code.visualstudio.com/docs/remote/faq
- VS Code Server 是 Remote Development 扩展的组件，**不由 VS Code 客户端管理可独立安装**

**架构特点**：
- **Server 端**：注入到远程主机 `~/.vscode-server/`，运行 Node.js 进程，承载扩展宿主、文件系统服务、终端服务
- **Client 端**：通过 SSH 隧道与 Server 通信，文件操作走自定义 RPC（非 SFTP）
- **FileSystemProvider API**：允许扩展挂载虚拟文件系统，支持 `readFile` / `writeFile` / `stat` / `readDirectory` / `watch` / `createDirectory` / `delete` / `rename` / `copy`
- **文件 watcher**：Server 端用原生 fs.watch（inotify/FSEvents），变更事件推送到客户端

**性能**：
- 文件读写延迟低（Server 直接调本地 fs，无 SFTP 协议开销）
- 大目录列表快（Server 本地 readdir，无网络往返 per entry）
- **但首次安装 Server 需下载 ~100MB Node.js + VS Code Server 到远程主机**

**集成到 TDSF 的难度**：**极高，不推荐**。
1. 需要在远程主机注入并维护一个 Server 进程，与 TDSF「轻量教学工具」定位冲突
2. 远程主机可能没有 Node.js 运行时，需要打包自带
3. Server 进程的生命周期管理、版本升级、安全隔离都是独立工程
4. 用户可能没有远程主机的写入权限（如只读 SSH 账号）

**需要新增的依赖**：自行实现 Server 协议（无开源可复用）

**对现有架构的影响**：**颠覆性**。SftpManager 整个废弃，改为 Server RPC；前端 FileTree 改为 FileSystemProvider 模式。

**结论**：**不适合 TDSF**。VS Code Remote 的优势在于「让远程开发体验等于本地」，代价是重型 Server 注入。TDSF 是教学工具，目标是让学生理解 SSH/SFTP，不是隐藏远程性。

### 4.3 方案 C：SSHFS 挂载（WinFsp + SSHFS-Win）

**技术方案**：在 Windows 客户端用 WinFsp（FUSE for Windows）+ SSHFS-Win 把远程目录挂载为本地盘符（如 `Z:`），TDSF 通过本地 fs API 操作挂载点。

**开源实现参考**：
- **WinFsp**：https://gitcode.com/gh_mirrors/wi/winfsp — Windows 用户态文件系统框架
- **SSHFS-Win**：https://github.com/winfsp/sshfs-win — SSHFS 的 Windows 移植
- **SSHFS**（Linux 原版）：https://gitcode.com/gh_mirrors/ss/sshfs — 基于 FUSE + SFTP

**架构特点**：
- WinFsp 提供内核驱动 + 用户态 API，用户态进程（SSHFS-Win）处理所有文件操作
- 挂载后，Explorer / VS Code / 任意 Windows 应用可无感知访问远程文件
- 支持缓存策略（`cache=yes` + `cache_timeout=60`）、自动重连（`reconnect`）、多连接（`max_conns`）

**性能**：
- 透明缓存，重复读取快
- 大文件顺序读写性能与 SFTP 相当
- **小文件随机读写性能差**（每个操作都有 RTT），不适合代码编辑器频繁保存

**集成到 TDSF 的难度**：**高，且有打包风险**。
1. WinFsp 需要安装内核驱动（需管理员权限 + SmartScreen 警告）
2. SSHFS-Win 依赖 Cygwin 运行时，打包进 Electron 安装包体积大（~50MB+）
3. 挂载点管理、卸载、异常恢复是独立工程
4. 与 TDSF 现有 SftpManager + IPC 架构完全重叠，等于推倒重来

**需要新增的依赖**：WinFsp 运行时、SSHFS-Win 可执行文件（需打包进安装包）

**对现有架构的影响**：**完全替代** SFTP 层，前端从「调 IPC」改为「操作本地路径」。

**结论**：**不适合 TDSF**。原因：
1. TDSF 是教学工具，应该让学生看到 SFTP 操作过程，而不是隐藏它
2. WinFsp 驱动安装对教学场景过重
3. 打包体积膨胀与「轻量桌面工具」定位冲突
4. 现有 SftpManager 已经能用，没必要推倒重来

### 4.4 方案对比矩阵

| 维度 | A. 直接 SFTP（增强） | B. VS Code Remote 架构 | C. SSHFS 挂载 |
|------|---------------------|------------------------|---------------|
| 协议 | SFTP over SSH | 自定义 RPC over SSH | SFTP + FUSE |
| 客户端复杂度 | 低 | 高（FileSystemProvider） | 低（本地 fs） |
| 服务端依赖 | 无（仅 sshd） | 需注入 Server 进程 | 无（仅 sshd） |
| 打包体积 | 无新增 | 需打包 Server | 需打包 WinFsp + SSHFS-Win (~50MB) |
| 大目录性能 | 中（懒加载 + 虚拟滚动可解） | 高（Server 本地操作） | 中（缓存命中后高） |
| 文件 watcher | 需额外方案 | 原生支持 | 原生支持（inotify） |
| 教学价值 | **高**（显式 SFTP 操作） | 低（隐藏远程性） | 低（隐藏远程性） |
| 与 TDSF 现有架构契合度 | **高** | 低 | 低 |
| 集成难度 | **低** | 极高 | 高 |
| 推荐度 | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐ |

---

## 5. 文件树组件选型

### 5.1 候选组件对比

| 组件 | 虚拟滚动 | 拖拽 | 内联重命名 | 键盘导航 | 右键菜单 | ARIA | 包大小 | 维护状态 |
|------|----------|------|-----------|----------|----------|------|--------|----------|
| **react-arborist 3.2** | ✅ 原生 | ✅ 内置 | ✅ 内置 | ✅ 内置 | 自定义 | ✅ | ~30KB | 活跃（2026 持续更新） |
| react-complex-tree | ✅ | ✅ | ✅ | ✅ | ✅ 内置 | ✅ | ~40KB | 活跃 |
| @radix-ui/react-tree | ❌ 需自配 | ❌ | ❌ | ✅ | 自定义 | ✅ | ~15KB | 稳定 |
| antd Tree | ⚠️ `treeData` 大数据卡 | ✅ `draggable` | ✅ `fieldNames` | ✅ | 自定义 | ✅ | ~50KB | 稳定 |
| react-virtuoso Tree | ✅ | 自定义 | 自定义 | 自定义 | 自定义 | ⚠️ | ~45KB | 活跃 |

### 5.2 推荐：react-arborist 3.2

**理由**：

1. **专为大型树优化**：内置虚拟滚动，只渲染可见节点。社区文档明确指出「Traditional tree implementations often struggle with performance when dealing with large datasets. React Arborist solves this by virtualization」
2. **开箱即用的交互**：拖放排序、内联重命名、多选、过滤、键盘导航、ARIA 属性
3. **数据结构灵活**：`{ id, name, children }` 与 TDSF 现有 `TreeNode` 几乎一致，迁移成本低
4. **API 简洁**：
   ```tsx
   <Tree initialData={data} width={500} height={500} indent={34} rowHeight={34} openByDefault={false}>
     {({ node, style, dragHandle }) => (
       <div style={style} ref={dragHandle}>{node.data.name}</div>
     )}
   </Tree>
   ```
5. **与 antd 兼容**：可在节点渲染中嵌套 antd 组件（ContextMenu、Tooltip）
6. **VS Code 风格**：官方文档明确对标「VSCode 侧边栏、Mac Finder、Figma 图层面板」

**风险**：
- 需要将 TDSF 现有 `TreeNode[]` 树结构转为 react-arborist 期望的 `initialData`（递归 `id` / `name` / `children`）—— 但现有结构已经满足，几乎零改动
- 拖拽需要自定义 `onMove` 处理器，调用 `sftpRename` 实现远程移动

### 5.3 备选：react-complex-tree

如果需要更精细的拖拽控制（如跨树拖拽、自定义拖拽预览），可考虑 `react-complex-tree`。但其 API 更复杂，且 TDSF 当前需求（单树拖拽移动）react-arborist 完全够用。

### 5.4 不推荐：antd Tree

TDSF 已依赖 antd 5，看似用 antd Tree 最省事。但：
- antd Tree 的虚拟滚动支持有限（`virtual` prop 在 v5 才稳定，且需要固定 `height`）
- 大数据量（>1000 节点）仍性能不佳，社区反馈卡顿
- 拖拽 API 与 SFTP 移动语义不直接对应，需要大量适配
- 内联重命名需要 `fieldNames` + 自定义渲染，代码量与 react-arborist 持平

**结论**：antd Tree 适合「配置项树」「分类树」等中小规模场景，不适合 SFTP 文件浏览器。

---

## 6. 集成方案建议（基于 TDSF 现有架构）

### 6.1 总体策略：增量增强，不推倒重来

TDSF 现有 SFTP 后端（SftpManager + 12 个 IPC 通道）已经覆盖 90% 场景，**后端几乎不动**，主要工作在前端 + 进度回调链路。

### 6.2 分阶段实施

#### Phase 1：进度条 + 虚拟滚动（Demo 必需，1-2 天）

**后端改动**：

1. `SftpManager.upload/download` 改用 `fastGet/fastPut`：
   ```typescript
   public async download(
     sessionId: string,
     remotePath: string,
     localPath: string,
     onProgress?: (transferred: number, total: number) => void
   ): Promise<boolean> {
     const sftp = await this.openSftp(sessionId)
     try {
       const stat = await this.statInternal(sftp, remotePath)
       const total = stat?.size ?? 0
       return await new Promise<boolean>((resolve, reject) => {
         sftp.fastGet(remotePath, localPath, {
           concurrency: 64,
           chunkSize: 32768,
           step: (transferred) => onProgress?.(transferred, total),
         }, (err) => err ? reject(err) : resolve(true))
       })
     } finally {
       this.closeSftp(sftp)
     }
   }
   ```
2. 新增 IPC 事件通道 `sftp:progress`（`webContents.send` 推送，渲染进程 `ipcRenderer.on` 订阅），载荷 `{ transferId, transferred, total, speed }`
3. `upload/download` IPC handler 增加 `transferId` 参数，用于关联进度事件

**前端改动**：

1. `FileTree.tsx` 引入 `react-arborist`，替换原生 `map` 渲染
2. 现有 `TreeNode` 适配 react-arborist 数据格式（`id` / `name` / `children` 已有）
3. 新增 `TransferProgress` 组件（antd `Progress` + 队列列表），订阅 `sftp:progress` 事件
4. 上传/下载前生成 `transferId`，调用 `sftpUpload/sftpDownload` 时传入

#### Phase 2：拖拽 + 递归删除（体验增强，2-3 天）

1. **拖拽上传**：监听 `onDrop`，本地文件拖入文件树区域 → 调 `sftpUpload`
2. **拖拽移动**：react-arborist 的 `onMove` 处理器 → 调 `sftpRename`（远程移动 = rename 到新路径）
3. **递归删除**：`SftpManager.delete` 增加递归实现：
   ```typescript
   public async delete(sessionId: string, remotePath: string, recursive = false): Promise<boolean> {
     if (!recursive) return this.deleteSingle(sessionId, remotePath)
     const stat = await this.stat(sessionId, remotePath)
     if (stat?.isDirectory) {
       const entries = await this.list(sessionId, remotePath)
       for (const e of entries) {
         await this.delete(sessionId, joinPath(remotePath, e.name), true)
       }
     }
     return this.deleteSingle(sessionId, remotePath)
   }
   ```
4. **目录上传/下载**：用 `tar` 流打包 → 单文件 `upload` → 远程 `exec` 解包（项目已依赖 `tar ^7.5.20`）

#### Phase 3：文件编辑流程闭环（已有基础，补脏状态）

TDSF 已有 `sftpReadFile` + `sftpWriteFile`，双击编辑已能跑。需要补的是：

1. **临时文件策略**：双击 → `sftpDownload` 到 `app.getPath('temp')/tdsf-sftp/<sessionId>/<remotePath>` → 用 Monaco Editor 打开
2. **保存回传**：Ctrl+S → `sftpWriteFile`（直接写字符串，不用临时文件中转）→ 标记为已保存
3. **脏状态检测**：编辑器内容 hash 与上次保存/加载的 hash 比较
4. **冲突检测**：保存前 `sftpStat` 比较 `mtime`，若远程已变更则弹窗确认「远程文件已修改，是否覆盖？」
5. **关闭确认**：脏状态时关闭标签页弹窗「文件未保存，是否保存？」

#### Phase 4：增量同步（可选，非 Demo 必需）

文件 watcher 三种方案对比：

| 方案 | 实现 | 延迟 | 复杂度 | 推荐 |
|------|------|------|--------|------|
| **轮询 + mtime 比较** | 每 N 秒 `sftpStat` 当前展开目录，比较 mtime | 秒级 | 低 | ✅ Demo 阶段 |
| SSH exec `inotifywait` | 远程跑 `inotifywait -m -r <path>`，输出流回客户端 | 亚秒 | 中 | ⚠️ 依赖远程装 inotify-tools |
| SFTP extended attributes | ssh2 不支持 `SSH_FXP_EXTEND`，需自行扩展 | — | 高 | ❌ 不推荐 |

**Demo 阶段建议**：手动刷新（已有 `refresh` 菜单）+ 可选轮询（展开目录每 10 秒 stat 一次顶层节点，mtime 变了才重新 list）。不做 inotify，避免依赖远程工具。

### 6.3 关键技术问题解答

#### Q1：大目录（10000+ 文件）如何流畅？

**A**：三管齐下：
1. **懒加载**：目录展开时才 `sftp:list`，不在初次连接时递归拉取（TDSF 已实现）
2. **虚拟滚动**：react-arborist 只渲染可见节点，DOM 数量恒定（~50 个），与节点总数无关
3. **缓存**：已加载目录的 `loaded` 标志保留，折叠不重新请求（TDSF 已实现）。可加 TTL（如 60 秒后强制刷新）

**不需要**：
- inotify over SSH（依赖远程工具，教学场景不通用）
- 全量预加载（与懒加载矛盾）
- Web Worker 处理树结构（节点数 < 10 万时主线程足够）

#### Q2：双击编辑 → 保存的完整流程？

**A**：TDSF 已有 `readFile/writeFile`，推荐「直接流式读写」而非「下载到临时目录再编辑」：

```
双击文件
  → sftpReadFile(sessionId, path)  // 拉取内容字符串（10MB 上限）
  → Monaco Editor 打开新 Tab
  → 用户编辑
  → Ctrl+S
    → sftpStat(sessionId, path) 比较 mtime  // 冲突检测
    → sftpWriteFile(sessionId, path, content)  // 写回
    → 更新 Tab 的「已保存」hash
```

**为什么不用临时文件**：
- 临时文件需要管理生命周期（关闭 Tab 时清理）
- 临时文件与远程的同步关系复杂（外部修改远程文件怎么办）
- `readFile/writeFile` 已经够用，字符串在内存中传递，10MB 内无压力

**例外**：二进制文件（图片、PDF）不适合字符串传递，可降级为「下载到临时目录 → 系统默认程序打开」。

#### Q3：文件树刷新时如何避免全量重载？

**A**：当前 TDSF 的 `loadRoot()` 是全量重载根目录。改进策略：
1. **刷新当前目录**：只重新 `sftp:list` 当前展开的目录，不递归
2. **比较差异**：新旧 list 用 `name` 做 key，diff 出 added / removed / modified（mtime 变化）
3. **局部更新**：用 react-arborist 的 `updateTreeData` 增量更新，不重置展开状态
4. **轮询策略**：可选，每 10 秒 stat 当前展开目录的顶层节点，mtime 变了才触发 list

---

## 7. 推荐技术路线

### 7.1 最终选型

| 层 | 选型 | 理由 |
|----|------|------|
| SSH 库 | **ssh2 ^1.15.0**（保持不变） | 已集成，API 完整，无需切换 |
| SFTP 封装 | **SftpManager**（保持不变，内部增强） | 已覆盖 10 个方法，仅需补 fastGet/fastPut + 递归 delete |
| 文件树 | **react-arborist 3.2**（新增） | 虚拟滚动 + 拖拽 + 内联重命名，VS Code 风格 |
| 进度推送 | **IPC `webContents.send` 事件**（新增 `sftp:progress` 通道） | 流式进度不适合 `invoke` 模式，用事件推送 |
| 文件编辑 | **Monaco Editor + sftpReadFile/WriteFile**（已有基础） | 10MB 内字符串传递，无需临时文件 |
| 目录传输 | **tar 流 + 单文件 upload + SSH exec 解包** | 复用已有 `tar ^7.5.20` 依赖 |
| 文件 watcher | **手动刷新 + 可选轮询 mtime**（Demo 阶段） | 避免 inotify 依赖，教学场景通用性更好 |

### 7.2 新增依赖

| 依赖 | 版本 | 用途 | 包大小 |
|------|------|------|--------|
| `react-arborist` | ^3.2.0 | 虚拟滚动文件树 | ~30KB |

**无需新增后端依赖**。`tar` 已在 `package.json` 中（`^7.5.20`）。

### 7.3 IPC 通道新增

| 通道 | 类型 | 方向 | 载荷 | 用途 |
|------|------|------|------|------|
| `sftp:progress` | 事件 | main → renderer | `{ transferId, transferred, total, speed, phase }` | 上传/下载进度推送 |
| `sftp:transfer:cancel` | invoke | renderer → main | `{ transferId }` | 取消传输（可选） |

现有 `sftp:upload` / `sftp:download` 的 invoke 参数增加 `transferId`。

### 7.4 实施优先级（与 TDSF 两周冲刺对齐）

| 优先级 | 任务 | 对应路线图 | 工时 |
|--------|------|-----------|------|
| P0 | `upload/download` 改 `fastGet/fastPut` + 进度回调 | W1.4 SFTP 文件管理 | 4h |
| P0 | `FileTree.tsx` 引入 react-arborist（虚拟滚动） | W1.4 | 6h |
| P0 | `TransferProgress` 组件 + `sftp:progress` 通道 | W1.4 | 4h |
| P1 | 递归删除非空目录 | W1.4 | 2h |
| P1 | 拖拽上传（onDrop → sftpUpload） | W2.5 体验增强 | 4h |
| P1 | 拖拽移动（react-arborist onMove → sftpRename） | W2.5 | 4h |
| P2 | 文件编辑脏状态 + 冲突检测（mtime 比较） | W2.5 | 6h |
| P2 | 目录上传/下载（tar 流 + exec 解包） | W2.5 | 6h |
| P3 | 轮询 mtime 增量刷新 | 后续迭代 | 4h |

**Demo 阶段（W1.4）只需完成 P0**：进度条 + 虚拟滚动，共 ~14h 工时。

### 7.5 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| react-arborist 与 antd 5 样式冲突 | 用 `cn()` 工具（已有）+ CSS isolation，react-arborist 仅负责结构，样式用 `var(--trae-*)` token |
| `fastGet/fastPut` 在弱网下并发过高导致服务端拒绝 | `concurrency` 设为 16（默认 64 过高），`chunkSize` 32768 |
| 进度事件过于频繁导致前端卡顿 | 后端节流（每 100ms 或每 64KB 推送一次），前端 `requestAnimationFrame` 批量更新 |
| 大文件 `readFile` 超过 10MB 限制 | 提示「文件过大，请下载到本地编辑」+ 调用 `sftpDownload` 降级 |
| 拖拽移动跨目录失败（权限不足） | `sftpRename` 失败时回滚 react-arborist 树状态 + antd `message.error` 提示 |

---

## 8. 参考资料

### 8.1 协议规范
- SFTP 协议草案：https://datatracker.ietf.org/doc/draft-ietf-secsh-filexfer/
- SSH 协议族：RFC 4250-4256
- OpenSSH sftp-server 文档：https://man.openbsd.org/sftp-server

### 8.2 Node.js 库
- ssh2（mscdex）：https://github.com/mscdex/ssh2
- ssh2-sftp-client：https://www.npmjs.com/package/ssh2-sftp-client
- ssh2-streams SFTPStream API：https://github.com/mscdex/ssh2-streams/blob/master/SFTPStream.md

### 8.3 开源 SFTP 客户端
- electerm：https://github.com/electerm/electerm （与 TDSF 技术栈最接近）
- WinSCP：https://winscp.net/eng/docs/start
- FileZilla：https://filezilla-project.org/

### 8.4 VS Code Remote
- Remote SSH 文档：https://code.visualstudio.com/docs/remote/ssh
- Remote FAQ：https://code.visualstudio.com/docs/remote/faq
- FileSystemProvider API：https://code.visualstudio.com/api/references/vscode-api#FileSystemProvider

### 8.5 SSHFS / WinFsp
- WinFsp：https://gitcode.com/gh_mirrors/wi/winfsp
- SSHFS-Win：https://github.com/winfsp/sshfs-win
- SSHFS（Linux）：https://gitcode.com/gh_mirrors/ss/sshfs

### 8.6 React 文件树组件
- react-arborist：https://github.com/brimdata/react-arborist
- react-complex-tree：https://github.com/lukasbach/react-complex-tree
- @radix-ui/react-tree：https://www.radix-ui.com/primitives/docs/components/tree
- antd Tree：https://ant.design/components/tree

### 8.7 TDSF 现有代码
- `src/main/services/ssh/sftp.ts` — SftpManager 类（10 个方法）
- `src/main/services/ssh/connection-manager.ts` — SshConnectionManager 单例
- `src/main/ipc/ssh.ts` — SFTP IPC handlers（12 个通道）
- `src/main/ipc/sftp-search.ts` — find/grep 远程搜索（SSH exec）
- `src/renderer/src/components/workbench/FileTree.tsx` — 前端文件树（懒加载，无虚拟滚动）
- `src/renderer/src/components/workbench/FileTreeContextMenu.tsx` — 右键菜单
- `src/shared/ipc-channels.ts` — IPC 通道常量定义

---

## 9. 总结

TDSF Linux Desktop 的 SFTP 文件浏览器增强**不需要引入新协议或新架构**。现有 `ssh2 + SftpManager + 12 个 IPC 通道` 已覆盖 90% 能力，缺口集中在：

1. **前端虚拟滚动**（react-arborist 替换原生 map 渲染）
2. **进度回调链路**（fastGet/fastPut + sftp:progress 事件通道）
3. **拖拽与递归操作**（onMove/onDrop + 递归 delete + tar 流目录传输）

Demo 阶段（W1.4）只需完成前两项，工时 ~14h，即可达到 VS Code Remote SSH 风格的文件浏览体验。SSHFS 挂载方案和 VS Code Server 注入方案均不适合 TDSF 的教学工具定位，应明确排除。

**核心原则**：增量增强，不推倒重来。SftpManager API 保持向后兼容，前端 FileTree 保留 TreeNode 数据结构，仅在渲染层和传输链路层做替换。
