# TDSF-Linux Desktop v0.3.0 — 启动·测试·使用教程 & 亮点说明

> 版本：v0.3.0 | 日期：2026-07-11 | 技术栈：Electron 30 + React 18 + TypeScript 5.4

---

## 一、启动教程

### 1.1 环境要求

| 依赖    | 最低版本 | 验证命令           |
| ------- | -------- | ------------------ |
| Node.js | 20 LTS   | `node --version` |
| pnpm    | 9.0+     | `pnpm --version` |
| Git     | 2.40+    | `git --version`  |

### 1.2 首次安装

```bash
# 1. 进入项目目录
cd d:\ai\linux教学一体\tdsf-linux-desktop

# 2. 安装依赖（pnpm 会自动处理原生模块编译权限）
pnpm install

# 3. 下载 Electron 预编译二进制（如遇下载失败，设置镜像）
# Windows 国内网络需设置镜像：
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
# 然后重新安装：
pnpm install

# 4. 下载 better-sqlite3 的 Electron 30 预编译二进制
npx prebuild-install -r electron -t 30.0.0 --tag-prefix v
# 如遇网络问题，设置 npm 镜像：
$env:npm_config_build_from_source="false"
```

### 1.3 启动开发模jj# 一键启动（electron-vite dev，自动热更新）

```bash
pnpm dev
```

启动后你会看到：

- 终端输出 `main process built` / `preload built` / `renderer dev server running`
- Electron 窗口自动弹出，显示 TDSF-Linux Desktop 主界面
- 渲染进程开发服务器运行在 `http://localhost:5173/`

### 1.4 构建生产版本

```bash
# 构建三进程产物
pnpm build

# 产物输出到 out/ 目录：
#   out/main/index.js      — 主进程（~110KB）
#   out/preload/index.js   — Preload桥接（~5KB）
#   out/renderer/          — 渲染进程（~3.98MB + CSS）
```

### 1.5 常见启动问题

| 问题                                   | 原因                                       | 解决方案                                                                               |
| -------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `Electron uninstall`                 | electron 二进制未下载                      | `$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"` → `pnpm install` |
| `Could not locate the bindings file` | better-sqlite3 原生模块缺失                | `npx prebuild-install -r electron -t 30.0.0 --tag-prefix v`                          |
| `NODE_MODULE_VERSION mismatch`       | 测试环境 vs Electron 运行时版本不匹配      | 正常现象，测试用 MockDatabase，Electron 运行时正常                                     |
| `Vite CJS Node API deprecated`       | vitest 使用了 Vite CJS API                 | 忽略，不影响功能                                                                       |
| pnpm install 卡住                      | 原生模块编译需要 Visual Studio VC++ 工具链 | 安装 VS 2022 BuildTools + VC++ 桌面开发组件                                            |

---

## 二、测试教程

### 2.1 运行全部测试

```bash
# 一键运行（vitest）
pnpm test

# 预期输出：
# ✓ tests/core/confidence.test.ts (7)
# ✓ tests/core/decision-engine.test.ts (11)
# ✓ tests/core/grounding.test.ts (8)
# ✓ tests/core/risk-engine.test.ts (20)
# ✓ tests/core/rule-engine.test.ts (13)
# ✓ tests/core/sampling.test.ts (12)
# ✓ tests/scenarios/502-slow-query.test.ts (7)
# ✓ tests/scenarios/disk-full.test.ts (10)
# ✓ tests/scenarios/oom-scenario.test.ts (8)
# ✓ tests/services/knowledge-repo.test.ts (23)
# ✓ tests/services/llm-client.test.ts (30)
# Test Files  11 passed (11)
#      Tests  149 passed (149)
```

### 2.2 监视模式（开发时使用）

```bash
# 文件变更自动重跑测试
pnpm test:watch
```

### 2.3 测试结构说明

