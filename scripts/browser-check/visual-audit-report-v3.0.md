# TDSF Linux 桌面应用前端视觉审查报告 v3.0

> 审查范围：当前实现（`screenshots-round2/`）vs 设计稿（`screenshots/`），页面 13 个
> 审查日期：2026-07-22
> 审查方式：逐对截图视觉对比

---

## 一、顶部汇总

| 指标 | 数量 |
|------|------|
| 总问题数 | 34 |
| P0（崩溃/完全不可用/明显死代码占位） | 2 |
| P1（明显多余 UI 或缺失功能区块） | 21 |
| P2（细节差异、样式/交互层级） | 11 |

**核心结论**：
- 当前实现存在多处设计稿未要求的 UI 元素，集中在 **boot 启动页**、**workbench 演示标签**、**logs 页 AI 分析/环境警告/统计卡**。
- **monitor 页**和**settings-about 页**分别处于"加载中…"占位和 JS 崩溃状态，属于 P0 阻塞问题。
- 设置页左侧导航与设计稿差异较大，缺少"模型配置 / 数据通道 / 关于"等入口；模型配置页结构不完整。
- 大量功能区块仍为静态占位（SSH 密钥/服务器列表、日志真实读取、关于页 app 信息等），需要后续接入 Electron IPC 或真实数据。

---

## 二、逐页审查表格

### boot

| 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|--------|----------|----------|--------------|
| P1 | 多余 UI | 当前页出现"进入工作台"按钮，设计稿启动页只有标题与进度线，无按钮 | `src/renderer/src/pages/BootPage.tsx` |
| P1 | 视觉差异 | 背景完全不同：当前为纯黑背景，设计稿为彩色流光斜线动态背景 | `src/renderer/src/pages/BootPage.tsx` / `BootPage.css` |
| P2 | 多余 UI | 进度条下方出现"就绪，点击进入工作台"状态文字，设计稿无此文案 | `src/renderer/src/pages/BootPage.tsx` |
| P2 | 多余 UI | 底部出现版本信息"v2.0 · 2026 火山杯 Agent 创新大赛"，设计稿无底部信息 | `src/renderer/src/pages/BootPage.tsx` |

### workbench

| 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|--------|----------|----------|--------------|
| P1 | 多余 UI | 右侧 AI 运维助手底部出现"演示模式"标签及"诊断 / 部署 / 巡检 / 调优 / 扩容"子标签，设计稿无这些快速模式入口 | `src/renderer/src/pages/WorkbenchPage.tsx` |
| P2 | 多余 UI | 右侧助手底部出现费用统计"本次会话 $0.00 今日 $0.00 本月 $0.00"和"未配置模型"提示，设计稿为具体 token 使用量与已选模型 | `src/renderer/src/pages/WorkbenchPage.tsx` / 聊天组件 |
| P2 | 状态差异 | 当前截图为未连接 SSH 空态，设计稿为已连接 prod-web-01 的完整工作状态（属于截图时状态不同，非必修复） | `src/renderer/src/pages/WorkbenchPage.tsx` |

### tutorial

| 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|--------|----------|----------|--------------|
| P1 | 功能缺失 | 页面底部缺少设计稿中的"推荐学习路径"区块 | `src/renderer/src/pages/TutorialPage.tsx` |
| P2 | 细节差异 | 分类标签样式略有不同（当前为圆角胶囊，设计稿为扁平标签） | `src/renderer/src/pages/TutorialPage.tsx` |

### monitor

| 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|--------|----------|----------|--------------|
| P0 | 死代码/静态占位 | 页面仅显示"加载中…"，未渲染任何监控指标卡、图表、告警列表、进程监控，完全未实现设计稿内容 | `src/renderer/src/pages/MonitorPage.tsx` |
| P1 | 缺失功能 | 设计稿中的 CPU / 内存 / 磁盘 / 网络指标卡、24h 趋势图、告警列表、进程监控全部缺失 | `src/renderer/src/pages/MonitorPage.tsx` / 监控数据服务 |

### history

| 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|--------|----------|----------|--------------|
| P2 | 多余 UI | 筛选器"全部状态"前多了漏斗图标，设计稿无图标 | `src/renderer/src/pages/HistoryPage.tsx` |
| P2 | 细节差异 | 决策卡片状态标签样式不一致（当前"成功 / 低风险"等标签组合，设计稿标签颜色/形式不同） | `src/renderer/src/pages/HistoryPage.tsx` / History CSS |

### knowledge

| 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|--------|----------|----------|--------------|
| P1 | 功能缺失 | 页面底部"AI 知识沉淀"区块缺少设计稿中的统计数据（1,247 条 / 23 条 / 68%）和"贡献知识"按钮 | `src/renderer/src/pages/KnowledgePage.tsx` |
| P2 | 细节差异 | 右侧"热门知识"与"最近浏览"列表项间距/缩进略有不同 | `src/renderer/src/pages/KnowledgePage.tsx` |

