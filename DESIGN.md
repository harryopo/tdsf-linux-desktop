# Design System — TDSF Linux Desktop

基准：**Trae 中等密度**（用户 2026-10-05 选定）。深色为默认主题，浅色主题同样必须实测通过（见 §8）。
唯一令牌源：`src/renderer/src/styles/ui-tokens.css`。除该文件外，任何 .css/.tsx 里都不许出现颜色字面量。
`src/renderer/src/styles/trae-tokens.css` 是旧页面遗留层，重建一块删一块，不许新增引用。

## 1. Color

| 角色 | 令牌 | 深色值 | 用途 |
|---|---|---|---|
| 画布 | `--bg-primary` | `#1e1e1e` | 终端、编辑器、消息流 |
| 面板 | `--bg-secondary` | `#252526` | 侧栏、标题栏、状态栏、文件树 |
| 凹陷 | `--bg-tertiary` | `#2b2d31` | 输入底、进度轨道、代码块底 |
| 浮层 | `--bg-elevated` | `#2d2d2d` | 弹窗、菜单、气泡、composer 工具条 |
| 正文 | `--text-primary` | 见令牌 | 所有正文与控件文字 |
| 标题 | `--text-secondary` | 见令牌 | 面板/弹窗标题、需要压过正文的名称 |
| 说明 | `--text-tertiary` | 见令牌 | 副标题、参数说明；AA 达标线 |
| 弱化 | `--text-muted` | 见令牌 | 时间戳、快捷键片；**不得低于 4.5:1** |
| 主操作 | `--accent-solid` | 见令牌 | 仅用于当前屏唯一主按钮，配 `--text-on-accent` |
| 语义 | `--status-success/warning/error/danger/info` + `-soft` | 见令牌 | 只表达状态，不做装饰 |

规则：
- 强调色只出现在三处：主按钮、当前选中、状态指示。其他位置用中性色。
- 灰字配彩色底、彩色字配半透明同色相底，是 chip/banner 的唯一两种合法组合。
- 状态色文字必须比状态色本身更亮（例：错误底 `--status-error-soft` 上的字要 ≥`#ff8a80` 一档），
  实测过：`--status-error` 直接当 10px 文字用只有 2.16:1。
  2026-10-07 起有静态闸：`tests/unit/ui-tokens.test.ts` 扫到裸 `text-error/warning/success/info`
  落在文字上即红（同一行带 `size-N` 的算图标，按图形 3:1 豁免）。这条是连接对话框的必填星号
  被真机审计量出 3.74:1 之后补的。

## 2. Typography

单一字体族：`--ui-family-ui`（Inter + 微软雅黑 + system-ui 兜底）。代码用 `--ui-family-code`。
**禁止**在组件里写 `font-family` 指向别的族（旧启动页的 `--trae-font-family-heading` 就是反例）。
**界面字体不做成设置项**：外观页那个"界面字体"选择器会把首族换成机器上没装的 SF Pro Text，
真机量到同一屏出现 Inter / -apple-system / JetBrains Mono 三套族，2026-10-06 起删掉，只留代码字体。

