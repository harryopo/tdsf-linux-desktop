# 视觉审查报告

## 启动页 BootPage

### 总体评价
启动页整体实现了纯黑背景 + Three.js shader 流光效果，标题、进度条、进入按钮三大元素均已呈现，动画时序（标题 0.3s 淡入、进度条 0.5s 延迟、按钮 3.5s 浮现）与设计稿一致。但**元素垂直排列顺序与设计稿相反**，且标题视觉居中补偿、按钮内边距、进度条间距存在可量化的偏差，需要在 1:1 复刻阶段修正。

### 问题清单

- [P1] **元素垂直顺序错误** | 设计稿：标题 → 进入工作台按钮 → 进度条 | 当前实现：标题 → 进度条 → 进入工作台按钮 | 修复建议：调整 `BootPage.tsx` 中三个元素的 JSX 顺序，将进度条移至按钮下方，与设计稿 DOM 结构保持一致。

- [P2] **标题 `text-indent` 补偿值不一致** | 设计稿：`text-indent: 0.18em` | 当前实现：`text-indent: -0.09em` | 修复建议：按设计稿使用 `text-indent: 0.18em`，并移除外层用于视觉居中的 `flex w-full justify-center` 包裹容器，避免双重补偿导致位置偏移。

- [P2] **"进入工作台"按钮水平内边距过宽** | 设计稿：`padding: 12px 28px` | 当前实现：`px-8 py-3.5`（约 32px × 14px）| 修复建议：将左右内边距改为 `px-7`（28px）或直接使用 `py-3 px-7`，确保按钮宽度与设计稿一致。

- [P2] **进度条上边距过大** | 设计稿：`margin-top: 32px` | 当前实现：`mt-12`（48px）| 修复建议：将进度条容器改为 `mt-8`（32px），恢复设计稿的紧凑节奏。

- [P3] **按钮 hover 发光强度略强** | 设计稿：`box-shadow: 0 0 28px rgba(56,123,255,0.4)` | 当前实现：`box-shadow: 0 0 32px ...45%` | 修复建议：将 hover 发光半径从 32px/45% 调整为 28px/40%，严格对齐设计稿参数。

- [P3] **标题阴影色使用混合模式而非固定色** | 设计稿：`text-shadow: 0 0 40px rgba(56,123,255,0.35), 0 0 12px rgba(0,0,0,0.6)` | 当前实现：使用 `color-mix(in srgb, var(--trae-bg-brand) 35%, transparent)` | 修复建议：虽然效果接近，但为 1:1 复刻，建议直接采用设计稿的固定 rgba 值，避免不同主题下产生色差。

---

## 工作台 WorkbenchPage

### 总体评价
工作台已按 5 栏布局（Titlebar / ActivityRail / FileTree / EditorArea / AIPanel）正确搭建，尺寸骨架（40px / 48px / 200px / flex-1 / 560px）与设计稿一致，主要交互按钮均已挂载 `onClick`。但局部仍存在间距、行高、图标、内边距等细节偏差，尤其是 **FileTree 节点行高**、**Composer 内边距**、**ActivityRail 图标系统** 需要重点修正。

### 问题清单

#### 1. 顶部标题栏

- [P3] **右侧"终端面板"按钮图标与设计稿不符** | 设计稿：使用 `layout.svg`（终端/布局图标）| 当前实现：使用 `LayoutGrid`（Lucide 网格布局图标）| 修复建议：替换为设计稿指定的 `layout.svg` 自定义图标，或从设计稿 assets 中引入对应 SVG。

#### 2. ActivityRail 左侧导航

- [P2] **导航图标未使用设计稿自定义图标** | 设计稿：home / scroll-text / shield / dashboard / layers / clock / file-text / settings（均为 `dl_builtin_trae` 自定义 SVG）| 当前实现：使用 Lucide 的 Home / BookOpen / Shield / Activity / Layers / Clock / FileText / Settings | 修复建议：从 `tdsf-linux-redesign/assets/icons/dl_builtin_trae/` 引入设计稿图标，保持 1:1 视觉。

