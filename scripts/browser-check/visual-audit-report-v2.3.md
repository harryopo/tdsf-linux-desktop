# 视觉审查报告 v2.3 — 全页面 1:1 对比

> 生成时间：2026-07-20  
> 检查方式：Playwright Chromium + 本地静态服务器渲染 `out/renderer` 构建产物，对照 `tdsf-linux-redesign/pages` 设计稿 HTML  
> 窗口尺寸：1920×1080  
> 截图目录：`scripts/browser-check/screenshots/`

## 说明

本次审查因 Electron 主进程启动异常（`electron.app.getPath` 报错，详见附录 A），改用 Chromium 直接加载 renderer 构建产物进行截图。renderer 层的视觉差异可被准确捕获；但 Electron 窗口非客户区、主进程数据加载、IPC 返回的数据差异未包含在本次截图中。

---

## 总体结论

| 页面 | 相似度 | 主要问题 |
| --- | --- | --- |
| BootPage | 70% | 多出的"进入工作台"按钮、进度条位置、背景色调差异 |
| WorkbenchPage | 80% | AI 面板标题栏缺少模型选择器/思考强度标签、整体偏紧凑 |
| Settings-General | 55% | 侧边栏样式、设置项内容/顺序、卡片间距差异大 |
| Settings-Model | 60% | 模型选择卡片样式、温度滑块、思考强度按钮差异 |
| Settings-Appearance | 75% | 紧凑度、卡片间距 |
| Settings-Risk | 65% | 设置项内容差异、表格样式 |
| Settings-SSH | 75% | 紧凑度、按钮样式 |
| Settings-Terminal | 60% | 设置项内容/顺序差异大 |
| Settings-Decision | 70% | 紧凑度、额外设置项 |
| Settings-About | 80% | 缺少左侧边栏一致性问题 |
| TutorialPage | 75% | 统计数据、按钮文字、卡片信息密度 |
| TutorialDetail | 65% | 当前章节内容未按路由 ID 显示 |
| HistoryPage | 80% | 列表紧凑度、分页显示 |
| HistoryDetail | 85% | 标题编号格式 |
| KnowledgePage | 75% | 搜索框宽度、布局比例 |
| KnowledgeDetail | 80% | 顶部标签布局 |
| MonitorPage | 85% | KPI 卡片细节、紧凑度 |
| LogsPage | 80% | 左侧 sidebar 项目数量、顶部统计 |
| DecisionDetail | 80% | 命令面板按钮布局 |

---

## 1. 启动页 BootPage

**截图证据**

- 实际：`screenshots/app-boot.png`
- 设计稿：`screenshots/design-boot.png`

### 问题清单

- **[P1] 存在设计稿没有的"进入工作台"按钮**
  - 设计稿：标题下方仅有一条细进度线，无按钮。
  - 实际：标题下方有"进入工作台 →"按钮，且按钮下方才有进度条。
  - 影响：用户指出"进入工作台应该在状态栏下面"，当前位置与设计稿不符。

- **[P2] 进度条位置与设计稿相反**
  - 设计稿：标题 → 进度条（细线）。
  - 实际：标题 → 按钮 → 进度条。

- **[P2] 背景流光色调不一致**
  - 设计稿：以蓝紫冷色调为主，流光更柔和。
  - 实际：出现明显橙黄暖色条纹，整体色调偏暖。

- **[P2] 标题视觉中心偏移**
  - 由于 `letter-spacing` 补偿，标题在视觉上有轻微左偏倾向，需要复核 `text-indent` 是否完全抵消。

- **[P3] 进度条样式差异**
  - 设计稿为简洁细线，无渐变发光尾端。
  - 实际为渐变发光进度条。

### 修复建议

1. 移除"进入工作台"按钮（若设计稿确实不需要）或按用户最新指示将其放在"状态栏下面"。
2. 调整 DOM 顺序为：标题 → 进度条。
3. 重新校准 Shader 背景色，减少橙黄分量，向蓝紫冷色调靠拢。
4. 复核标题 `letter-spacing` 与 `text-indent` 的数值，确保视觉居中。

---

## 2. 工作台 WorkbenchPage

**截图证据**

- 实际：`screenshots/app-workbench.png`
- 设计稿：`screenshots/design-workbench.png`

### 问题清单