字阶（固定 rem 档，不做 clamp；一屏内出现的档位组合数由脚本上限约束）：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--ui-font-micro` | 11px | 最低可读底线：状态点旁注、进度百分比、活动栏标签 |
| `--ui-font-caption` | 12px | 时间戳、参数 label、badge、chip、页头副标题 |
| `--ui-font-sm` | 13px | 说明、摘要、thinking 正文 |
| `--ui-font-md` | 14px | 控件文字、列表项、表格 |
| `--ui-font-body` | 15px | 全应用唯一正文档（消息流、markdown） |
| `--ui-font-composer` | 14px | 输入区 |
| `--ui-font-title` | 17px | 表单弹窗标题、页内小节标题（确认框用 14px，见 §弹窗） |
| `--ui-font-head` | 20px | 模块页头标题（`PageHeader` 专用） |
| `--ui-font-display` | 30px | KPI 大数字 |
| `--ui-font-splash` | 44px | 启动页字标 |

- 行高只用 `--ui-lh-*` 六档（1 / 1.3 / 1.4 / 1.5 / 1.6），且随字档成对给出。
- 字重只用 400 / 500 / 600。强调靠字重和颜色，不靠字号跳档，不用斜体。
- 正文行长 65–75ch；终端与表格允许更密。
- **层级只有一条规则**：模块页头 20/600 > 页内小节 17/600 > 正文 15/400 > 辅助 12–13。
  页内小节标题不得比模块页头大（2026-10-06 真机量到过 20px 小节标题压 17px 页头的倒挂）。

## 3. Spacing / Radius / Elevation

- 间距 4px 步进：`--ui-space-1..8` = 2/4/6/8/12/16/20/24。图标与文字之间 6px，chip 之间 8px。
- 圆角按苹果美学放宽（用户 2026-10-05 要求"圆角多一些"）。**这张表就是刻度**，
  由 `scripts/design/design-contract.mjs` 对回 ui-tokens.css，改数值必须两处一起改：

| 令牌 | 值 | 用在哪 |
|---|---|---|
| `--ui-radius-inline` | 6px | 行内 code、kbd、小徽标 |
| `--ui-radius-control` | 10px | 按钮、输入框、图标钮、chip、菜单项 |
| `--ui-radius-card` | 14px | 卡片、面板内区块、下拉菜单容器 |
| `--ui-radius-panel` | 18px | 弹窗、抽屉、composer |
| `--ui-radius-bubble` | 22px | 消息气泡、超大容器 |
| `--ui-radius-pill` | 999px | 只有真·胶囊（状态点、进度药丸） |

- **嵌套圆角（concentricity）**：内层圆角 = 外层圆角 − 内缩距离。算出来 ≤0 就用直角，
  不要把大圆角往小容器里塞（告警弹窗底栏的通栏按钮就是直角 + 1px 分隔线）。
- 阴影三档 `--shadow-sm/md/lg`（0 1px 2px / 0 8px 24px / 0 24px 56px，透明度 .30/.36/.48），
  且**不与 1px 边框同时**做纯装饰（1px 边 + 大软阴影是模板脸）。浮层靠阴影分层，不靠描边。

## 4. Icons

- 全站一套图标库：`lucide-react`。禁止混用 `@ant-design/icons`、自画 SVG、emoji。
- 渲染尺寸刻度：**12（行内/chip/趋势箭头）、14（控件与表格）、16（菜单与按钮）、18（紧凑行内）、
  20（页头图标盒与活动栏 `--ui-size-glyph`）、24/32/48（空态与品牌）**。
  用 `size={N}` 或 `size-3/3.5/4/4.5/5/6`，不写刻度外的值（10/13/15/22/26 这类已在
  2026-10-05、2026-10-06 两轮清扫并档；`--ui-size-glyph` 曾定 22px，与刻度打架，改 20px）。
  同一屏内出现的档数 **≤3**。
- 图标按钮必须带 `aria-label`；纯装饰图标 `aria-hidden`。

## 5. Components

每个交互组件都要有 7 态：default / hover / focus / active / disabled / loading / error。
- **模块页头只有一个组件：`PageHeader`**（`ui/surface.tsx`）。高 56px（`--ui-size-page-header`）、
  左右 20px、图标走"强调色淡底圆角方块 + 20px 图标"、标题 20/600、副标题 12。
  它必须是页面根的**第一个子节点且通栏**（full-bleed）：塞进带 padding 的容器里就会和别的模块错位。
  正文另起一个 `min-h-0 flex-1 overflow-y-auto` 的滚动容器。
  页面**不许自写 `<h1>`**（`tests/unit/ui-tokens.test.ts` 有静态闸；启动页字标是唯一例外）。
  自动化取标题用稳定钩子 `[data-dom-id="page-title"]`，不要再按页面各自的类名取。
- **工作台三栏的第一条栏同高：`--ui-size-panel-header`（40px）**——左栏资源管理器头、中栏终端标签条、
  右栏 AI 面板头都取这一个令牌。三栏顶边对齐只靠它；任何一栏自己写死 32px/44px 就会错开
  （2026-10-08 用户指出右栏 `h-8` 与另两栏差 8px）。
- **AI 输入框至少三行**：`--ui-size-composer-min`（80px，14px 字号三行）是空态下限，往上长到 `--ui-collapse-max-composer`（240px）为止。
  快捷提示词那一排**不换行**（单行 + 横向滚动）：它一排挤成两行时，输入区就被压成一行高。
- **外壳上下两条横带也走令牌**：`--ui-size-titlebar`（40px）与 `--ui-size-statusbar`（24px）。
  这两个值曾只在令牌文件里写着 44/26，界面上另有硬编码，等于假单源（2026-10-09 核对后按界面真值定）。
- **新增字阶档位要改两处**：`tailwind.css` 的 `@theme` 定义 + `components/trae/utils.ts` 的 `FONT_SIZE_TIERS` 登记。
  漏第二处时 `cn('text-title text-ink')` 会把字号当颜色类吞掉，界面静默退回继承字号，源码看着完全正常
  （`tests/unit/cn-font-size-merge.test.ts` 按效果断言，档位集合直接从 CSS 反查）。

- 加载用骨架，不用内容区中央转圈（首屏与列表）；按钮内加载允许用 spinner + 文案改"提交中…"。
  区域级"转圈 + 一句话"统一用 `Spinner`，不引 antd `Spin`。
- 空态必须教用户下一步（给按钮或一句话），不许只写"暂无数据"。
- 弹窗：`Dialog` + `DialogContent`（radix 包一层），统一底色 `--bg-elevated`、圆角 18px、无边框、靠阴影分层。
  两种 `variant`：
  - `panel`（默认，带表单/详情）：头部左对齐 + 右上关闭钮，底部右对齐动作条。
    宽度按内容分三档：**确认 380px、表单 520px、详情 680px**，均 `min(Npx, 92vw)`。
  - `alert`（确认/告警）：居中标题 + 居中描述，底栏通栏等宽按钮（40px 高、直角、1px 分隔线），
    照 macOS 告警的样子；`confirmDialog()` 走这一档。
    2026-10-10 用户指出"整体太大"后收小：标题 14px 加粗、描述 13px、内边距 `px-6 pt-6 pb-5`、
    按钮 48px→40px、宽度 420px→380px。一句确认话撑不起 17px 的弹窗标题档。
  `panel` 标题 17px、正文 14–15px；`alert` 标题 14px、正文 13px；按钮文字 14px；
  按钮文字与边框之间至少 8px 留白（贴边算缺陷）。
  按钮顺序：取消在左，主操作在右；破坏性操作主按钮用 `danger`，且默认焦点落在"取消"。
- 高危二次确认一律走 `confirmDialog()`，不用 `Modal.confirm`（静态方法依赖 React 19 补丁）。
- 区域内的常驻说明用 `Notice`（`tone` 只有 info/warning/error 三档，配色取 `--notice-*` / `--status-*`）；
  要用户当场做选择用 Dialog/`confirmDialog()`，一闪而过的反馈用 sonner toast。三样各管一段，不许互相顶。
- 侧滑抽屉用 `Sheet` + `SheetContent`（`ui/overlay.tsx`，radix Dialog 包的右侧版式，宽 420px 档）；
  不许再引 antd `Drawer`。标签用 `Chip`（`tone` 只有 neutral/accent/success/warning/error/outline 六档），
  状态用 `StatusDot`（进行中是旋转环，不只靠颜色）。
- 右键菜单走 `ContextMenu`，悬浮提示走 `Tooltip`（`content` 为空即不渲染气泡）。
- 禁用按钮上挂提示时，外包一层 `span`，否则 hover 不触发、"为什么不能点"反而看不到。
- 只读读数不是按钮。状态栏的 SSH/AI/光标/编码/命令块计数这类不会响应点击的格子写 `<span>`，
  写 `<button>` 等于让读屏报出一个按不动的控件、让用户白点一次。反过来，能点的切换钮
  要把当前态标出来（`aria-pressed` + `is-active`）：已经停在终端 tab 时再点"终端面板"
  本就不该有变化，没有按下态就只能被当成假按钮。
- 没有目的地就不放按钮。"查看全部"之类指向不存在视图的按钮直接删（2026-10-07 删掉
  教程页的学习路径按钮，改为把全部路径平铺出来）。输入框为空时的动作钮改成 `disabled`，
  不要按下去静默 return。

## 6. Motion

- 时长三档 `--ui-dur-*` = 150 / 200 / 300ms；绝大多数过渡用 150ms。
- 缓动只用 ease-out 系（`--ui-ease-out`），不做回弹。
- 动效只表达状态：进度、展开收起、进出场。**不做分阶段入场编排**（旧启动页标题 0.3s、
  按钮 3.5s 才浮现就是反例：用户以为卡死）。
- 全部动效配 `@media (prefers-reduced-motion: reduce)` 终态直出。

## 7. Layout

- 外壳：左导航栏 + 中央终端优先工作区 + 右 AI 停靠格，可拖拽；折叠后必须留一条可再展开的边。
- 分栏宽度要记住用户拖出来的值（`tdsf.workbench.layout`，只落在 `isUserInteraction` 的变化上，
  免得挂载和约束重算把真值冲掉）。改外壳后跑真机探针：`node scripts/design/layout-persistence-check.mjs`
  ——它量「拖得动 + 存得住 + 重开还在」三件事。
- 活动栏 64px 宽、单项 52px 高、图标 20px + 11px 文字标签（用户 2026-10-05：原来 38px 纯图标太小）。
  选中态 = 淡底圆角块 + 提亮，不靠左侧亮条。
- 导航保持七个平级入口（用户 2026-10-05 决定：页面全留，只统一视觉）。
- 响应式是结构性的（侧栏收起、面板堆叠），不是流体字号。
- 浮层一律 portal 或用 `position: fixed` 逃出 `overflow: hidden` 容器；下拉被裁切算 bug。

## 8. 硬门禁（脚本可判定，不靠自觉）

`node scripts/design/ui-audit.mjs --gate` 在真机构建产物上量，任一不达标即非零退出：

1. 低对比度文字 **0 处**（正文 <4.5:1、大字 <3:1 都算）。
2. 最小字号 **≥11px**，且 10px 出现 **0 处**。
3. 单屏 (字号/字重/字体族) 组合数 **≤12**；字体族 **≤2**（UI + 代码）。
4. 单屏 SVG 渲染尺寸必须落在 §4 刻度内（>48px 的图表容器除外），FAIL 会打印图标旁边的文字定位。
5. 文字被裁切（`overflow: hidden` 且 scrollWidth/Height 溢出 >3px 且无省略号）**0 处**。
6. 弹窗宽度必须命中 §5 的三档之一。
7. 界面可见文字里 **0 个 emoji**、0 处示例数据字面量（另有 `no-fabricated-data` 与 `verify-no-emoji-on-screen` 两把闸）。
8. **每个模块页的左上角标题必须是 `PageHeader`，且量出来是 20px/600**；外壳工作区页（左上角是标题栏）是唯一豁免。
9. 风险控制页的只读规则表必须真画出引擎规则：**行数 ≥ 主进程快照条数（2026-10-06 实测 7）**、
   无"规则读取失败"错误态、无 `@名单` 这类内部引用名、无「新增规则」按钮。
10. 同一屏内 `data-dom-id` **不许重名**（0 处）。这是 E2E 与审计取元素的唯一稳定入口，
    重名就等于让自动化点到错的那个（2026-10-07 `nav-decision` 同时被左侧导航和设置导航
    占用，Demo 9 步两步一起红）。跨页复用同名不算冲突，所以只能在渲染后的屏幕上判。
11. 按钮真伪普查（`tests/e2e/button-truth-census.spec.ts`，需先 `pnpm build`）：
    逐页真点每个可见按钮，`none`（按了没反应）与 `unclickable`（点不下去）都必须 0，
    且真点出反应的按钮 ≥40 —— 最后这条是量具自证，防止循环空转造成假绿。
12. Demo 主路径 12 步（`tests/e2e/demo-9-steps.spec.ts`）：9 步走界面，S1/S2 连仓库内的
    本地 fixture SSH 靶机（`tests/e2e/ssh-fixture-server.ts`），S3 连本地假模型服务
    （`tests/e2e/ai-fixture-server.ts`）。S1 钉住「主机密钥首次确认 → 写进 known_hosts →
    再连不再问 → 换密钥报 host-key-changed」；S2 钉住「交互式 shell → OSC 133/633 →
    状态栏命令块」；S3 断言流式增量至少到达 2 次（把 fixture 改成一次性回吐，这条必须红——
    已实测会红）。真机与真模型仍由 ssh-live-verification / ai-chat-live-verification 负责。
    三条都把 known_hosts 写到系统临时目录、并用 `--user-data-dir` 隔离 userData，
    不许碰用户真实的 `~/.ssh/known_hosts` 与 `%APPDATA%\tdsf-linux-desktop`。

静态侧的配套闸（`pnpm test`）：`tests/unit/ui-tokens.test.ts` 查字阶/圆角/间距刻度、
查页面自写 `<h1>`、查 `text-[Npx]`；`tests/unit/css-comment-balance.test.ts` 查注释提前闭合；
`scripts/design/count-important.mjs <上限>` 查活跃 `!important` 总量。

## 9. 新建或改一个页面：照这个配方

1. 页面根：`<main className="flex h-full w-full flex-col bg-canvas">`（根不滚动）。
2. 第一个子节点必须是 `<PageHeader icon title subtitle actions />`（通栏，见 §5）。
3. 正文：`<div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4">…</div>`。
4. 文字只用 `text-micro/caption/sm/md/body/composer/title/head/display` 这些档；
   颜色只用 `ink / ink-dim / ink-mute / line / bg-* / accent-* / status-*` 语义类。
   **不写内联 `style={{ color/fontSize }}`**（§12 的刻度会涨）。
