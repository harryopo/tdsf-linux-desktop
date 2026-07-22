# v2.1 功能修复循环工程 · 任务清单

> 基于用户实测反馈的功能修复循环工程，8 Phase（H-O）35 Task
> 起始时间：2026-07-22 21:30
> 完成时间：2026-07-22 23:20

---

## Phase H · 密码持久化修复（3 Task）✅

| Task | 描述 | 状态 | commit |
|------|------|------|--------|
| H.1 | server-store syncToMain 移除脱敏逻辑，直接传完整对象给主进程 | ✅ | c25089e |
| H.2 | hydrateFromMain 改为"主进程权威"策略，mainServers.length>0 时覆盖渲染层 | ✅ | c25089e |
| H.3 | removeServer 增加 serverDeleteCred 调用，清除安全凭据 | ✅ | c25089e |
| H.4 | ServerList handleDelete 改为 async，先 serverDeleteCred 再 removeServer | ✅ | c25089e |

## Phase I · 监控间隔修复（2 Task）✅

| Task | 描述 | 状态 | commit |
|------|------|------|--------|
| I.1 | MonitorPage monitorStart 参数从 5000（秒=83分钟）改为 3（秒） | ✅ | c25089e |
| I.2 | WorkbenchTitlebar connectServer 后自动启动监控 | ✅ | c25089e |

## Phase J · DeepSeek 模型弃用修复（3 Task）✅

| Task | 描述 | 状态 | commit |
|------|------|------|--------|
| J.1 | provider-templates: deepseek-chat→v4-flash, deepseek-reasoner→v4-pro, baseURL移除/v1 | ✅ | c25089e |
| J.2 | supervisor: DeepSeek 思考模式 providerOptions(thinking+reasoning_effort) | ✅ | c25089e |
| J.3 | ModelSettings: 默认 endpoint 和 model 更新 | ✅ | c25089e |

## Phase K · SSH 心跳保活真实重连（3 Task）✅

| Task | 描述 | 状态 | commit |
|------|------|------|--------|
| K.1 | connection-manager startKeepAlive 增加3次指数退避自动重连(1s→2s→4s) | ✅ | 49514d1 |
| K.2 | SshStateEvent + SSH.STATE_CHANGED IPC 4步同步(preload/electron.d.ts) | ✅ | 49514d1 |
| K.3 | SshSettings keepAliveIntervalSec 滑块联动 store | ✅ | 49514d1 |

## Phase L · known_hosts 验证 + 首次保存密钥弹窗（5 Task）✅

| Task | 描述 | 状态 | commit |
|------|------|------|--------|
| L.1 | 新建 known-hosts.ts: checkKnownHosts/appendKnownHost/replaceKnownHost/createHostVerifier | ✅ | e674b06 |
| L.2 | connection-manager buildConnectOptions 注入 hostVerifier(strictHostKeyCheck=true时) | ✅ | e674b06 |
| L.3 | IPC 4步同步: HOST_KEY_PROMPT/HOST_KEY_RESPONSE 通道+5分钟超时 | ✅ | e674b06 |
| L.4 | HostKeyPromptDialog 组件: antd Modal 三按钮(保存并继续/仅本次/拒绝)+App.tsx挂载 | ✅ | e674b06 |
| L.5 | SshSettings: strictHostKeyCheck/knownHostsPath 联动 store + mergedConfig | ✅ | e674b06 |

## Phase M · 删除按钮 + 密钥管理 UI（4 Task）✅

| Task | 描述 | 状态 | commit |
|------|------|------|--------|
| M.1 | SshSettings Card1: 每个服务器行增加 Trash2 删除按钮+Modal.confirm+removeServer | ✅ | ada7f40 |
| M.2 | Card2 密钥删除: 切换数据源到 sshListKeypairs 真实文件扫描+sshDeleteKeyring 幂等删除 | ✅ | ada7f40 |
| M.3 | 私钥上传: sshUploadKeypair dialog.showOpenDialog+复制到~/.ssh/+chmod 600 | ✅ | ada7f40 |
| M.4 | 私钥生成: sshGenerateKeypair spawn ssh-keygen(ed25519/rsa)+Modal+Form | ✅ | ada7f40 |

## Phase N · 终端选中翻译恢复（3 Task）✅

| Task | 描述 | 状态 | commit |
|------|------|------|--------|
| N.1 | EditorArea TerminalPanel 恢复翻译开关按钮(Languages图标) | ✅ | 49514d1 |
| N.2 | SelectionPopover 组件重新挂载 | ✅ | 49514d1 |
| N.3 | useTranslateStore 联动开关状态 | ✅ | 49514d1 |

## Phase O · 集成验证 + 归档（5 Task）✅

| Task | 描述 | 状态 | commit |
|------|------|------|--------|
| O.1 | 编译门禁三绿(typecheck:node + typecheck:web + lint) | ✅ | 91ef994 |
| O.2 | lint 修复: models.ts ban-types豁免 + SshSettings删除未使用函数 | ✅ | 91ef994 |
| O.3 | 归档五件套(tasks/checklist/verify-report/learnings/PROGRESS) | ✅ | 本文档 |
| O.4 | PROGRESS.md 更新 v2.1 段落 | ✅ | - |
| O.5 | project_memory.md 更新 v2.1 经验 | ✅ | - |

---

## 总计

| Phase | Task 数 | 完成 | commit |
|-------|---------|------|--------|
| H | 4 | 4 | c25089e |
| I | 2 | 2 | c25089e |
| J | 3 | 3 | c25089e |
| K | 3 | 3 | 49514d1 |
| L | 5 | 5 | e674b06 |
| M | 4 | 4 | ada7f40 |
| N | 3 | 3 | 49514d1 |
| O | 5 | 5 | 91ef994 |
| **合计** | **29** | **29** | **5 commits** |