### logs

| 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|--------|----------|----------|--------------|
| P1 | 多余 UI | 顶部出现两条黄色警告"当前环境不支持日志读取（非 Electron 环境），展示示例数据"，设计稿无此环境提示 | `src/renderer/src/pages/LogsPage.tsx` |
| P1 | 多余 UI | 工具栏出现"AI 分析"按钮，设计稿工具栏无此按钮 | `src/renderer/src/components/logs/v1/LogToolbar.tsx` |
| P1 | 多余 UI | 日志查看区右上角出现 INFO/WARN/ERROR 浮动统计卡，设计稿无此统计卡 | `src/renderer/src/components/logs/v1/LogViewer.tsx` |
| P1 | 多余 UI | 左侧日志源侧边栏出现"AI 决策日志"和"服务最新日志"分组，设计稿左侧只有 5 个主类日志源 + 服务器路径 | `src/renderer/src/components/logs/v1/LogSidebar.tsx` |
| P1 | 功能缺失 | 设计稿顶部标题旁有"AI 决策树还原"按钮，当前实现缺失 | `src/renderer/src/pages/LogsPage.tsx` |
| P2 | 多余 UI | 工具栏出现"自动滚动"开关，设计稿工具栏只有搜索/级别筛选/刷新/导出 | `src/renderer/src/components/logs/v1/LogToolbar.tsx` |
| P2 | 交互层级 | 非 Electron 环境下所有日志为示例数据，但"导出 CSV"仍可用，会导出示例数据，易造成误解 | `src/renderer/src/pages/LogsPage.tsx` |

### settings-general

| 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|--------|----------|----------|--------------|
| P1 | 导航缺失 | 左侧设置导航只有"通用 / SSH 连接 / 终端设置 / 外观"，设计稿还有"模型配置 / 数据通道 / 关于" | `src/renderer/src/pages/SettingsLayout.tsx` |
| P1 | 功能缺失 | "数据与存储"分组不完整：缺少"日志文件路径"、"自动清理日志"开关、"日志保留天数"、"导出数据 / 清除缓存"按钮 | `src/renderer/src/pages/GeneralSettings.tsx` |
| P2 | 细节差异 | 时区下拉显示"Asia/Shanghai (UTC+8)"，设计稿显示"Asia/Shanghai" | `src/renderer/src/pages/GeneralSettings.tsx` |

### settings-ssh

| 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|--------|----------|----------|--------------|
| P1 | 静态占位 | 已连接服务器区域显示"无法访问服务器列表 / Electron IPC 不可用"，SSH 密钥管理显示"无法加载密钥 / Electron IPC 不可用"，功能未实际可用 | `src/renderer/src/pages/SshSettings.tsx` |
| P2 | 默认值差异 | Keep Alive 间隔当前显示 30s，设计稿显示 60s | `src/renderer/src/pages/SshSettings.tsx` |
| P2 | 多余 UI | 虽然 Electron IPC 不可用，"添加服务器 / 上传密钥 / 生成新密钥"按钮仍可点击但无实际作用，建议空态时禁用或隐藏 | `src/renderer/src/pages/SshSettings.tsx` |

### settings-terminal

| 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|--------|----------|----------|--------------|
| P1 | 导航缺失 | 左侧设置导航缺少"AI 引擎 / 数据通道 / 关于"（同 settings-general） | `src/renderer/src/pages/SettingsLayout.tsx` |
| P1 | 功能缺失 | 缺少"登录提示"开关（设计稿中"默认 Shell 配置"分组有该开关） | `src/renderer/src/pages/TerminalSettings.tsx` |
| P1 | 功能缺失 | "复制与粘贴"分组当前只显示"选中自动复制"一项，设计稿还有"右键粘贴"、"复制时去除换行"等选项 | `src/renderer/src/pages/TerminalSettings.tsx` |

### settings-model

| 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|--------|----------|----------|--------------|
| P1 | 结构差异 | 当前模型配置作为设置子页面渲染，设计稿为独立页面结构（顶部左侧"返回设置"+ 右侧"保存配置"，无左侧设置导航） | `src/renderer/src/pages/ModelSettings.tsx` / 路由配置 |
| P1 | 功能缺失 | 缺少"思考强度 Thinking Effort"配置（低 / 中 / 高） | `src/renderer/src/pages/ModelSettings.tsx` |
| P1 | 功能缺失 | 缺少"最大 Token Max Tokens"、"上下文窗口 Context Window"、"请求超时 Timeout"字段 | `src/renderer/src/pages/ModelSettings.tsx` |
| P1 | 功能缺失 | 缺少"API 接入与测试"区块（API Endpoint、API Key、Organization） | `src/renderer/src/pages/ModelSettings.tsx` |
| P2 | 细节差异 | Token 统计卡排列方式不同：当前为纵向堆叠，设计稿为 4 列并排 | `src/renderer/src/pages/ModelSettings.tsx` |