5. 弹层只用 `Dialog`+`DialogContent`（`panel` 带表单、`alert` 做确认）；
   高危确认只用 `confirmDialog()`；菜单用 `Menu`/`ContextMenu`；
   悬浮提示用 `Tooltip`（`content` 传空即不渲染）；轻提示用 `sonner` 的 `toast`。
6. 三态必须齐：空态（`Empty`，给下一步动作）、加载（`Spinner` 或骨架）、错误（说清怎么办）。
7. 数字与列表只来自 IPC。没有链路就显示"—"并说明为什么，**不许造示例数据**。
8. 设置区加一节：只在 `pages/settings-sections.ts` 登记（左栏、目录页、子页标题三处都从它读），
   再在 `router.tsx` 的 SettingsLayout 嵌套里挂子路由；子页标题写 `<SettingsPageHeader {...settingsHeader('/settings/xxx')} />`，
   不要在页面里自己拼图标/标题/说明（`tests/components/settings-nav-ownership.test.ts` 会双向对账）。
9. 加一个能写进 config 的设置：必须同时在 `scripts/design/settings-keys-audit.mjs` 的 `WIRED` 里
   登记"谁按这个键取值"。接不上消费者就别加控件——`pnpm test` 里的设置键登记闸会拦新增未登记的键，
   欠账清单 `FAKE` 上限已是 **0**（2026-10-06 清零：35 个键全部有消费者），再加一个"拨了没反应"的开关直接红。
