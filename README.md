# TDSF-Linux Desktop

> 连上服务器敢敲下一条命令 —— SSH 终端 + AI 辅助 + 高危命令拦截 + 决策可信度透明化的桌面工具。

[![MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-43.8.3-47848F.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19.3-61dafb.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg)](https://www.typescriptlang.org/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

在线预览：<https://harryopo.github.io/tdsf-linux-desktop/>

---

## 它解决什么

Linux 新手第一次连上服务器，最怕的不是看不懂报错，是**不知道这条命令敲下去会怎样**。
`rm -rf` 和 `df -h` 看起来一样长。

这个工具在三个地方拦一道：

1. **执行前**——命令先过风险闸，高危的直接挡下来，说清楚挡的是什么、会坏在哪、怎么回滚。
2. **执行时**——AI 在旁边解释，但它的每句话都带一个可信度分数和分数怎么来的。
3. **执行后**——所有决策进历史，能翻回去看当初为什么放行。

## 界面

![工作台：左终端右 AI 面板](docs/assets/shot-workbench.png)

*左：SSH 终端（命令-输出按块切分）；右：AI 面板，工具调用逐条成卡。*

![知识库](docs/assets/shot-knowledge.png)

*命令知识库：词条 + 事件沉淀 + 每条的综合置信度。*

暗色/浅色两套主题都是可用的（浅色由 `ui-audit` 逐元素量过对比度，不是"能看"）。

## 功能

### 命令风险闸

不是关键字黑名单那种一查就绕过的东西。判定分三层：

| 层 | 数量 | 例子 |
|---|---|---|
| 结构性拦截器 | 8 | fork 炸弹、`rm -rf /`、`dd` 写块设备、重定向覆写磁盘、根级 `chmod/chown` |
| argv 规则 | 7 | 按参数结构判，`find / -delete` 和 `find . -name x -delete` 不是一回事 |
| 命令规则词表项 | 244 | 受保护根级路径 15、只读命令 38（+58 扩展）、拒绝动词 62、前缀跳过 3 |

上表「数量」那一列的每个数都由 `npm run promo:check` 现场算并比对（分项由同一条命令打印），
所以正文里不再重复写数——2026-10-19 那次就是 README 与宣传页各抄一份、同时过期没人发现。

结构性拦截器**故意不放进数据文件**——它们靠正则和参数结构判断，写成可配数据只会让人误以为能把级别往下调。
判据的实测口径写在 [CODING.md](CODING.md) 与 `tests/unit/` 里那批命令闸用例。

### AI 辅助

- 多 Provider：类别数见下表「Provider 类型」（按 `provider-factory.ts` 的 switch 分支现数）——
  `anthropic` / `google` / `deepseek` / `qwen` / `volcengine-ark` / `openai-compatible`。
  智谱、Moonshot 这类走 `openai-compatible` 模板，不是独立分支。
  内置模板只列各家**现役**型号（8 家各 ≤2 档 + 一个自定义槽），**没有本地模型候选**——
  Ollama 那条已按用户口径整条撤掉，本地服务仍可通过「OpenAI 兼容 (自定义)」填 baseURL 接。
- 流式：增量合并、思考链占位、迟到事件不丢、可中途停止（停止和失败分开报，不混成一个红条）。
  停止的那一轮在消息底部标成「已停止」。用量按实测入账：能拿到就记，
  拿不到（点停止时 SDK 那三个 promise 一律 reject）就明说「未拿到账」，
  绝不写一串 0 冒充"这一轮一个 token 没烧"。
- 上下文窗口按各家真实上限算，超了如实截断并标注，不假装塞得下。
- **一问一答的账**：普通问题只打 1 次模型（真窗口量过：`tests/e2e/ai-request-budget.spec.ts` 断言请求数 ≤ 2 且带 `max_tokens`）；
  带工具时是 ReAct 循环，最多 12 步、每步重发历史（这是能力本身的成本，不是泄漏）。压缩摘要与记忆抽取各有 800 tokens 上限，
  且摘要按提示词内容去重——同一段旧对话不会每轮重复计费。
- MCP 工具接入（`@modelcontextprotocol/sdk`），工具执行在前端逐条成卡。
- 所有网络请求界面可见——不给"静默把终端内容传走"留口子。

### 决策可信度

每个 AI 判断都拆成多源证据，在雷达图上画出各源权重与融合结果。融合源共 7 个，
以 `src/shared/credibility.ts` 的 `FUSION_SOURCE_IDS` 为准：日志、观测、知识库、AI 参数、人工、历史、最佳实践。
**分数低就明说分数低**，不包装成"仅供参考"。

各源先验先按 `decision.weights`（决策设置页可调）做一次 Shafer 折扣，再进 D-S 合成：
两两冲突低于 0.3 走 Dempster，高于就换 PCR5 重分配。实现在 `src/main/core/agent/credibility/`，
界面（`credibility:assess`）与 MCP 工具走的是同一条引擎，没有第二套简化算法。

### 终端与文件

- `ssh2` + `@xterm/xterm`；命令-输出块由 OSC 133/633 序列切分，切分逻辑是纯函数、可单测。
- 远端 shell 集成逐台确认后写入，随时可撤（撤完 rc 文件字节回到原样）。
- SFTP 文件树 + Monaco 编辑器，双击编辑、Ctrl+S 同步回远端。
- 本机终端走 node-pty，在主进程 require（`services/terminal/local-pty.ts`），不额外起子进程。

### 知识库

2236 条（`src/renderer/src/assets/dict/linux-commands-zh.json` 的 entries 计数）。
条目由三个来源合并而成（`jaywcjlove/linux-command` MIT、`tldr-pages` CC BY 4.0、人工标注），
**但条目里没有保留来源字段**，所以分项数只能按导入批次记账，加起来不等于 2236。
条目上有两个经验计数：`useCount` 由打开详情页真自增，界面上"7 次阅读"就是它。
`successRate` 这一列还在库里，但 2026-10-29 起它再没有写入方（"有帮助/没帮助"反馈模块整删），
所以列表徽章、详情页"匹配 X%"、侧栏置信度环与聊天摘要里那句"成功率 X%"一起撤下——
拿着出厂常量演实测读数，比不报更糟。

## 快速开始

```bash
git clone https://github.com/harryopo/tdsf-linux-desktop.git
cd tdsf-linux-desktop
pnpm install
pnpm dev
```

需要 Node.js 与 pnpm：CI 在 **Node 22** 上跑（`.github/workflows/ci.yml`），本机开发用的是 Node 24 + pnpm 11。
`package.json` **没有 `engines` 字段**，所以这些是"验证过的版本"，不是强制门槛。
模型 API Key 在 设置 → 模型配置 里填，不填也能跑（AI 走可见的失败态，不白屏）。

打包：`pnpm build:win` / `build:mac` / `build:linux`（electron-builder 26）。

## 质量与验证

页面里每个数字都带一条能复现它的命令——不写"约""等"，也不写没有出处的统计。
下表测量时间 **2026-10-29 18:29**：端到端读数出自 18:20–18:26 那轮全量（`npx playwright test`，rc=0，
103 通过 / 16 跳过，5.3 分钟，JSON 报告里 `unexpected=0`、`flaky=0`；16 条按环境跳过 = 3 条要真模型 Key
+ 2 条要一个比 `out/` 新的发布包 + 11 条要一台常备的真 SSH 靶机——本轮没给 `TDSF_REAL_SSHD_*`，那一组整组跳过）；
单元与组件读数出自 18:29 那轮全量（rc=0，3709 通过 / 19 跳过，363 个测试文件）。
**这一轮同一套端到端在前两次跑时有两条红**（`button-truth-census` 报 94 个"点了没反应"、`demo-9-steps` Step 5 撞 30 秒测试超时），
两次单跑都是绿的；顺着 #154 那条线查下去找到的不是负载，是判据自己过时了：工作台改成常驻挂载后
「离开工作台 = 工作台从 DOM 消失」不再成立，普查于是拿整个外壳当就绪信号、在上一页还画着的时候抓按钮。
两处都按"就绪信号换成那一页自己的根"修掉（普查那页的 `ready` 逐页改准、Step 5 改判 hash），
修完连着两轮全量都是 103 通过 / 0 红（17:19–17:25 与 18:20–18:26，中间那轮之后又按 #276 改了知识库三处读数并重出 knowledge 基线）。**这不等于 #154 结案**：那两条对同机并发仍然敏感（本轮前两次就是我在旁边跑构建与单测时红的），
判据里 `loadAvgStart/loadAvgEnd/slowReactions/maxWaitedMs` 四个读数留着，红时先分清是负载还是按钮真死了。
**昨天这里记的"两条没归因的间歇红"，今天判清其中一条根本不是间歇**：`mcp-external-settings` 那条判据拿 `agentChat`
的返回值当回答正文比字符串，而那把键按契约回的是会话号（`chat_<毫秒>_<uuid>`）——带不带某个数字全看那一刻的时间戳，
于是它一直在掷骰子（压负载重跑 8 次红 5 次，红时读到的值就是那个会话号）。同一次调查又抓到第二条恒假：拿整份请求体比
"没有被批准"这句话，而系统提示词会注入长期记忆、上一轮沉淀的《错误教训》里就带着那句（实测第一条请求命中 61 处）。
两条都按"取数面挪到真正那一层"修掉：对话判据改接触收 chunk/done/error 三个推送、只认本次会话号；假模型夹具只按角色给原文。
反证跑过——故意让会话号匹配失败，当场红在"界面上没收到回答正文"。顺着同一条线索把另一条也办了（#247）：
`chat-history-persistence` 原判据是"库里至少两行 + 取第一条助手行比全文"，而**这一档是跨次运行累积的**，
两个条件都可能由上一次运行留下的行满足——所以那句"半截"读的很可能根本不是本轮那一行。现在改成按 id 记基线、
只等**本轮新出现的那一行**，并把库里的实际字节、长度与 id 连同屏上文本写进失败消息（红了当场能分清"没落库"与"落成了半截"）。
改完压负载重跑 8 次全绿，所以"本轮落库到底会不会写成半截"这一问题仍未复现、也没被放宽；逐条取证见
[docs/功能实景清单.md](docs/功能实景清单.md) 第六节与 [docs/长期优化目标.md](docs/长期优化目标.md)。
这一轮开头还有一次端到端被 e2e 自己的新鲜度门拒绝起跑（`out/` 比 `src/` 旧，"跑的是改版前的包，结论不可信"），
重出包后才是下面这轮——同一个门当天上午 10:09 与中午 12:00 各拦过一次。
另一类读数不在上表：**真机端到端**（要本机 WSL 起真 OpenSSH 靶子）——`tests/e2e/ssh-real-target.spec.ts`（3 条）、
`ssh-real-jump.spec.ts`（3 条，两跳各自校验主机密钥）、`ssh-shell-integration.spec.ts`（2 条，真机上的 OSC 133/633 命令块）、
`workbench-file-search-real.spec.ts`（3 条，含 Ctrl+S 真 SFTP 保存、只读挡下与符号链接删除拒绝），
在给了 `TDSF_REAL_SSHD_*` 之后都真跑过、全绿；其中「Ctrl+S 把编辑器里的改动写回真机」这条
当场抓出一个"保存写回旧正文、用户的改动静默消失"的缺陷（#233），修完由红转绿；
2026-10-26 又在这条用例里补了只读往返（#235），并在改过 SFTP 写闸后复跑通过（#237）；
远程搜索的命令加了 `--`（#240）之后，真机上的内容搜索与这条保存用例也复跑通过；
「删除符号链接目录必须被拒」（#241）在真机上证明链接目标原样保留、普通目录照常能删。
**#242 拿同一台靶子把 #240 的结论重量了一遍，量出它只对了一半**：`find` 不认 `--`——
`find -- '-delete' -type f` 和不带的写法结果一样，起点退化成当前目录、`-delete` 把目录删空（实测只剩 `.` `..`），
所以 find 那半边当时等于没修，现在改成"路径必须绝对"的形状闸；
同一轮把认 `--` 的那族也量实了：`tail -n 2 '-f'` 挂死 5 秒被 timeout 杀而带 `--` 的 50ms 正常回内容、
`grep -r -n -E '-f/etc/passwd' 目录` 静默零命中（把 /etc/passwd 读成了模式文件）而带 `--` 的命中那行、
`rm -rf '-x'` 报 invalid option 什么也没删而带 `--` 的删掉了文件名就叫 `-x` 的文件（顺带把 #241 那句 `rm -rf --` 量实）、
`du -sh "-s"` 报的是**当前目录**的大小（静默错数据）。
默认轮（不给 `TDSF_REAL_SSHD_*`）里这 11 条按环境跳过；上表那一轮给了，所以它们真跑了。
**"单元与组件"那条读数以前在这里留过一个洞**：10:09 与 10:16 各跑了一遍全量，两轮各红一条、且红的不是同一条，
都是"起子进程跑真脚本"那种判据在并行下撞 20 秒超时（把这两个文件单独跑，全绿）。2026-10-25 已按 #221 处置：
那 14 个文件各带一条 60 秒的显式超时（全局 20 秒不动，抬它等于对真挂死也放宽），并由
`node scripts/quality/subprocess-test-timeout.cjs --check` 常驻盯着——名单是现扫出来的，不靠手抄，
同脚本还有一条 `--self-test`：扫不到东西时不许报绿。
三轮里最慢那一轮的墙钟 148.65s 是第一轮的 3.5 倍，这个数留在这里当"共享机器上会慢到什么程度"的读数，
而不是当已修好：同一族的界面普查间歇红（板上 #154）仍未结案。完整口径见 [docs/长期优化目标.md](docs/长期优化目标.md)。
结构类读数（通道、契约、源文件、词表）由 `npm run promo:check` 在对账那一刻现场数。

| 读数 | 值 | 怎么量的 |
|---|---|---|
| 单元与组件用例 | 3709 通过 / 19 跳过 | `npm test`（363 个测试文件，0 失败；那 19 条按环境跳过） |
| 端到端用例 | 103 通过 / 16 跳过 | `npx playwright test`（直驱真实应用窗口；这一轮没起本机真靶子，16 条按环境跳过 = 3 条要真模型 Key、2 条要一个比 `out/` 新的发布包、11 条要一台真 OpenSSH 靶机——那 11 条在 2026-10-27 那轮给了 `TDSF_REAL_SSHD_*` 时真跑过） |
| IPC 通道 | 163 | `npm run audit:ipc`（145 请求-响应 + 18 事件推送） |
| 已登记契约的通道 | 60 | `src/shared/ipc-contract.ts`（55 invoke + 5 event） |
| TypeScript / TSX 源文件 | 464 | `git ls-files src` 里 `.ts/.tsx` 计数 |
| Provider 类型 | 6 | `provider-factory.ts` 的 switch 分支数，`npm run promo:check` 现场算 |
| 命令规则词表项 | 244 | `npm run promo:check` 现场算 |

门禁链（每一道都是能跑红的闸，不是提醒）：

```
lint · typecheck · tests 类型检查 · vitest · knip 死代码 ·
design:gate · ipc:check · gates:ci · build · playwright ·
身份闸（含阳性对照）· 凭据形状闸 · 架构图读数对账
```

`gates:ci` 收的是**只在 CI 直跑的那四把**（脚本语法下限、scratch 卫生自检、文档链接自检、架构图读数对账）。
以前它们只在 workflow 里，本地那串"门禁全绿"根本碰不到，于是 2026-10-25 出现过"本地全绿、远端连红三轮"；
常驻判据 `tests/unit/ci-gate-parity.test.ts` 钉住这个方向——workflow 里每一条 `node scripts/...`
都必须能从 package.json 的某个脚本里叫动，叫不动就红。

`ui-audit --gate` 的真命令是 `node scripts/design/ui-audit.mjs --gate`（它不是 npm script），要在那台真的开着窗口的机器上跑。
反方向仍有几把只在本地、CI 里没有对应 job，各自的原因不一样：`security:history`（CI 是浅克隆，没有历史可扫）、
`security:topology`（锚定的内网值不进 CI）、`ui-audit --gate`（要真窗口）、`promo:check` 全量面（宣传页在仓库外的兄弟目录）。
`security:identity` 两边都跑，但**CI 上只有通用形状规则**——具体身份值清单是本机文件，
真实姓名那一层只有本机与提交钩子管得到。完整口径写进 [CLAUDE.md](CLAUDE.md) 的门禁清单，
别把"有这道闸"当成"CI 会拦"。

安全侧常驻闸：`secret-gate`（凭据形状，扫跟踪集与暂存区）、
`topology-gate`（内网拓扑值，按值 + 按 /24 网段）、`history-env-scan`（全历史按值回归，pre-push 跑）、
`doc-links`（文档断链）。每条都配了阳性对照——报 0 命中之前先证明这把尺子扫得到东西。

## 架构

![TDSF-Linux Desktop 三进程架构：渲染层经预加载桥接调用主进程，主进程再连 SSH 服务器、LLM 端点、Python 侧车与 Langfuse](docs/assets/architecture.svg)

图由 `scripts/docs/arch-diagram.py` 生成（`python scripts/docs/arch-diagram.py` 重出，别手改 SVG）。
图上那几个数与仓库实测由 `promo-readout` 对账，漂了单测就红。

```
主进程  src/main/       Node.js：ssh2 / LLM / SQLite / 风险闸 / 可信度 / MCP / 技能
预加载  src/preload/    contextBridge 按域拆分，入参走 zod 契约判定
渲染层  src/renderer/   React 19 + Zustand 5 + lucide，沙箱隔离
共享    src/shared/     跨进程类型与常量的单源（IPC 通道名、可信度表、boot 载荷）
```

Electron 安全三原则全部为硬约束：`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`，
由 `design-contract` 与启动期断言钉住，不是靠自觉。

凭据不进任何文本通道：SSH 口令与 API Key 走 `safeStorage`（Windows DPAPI）加密落盘，
存在系统用户目录而不是仓库里；发往 LLM 的上下文按递归规则逐层打码。

## 已知边界（说清楚，不含糊）

这些是**当前状态**，不是待办清单的修辞：

- **可信度融合跑的是完整 D-S / PCR5，但各源先验是人工定标的**：折扣权重在决策设置里可调，
  先验本身（每条证据给多高分）来自规则与经验值，不是从数据里学出来的。融合算法不会替先验兜底。
- **AI 的多步编排只有一条：Supervisor 的 PAOR**（AI 面板底部那颗「PAOR 自主循环」chip 是唯一入口）。
  这条结论是两批整删之后才成立的。**#218**（2026-10-25）：曾经还有一套"9 个专职 Subagent"（编程/思考/
  运行/搜索/skill/方法论/历史/知识库/探索）在启动时被实例化，但**全仓没有任何派发点**——两个查找方法
  没人调，也没有一条工具、通道或界面能派活给它们；同批摘掉 `BaseSubagent.execute` 里那段"先跑完再假审批"
  的代码，它把跑完的结果丢掉、换成一句"等待人工审批"，而那句占位实现从不推审批卡。
  **#222**（同日）：那份工作流子 agent 与它的基类也判掉了——主进程 IPC、子 agent、前端 hook、
  显示面板全都建好，唯一缺的是**启动入口**（那个 hook 的启动函数在渲染层零调用）。挂在它上面的
  六处审批动作因此落空：决策中心那三处第一行就 return（点了没反应），决策详情页那三处拿历史记录 id
  去敲只认工作流序号的门（必得一句"主进程拒绝执行"）。详情页因此回到"看历史 + 审计链 + 置信度 +
  真的重新在终端执行"。PAOR 那条链的把关一直在工作流的 confirm 步——在动手**之前**弹决策卡。
  还有哪些能力属于这种半态，逐条列在 [docs/功能实景清单.md §C 组](docs/功能实景清单.md)。
- **Python 侧车（Drain3 日志模板挖掘）需要本机 venv**，缺依赖时整条日志聚类走降级，界面会显示降级原因。
  另注：`drain3-bridge.ts:235` 自陈模板抽取一直是内置正则——所以这条链路的"日志聚类"从来不是真 Drain3。
- **Langfuse 追踪没有 Key 时自动关闭**，不会静默上报。
- **安装包不随仓库发布**；`pnpm build:win` 只在本机验证过 Windows。
- 端到端有一批用例按环境跳过（2026-10-27 实测：靶机变量给齐后，103 条里只剩 5 条跳——3 条要真模型 Key、
  2 条要一个比 `out/` 新的发布包）。默认轮还会多跳 11 条真 Linux 靶机用例，给了 `TDSF_REAL_SSHD_*` 就真跑
  （`ssh-real-target` 3 / `ssh-real-jump` 3 / `ssh-shell-integration` 2 / `workbench-file-search-real` 3）。

## 贡献

先看 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [CODING.md](CODING.md)。
改 `src/renderer/**` 之前必读 [DESIGN.md](DESIGN.md)（界面规范唯一权威）。
想知道"现在真有什么、什么还没接上"，看 [docs/功能实景清单.md](docs/功能实景清单.md)；
想知道"接下来往哪走、每条凭什么"，看 [docs/长期优化目标.md](docs/长期优化目标.md)。

发现安全问题请走 [SECURITY.md](SECURITY.md) 私密披露，不要在 Issue 里公开。

## 许可证

[MIT](LICENSE) · 第三方依赖致谢见 [NOTICE](NOTICE)

---

## English

TDSF-Linux Desktop is an Electron desktop tool that makes the first SSH session survivable:
a three-layer command risk gate (8 structural detectors, 7 argv rules, 244 vocabulary entries),
AI assistance whose every answer carries an explicit credibility score with the evidence behind it,
and a full audit trail of what was allowed and why.

Electron 43 · React 19 · Zustand 5 · ssh2 · xterm.js · Monaco · Vercel AI SDK · MCP · better-sqlite3 ·
D-S evidence theory + PCR5 fusion · Vitest + Playwright.

Every figure in the [quality table](#质量与验证) comes from the command named in that same row,
and `npm run promo:check` re-diffs all of them against the repo — no outward number has any other source.
See [Quick start](#快速开始), the [known boundaries](#已知边界说清楚不含糊)
and [docs/功能实景清单.md](docs/功能实景清单.md) for what is actually wired up.

MIT licensed.