### settings-appearance

| 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|--------|----------|----------|--------------|
| P1 | 功能缺失 | 页面底部缺少"代码高亮主题"区块（设计稿有 One Dark / Monokai 等主题选择） | `src/renderer/src/pages/AppearanceSettings.tsx` |
| P2 | 细节差异 | 当前"界面密度"只显示到区块标题，设计稿可见完整选项（紧凑 / 标准 / 宽松） | `src/renderer/src/pages/AppearanceSettings.tsx` |

### settings-about

| 优先级 | 差异类型 | 具体问题 | 涉及文件猜测 |
|--------|----------|----------|--------------|
| P0 | 页面崩溃 | 页面报错"Cannot read properties of undefined (reading 'appGetInfo')"，堆栈指向 `AboutSettings.tsx:37:28`，完全无法显示关于内容 | `src/renderer/src/pages/AboutSettings.tsx` |
| P1 | 功能缺失 | 因崩溃导致设计稿中的 logo、版本信息、检查更新、更新日志、版本详情表、链接卡片全部缺失 | `src/renderer/src/pages/AboutSettings.tsx` |
| P2 | 返回按钮 | 因页面崩溃，无法确认"返回设置"按钮是否存在 | `src/renderer/src/pages/AboutSettings.tsx` |

---

## 三、返回按钮完整性检查表格

| 页面 | 当前实现 | 设计稿 | 是否完整 | 说明 |
|------|----------|--------|----------|------|
| boot | 有"进入工作台" | 无返回按钮 | N/A | 当前按钮为多余 UI，设计稿启动页无返回 |
| workbench | 无 | 无 | ✓ | 首页无需返回 |
| tutorial | 有"返回工作台" | 有"返回工作台" | ✓ | 完整 |
| monitor | 未显示（页面加载中） | 有"返回" | ✗ | 页面未渲染，无法确认 |
| history | 有"返回工作台" | 有"返回工作台" | ✓ | 完整 |
| knowledge | 有"返回工作台" | 有"返回工作台" | ✓ | 完整 |
| logs | 有"返回工作台" | 有"返回工作台" | ✓ | 完整 |
| settings-general | 有"返回设置" | 有"返回设置" | ✓ | 完整 |
| settings-ssh | 有"返回设置" | 有"返回设置" | ✓ | 完整 |
| settings-terminal | 有"返回设置" | 有"返回设置" | ✓ | 完整 |
| settings-model | 有"返回设置" | 有"返回设置" | ✓ | 完整（设计稿为独立页面也有返回） |
| settings-appearance | 有"返回设置" | 有"返回设置" | ✓ | 完整 |
| settings-about | 未显示（页面崩溃） | 有"返回设置" | ✗ | 页面崩溃导致无法确认 |

**返回按钮结论**：常规页面返回按钮完整；monitor 与 settings-about 因页面未正常渲染，返回按钮缺失或不可见。

---

## 四、建议删除的不必要 UI 清单

按页面与优先级排序：

| 页面 | 建议删除/隐藏的 UI 元素 | 优先级 | 原因 |
|------|------------------------|--------|------|
| boot | "进入工作台"按钮 | P1 | 设计稿启动页只有标题与进度线 |
| boot | 进度条下方"就绪，点击进入工作台"文字 | P2 | 设计稿无此状态提示 |
| boot | 底部版本信息"v2.0 · 2026 火山杯 Agent 创新大赛" | P2 | 设计稿无底部信息 |
| workbench | "演示模式"标签及"诊断 / 部署 / 巡检 / 调优 / 扩容"子标签 | P1 | 设计稿 AI 助手区域无此快捷入口 |
| workbench | 底部费用统计与"未配置模型"提示 | P2 | 设计稿为真实 token 用量与已选模型 |
| logs | 顶部黄色环境警告条（两条重复提示） | P1 | 设计稿无此提示，且重复出现 |
| logs | 工具栏"AI 分析"按钮 | P1 | 设计稿工具栏无此按钮 |
| logs | 日志查看区右上角 INFO/WARN/ERROR 浮动统计卡 | P1 | 设计稿无此统计卡 |
| logs | 左侧"AI 决策日志"和"服务最新日志"分组 | P1 | 设计稿左侧日志源结构不同 |
| logs | 工具栏"自动滚动"开关 | P2 | 设计稿工具栏无此开关 |
| settings-ssh | Electron IPC 不可用时禁用"添加服务器 / 上传密钥 / 生成新密钥"按钮 | P2 | 当前按钮可点击但无实际作用，误导用户 |