- **[P2] AI 面板标题栏中间缺少模型选择器与思考强度标签**
  - 设计稿：标题栏中间区域包含"DeepSeek-R1"模型选择器和"深度思考"等标签横向组合。
  - 实际：仅显示"AI运维助手"标题，缺少该横向组合。

- **[P2] 整体布局偏紧凑**
  - 实际页面各区域间距小于设计稿，AI 面板、文件树、编辑器之间的呼吸感不足。

- **[P2] 文件树/ActivityRail 图标已替换为自定义 SVG，但顶部标题栏右侧图标仍需替换**
  - 设计稿使用 `layout.svg`，实际仍为 Lucide `LayoutGrid`。

- **[P3] 命令面板按钮组视觉权重不同**
  - 设计稿中"执行"/"沙箱预演"/"回滚"按钮样式更统一。
  - 实际按钮颜色、边框略有差异。

- **[P3] Token 预算行与指标对比表间距需复核**
  - 实际页面 AI 面板底部信息密度过高。

### 修复建议

1. 按设计稿复刻 AI 面板标题栏中间区域：模型选择器 + 思考强度标签 + Token 曲线触发器。
2. 增大主要区域间距（ActivityRail 与 FileTree、FileTree 与 Editor、Editor 与 AIPanel 之间）。
3. 替换 WorkbenchTitlebar 右侧"终端面板"图标为 `layout.svg`。
4. 统一命令面板按钮的视觉样式。

---

## 3. 设置页（通用）Settings-General

**截图证据**

- 实际：`screenshots/app-settings-general.png`
- 设计稿：`screenshots/design-settings-general.png`

### 问题清单

- **[P1] 左侧 Sidebar 样式与设计稿不一致**
  - 设计稿：更宽的卡片式侧边栏，图标+文字横向排列，当前项有高亮背景。
  - 实际：窄 sidebar，图标+文字垂直紧凑排列。

- **[P1] 设置项内容/顺序与设计稿不符**
  - 实际包含"自动恢复会话"、"启动时检查更新"、"后台运行"等设计稿没有的项。
  - 设计稿中的项名称、顺序与实际不同。

- **[P2] 卡片间距过小**
  - 实际各设置卡片之间几乎没有明显间隔，设计稿卡片间距更大。

- **[P2] 顶部标题区域布局不同**
  - 设计稿：左侧大标题"通用" + 副标题 + 右侧"返回设置"按钮。
  - 实际：左侧图标 + 标题，右侧"返回设置"按钮样式不同。

- **[P3] 输入框/开关样式差异**
  - 实际输入框高度、开关颜色与设计稿略有不同。

### 修复建议

1. 重新实现 SettingsLayout 侧边栏，按设计稿使用卡片式、图标+文字横向布局。
2. 严格按设计稿 settings-general.html 中的设置项内容和顺序重新排列。
3. 增大设置卡片间距，使用设计稿中的卡片背景色和圆角。
4. 统一顶部标题区域样式。

---

## 4. 设置页（模型配置）Settings-Model

**截图证据**

- 实际：`screenshots/app-settings-model.png`
- 设计稿：`screenshots/design-settings-model.png`

### 问题清单

- **[P2] 模型选择区域样式差异**
  - 设计稿：DeepSeek-R1 为大卡片，GPT-4o / Claude-3.5 为较小的可选卡片。
  - 实际：三个模型横向等宽排列，更像标签页。

- **[P2] 温度参数滑块视觉不同**
  - 设计稿：滑块轨道更细，当前值标签在右侧。
  - 实际：滑块轨道较粗，推荐值提示下方显示。

- **[P2] 思考强度按钮样式不同**
  - 设计稿：低/中/高为圆角按钮组，当前选中项为蓝色填充。
  - 实际：类似单选按钮，样式不同。

- **[P2] API 测试连接状态位置不同**
  - 设计稿：状态信息在测试按钮右侧或下方紧凑显示。
  - 实际：占用了较大垂直空间显示"连接成功"日志。

- **[P3] KPI 卡片细节差异**
  - 设计稿 KPI 卡片标题在上方、数值在下方。
  - 实际数值在左、标题在右（或上方小字）。

### 修复建议

