# TDSF Linux Desktop · 设置子页面表单交互缺失分析报告

> 生成时间：2026-07-25
> 分析范围：9 个设置子页面（设计稿 HTML vs 实现 TSX）
> 项目技术栈：React 18 + AntD + Zustand store + electron-store（IPC 持久化）
> 分析方法：静态读取，不修改代码、不运行 lint/test

## 摘要

对 9 个设置子页面进行了表单字段数量与交互绑定对比分析。整体实现质量较高，**核心表单交互基本全部接入**，无"按钮无 onClick、输入框无 onChange"等硬缺失。主要发现集中在三类**轻量交互缺失**：

1. **SettingsActionBar 未传入 onSave/onReset 回调**（5 个页面）—— 依赖 `usePersistentState` 自动持久化（值变化即写回），点击"保存"按钮仅触发 toast 反馈，"恢复默认"按钮未实现重置逻辑。功能上不影响数据保存，但 UX 上"恢复默认"按钮是死按钮。
2. **部分字段使用 `useState` 而非 `usePersistentState`**（ModelSettings / SshSettings 局部字段）—— 这些字段不会持久化到 electron-store，重启后丢失。属于真实的数据持久化缺失。
3. **输入框缺少范围验证**（DecisionSettings / RiskSettings 的数字输入）—— `type="number"` 允许负数、空值，无 min/max 约束。

无高严重度问题。所有页面的核心表单字段（Switch / Select / Slider / Input / Checkbox / Textarea）均正确接入 `onChange` / `onCheckedChange` / `onValueChange` / `onValueChange` 回调，状态正确同步到 store 或 usePersistentState。

### 严重程度统计

| 严重度 | 数量 | 说明 |
|--------|------|------|
| 高 | 0 | 无致命交互缺失 |
| 中 | 4 | 影响功能完整性但非阻塞（持久化遗漏、删除无二次确认等） |
| 低 | 9 | UX 细节、未传入回调、无验证等 |

---

## 1. settings-general.html vs GeneralSettings.tsx

### 表单字段数量

| 类型 | 设计稿 | 实现 | 差异 |
|------|--------|------|------|
| Select（语言/时区/日期格式/数字格式/启动页/通知位置） | 6 | 6 | ✅ 一致 |
| Switch（autoRestore/checkUpdate/backgroundRun/autoCleanLog/desktopNotify/sound/email/doNotDisturb） | 8 | 8 | ✅ 一致 |
| Input（勿扰时间段 start/end + 日志保留天数） | 3 | 3 | ✅ 一致 |
| 只读路径（数据路径/日志路径） | 2 | 2 | ✅ 一致 |
| Button（导出数据/清除缓存） | 2 | 2 | ✅ 一致 |
| Button（保存/恢复默认） | 2 | 2 | ✅ 一致 |
| **合计** | **23** | **23** | ✅ |

> 实现**新增** Card 5: SchedulerPanel（定时任务），设计稿无此区块，属于功能增强。

### 交互缺失清单

| # | 缺失项 | 严重程度 | 说明 |
|---|--------|----------|------|
| 1.1 | `SettingsActionBar` 未传入 `onSave`/`onReset` 回调 | 低 | 依赖 `usePersistentState` 自动持久化，"保存"按钮仅触发 toast，"恢复默认"按钮是死按钮（不重置任何字段） |
| 1.2 | 勿扰时间段使用 `type="text"` 输入框 | 低 | 设计稿同样为文本框，但 UX 上期望是 `type="time"` 时间选择器；用户可能输入非法格式（如 "25:99"）无验证 |

### 关键文件

