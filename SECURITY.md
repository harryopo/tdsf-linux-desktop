# Security Policy

## 支持的版本

| 版本  | 支持状态              |
| ----- | --------------------- |
| 1.0.x | ✅ 活跃支持（v1.0.0+）|
| < 1.0 | ❌ 不再支持           |

## 报告漏洞

**请勿在公开 Issue 中报告安全漏洞。**

请通过以下方式私下报告（**首选第一条**）：

- **GitHub 私密漏洞报告**：
  [Report a vulnerability](https://github.com/harryopo/tdsf-linux-desktop/security/advisories/new)
  —— 走仓库的 Security 标签页，表单本身私密，只有维护者可见；报告会留在 GitHub 上，
  修复进展与致谢都在那里对账，不依赖任何私人邮箱。
- **主题前缀**（若你另外找到了其它渠道）：`[SECURITY] `

> 2026-10-20 变更：这里原来写的是维护者本人的 QQ 邮箱。那串地址会被公开仓的爬虫抓走
> （已经收到过按模板群发的"安全扫描"冷邮件），而个人信箱一旦散布就无法收回。
> 现在改用 GitHub 的私密漏洞报告渠道；`scripts/security/identity-gate.cjs` 新增一条
> "个人邮箱形状"规则，会把这类地址在已入库文件里再出现时直接判红。

我们承诺：

- **48 小时内**确认收到
- **7 天内**给出初步评估
- 修复后会公开致谢（除非你要求匿名）

## 安全更新流程

1. 内部评估严重程度（Critical / High / Medium / Low）
2. 准备修复补丁 + Release Notes
3. 发布安全版本 + GitHub Security Advisory
4. 通知所有已知用户

## 安全最佳实践（用户侧）

- ✅ 保持版本更新：目前请从 [Releases](https://github.com/harryopo/tdsf-linux-desktop/releases) 下载安装包；应用内"检查更新"只查询已发布的 Release，不做自动更新
- ✅ SSH 私钥使用 ED25519 或 RSA-4096
- ✅ 启用三态权限审批（ALWAYS / AUTO / NEVER）
- ✅ 不要在公共 WiFi 下管理生产服务器
- ✅ 定期审查 AI 自动执行的命令日志

## 安全特性（本项目）

- **contextIsolation: true** — 渲染进程与 Node.js 隔离
- **nodeIntegration: false** — 渲染进程无 Node.js 权限
- **sandbox: true** — Chromium 沙箱启用
- **CSP 严格策略** — 阻止 XSS / 注入
- **IPC 参数校验** — 防止恶意输入
- **默认不联网上报** — 遥测关闭；配置 Langfuse Key 后属于**显式**上报（无 Key 时整条追踪自动关闭，不会静默发送）

## 威胁模型（按信任边界逐条，右边写"哪条命令在守"）

这个应用同时握着三样别人想要的东西：SSH 私钥与主机口令、模型服务的 API Key、
以及"能在那台服务器上执行命令"的能力。所以下面每一行都写明**守它的是哪道闸**，
以及**闸管不到的地方**——只写有执行体的东西，不写"我们会注意"。

| 边界 | 威胁 | 现在的防线（可当场复现） | 管不到的地方 |
|---|---|---|---|
| 渲染进程 ↔ 主进程 | 界面里任何一段被注入的脚本拿到 Node 能力 | `src/main/windows/main-window.ts:179-181` 三红线（`contextIsolation:true` / `nodeIntegration:false` / `sandbox:true`）；跨进程只经 `contextBridge` 白名单 | 渲染层能调到的每个 IPC 通道本身——见下一行 |
| IPC 入参与返回 | 界面（或界面里的内容）用合法通道传畸形参数、或从错误信息里读内部路径 | 边界装在注册函数本身：`src/main/ipc/error-boundary.ts`（抛错与"把失败当数据返回"两条出口都过脱敏）+ `contract-guard.ts` 按 `src/shared/ipc-contract.ts` 判形状。`config:get/set` 另有严格白名单（`services/storage/config-policy.ts`）：Provider/MCP/SSH 配置与任何点号子路径一律拒，读回的 `llmConfig` 强制摘掉 `apiKey`。判据 `npm run ipc:check`、`pnpm test` 里 `ipc-error-boundary` / `ipc-data-error-boundary` / `ipc-contract-*` / `credential-boundary`，e2e `config-boundary` | **契约覆盖 60 / 222 条 invoke（27.0%，2026-10-24 实测：`npm run ipc:check` 的生成行数 ÷ `audit:ipc` 的请求通道数）**；未登记的通道在边界上原样放行（一刀切拒绝等于把应用关掉）。扩面进度见 长期优化目标 §二 |
| AI 输出的命令 → 真实执行 | 模型给出一条破坏性命令并被人顺手回车 | 单入口 `src/main/core/command-gate.ts` `evaluateCommand`；8 个结构探测器 + 226 条词表；四个出口都过闸（exec / 远程 PTY 逐行 LineGate / 本机 PTY / AI 与 MCP  authored 命令）。判据 `tests/unit/command-gate-*.test.ts`，含**误伤**回归 | 关键词与结构判据只证明"这类能识别"，不证明"识别不了的那类不会来"。所以界面把每一次拦截都留痕，人可以看自己拦住了什么 |
| 工具结果里的凭据不出主进程 | 远端命令的原样输出（`cat /etc/mycnf`、`env`、日志里内联的 token）随工具结果离开进程：进模型上下文、进界面、进 MCP 客户端 | 按出口枚举，一份实现（`src/main/core/agent/providers/redact.ts:265` 的 `redactToolValue`）四处各接一次：模型侧在工具组装点统一套 `withToolResultRedaction`（`src/main/core/agent/supervisor.ts:992`，外部 MCP 工具同一条路径）、界面事件与回喂模型共用同一份已打码结果（`src/main/ipc/llm-tools.ts:71`）、MCP 三条返回统一走 `src/main/services/mcp/tools/registry.ts:68`。判据 `tool-result-redaction` / `llm-tools-result-redaction` / `mcp-result-redaction` 三份。**"在唯一执行点收口一次、两个出口共用"是刻意的**：分头各写一遍，下次加出口必漏（2026-10-23 就是这么抓到第三家没装的） | 打码只认已登记的凭据形状，规则条数以 `listRedactRules()` 现场数为准，不在文档里抄——抄来的就会漂。同一批 18 个变体的实测里首次穿透 56%（之后才补规则并留下已知穿透的测试），所以"识别得了的"拦得住，不等于"识别不了的"不会来。真正的兜底是命令闸：会读到敏感文件的那条命令本身要先过闸、要留痕 |
| 远端主机身份 | 中间人换掉服务器密钥，把口令引到假机 | `src/main/services/ssh/known-hosts.ts`（跳板机同样校验，不豁免）；首连必须由人确认，接受后写入 OpenSSH 兼容的 known_hosts；`services/ssh/agent-auth.ts` 支持系统 ssh-agent（应用只拿 socket，不落私钥） | 首次确认是一次人工判断：用户点"接受"就等于信任当前密钥；应用无法替他判断这台机器是不是被换过 |
| 密钥与内网拓扑不出库 | 凭据、内网地址、身份字样被写进源码 / 测试夹具 / 提交信息 / 文档 | `security:secrets`（凭据形状，扫跟踪集与暂存区）、`security:topology`（内网值按值 + 按 /24 网段，含文档腿）、`security:history`（全历史按值回归，pre-push）、`security:identity`（身份暴露：校名/专业/真实姓名/赛事字样）。每把都带阳性对照——报 0 命中之前先证明这把尺子扫得到东西。GitHub 侧：本仓是个人公开仓，Secret Scanning 实测可用（警报列表返回 200、0 条） | 2026-10-20 起 `security:identity` 与 `security:secrets` 同时进 CI（新 job `security-static`）。**原因是：钩子在 `.git/hooks` 里，而 hooks 不入库——新克隆的机器一把都不跑**，"有闸"只对这台工作副本成立。仍在 CI 外的：`security:history`（浅克隆没有历史可扫）、`security:topology`（锚定值不入库）。且 CI 上的身份闸只跑通用形状规则：具体姓名/校名清单是本机文件，那一层只有本机与提交钩子管得到 |
| 导入知识文件读到什么 | 导入时会读盘：恶意/手滑选中私钥、系统文件、二进制，或塞一个超大文件把内存拖死 | 路径只来自系统打开对话框（`src/main/services/security/dialog-paths.ts:41` 的 `pickExistingFiles`，选中即记入 confinement 授权集），渲染层不递路径；主进程先按后缀白名单挡（`.md/.markdown/.txt/.json`，不认识的后缀一个字节都不读，`src/main/services/knowledge/kb-import.ts:115`），再按 2MB 上限挡（`kb-import.ts:127`）；解析是纯函数、不执行任何内容，围栏里的命令只是当文本存进 `commands` 列 | 导入的内容会进 `knowledge_entries` 并可能被 AI 检索进上下文，所以它走过和工具输出同一条脱敏出口（`withToolResultRedaction`）；但"用户自己写进本地笔记的明文"按本机数据对待，不在入库时改写（与对话历史同一口径）。判据：`tests/services/kb-import-real-db.test.ts` 里"陌生后缀一条不写""超体积拒掉""读不到不炸整批"三条 |
| 远程下载的模型 | 镜像把 ONNX 权重换成被动过手脚的版本 | `services/tutorial/embedding-model.ts` 先取字节、比对仓库里钉死的 SHA-256（6 个文件，含 24MB 量化 ONNX），通过后才写进 transformers 缓存；`allowRemoteModels=false`，未验证字节不进运行时。下载源按 hf-mirror → huggingface 依次尝试，任一源都要过同一张哈希表 | 24MB 权重没有打进安装包，首次使用必须联网取一次；下载失败时知识库降级为关键词检索（错误原因写日志与界面） |
| 依赖与发布物 | 装进来的包被投毒 | `audit:deps` 强制走 npm 官方 registry（镜像站没有 audit 端点）；基线 `scripts/quality/deps-audit-accepted.json` 2026-10-22 实测 0 条未处置公告（空表必须写 `_空基线理由`，否则闸退出码 2）；CI 里 `deps-audit` 是单个 job，原生依赖另有 `check-native-prebuild`，构建只有 Windows 一个平台 | 代码签名与发布物校验和属于人工发布环节，本文件不声称已具备 |
| 数据外传 | "静默把终端内容传走" | 所有网络请求在界面可见；Langfuse 追踪**无 Key 即整条关闭**，有 Key 属于显式上报（`docs/功能实景清单.md` 记了这条链路的实际状态） | 用户自己填的模型 API Key 会把对话内容送到该端点——这是产品定义，不是缺陷，但界面不隐藏它 |

## 已知安全问题

不是"暂无"。当前承认存在、尚未收口的项写在
[docs/长期优化目标.md §五 安全欠账](docs/长期优化目标.md)：归档仍接假仓储、Drain3 桥生产链路零启动、
生产链路没有可复核的 OTel 追踪面。依赖公告在 2026-10-23 实测为 **0 条**：
hono 钉到 4.13.13、Electron 升到 43.8.3、`@typescript-eslint` 升到 v8（`braces` 链随之消失）；
同日上游新出 4 条（dompurify 的 critical/high/low 与 ip-address 的 moderate），已升到受影响区间外的
修补版 dompurify 3.4.17、ip-address 10.7.4（直接依赖与传递钉版落在同一版本，锁文件里各只有一份）；
`deps-audit-accepted.json` 因此仍是空表，并在 `_空基线理由` 里写明"修完后的 0 条，不是清空"。
风险等级与为什么不先做，都在那一节里逐条给了出处。

## 致谢

感谢以下安全研究人员的贡献（按时间顺序）：

- 待添加