```
tests/
├── core/                           # 核心算法单元测试
│   ├── confidence.test.ts          # 7个 — 置信度公式验证
│   ├── grounding.test.ts           # 8个 — 证据溯源校验
│   ├── risk-engine.test.ts         # 20个 — 4层风险控制
│   ├── decision-engine.test.ts     # 11个 — 决策卡片生成
│   ├── sampling.test.ts            # 12个 — 自适应采样
│   └── rule-engine.test.ts         # 13个 — 规则引擎降级
├── services/                       # 服务层测试
│   ├── llm-client.test.ts          # 30个 — LLM客户端+重试+降级
│   └── knowledge-repo.test.ts      # 23个 — 知识库CRUD+Jaccard+向量
└── scenarios/                      # 端到端场景测试
    ├── oom-scenario.test.ts        # 8个 — OOM内存溢出全链路
    ├── 502-slow-query.test.ts      # 7个 — 502慢查询+自适应采样
    └── disk-full.test.ts           # 10个 — 磁盘满+多风险等级
```

### 2.4 场景测试验证点

**OOM 内存溢出场景**（8个测试）：ii

1. 规则引擎匹配OOM关键词（`Out of memory: Kill process`）
2. 证据从 dmesg 日志收集
3. 置信度 = 0.7×匹配度 + 0.3×0.6（log先验）
4. Ground-Check 验证证据来源
5. `kill -9 <pid>` 评估为 HIGH 风险
6. 决策卡片包含假设+证据+修复命令
7. HIGH 风险需人工确认

**502 慢查询场景**（7个测试）：xx

1. 多证据源（Nginx日志+MySQL慢查询+CPU指标）
2. 综合置信度计算
3. Ground-Check 溯源3条证据到3个工具
4. `systemctl restart php-fpm` 评估为 MEDIUM
5. 自适应采样：置信度<0.7触发3次重采样
6. 多数投票决策

**磁盘满场景**（10个测试

- 直接输入密码
- 密码通过 safeStorage 加密存储在 OS 钥匙串中

**密钥文件认证**：

- 认证方式选择"密钥文件"
- 输入私钥路径（如 `~/.ssh/id_rsa`）或点击选择文件
- 可选填 passphrase（私钥口令）

#### 步骤3：高级选项（跳板机）

展开"高级选项"可配置跳板机：

- 填写跳板机的 host/port/username/认证信息
- 应用会先连接跳板机，再通过 `forwardOut` 转发到目标服务器

#### 步骤4：连接

- 点击"连接"按钮
- 左栏服务器状态变为 🟢 已连接
- 中栏自动打开终端标签页
- 右栏 AI 助手已就绪

### 3.3 终端操作

- **多标签**：点击终端标签栏 "+" 可打开新标签
- **交互式 Shell**：支持 vim / top / htop 等全屏程序（xterm.js + WebGL 加速）
- **复制粘贴**：选中文本自动复制，右键粘贴
- **搜索**：Ctrl+Shift+F 打开终端搜索
- **字号调整**：Ctrl++ / Ctrl+- 调整终端字号

### 3.4 服务器监控

1. 切换工作台 Tab 到 **"监控"**
2. 实时显示6项指标（3秒刷新）：
   - CPU 使用率（折线图）
   - 内存使用率（折线图）
   - 磁盘使用率
   - 网络流量（上传/下载 KB/s）
   - 系统负载
   - 进程数
3. 图表使用 Recharts 渲染，实时滚动显示最近60个数据点

### 3.5 AI 运维助手

#### 基础对话

1. 在右栏 AI 面板输入框输入问题，如：
   > "服务器内存使用率95%，怎么排查？"
   >
2. AI 会分析问题并返回建议
3. 如果配置了 LLM API Key，使用大模型推理；否则降级到规则引擎

#### 粘贴日志分析

1. 将日志内容（dmesg / nginx error log / mysql slow query 等）粘贴到输入框
2. AI 自动识别日志类型，提取关键信息
3. 生成证据链，展示在对话中

#### 7步 HITL 工作流

当 AI 需要执行操作时，自动触发人机协同工作流：