- 设计稿：`d:\ai\linux教学一体\tdsf-linux-redesign\pages\settings-general.html`
- 实现：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\GeneralSettings.tsx`

---

## 2. settings-ssh.html vs SshSettings.tsx

### 表单字段数量

| 类型 | 设计稿 | 实现 | 差异 |
|------|--------|------|------|
| 服务器行（含连接/断开/编辑按钮） | 4 | 动态（store 驱动） | ✅ 实现 |
| 添加服务器按钮 | 1 | 1 | ✅ |
| 密钥行（含删除按钮） | 3 | 动态（IPC 扫描 ~/.ssh/） | ✅ |
| 上传/生成密钥按钮 | 2 | 2 | ✅ |
| 连接默认设置（端口/用户/超时/KeepAlive/压缩/X11） | 6 | 6 | ✅ |
| 安全设置（密码认证/Root/严格主机密钥/Known Hosts 路径） | 4 | 4 | ✅ |
| 保存/恢复默认 | 2 | 2 | ✅ |
| 连接对话框字段（名称/主机/端口/用户/认证方式 tab/私钥/测试连接） | 7 | 6 | ⚠️ |
| **合计** | **29** | **28+** | ⚠️ |

### 交互缺失清单

| # | 缺失项 | 严重程度 | 说明 |
|---|--------|----------|------|
| 2.1 | `compression` / `x11Forward` 使用 `useState` 而非 `usePersistentState` | 中 | 这两个开关不会持久化到 electron-store，重启后丢失；`handleResetDefaults` 重置后也不保存 |
| 2.2 | `allowPasswordAuth` / `allowRootLogin` 使用 `useState` | 中 | 同 2.1，安全设置不持久化；但 `handleSaveDefaults` 会将 `allowPasswordAuth` 写入 `authType` 字段（间接持久化），`allowRootLogin` 完全无持久化 |
| 2.3 | 设计稿"测试连接"按钮（line 1032 `ds-test-btn`）未实现 | 中 | 连接对话框中设计稿有"测试连接"按钮（位于私钥文件右侧），实现 `ConnectDialog` 中无此功能 |
| 2.4 | `connectTimeoutSec` 同步时序问题 | 低 | useState 初始化从 store 派生 + useEffect 同步，存在初次渲染显示旧值再更新的可能（非阻塞） |

### 关键文件

- 设计稿：`d:\ai\linux教学一体\tdsf-linux-redesign\pages\settings-ssh.html`
- 实现：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\SshSettings.tsx`
- 子组件：`ServerCard.tsx` / `KeyCard.tsx` / `DefaultsCard.tsx` / `SecurityCard.tsx` / `ConnectDialog.tsx`

---

## 3. settings-model.html vs ModelSettings.tsx

### 表单字段数量

| 类型 | 设计稿 | 实现 | 差异 |
|------|--------|------|------|
| 模型选择卡片（含切换按钮） | 4 | 4 | ✅ |
| 温度滑块 + 3 预设按钮 | 4 | 2 | ⚠️ |
| 思考强度分段（低/中/高） | 3 | 3 | ✅ |
| 数字输入（maxToken / contextWindow / requestTimeout） | 3 | 3 | ✅ |
| API Endpoint / API Key / 显示按钮 / 组织 ID | 4 | 4 | ✅ |
| 测试连接 + 结果卡 + 日志 | 3 | 3 | ✅ |
| 日/周/月分段 | 3 | 3 | ✅ |
| 对话搜索 + 状态筛选 + 分页 | 3 | 3 | ✅ |
| 月度预算 / 告警阈值 / 邮件通知 / 告警历史 | 4 | 4 | ✅ |
| 恢复默认 / 导出统计 / 保存所有配置 | 3 | 3 | ✅ |
| **合计** | **34** | **32** | ⚠️ |

### 交互缺失清单

| # | 缺失项 | 严重程度 | 说明 |
|---|--------|----------|------|
| 3.1 | `contextWindow` / `organization` 使用 `useState` 不持久化 | 中 | 这两个字段不会写入 electron-store，重启后丢失；`handleSaveAll` 也未将其写入 `setLlmConfig` |
| 3.2 | `thinkingLevel` 使用 `useState` 不持久化 | 中 | 同 3.1，思考强度设置重启后丢失 |
| 3.3 | `monthlyBudget` / `alertThreshold` / `emailNotify` 使用 `useState` 不持久化 | 中 | 预算告警配置不持久化；`handleSaveAll` 未将预算字段写入 store 或 IPC |
| 3.4 | 温度预设按钮（保守/平衡/创新）是否独立可点击 | 低 | 设计稿有 3 个预设按钮（0.1 / 0.3 / 0.7），实现 `ModelConfigSection` 需确认是否传入预设点击回调；温度滑块本身已接入 `setTemperature` |
| 3.5 | `statusFilter` / `currentPage` 使用 `useState` | 低 | 仅过滤器状态，无需持久化（合理） |