- [P3] **激活态指示条位置存在 1px 偏差风险** | 设计稿：`left: -8px; width: 3px; height: 20px` | 当前实现：`-left-2`（-8px）、`w-[3px]`、`h-5`（20px）| 修复建议：当前值已接近设计稿，但 `left-2` 在 Tailwind 中实际为 `-0.5rem`（-8px），需确认与 border 叠加后的真实位置；若截图中指示条未紧贴导航栏左边缘，则改为 `left-[-9px]` 或 `translateX(-1px)`。

#### 3. 文件树 FileTree

- [P2] **节点行高不一致** | 设计稿：`.ft-row { height: 24px }` | 当前实现：`h-[26px]` | 修复建议：将节点行高统一改为 `h-6`（24px），减小文件树整体高度，避免截图中略显拥挤。

- [P2] **节点水平内边距不一致** | 设计稿：`padding: 0 6px` | 当前实现：`pr-2`（8px）+ 动态 `paddingLeft` | 修复建议：右侧 padding 改为 `pr-1.5`（6px），保持与设计稿一致的 6px 水平内边距。

- [P3] **服务器图标未使用设计稿自定义 SVG** | 设计稿：自定义服务器 SVG（双矩形 + 圆点）| 当前实现：Lucide `Server` 图标 | 修复建议：引入设计稿中的服务器 SVG，保持图标风格一致。

- [P3] **分组标签上下间距略大** | 设计稿：`padding: 6px 8px 2px` | 当前实现：`px-2 pb-0.5 pt-1.5`（约 6px 2px 6px）| 修复建议：将 `pt-1.5` 改为 `pt-1` 或直接使用 `py-0.5 px-2 pb-0.5`，使分组标签更贴近设计稿。

#### 4. 编辑器 / 终端区域

- [P2] **终端区域上内边距不一致** | 设计稿：`padding: 8px 12px` | 当前实现：`px-3 py-2`（12px 8px）| 修复建议：确认当前终端区域是否使用 `px-3 py-2`，若设计稿为 8px/12px，则保持 `py-2 px-3` 实际与设计稿一致（Tailwind `py-2` = 8px，`px-3` = 12px）。**此项可能已一致，需复核截图中首行文字到顶部边距。**

- [P3] **终端选中文本翻译浮层未实现** | 设计稿：包含 `term-sel-popup`（翻译 / 添加到 AI 对话）| 当前实现：未在截图/代码中看到对应浮层 | 修复建议：后续功能迭代中补全该交互组件，当前视觉审查暂不做硬性要求。

#### 5. AI 面板 AIPanel

- [P2] **标题栏中间 Token 曲线触发按钮位置/样式差异** | 设计稿：Token 曲线按钮位于标题栏中间区域，紧邻模型选择器，整体为一个可点击的统计区域 | 当前实现：仅有一个独立的 `BarChart3` 图标按钮，缺少设计稿中模型选择器、思考强度标签等横向组合 | 修复建议：按设计稿复刻标题栏中间区域：模型选择器 + 思考强度标签 + Token 曲线触发器，保持横向紧凑排列。

- [P2] **工具面板行内边距/圆角不一致** | 设计稿：`.ai-tool-row { height: 28px; padding: 0 8px; border-radius: 6px }` | 当前实现：`h-7 px-2 rounded-[var(--trae-radius-6)]`（高度 28px、padding 8px、圆角 6px）| 修复建议：数值上一致，但需检查 `px-2` 是否严格等于 8px；同时当前核心面板（command/progress 等）未使用 `ai-tool-row` 样式，而是独立渲染，需确认视觉是否一致。

- [P2] **核心命令面板上边距略大** | 设计稿：`margin: 4px 0; padding: 8px` | 当前实现：`my-1 p-2`（4px 8px）| 修复建议：当前值与设计稿一致，但截图中命令面板与上下元素间距显得略大，建议复核 `my-1` 是否被其他父级 gap 叠加；必要时改为 `my-1` 并移除父级额外 margin。