10. 提交前自己跑三件事：`node scripts/design/design-contract.mjs`、
   `pnpm build && node scripts/design/ui-audit.mjs --gate`、`pnpm test`。
11. 改完样式再看一眼视觉基线：`pnpm test:e2e:visual`（本机尺子，零宽容，基线不入库）。
    这条确实拦得住东西：实测互换两页基线就红。有意改版就带 `--update-snapshots` 重新生成，
    别把宽容比调大——这些页面彼此整体只差 3%~9%，阈值超过 0.03 就等于没有闸。

## 10. 界面文案准则（"过时字眼"就靠这几条拦）

- 词必须对得上界面上真存在的东西：分区名、按钮名、菜单项名。写了"左侧那格"就必须有那一格。
- 不写没实现的能力。开关/按钮要么真改状态，要么整行删掉（历史上"AI 检索"假开关、
  "强调色"设置项都是这么来的）。
- 安全判定不在界面上开放编辑：拦截规则、审批要求来自随包分发的数据文件，界面只展示引擎实际生效的那份
  （`risk:rules`）。能在设置里删掉 rm -rf 拦截项的「安全设置」不是安全设置；
  反过来，也不许放一个改了不生效的「防护等级/审批模式」骗人（2026-10-06 已删）。
- 状态用统一说法：进行中"××中…"、完成"就绪"、失败"没连上/没配好 + 下一步"。
  进度文案只来自后端 stage 事件，前端不许自己编节奏。