1. 按设计稿重新实现模型选择卡片布局。
2. 统一滑块组件样式。
3. 重新设计思考强度选择器。
4. 压缩 API 测试状态区域的垂直空间。

---

## 5. 设置页（外观）Settings-Appearance

**截图证据**

- 实际：`screenshots/app-settings-appearance.png`
- 设计稿：`screenshots/design-settings-appearance.png`

### 问题清单

- **[P2] 主题模式卡片被截断/重叠**
  - 实际截图中"浅色模式"和"跟随系统"卡片右侧有白色块覆盖，疑似布局或渲染问题。

- **[P2] 紧凑度过高**
  - 字体设置、界面密度、代码高亮主题等卡片间距小于设计稿。

- **[P3] 代码高亮主题显示数量不同**
  - 实际显示 4 个主题（One Dark、Monokai、Solarized Dark、GitHub Dark），设计稿也是 4 个，但卡片比例不同。

### 修复建议

1. 修复主题模式卡片布局，消除白色覆盖块。
2. 增大卡片间距。

---

## 6. 设置页（风险控制）Settings-Risk

**截图证据**

- 实际：`screenshots/app-settings-risk.png`
- 设计稿：`screenshots/design-settings-risk.png`

### 问题清单

- **[P2] 设置项数量/顺序差异**
  - 实际比设计稿多出"审计日志"、"应急响应"等区块。

- **[P2] 命令风险评级规则表格样式不同**
  - 设计稿：表格行高更高，风险等级标签为圆角小 pill。
  - 实际：行高较矮，标签更接近矩形。

- **[P3] 侧边栏与主内容比例需调整**

### 修复建议

1. 按设计稿精简/重排风险控制设置项。
2. 调整表格行高和标签样式。

---

## 7. 设置页（SSH 连接）Settings-SSH

**截图证据**

- 实际：`screenshots/app-settings-ssh.png`
- 设计稿：`screenshots/design-settings-ssh.png`

### 问题清单

- **[P2] 服务器列表行高与按钮样式**
  - 设计稿行高更高，右侧"连接/编辑/断开"按钮为更紧凑的 outline 按钮。
  - 实际按钮较宽。

- **[P2] 连接默认设置中"连接超时""Keep Alive 间隔"未完整显示**
  - 实际截图中这些项的值区域被截断或显示不完整。

- **[P3] 紧凑度问题**

### 修复建议

1. 调整服务器列表行高和按钮样式。
2. 修复设置项值显示区域被截断的问题。

---

## 8. 设置页（终端设置）Settings-Terminal

**截图证据**

- 实际：`screenshots/app-settings-terminal.png`
- 设计稿：`screenshots/design-settings-terminal.png`

### 问题清单

- **[P1] 设置项内容/顺序与设计稿差异较大**
  - 实际包含"复制与粘贴"、"高级"等设计稿没有的区块。
  - 设计稿中的"登录提示"开关在实际中位置不同。

- **[P2] 滑块值标签被截断**
  - 实际截图中"字体大小""行高"右侧值显示为 `14px`、`1.4` 等，但与设计稿样式不同。

- **[P3] 紧凑度问题

### 修复建议

1. 严格按设计稿重排终端设置项。
2. 统一滑块和开关样式。

---

## 9. 设置页（决策控制）Settings-Decision

**截图证据**

- 实际：`screenshots/app-settings-decision.png`
- 设计稿：`screenshots/design-settings-decision.png`

### 问题清单

- **[P2] 额外设置项**
  - 实际包含"审批通知"等设计稿未显示的区块。

- **[P2] 证据源权重配置 sliders 样式**
  - 设计稿滑块值显示在右侧，轨道有灰色背景。
  - 实际样式略有不同。

- **[P3] 紧凑度

### 修复建议

1. 按设计稿精简决策控制设置项。
2. 统一 sliders 样式。

---

## 10. 设置页（关于）Settings-About

**截图证据**

- 实际：`screenshots/app-settings-about.png`
- 设计稿：`screenshots/design-settings-about.png`

### 问题清单

- **[P2] 设计稿中未显示左侧设置侧边栏**
  - 实际页面保留了完整的设置侧边栏。
  - 设计稿 about 页面似乎为独立全宽布局（或被截断，需确认）。

- **[P3] 底部链接卡片数量**
  - 实际显示 4 个链接卡片，设计稿也是 4 个，但布局比例不同。