```
收集(collect) → 分析(analyze) → 推理(reason) → 校验(check)
                                                    ↓
验证(verify) ← 执行(execute) ← 人工确认(confirm)
```

- **收集**：从系统采集日志、指标、配置等证据
- **分析**：规则引擎 + LLM 双推理，生成假设
- **推理**：综合证据生成修复方案（DecisionCard）
- **校验**：Ground-Check 验证证据溯源 + 风险评估
- **确认**：人确认（HIGH/CRITICAL 风险必须确认）
- **执行**：通过 SSH 在目标服务器执行命令
- **验证**：确认执行结果，更新知识库

#### 证据链可视化

每条 AI 建议都附带证据溯源链：

- 📄 日志证据 — 来源：dmesg / nginx / mysql
- 📊 指标证据 — 来源：CPU / 内存 / 磁盘
- 💻 命令证据 — 来源：df / free / ps
- ⚙️ 配置证据 — 来源：/etc/ 配置文件
- 📖 知识证据 — 来源：历史案例库

每条证据显示：

- 置信度进度条（0-100%）
- Ground-Check 验证徽章（✓ 已验证 / ⚠ 未验证）

#### 决策卡片

AI 生成的决策卡片包含：

- **风险等级色带**：左侧4px彩色条（绿/青/橙/红/品红）
- **置信度仪表盘**：RadialBarChart 圆形进度
- **修复命令**：代码块 + 一键复制按钮
- **操作按钮**：批准执行 / 拒绝 / 修改

### 3.6 设置页

#### LLM 配置

| 配置项     | 说明                    | 默认值                                   |
| ---------- | ----------------------- | ---------------------------------------- |
| Base URL   | API 地址                | https://ark.cn-beijing.volces.com/api/v3 |
| API Key    | 密钥（safeStorage加密） | 空                                       |
| 模型       | 模型名                  | doubao-seed-1-6-250615                   |
| 温度       | 生成随机性              | 0.3                                      |
| 最大 Token | 单次响应上限            | 4096                                     |
| 超时       | 请求超时(ms)            | 60000                                    |

支持的 LLM 提供商（任何 OpenAI 兼容 API）：

- 火山方舟（豆包系列）
- OpenAI（GPT-4o 等）
- DeepSeek
- Ollama 本地模型
- 任何兼容 API

#### SSH 默认配置

| 配置项       | 默认值   |
| ------------ | -------- |
| 默认端口     | 22       |
| 默认用户名   | root     |
| 默认认证方式 | password |
| 连接超时     | 30000ms  |

#### 风险规则管理

内置5条默认规则，可自定义添加：

| 规则名                 | 等级     | 匹配模式                                     |
| ---------------------- | -------- | -------------------------------------------- |
| 禁止 rm -rf /          | CRITICAL | `rm\s+-rf?\s+/?`                           |
| 禁止 mkfs 格式化       | CRITICAL | `mkfs\.`                                   |
| 禁止 dd 写设备         | CRITICAL | `dd\s+.*of=/dev/`                          |
| 禁止修改 passwd/shadow | HIGH     | `(chmod\|chown).*(/etc/passwd\|/etc/shadow)` |
| 禁止 iptables flush    | HIGH     | `iptables\s+(-F\|--flush)`                  |

#### 外观设置（v0.3.0新增）

- 亮色模式 / 暗黑模式切换
- Switch 开关一键切换
- 首次使用自动跟随系统偏好
- 暗黑模式配色：苹果暗黑风格（#1d1d1f → #2c2c2e → #3a3a3c）

### 3.7 历史决策页

- 查看所有历史决策卡片
- 按时间/风险等级/状态筛选
- 点击查看详情（证据链 + 审计日志）

### 3.8 知识库页

#### 双轨制知识

| 类型           | 说明     | 示例                         |
| -------------- | -------- | ---------------------------- |
| command_skills | 操作能力 | 如何重启Nginx、如何查看内存  |
| incident_cases | 故障案例 | OOM处理、502排查、磁盘满清理 |

