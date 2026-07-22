# v2.1 功能修复循环工程 · 经验沉淀

> LRN-20260722-009 至 LRN-20260722-014

---

## LRN-20260722-009 · git add -p 精确暂存混合文件

**场景**：Phase K commit 时，preload/index.ts 和 electron.d.ts 混入了前端对话的 expectation 模块修改。

**问题**：直接 `git add file` 会把前端修改也 commit，影响 commit 范围准确性。

**解决方案**：用 PowerShell 管道非交互式运行 `git add -p`：
```powershell
"y`nn`nn`ny`ny`nn`ny`nn`nq`n" | git add -p src/preload/index.ts
```
通过 `y/n` 序列精确选择 Phase K 的 hunks，前端 hunks 选择 `n`。

**经验**：多 AI 协作场景下，工作区文件可能被多个对话修改。commit 前必须检查 `git diff` 确认修改来源，混合文件用 `git add -p` 精确暂存。

---

## LRN-20260722-010 · SSH 心跳保活必须实现真实重连

**场景**：用户反馈"SSH心跳保活不知道能否真正保活"。

**问题**：原实现只有 `setInterval + exec('echo ping')` 检测，心跳失败后没有重连逻辑，连接会静默断开。

**解决方案**：
1. 心跳失败后触发 `handleKeepAliveFailure`，最多3次指数退避重连(1s→2s→4s)
2. 重连过程通过 `SshStateEvent` IPC 推送 UI（reconnecting/disconnected）
3. 总时长上限30s，避免无限重连

**经验**：心跳保活不只是"检测存活"，必须包含"失败恢复"完整链路。检测→重连→通知UI→最终断开，缺一不可。

---

## LRN-20260722-011 · known_hosts 验证不能简单 return true

**场景**：Phase L 实现 hostVerifier 时，最简单的做法是 `hostVerifier: () => true`，但这是安全漏洞（中间人攻击风险）。

**问题**：ssh2 的 hostVerifier 回调需要真正比对密钥指纹，不能简单 return true。

**解决方案**：
1. 参考 electerm MIT License 的 ssh-known-hosts.js 实现
2. 用 HMAC-SHA1 哈希主机名比对 known_hosts 条目（OpenSSH 兼容）
3. 五种状态全覆盖：unknown/changed/mismatch/match/revoked
4. 首次连接通过 IPC 弹窗让用户确认（三按钮：保存并继续/仅本次/拒绝）
5. 5分钟超时自动 reject，避免 Promise 永久挂起

**经验**：安全相关的回调函数必须实现真实逻辑，不能为了"先跑通"而 return true。参考成熟开源项目（electerm）的实现是最安全的做法。

---

## LRN-20260722-012 · DeepSeek API baseURL 不能含 /v1

**场景**：Phase J 修复 DeepSeek 模型弃用时，baseURL 从 `https://api.deepseek.com/v1` 改为 `https://api.deepseek.com`。

**问题**：@ai-sdk/openai 的 createOpenAI 会自动追加 `/v1`，如果 baseURL 已含 `/v1` 会变成 `/v1/v1` 导致 404。

**解决方案**：baseURL 只填到域名级别，让 SDK 自动追加版本路径。

**经验**：不同 LLM Provider 的 baseURL 规范不同，必须查文档确认。OpenAI 兼容 API 通常不需要 `/v1` 后缀（SDK 自动处理）。

---

## LRN-20260722-013 · MonitorPage interval 单位错误导致监控不工作

**场景**：用户反馈"实时监控的功能跑不起来"。

**问题**：`monitorStart(activeSessionId, 5000)` 传的 5000 被当作"秒"，等于 83 分钟才执行一次。

**解决方案**：改为 `monitorStart(activeSessionId, 3)`（3秒间隔），并在 `connectServer` 后自动启动监控。

**经验**：IPC 参数单位必须在接口文档和代码注释中明确标注。渲染层和主进程对参数的理解必须一致。

---

## LRN-20260722-014 · subagent 实施后必须检查混合文件

**场景**：Phase L/M subagent 实施后，preload/index.ts 和 electron.d.ts 混入了前端对话的修改。

**问题**：subagent 在修改文件时，可能发现文件已有其他修改（前端对话的），会一起处理。

**解决方案**：
1. subagent 完成后，检查 `git status` 确认修改文件列表
2. 对于混合文件，用 `git add -p` 精确暂存
3. 如果混合程度高且前端修改已完整，可直接一起 commit（commit message 说明）

**经验**：subagent 不区分修改来源，它会处理工作区中的所有修改。派发 subagent 前最好先 `git stash` 前端修改，或接受混合 commit。