### 修复建议

1. 确认设计稿 about 页面是否应包含侧边栏；若不应包含，则移除。
2. 调整底部链接卡片布局。

---

## 11. 运维教程 TutorialPage

**截图证据**

- 实际：`screenshots/app-tutorial.png`
- 设计稿：`screenshots/design-tutorial.png`

### 问题清单

- **[P2] 顶部统计数据不同**
  - 实际：6 门课程、54 分钟、缺少学习人次。
  - 设计稿：12 门课程、48 课时、3.2k 学习人次。

- **[P2] 精选课程按钮文字不同**
  - 实际："继续学习"。
  - 设计稿："开始学习"。

- **[P3] 顶部右侧按钮**
  - 实际有"刷新教程"和"返回工作台"，设计稿只有"返回工作台"。

- **[P3] 课程卡片信息密度**
  - 实际卡片内信息行数多于设计稿，显得拥挤。

### 修复建议

1. 更新顶部统计数据以匹配设计稿。
2. 调整精选课程按钮文字。
3. 精简课程卡片内信息。

---

## 12. 教程详情 TutorialDetail

**截图证据**

- 实际：`screenshots/app-tutorial-detail.png`
- 设计稿：`screenshots/design-tutorial-detail.png`

### 问题清单

- **[P1] 当前章节内容未按路由 ID 显示**
  - 路由为 `#/tutorial/1`，设计稿显示"第3章：内核参数优化"。
  - 实际显示"第1章：Nginx 基础架构"，疑似默认显示第一章或路由参数未生效。

- **[P2] 进度条当前节点与设计稿不同**
  - 设计稿当前节点为"内核参数优化"（第三个节点）。
  - 实际当前节点也为"内核参数优化"，但内容区域显示的是第一章。

### 修复建议

1. 修复 TutorialDetail 路由参数解析，确保根据 `id` 显示对应章节内容。
2. 检查进度条与内容区域的同步逻辑。

---

## 13. 历史决策 HistoryPage

**截图证据**

- 实际：`screenshots/app-history.png`
- 设计稿：`screenshots/design-history.png`

### 问题清单

- **[P2] 决策列表行高过矮**
  - 实际列表项更紧凑，时间线节点更小。

- **[P2] 分页组件显示**
  - 实际底部分页显示 1/2/3/.../25，设计稿未显示分页（或被截断）。

- **[P3] 统计卡片标题字号**
  - 实际标题字号小于设计稿。

### 修复建议

1. 增大决策列表行高和时间线节点。
2. 确认设计稿是否需要分页组件。

---

## 14. 历史详情 HistoryDetail

**截图证据**

- 实际：`screenshots/app-history-detail.png`
- 设计稿：`screenshots/design-history-detail.png`

### 问题清单

- **[P2] 标题编号格式不同**
  - 实际："决策记录 #1"。
  - 设计稿："决策记录 #DEC-2024-0718-001"。

- **[P3] 卡片间距略小**

### 修复建议

1. 调整标题编号格式为设计稿样式。
2. 增大卡片间距。

---

## 15. 知识库 KnowledgePage

**截图证据**

- 实际：`screenshots/app-knowledge.png`
- 设计稿：`screenshots/design-knowledge.png`

### 问题清单

- **[P2] 搜索框宽度**
  - 设计稿搜索框贯穿主内容区。
  - 实际搜索框较窄。

- **[P2] 主内容与侧边栏比例**
  - 设计稿主内容占约 2/3，右侧边栏占 1/3。
  - 实际主内容占满全宽，右侧边栏被挤压。

- **[P3] 标签样式**
  - 实际标签为蓝色小按钮，设计稿为灰色 pill。

### 修复建议

1. 调整搜索框宽度。
2. 重新划分主内容与侧边栏比例。
3. 统一标签样式。

---

## 16. 知识详情 KnowledgeDetail

**截图证据**

- 实际：`screenshots/app-knowledge-detail.png`
- 设计稿：`screenshots/design-knowledge-detail.png`

### 问题清单

- **[P3] 顶部标签/面包屑布局**
  - 实际顶部标签横向排列较拥挤。
  - 设计稿顶部为返回按钮 + 标题 + 标签，布局更舒展。