- 不出现内部黑话：阶段号、Task 编号、设计稿文件名、`v2.x` 版本号、"P1 修复"这类
  只对我们有意义的词，一律不进界面文字。
- 模型名/供应商名从数据里取，不写死在组件里；没配 Key 就说"未配置 API Key"并给入口。
- 破坏性操作：说清后果 + 是否可撤销（"此操作不可撤销"），不吓唬也不含糊。

## 11. 禁止清单（都有闸，不靠自觉）

| 禁止 | 由谁拦 |
|---|---|
| 页面自写 `<h1>`/标题栏 | `design-contract.mjs` + `ui-tokens.test.ts` + `ui-audit --gate` 第 8 条 |
| `text-[Npx]` 绕过字阶 | `ui-tokens.test.ts` |
| 内联 `style` 写 color/fontSize/background | `design-contract.mjs` 刻度（只降不升） |
| 新增引用旧 `--trae-*` 令牌 | `design-contract.mjs` 刻度（只降不升） |
| 再引 antd（含 `@ant-design/icons`） | `exit-antd-dialog.test.ts`：渲染层引 antd 的文件数上限已是 **0**，图标也只许 lucide |
| 裸状态色（`text-error` 等）当文字用 | `ui-tokens.test.ts`（图标行按 `size-N` 豁免，图形只要求 3:1） |
| 界面文字里出现 emoji | `verify-no-emoji-on-screen.mjs` |
| 示例/假数据字面量 | `no-fabricated-data` 闸 |
| 新增 `!important` | `count-important.mjs <上限>` + `important-budget.test.ts`（2026-10-07 antd 退出后实测 33） |
| e2e 里点 antd 时代的选择器 | `e2e-selector-freshness.test.ts`（2026-10-07 清零后升级为 **0 容忍**：改版前选择器取不到元素，serial 模式下会把后面的用例悄悄标成"未运行"，等于死代码装覆盖） |
| 按了没反应的 `<button>` | `no-dead-button.test.ts`（静态，0 容忍）+ `button-truth-census.spec.ts`（真机逐个点，`none` 必须为 0） |
| 死 CSS 类名 | `dead-css-classes.cjs` |
| 文档与令牌数字漂移 | `design-contract.mjs`（含负向对照测试） |