- [P3] **"执行/沙箱预演/回滚"按钮组间距略紧** | 设计稿：`gap: 4px` | 当前实现：`gap-1`（4px）| 修复建议：数值一致，但当前按钮高度 `h-6` 与设计稿 `height: 24px` 一致，视觉上若仍显拥挤，可复核是否因字体渲染导致按钮宽度差异。

- [P2] **Composer 输入框内边距不一致** | 设计稿：`padding: 8px 10px` | 当前实现：`px-2.5 py-2`（10px 8px）| 修复建议：将 Composer 容器内边距改为 `px-2.5 py-2` 当前值实际与设计稿接近，但需统一方向：设计稿为上下 8px / 左右 10px，当前已符合，**需复核截图中输入框是否显得过矮或过宽**。

- [P3] **Composer Agent badge 水平内边距略小** | 设计稿：`padding: 0 6px` | 当前实现：`px-1.5`（6px）| 修复建议：数值一致，若截图中 badge 左右留白不足，可检查字体渲染或改为 `px-2`。

- [P3] **Token 预算行进度条容器样式** | 设计稿：使用 `.mini-bar-track { height: 4px; background: var(--bg-overlay-l3); border-radius: 9999px }` | 当前实现：`h-1 max-w-[120px] flex-1 rounded-full bg-[var(--trae-bg-overlay-l3)]` | 修复建议：`h-1` = 4px 一致，但设计稿未限制 `max-width: 120px`，当前限制最大宽度会导致在大尺寸窗口下预算条偏短；建议移除 `max-w-[120px]` 或按设计稿使用固定比例。

#### 6. 全局/跨组件

- [P2] **图标系统未统一为设计稿自定义 SVG** | 设计稿：大量使用 `../assets/icons/dl_builtin_trae/*.svg` 的 `mask-image` 方案 | 当前实现：大量使用 Lucide 图标 | 修复建议：建立图标映射表，将设计稿中的关键图标（home、scroll-text、shield、dashboard、layers、clock、file-text、settings、layout、terminal、copy、play 等）替换为对应 SVG，确保 1:1 视觉。

- [P3] **部分文字颜色通过 CSS 变量混合而非固定 token** | 设计稿：直接给出 `--text-default`、`--text-secondary` 等 token | 当前实现：基本使用对应 `--trae-*` token，但部分元素（如按钮 hover 背景）使用 `color-mix` | 修复建议：保持当前 token 体系，仅对关键视觉差异项（如启动页按钮发光）按设计稿固定值微调。

- [P3] **滚动条样式未对齐** | 设计稿：未显式定义滚动条，但 `no-scrollbar` 类会隐藏滚动条 | 当前实现：各滚动区域可能使用浏览器默认滚动条 | 修复建议：在需要隐藏滚动条的区域（如启动页、ActivityRail）统一添加 `no-scrollbar` 样式，确保视觉干净。

---

## 优先级汇总

| 优先级 | 数量 | 核心问题 |
| --- | --- | --- |
| P1 | 1 | 启动页元素垂直顺序错误 |
| P2 | 13 | 标题 text-indent、按钮内边距、进度条间距、FileTree 行高、AI 面板标题栏、图标系统、Composer 内边距等 |
| P3 | 12 | 阴影强度、图标自定义、滚动条、Token 预算条最大宽度等细节优化 |

## 修复建议总览

1. **启动页优先修复顺序**：调整 DOM 顺序 → 修正 `text-indent` → 调整按钮 padding / 进度条 margin。
2. **工作台优先修复顺序**：统一图标系统（自定义 SVG）→ 调整 FileTree 节点行高与 padding → 复刻 AI 面板标题栏中间区域 → 微调 Composer 与命令面板间距。
3. **验收标准**：以设计稿 HTML 在浏览器中的渲染图为基准，对启动页和工作台分别进行像素级 overlay 对比，确保关键元素（标题、按钮、进度条、导航、文件树、AI 工具面板）位置偏差 ≤ 2px。