- **[P3] 右侧目录卡片标题**
  - 实际为"本页目录"，设计稿为"目录"。

### 修复建议

1. 调整顶部标题区域布局。
2. 统一右侧目录标题。

---

## 17. 实时监控 MonitorPage

**截图证据**

- 实际：`screenshots/app-monitor.png`
- 设计稿：`screenshots/design-monitor.png`

### 问题清单

- **[P3] KPI 卡片内部布局**
  - 设计稿 KPI 数值在左、标签在右下方。
  - 实际布局略有不同。

- **[P3] 图表与告警列表间距**
  - 实际更紧凑。

### 修复建议

1. 微调 KPI 卡片内部布局。
2. 增大图表与告警列表间距。

---

## 18. 系统日志 LogsPage

**截图证据**

- 实际：`screenshots/app-logs.png`
- 设计稿：`screenshots/design-logs.png`

### 问题清单

- **[P2] 左侧 Sidebar 项目数量**
  - 实际包含"系统日志"、"应用日志"、"安全日志"、"慢日志查询"等 6+ 项。
  - 设计稿 sidebar 项目较少。

- **[P2] 顶部日志级别统计**
  - 实际右上角显示 INFO/WARN/ERROR/DEBUG 数量统计。
  - 设计稿未显示。

- **[P3] 紧凑度

### 修复建议

1. 按设计稿精简左侧 sidebar 项目。
2. 确认是否保留顶部日志级别统计。

---

## 19. 决策详情 DecisionDetail

**截图证据**

- 实际：`screenshots/app-decision-detail.png`
- 设计稿：`screenshots/design-decision-detail.png`

### 问题清单

- **[P2] 命令面板主操作按钮**
  - 设计稿：底部宽大的"采纳执行"蓝色按钮。
  - 实际：按钮在命令面板 header 区域，尺寸较小。

- **[P2] 顶部标签页**
  - 实际有"决策审计"等标签页，设计稿为不同的导航项。

- **[P3] 证据链步骤样式**
  - 实际步骤条更紧凑。

### 修复建议

1. 将"采纳执行"按钮按设计稿移至命令面板底部并加宽。
2. 调整顶部标签/导航样式。

---

## 优先级汇总

| 优先级 | 数量 | 核心问题 |
| --- | --- | --- |
| P1 | 5 | BootPage 多余按钮、Settings 内容不符、TutorialDetail 路由内容错误、SSH 值截断、Settings-Terminal 内容差异 |
| P2 | 32 | 各页面间距/紧凑度、侧边栏样式、卡片布局、按钮样式、标题栏缺失元素 |
| P3 | 24 | 图标替换、颜色微调、字号、标签样式、统计项显示等 |

---

## 附录 A：Electron 启动异常记录

运行 `pnpm dev` 或 `./node_modules/.bin/electron out/main/index.js` 时，主进程在 `initLogger(electron.app.getPath('userData'))` 处报错：

```
TypeError: Cannot read properties of undefined (reading 'getPath')
```

在同一环境下，独立的 `test-electron.cjs` 中 `require('electron')` 可正常获取 `electron.app`。初步判断为 `electron-vite` 构建产物 `out/main/index.js` 在 Electron 主进程中的模块解析异常，可能与打包配置或依赖状态有关。建议重新构建或检查 electron-vite 配置。

---

## 附录 B：截图文件清单

所有截图位于 `scripts/browser-check/screenshots/`：

```
app-boot.png
app-decision-detail.png
app-history.png
app-history-detail.png
app-knowledge.png
app-knowledge-detail.png
app-logs.png
app-monitor.png
app-settings-about.png
app-settings-appearance.png
app-settings-decision.png
app-settings-general.png
app-settings-model.png
app-settings-risk.png
app-settings-ssh.png
app-settings-terminal.png
app-tutorial.png
app-tutorial-detail.png
app-workbench.png

design-boot.png
design-decision-detail.png
design-history.png
design-history-detail.png
design-knowledge.png
design-knowledge-detail.png
design-logs.png
design-monitor.png
design-settings-about.png
design-settings-appearance.png
design-settings-decision.png
design-settings-general.png
design-settings-model.png
design-settings-risk.png
design-settings-ssh.png
design-settings-terminal.png
design-tutorial.png
design-tutorial-detail.png
design-workbench.png
```