**收紧刻度的规矩**：每退一批债，把 `design-contract.mjs` 里对应 `cap` 改小并写上日期；
只许降不许升。升上限必须在评审里说清为什么。

## 12. 苹果美学的依据（2026-10-06 调研）

Apple 官方不发 agent skill，采纳的是社区对 HIG 的量化转述。**先查授权载体再搬**：
以下 4 个仓库是 MIT/Apache，其余（Ksanbal、OPN48、tzzs、ykswang、d-date、doppe7gangar）
无 LICENSE 或 NOASSERTION，**不搬代码**，只按公开事实自研。

| 仓库 | 许可 | 采纳了什么 |
|---|---|---|
| `CarlosZiegler/apple-hig-skills` | MIT | 21 个 HIG 主题的分区方式（foundations/components/patterns） |
| `ebuntario/apple-hig` | MIT | materials/layout 的写法；`regularMaterial` + 圆角容器 demo |
| `allexp1/apple-hig` | MIT | Liquid Glass 的"玻璃只用于浮层 chrome，不用于内容层"这条边界 |
| `noumanzindani/mobile-app-uiux-pro-max-skill` | Apache-2.0 | 用脚本校验设计规则的思路（我们的 `ui-audit --gate` 同型） |

落到本项目的具体数值（都有出处，不凭感觉）：
- 最小字号 11px、行高 ≥1.3×、大字（≥18px 或 ≥14px 粗体）对比度 3:1、其余 4.5:1 → §2、§8。
- 8pt 栅格 → `--ui-space-*` 全部 4 的倍数。
- 嵌套圆角同心（concentricity）→ §3。
- 触控目标 44pt 是触屏标准；桌面控件按 macOS 习惯仍用 24/28/32 三档，
  但**可点区域**（活动栏项、页头按钮）不小于 32px。
- 苹果是"平面的"：分层靠透明度 + 模糊 + 阴影，不靠描边堆（弹窗已去边框）。
- 强调色克制：只用在主操作与状态，不铺色板（活动栏选中态是淡底，不是色块）。