---

## 五、待开发功能清单（设计稿有但当前仅静态/未实现）

| 页面 | 待开发功能 | 优先级 | 当前状态 | 建议实现路径 |
|------|------------|--------|----------|--------------|
| boot | 彩色流光斜线动态背景 | P1 | 纯黑背景 | 替换背景样式/动画 |
| tutorial | 推荐学习路径区块 | P1 | 缺失 | 在 TutorialPage 底部添加 |
| monitor | 完整实时监控 dashboard（指标卡、趋势图、告警列表、进程监控） | P0 | 仅"加载中…" | 需接入监控数据源并渲染图表 |
| knowledge | AI 知识沉淀统计与"贡献知识"按钮 | P1 | 静态占位无数据 | 接入知识库统计与上传/编辑入口 |
| logs | "AI 决策树还原"按钮功能 | P1 | 缺失 | 在 LogsPage Header 添加按钮与对应弹窗/页面 |
| logs | 真实日志读取与实时流 | P1 | 非 Electron 回退示例数据 | 确保 Electron 环境下 `window.electronAPI.logRead` 可用 |
| settings-general | 左侧导航增加"模型配置 / 数据通道 / 关于" | P1 | 只有 4 项 | 修改 `SettingsLayout.tsx` 导航配置 |
| settings-general | "数据与存储"完整字段：日志文件路径、自动清理日志、日志保留天数、导出数据/清除缓存 | P1 | 字段缺失 | 扩展 `GeneralSettings.tsx` |
| settings-ssh | Electron 环境下真实服务器列表与 SSH 密钥管理 | P1 | IPC 不可用占位 | 确保 `window.electronAPI` 相关接口可用 |
| settings-terminal | 左侧导航增加"AI 引擎 / 数据通道 / 关于" | P1 | 导航缺失 | 修改 `SettingsLayout.tsx` |
| settings-terminal | "登录提示"开关 | P1 | 缺失 | 扩展 `TerminalSettings.tsx` |
| settings-terminal | 完整"复制与粘贴"选项（右键粘贴、复制时去除换行等） | P1 | 只有一项 | 扩展 `TerminalSettings.tsx` |
| settings-model | 独立页面结构（顶部"返回设置"+"保存配置"，无左侧设置导航） | P1 | 当前为子页面 | 调整路由与页面布局 |
| settings-model | 思考强度、Max Tokens、Context Window、Timeout 配置 | P1 | 缺失 | 扩展 `ModelSettings.tsx` |
| settings-model | API 接入与测试（Endpoint / API Key / Organization） | P1 | 缺失 | 扩展 `ModelSettings.tsx` |
| settings-appearance | 代码高亮主题选择（One Dark / Monokai 等） | P1 | 缺失 | 扩展 `AppearanceSettings.tsx` |
| settings-about | 修复 `appGetInfo` 调用崩溃 | P0 | JS 报错 | 在 `AboutSettings.tsx` 增加 `window.electronAPI?.appGetInfo` 判空或 mock 降级 |
| settings-about | 完整关于页面（logo、版本、检查更新、更新日志、详情表、链接卡片） | P0/P1 | 因崩溃全部缺失 | 修复崩溃后按设计稿补全 |

---

## 六、附录：截图对应关系

| 页面 | 当前实现截图 | 设计稿截图 |
|------|--------------|------------|
| boot | `screenshots-round2/boot.png` | `screenshots/design-boot.png` |
| workbench | `screenshots-round2/workbench.png` | `screenshots/design-workbench.png` |
| tutorial | `screenshots-round2/tutorial.png` | `screenshots/design-tutorial.png` |
| monitor | `screenshots-round2/monitor.png` | `screenshots/design-monitor.png` |
| history | `screenshots-round2/history.png` | `screenshots/design-history.png` |
| knowledge | `screenshots-round2/knowledge.png` | `screenshots/design-knowledge.png` |
| logs | `screenshots-round2/logs.png` | `screenshots/design-logs.png` |
| settings-general | `screenshots-round2/settings-general.png` | `screenshots/design-settings-general.png` |
| settings-ssh | `screenshots-round2/settings-ssh.png` | `screenshots/design-settings-ssh.png` |
| settings-terminal | `screenshots-round2/settings-terminal.png` | `screenshots/design-settings-terminal.png` |
| settings-model | `screenshots-round2/settings-model.png` | `screenshots/design-settings-model.png` |
| settings-appearance | `screenshots-round2/settings-appearance.png` | `screenshots/design-settings-appearance.png` |
| settings-about | `screenshots-round2/settings-about.png` | `screenshots/design-settings-about.png` |
