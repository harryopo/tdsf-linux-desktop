# 通宵编译循环工程 — 交付冲刺计划

> Session 族：`ai-claude-20260720-overnight`  
> 目标：**假设计产品 → 可演示的真实桌面运维 IDE**  
> 用户睡眠期间：自主规划 → 开发 → 自测 → 记进度 → 下一阶段

## 1. 成功标准（明早可验收）

| # | 用户故事 | 必须 |
|---|---------|------|
| 1 | 打开 App → Shader 启动页 → 进入工作台 | ✅ 已有 |
| 2 | 能连接 SSH（设置或对话框） | P0 |
| 3 | 工作台终端是 **真 xterm**，能敲命令 | P0（有会话时已接） |
| 4 | 左侧文件树是 **真 SFTP**，可展开 | P0 |
| 5 | 点文件能打开内容，可改可保存 | P0 |
| 6 | 右侧 AI 发消息走 **agent:chat**，有流式回复或明确错误 | P0 |
| 7 | 按钮/字号不至于点不动（密度修正） | P0 |
| 8 | 一次完整演示路径写在清单里 | P1 |

**非目标（通宵不碰，防膨胀）：**

- 完整 8 Subagent / PAOR 工业级
- Sidecar-B/C 因果/多 Agent
- 像素级 100% 还原全部 20 页
- 再写长调研文档

## 2. 阶段切片（每阶段 ≤ 1 上下文窗口）

### Phase A — 真文件树（当前）
- FileTree ← server-store + sftpList 懒加载
- 无会话引导
- 密度：行高 28、字 12–13、标题栏可点

### Phase B — 真编辑器
- 点击文件 → sftpReadFile → EditorArea 动态 tab
- 保存 → sftpWriteFile
- 脏标记

### Phase C — 连接与状态
- Titlebar/Status 已部分真；补连接入口可达
- 会话切换后树/终端刷新

### Phase D — Agent 可演示
- 确认 AIPanel 主路径稳定
- 无 Provider 时 UI 引导去模型设置
- 可选：一键「诊断示例」调 sidecar 或 workflow

### Phase E — 自测与清单
- eslint 改动文件
- `docs/DELIVERY_CHECKLIST.md` + 更新 `AGENT_MAIN_PATH.md`
- 记忆落盘

## 3. 循环纪律

1. 每阶段开始：`ai:status`，必要时 claim  
2. 只改当前阶段文件，不跨域乱改 main 大重构  
3. 每阶段结束：eslint → 记进度到 `docs/OVERNIGHT_PROGRESS.md`  
4. 上下文膨胀时：写进度文件，下一轮从进度读，不依赖长对话  
5. 失败两次同一 bug → 记 ERROR，换路径  

## 4. 主路径（冻结）

```
Boot → Workbench
  ├─ SSH session (server-store)
  ├─ TerminalView (真 shell)
  ├─ FileTree (sftpList) → Editor (read/write)
  └─ AIPanel → agent:chat → Supervisor
```

## 5. 进度文件

- `docs/OVERNIGHT_PROGRESS.md` — 机器可读进度（每阶段追加）
- `docs/DELIVERY_CHECKLIST.md` — 人读验收清单