#### 知识管理操作

- **搜索**：关键词搜索 + Jaccard 相似度匹配
- **添加**：手动录入命令技巧或故障案例
- **导入**：批量导入 JSON 格式知识库
- **导出**：导出为 JSON 文件，可在其他实例间共享
- **自动去重**：相似度 > 0.6 的条目自动合并

---

## 四、亮点说明

### 4.1 产品定位亮点

**TDSF-Linux Desktop = FinalShell 的 SSH 能力 + AI 运维助手 + 可信决策内核**

与竞品的核心差异：不做大而全的自动化 AIOps，而是做**可解释的人机协同决策**。

| 维度     | 传统AIOps  | 焰龙AI     | FinalShell | **TDSF-Linux Desktop** |
| -------- | ---------- | ---------- | ---------- | ---------------------------- |
| AI模式   | 自动闭环   | 自动执行   | 无AI       | **AI辅助+人工确认**    |
| 可信度   | 黑箱       | 无         | 无         | **证据置信度+溯源**    |
| 风险控制 | 基础       | 命令验证   | 无         | **4层风险门禁**        |
| 部署     | Docker     | Docker     | 安装即用   | **安装即用，零部署**   |
| 数据安全 | 服务端存储 | 服务端存储 | 本地明文   | **safeStorage加密**    |

### 4.2 六大核心机制亮点

#### 亮点1：证据置信度公式 — 拒绝黑箱

```
置信度 = 0.7 × Drain3匹配度 + 0.3 × 来源先验
```

- **不是简单的"AI说啥就是啥"**，每条建议都有量化置信度
- 来源先验权重：命令输出(0.9) > 指标(0.8) > 日志(0.6) > 知识(0.5)
- 用户可看到置信度仪表盘，判断建议的可信程度

#### 亮点2：Ground-Check 证据溯源 — 可核验

- **每条证据必须来自真实的工具调用**（dmesg/df/free 等）
- 知识库类型豁免验证（历史经验不需要工具调用验证）
- 证据显示验证徽章：✓ 已验证 / ⚠ 未验证
- **不是凭空生成的建议**，而是有据可查的推理链

#### 亮点3：4层风险控制 — 可感知

```
L1 语法检查 → L2 风险评估(5级) → L3 人工确认 → L4 审计日志
```

- **CRITICAL 级命令直接阻止**（rm -rf /、mkfs、dd 写设备）
- **HIGH 级命令必须人工确认**（kill -9、iptables -F）
- 所有操作记录审计日志，可追溯
- 风险等级色带直观展示（绿→青→橙→红→品红）

#### 亮点4：双推理模式 — 可靠

- **LLM 推理**：配置 API Key 后，使用大模型深度分析
- **规则引擎降级**：API Key 为空或调用失败时，自动降级到关键词匹配
- 8类常见故障关键词匹配（OOM/磁盘满/502/连接超时/权限拒绝/进程崩溃/服务停止/网络异常）
- **不会因 LLM 不可用而停止工作**

#### 亮点5：自适应自洽采样 — 可信

- 置信度 ≥ 0.7：单次推理，高效响应
- 置信度 < 0.7：3次重采样 + 多数投票，降低不确定性
- **低置信度时自动增加验证力度，而不是盲目输出**

#### 亮点6：知识双轨制 — 可沉淀

- **command_skills**：操作能力库（怎么做）
- **incident_cases**：故障案例库（怎么修）
- Jaccard 相似度匹配 + 自动去重（>0.6合并）
- 支持导入/导出，团队知识可复用
- **每次成功的故障处理都能沉淀为经验**

### 4.3 技术架构亮点

#### Electron 三进程安全架构

```
主进程 — Node.js 完整权限（SSH/LLM/SQLite/核心算法）
  ↕ contextBridge（只暴露 invoke/handle API）
Preload — 安全桥接
  ↕ window.electronAPI（渲染进程只能调用白名单方法）
渲染进程 — 沙箱隔离（无法访问 Node.js / 文件系统 / 网络）
```