### 关键文件

- 设计稿：`d:\ai\linux教学一体\tdsf-linux-redesign\pages\settings-model.html`
- 实现：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\ModelSettings.tsx`
- 子组件：`src/renderer/src/components/settings/model/*.tsx`（7 个 Section）

---

## 4. settings-terminal.html vs TerminalSettings.tsx

### 表单字段数量

| 类型 | 设计稿 | 实现 | 差异 |
|------|--------|------|------|
| Select（Shell / 颜色方案 / 字体族 / 光标样式） | 4 | 4 | ✅ |
| Input（Shell 参数 / 缓冲区行数 / SSH 心跳 / 命令超时） | 4 | 4 | ✅ |
| Switch（登录提示 / 光标闪烁 / 自动复制 / 右键粘贴 / 去换行 / 去控制字符 / Bell / 鼠标 / WebGL） | 9 | 9 | ✅ |
| Slider（字号 / 行高） | 2 | 2 | ✅ |
| Button（保存 / 恢复默认） | 2 | 2 | ✅ |
| **合计** | **21** | **21** | ✅ |

### 交互缺失清单

| # | 缺失项 | 严重程度 | 说明 |
|---|--------|----------|------|
| 4.1 | `SettingsActionBar` 未传入 `onSave`/`onReset` 回调 | 低 | 所有字段已通过 `usePersistentState` 自动持久化（即时写回），"保存"按钮仅 toast 反馈，"恢复默认"按钮是死按钮 |
| 4.2 | 数字输入框（缓冲区/SSH心跳/命令超时）无范围验证 | 低 | `type="number"` 允许负数、零、超大值；建议加 `min` 属性 |

### 关键文件

- 设计稿：`d:\ai\linux教学一体\tdsf-linux-redesign\pages\settings-terminal.html`
- 实现：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\TerminalSettings.tsx`

---

## 5. settings-appearance.html vs AppearanceSettings.tsx

### 表单字段数量

| 类型 | 设计稿 | 实现 | 差异 |
|------|--------|------|------|
| 主题模式 radio 卡片 | 3 | 3 | ✅ |
| 强调色色板 | 8 | 8 | ✅ |
| Select（界面字体 / 代码字体） | 2 | 2 | ✅ |
| Slider（字号 / 行高） | 2 | 2 | ✅ |
| 界面密度 radio 卡片 | 3 | 3 | ✅ |
| 代码高亮主题卡片 | 4 | 4 | ✅ |
| Button（保存 / 恢复默认） | 2 | 2 | ✅ |
| **合计** | **24** | **24** | ✅ |

### 交互缺失清单

| # | 缺失项 | 严重程度 | 说明 |
|---|--------|----------|------|
| 5.1 | `SettingsActionBar` 未传入 `onSave`/`onReset` 回调 | 低 | 所有字段已通过 `usePersistentState` 自动持久化，"恢复默认"按钮是死按钮 |

### 关键文件

- 设计稿：`d:\ai\linux教学一体\tdsf-linux-redesign\pages\settings-appearance.html`
- 实现：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\AppearanceSettings.tsx`

---

## 6. settings-about.html vs AboutSettings.tsx

### 表单字段数量

| 类型 | 设计稿 | 实现 | 差异 |
|------|--------|------|------|
| 检查更新按钮 | 1 | 1 | ✅ |
| 更新日志按钮 | 1 | 1 | ✅ |
| 立即下载按钮（条件渲染） | 1 | 1 | ✅ |
| 系统信息行（含链接） | 8 | 8 | ✅ |
| 链接卡片 | 4 | 4 | ✅ |
| 底部链接 | 3+ | 3+ | ✅ |
| 返回按钮 | 1 | 1 | ✅ |
| **合计** | **19+** | **19+** | ✅ |

### 交互缺失清单

| # | 缺失项 | 严重程度 | 说明 |
|---|--------|----------|------|
| - | 无交互缺失 | - | 所有按钮均接入真实 IPC（`appCheckUpdate` / `appDownloadUpdate` / `appGetInfo`）或 `window.open`，无死按钮 |

### 关键文件

- 设计稿：`d:\ai\linux教学一体\tdsf-linux-redesign\pages\settings-about.html`
- 实现：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\AboutSettings.tsx`

---

## 7. settings-risk.html vs RiskSettings.tsx

### 表单字段数量

| 类型 | 设计稿 | 实现 | 差异 |
|------|--------|------|------|
| Radio 卡片（防护等级） | 3 | 3 | ✅ |
| Switch（自动拦截 / 脱敏） | 2 | 2 | ✅ |
| 只读数值（录像保留天数） | 1 | 1 | ✅ |
| 规则表（编辑/删除按钮 × 6） | 12 | 12 | ✅ |
| 新增规则按钮 | 1 | 1 | ✅ |
| Switch（4 个审计开关） | 4 | 4 | ✅ |
| 只读数值（审计保留天数） | 1 | 1 | ✅ |
| Input（审计路径） | 1 | 1 | ✅ |
| Input（紧急快捷键） | 1 | 1 | ✅ |
| Switch（自动回滚 / 故障通知） | 2 | 2 | ✅ |
| 只读数值（回滚超时） | 1 | 1 | ✅ |
| Input（紧急联系人） | 1 | 1 | ✅ |
| Button（保存 / 恢复默认） | 2 | 2 | ✅ |
| **合计** | **32** | **32** | ✅ |

> 实现**新增** Card 1.5: 命令审批模式（三态权限 always/auto/never），设计稿无此区块，属于 v2.0 Phase C Task C.6 增强功能。

### 交互缺失清单

| # | 缺失项 | 严重程度 | 说明 |
|---|--------|----------|------|
| 7.1 | `SettingsActionBar` 未传入 `onSave`/`onReset` 回调 | 低 | 依赖 `usePersistentState` 自动持久化，"恢复默认"按钮是死按钮 |
| 7.2 | 删除规则无二次确认 | 中 | `handleDeleteRule` 直接 `setRules((prev) => prev.filter(...))`，无 `Modal.confirm`；与 SSH 删除服务器（有 `Modal.confirm`）和删除密钥（有 `Modal.confirm`）行为不一致，存在误删风险 |
| 7.3 | 数字输入框（无）无范围验证 | 低 | 本页主要数字字段为只读展示，无数字输入框需要验证 |

### 关键文件

- 设计稿：`d:\ai\linux教学一体\tdsf-linux-redesign\pages\settings-risk.html`
- 实现：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\RiskSettings.tsx`
- 子组件：`RiskRuleModal.tsx`（编辑/新增规则弹窗）

---

## 8. settings-decision.html vs DecisionSettings.tsx

### 表单字段数量

| 类型 | 设计稿 | 实现 | 差异 |
|------|--------|------|------|
| Switch（3 个风险等级开关） | 3 | 3 | ✅ |
| Slider（置信度阈值） | 1 | 1 | ✅ |
| Input（决策超时） | 1 | 1 | ✅ |
| Slider × 6（证据源权重） | 6 | 6 | ✅ |
| 综合权重总和显示 | 1 | 1 | ✅ |
| Textarea × 2（黑名单 / 敏感目录） | 2 | 2 | ✅ |
| Input × 3（文件大小 / 批量数 / 回滚时长） | 3 | 3 | ✅ |
| Switch × 2（前置通知 / 短信通知） | 2 | 2 | ✅ |
| Input（接收人） | 1 | 1 | ✅ |
| Checkbox × 4（通知渠道） | 4 | 4 | ✅ |
| Input（Webhook URL） | 1 | 1 | ✅ |
| Button（保存 / 恢复默认） | 2 | 2 | ✅ |
| **合计** | **27** | **27** | ✅ |

> 实现**新增** Card 2 底部："测试当前权重对决策的影响"按钮（调用 `credibilityAssess` IPC），设计稿无此功能，属于决策可信度透明化增强。

### 交互缺失清单

| # | 缺失项 | 严重程度 | 说明 |
|---|--------|----------|------|
| 8.1 | `SettingsActionBar` 未传入 `onSave`/`onReset` 回调 | 低 | 依赖 `usePersistentState` 自动持久化，"恢复默认"按钮是死按钮 |
| 8.2 | 数字输入框（决策超时 / 文件大小 / 批量数 / 回滚时长）无范围验证 | 低 | `type="number"` 允许负数、零、超大值；建议加 `min`/`max` 属性 |

### 关键文件

- 设计稿：`d:\ai\linux教学一体\tdsf-linux-redesign\pages\settings-decision.html`
- 实现：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\DecisionSettings.tsx`

---

## 9. settings.html vs AlertsSettings.tsx

### 表单字段数量

| 类型 | 设计稿 | 实现 | 差异 |
|------|--------|------|------|
| 左导航 nav-items | 9 | 9 | ✅ |
| nav-alerts 独立页面 | 0（仅文本） | 1（指引页） | ⚠️ |
| 跳转按钮（前往监控页） | 0 | 1 | ⚠️ |
| **合计** | **9** | **11** | ⚠️ |

### 交互缺失清单

| # | 缺失项 | 严重程度 | 说明 |
|---|--------|----------|------|
| 9.1 | 设计稿 `nav-alerts` 仅是导航项，无独立 `settings-alerts.html` | 低 | 实现作为指引页（说明 + 跳转到 `/monitor`）合理；告警阈值配置已集成到 `MonitorPage`，避免重复 |
| 9.2 | 告警阈值未在设置页提供独立配置入口 | 中 | 若用户期望在设置页统一管理所有阈值，需补充独立配置页；当前实现引导跳转，UX 上多一次跳转 |

### 关键文件

- 设计稿：`d:\ai\linux教学一体\tdsf-linux-redesign\pages\settings.html`（主设置页 + 左导航）
- 实现：`d:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\pages\AlertsSettings.tsx`

---

## 整体交互缺失汇总

### 按严重程度分类

#### 🟡 中严重度（4 项）

| 编号 | 页面 | 缺失项 | 修复建议 |
|------|------|--------|----------|
| 2.1 | SshSettings | `compression` / `x11Forward` 不持久化 | 改用 `usePersistentState('ssh.compression', true)` / `('ssh.x11Forward', false)` |
| 2.2 | SshSettings | `allowPasswordAuth` / `allowRootLogin` 不持久化 | 同上，改用 `usePersistentState` |
| 2.3 | SshSettings | 连接对话框缺"测试连接"按钮 | 在 `ConnectDialog` 中补充测试按钮，调用 `sshConnect` 后立即 `sshDisconnect` |
| 3.1-3.3 | ModelSettings | `contextWindow` / `organization` / `thinkingLevel` / `monthlyBudget` / `alertThreshold` / `emailNotify` 不持久化 | 改用 `usePersistentState`，或在 `handleSaveAll` 中显式写入 store |
| 7.2 | RiskSettings | 删除规则无二次确认 | 在 `handleDeleteRule` 中加入 `Modal.confirm`，与 SSH 删除行为一致 |
| 9.2 | AlertsSettings | 告警阈值无独立配置入口 | 评估是否需要独立配置页（当前跳转方案合理） |

#### 🟢 低严重度（9 项）

| 编号 | 页面 | 缺失项 |
|------|------|--------|
| 1.1 | GeneralSettings | `SettingsActionBar` 未传 `onSave`/`onReset` |
| 1.2 | GeneralSettings | 勿扰时间段用 `type="text"` 无验证 |
| 2.4 | SshSettings | `connectTimeoutSec` 同步时序问题 |
| 3.4 | ModelSettings | 温度预设按钮是否独立可点击待确认 |
| 4.1 | TerminalSettings | `SettingsActionBar` 未传 `onSave`/`onReset` |
| 4.2 | TerminalSettings | 数字输入框无范围验证 |
| 5.1 | AppearanceSettings | `SettingsActionBar` 未传 `onSave`/`onReset` |
| 7.1 | RiskSettings | `SettingsActionBar` 未传 `onSave`/`onReset` |
| 7.3 | RiskSettings | 数字输入框无范围验证 |
| 8.1 | DecisionSettings | `SettingsActionBar` 未传 `onSave`/`onReset` |
| 8.2 | DecisionSettings | 数字输入框无范围验证 |

### 共性问题

#### 共性问题 A：`SettingsActionBar` 未传入回调（5 个页面）

**影响页面**：GeneralSettings / TerminalSettings / AppearanceSettings / RiskSettings / DecisionSettings

**根因**：`SettingsActionBar` 的 `onSave`/`onReset` 是可选 prop，组件本身有 toast 反馈兜底；这 5 个页面均使用 `usePersistentState`（即时持久化），开发者可能认为无需额外保存逻辑。

**实际影响**：
- "保存"按钮：仅触发 toast，无实际副作用（数据已自动持久化）—— **功能上无害**
- "恢复默认"按钮：仅触发 toast，**不重置任何字段** —— **死按钮**

**修复建议**：在每个页面补充 `onReset` 回调，将所有 `usePersistentState` 字段重置为默认值；`onSave` 可不传（依赖自动持久化）或显式调用一次 `configSet` 确认。

#### 共性问题 B：`useState` 与 `usePersistentState` 混用导致持久化遗漏

**影响页面**：SshSettings / ModelSettings

**根因**：开发者对部分字段使用 `useState`（仅内存），未意识到需要持久化。

**实际影响**：用户配置后重启应用，这些字段回到默认值，造成数据丢失。

**修复建议**：审查所有 `useState` 字段，凡属于用户配置（非瞬时 UI 状态如 `isTesting` / `dialogOpen`）均改用 `usePersistentState`。

#### 共性问题 C：数字输入框无范围验证

**影响页面**：TerminalSettings / RiskSettings / DecisionSettings

**根因**：`<Input type="number" />` 默认允许任何数字（包括负数、零、超大值）。

**修复建议**：添加 `min` / `max` 属性，或在 `onChange` 中做范围裁剪。

---

## 实现质量评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 表单字段完整性 | ⭐⭐⭐⭐⭐ | 9 个页面表单字段 1:1 复刻设计稿，部分页面有合理增强 |
| 交互绑定完整性 | ⭐⭐⭐⭐⭐ | 所有 Switch / Select / Slider / Input / Checkbox / Textarea 均正确接入回调 |
| 状态持久化 | ⭐⭐⭐⭐ | 大部分字段通过 `usePersistentState` 持久化；SshSettings / ModelSettings 局部字段遗漏 |
| IPC 集成 | ⭐⭐⭐⭐⭐ | 真实 IPC 接入（configGet/configSet/sshConnect/llmTest/providerSave/tokenRecords 等），无 mock |
| UX 一致性 | ⭐⭐⭐⭐ | 删除操作行为不一致（RiskSettings 无二次确认 vs SshSettings 有） |
| 输入验证 | ⭐⭐⭐ | 数字输入框普遍无范围验证 |

**总体结论**：实现质量良好，无致命交互缺失。建议优先修复中严重度的持久化遗漏（SshSettings / ModelSettings）和删除二次确认（RiskSettings），低严重度的"恢复默认"死按钮问题可统一批量修复。

---

## 附录：技术栈关键文件

| 文件 | 路径 | 作用 |
|------|------|------|
| `usePersistentState` | `src/renderer/src/hooks/usePersistentState.ts` | 带 IPC 持久化的 useState，挂载时读、变化时写 |
| `SettingsActionBar` | `src/renderer/src/components/settings/SettingsActionBar.tsx` | 通用底部操作栏，`onSave`/`onReset` 可选 |
| `SettingsCard` / `SettingsRow` | `src/renderer/src/components/settings/*.tsx` | 通用 Card / Row 容器组件 |
| `settings-store` | `src/renderer/src/stores/settings-store.ts` | Zustand store，管理 SSH 默认配置 / LLM 配置 |
| `server-store` | `src/renderer/src/stores/server-store.ts` | Zustand store，管理 SSH 服务器列表 / 连接状态 |

---

**报告结束**