- `contextIsolation: true` — 上下文隔离
- `nodeIntegration: false` — 禁用 Node 集成
- `sandbox: true` — 沙箱模式
- **即使渲染进程被攻击，也无法获取 SSH 凭证或执行系统命令**

#### safeStorage 凭证加密

- API Key、SSH密码/私钥通过 OS 原生加密存储
- Windows: DPAPI | macOS: Keychain | Linux: libsecret
- **敏感信息永远不以明文存储在磁盘上**

#### LLM 自由接入

- 用户自配 API Key / Base URL / 模型名
- 支持火山方舟 / OpenAI / DeepSeek / Ollama 等任意兼容 API
- 降级机制：LLM 不可用时自动降级到规则引擎
- **不被任何 LLM 提供商绑定**

#### 重试与容错

- `chatWithRetry`：指数退避重试（1s → 2s → 4s，最多3次）
- `AbortController` 超时控制（默认60s）
- 流式响应中断自动清理
- **网络抖动不会导致功能崩溃**

### 4.4 用户体验亮点

| 亮点            | 实现                                   |
| --------------- | -------------------------------------- |
| 苹果极简美学    | 黑白配色 + 8px圆角 + 大量留白 + 无阴影 |
| 暗黑模式        | 一键切换，苹果暗黑风格配色             |
| WebGL 终端      | xterm.js + WebGL 加速，支持 vim/top    |
| 实时监控        | 3秒刷新，Recharts 折线图               |
| 7步工作流可视化 | Ant Design Steps + 脉冲等待动画        |
| 证据链图标      | 📄日志 📊指标 💻命令 ⚙️配置 📖知识   |
| 置信度仪表盘    | Recharts RadialBarChart 圆形进度       |
| 命令一键复制    | 决策卡片修复命令 + 复制按钮            |

### 4.5 工程质量亮点

| 指标              | 数值                                   |
| ----------------- | -------------------------------------- |
| TypeScript strict | 0 错误                                 |
| 测试用例          | 149 个（11个文件）                     |
| 场景测试          | 3 个端到端（OOM/502/磁盘满）           |
| 核心算法覆盖      | 置信度/溯源/风险/决策/采样/规则 全覆盖 |
| LLM 客户端测试    | 30 个（含重试/降级/流式/环境感知）     |
| 构建产物          | 主进程 110KB / 渲染进程 3.98MB         |
| Git 提交          | 3 次规范提交（v0.1.0→v0.2.0→v0.3.0） |

---

## 五、快捷操作参考

### 开发者命令

```bash
pnpm dev            # 启动开发模式
pnpm build          # 构建生产版本
pnpm test           # 运行全部测试
pnpm test:watch     # 监视模式
pnpm typecheck      # TypeScript 类型检查
pnpm lint           # ESLint 检查
pnpm rebuild        # 重编译原生模块
pnpm build:win      # 构建 Windows 安装包
```

### 界面导航

| 操作          | 方式                                    |
| ------------- | --------------------------------------- |
| 切换页面      | 顶部 Tab（工作台/历史决策/知识库/设置） |
| 切换终端/监控 | 工作台内 Tab                            |
| 新建SSH连接   | 左栏"+ 新建"                            |
| 连接服务器    | 左栏双击服务器                          |
| 发送AI消息    | 右栏输入框 + Enter                      |
| 清空对话      | 右栏清空按钮                            |
| 切换主题      | 设置页 → 外观 → Switch                |

### LLM 配置参考

| 提供商     | Base URL                                 | 模型名                 |
| ---------- | ---------------------------------------- | ---------------------- |
| 火山方舟   | https://ark.cn-beijing.volces.com/api/v3 | doubao-seed-1-6-250615 |
| OpenAI     | https://api.openai.com/v1                | gpt-4o                 |
| DeepSeek   | https://api.deepseek.com/v1              | deepseek-chat          |
| Ollama本地 | http://localhost:11434/v1                | llama3 / qwen2         |
