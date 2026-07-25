# 运维 Skill 分类体系与开源资源调研报告

> **调研时间**：2026-07-24
> **调研方式**：联网深度调研（GitHub API 实时核实 + 多源交叉验证）
> **数据说明**：所有 GitHub star 数与许可证均通过 `gh repo view` / `gh api` 实时核实，非凭记忆或单一文章转述。文中若标注"未直接核实"则表示来自二手资料未独立验证。

---

## 一、调研背景与核心结论

### 1.1 调研目的

为 TDSF Linux Desktop（SSH 终端 + AI 辅助 + 高危命令拦截 + 日志分析）项目梳理运维 Skill 完整分类体系，盘点可复用的开源资源，并建立"什么任务需要 Skill"的判断标准。

### 1.2 三条核心结论

1. **官方仓库几乎没有运维 Skill**。Anthropic 官方 `anthropics/skills`（163,876 stars）的 17 个 skill 全部聚焦在文档处理、创意设计、前端开发、MCP 构建等领域，**没有任何监控、备份、网络诊断、容器运维、故障排查等运维专用 skill**。运维 skill 完全依赖社区生态。

2. **专门运维 skill 仓库 star 普遍偏低**。star > 100 的纯运维 skill 仓库仅 3 个（`akin-ozer/cc-devops-skills` 280、`ahmedasmar/devops-claude-skills` 189、`aj-geddes/useful-ai-prompts` 301 但属通用 prompts 仓库）。绝大多数运维 skill 散落在通用大库（`Jeffallan/claude-skills`、`alirezarezvani/claude-skills`）的子目录中。

3. **运维 skill 生态存在明显空白**。监控、备份恢复、网络诊断、用户权限管理、日志分析等细分领域，目前**没有专门的、高 star 的 skill 仓库**，多借用于 DevOps 通用 skill 或 IaC 生成器。教学场景（命令解释、实验环境搭建、学习路径）更是几乎空白，是待填补的蓝海。

### 1.3 生态规模速览

| 维度 | 数据 | 来源 |
|------|------|------|
| GitHub 索引到的 skill 相关仓库 | 15,000+ | segmentfault 文章引用 agentskillreport.com |
| 三大 marketplace 合计条目 | 49 万+ | 同上（含大量低质量抓取） |
| 社区 skill 验证不合格率 | 22% | agentskillreport.com 对 673 个 skill 的分析 |
| Skill 中非功能性 token 占比 | 52% | 同上（许可证、构建产物、schema 白占上下文） |
| Anthropic 官方 skill 数量 | 17 | `gh api repos/anthropics/skills/contents/skills` 实测 |

---

## 二、运维 Skill 完整分类体系

### 2.1 分类总览表

基于运维工作域（参考 Google SRE Book、CNCF 运维能力模型）与 Claude Skill 的"工作流封装"本质，将运维 Skill 划分为 **15 大类**。前 5 类为已知分类，后 10 类为本调研补充。

| # | Skill 分类 | 核心能力描述 | 适用场景 |
|---|-----------|------------|---------|
| 1 | 环境检查 Skill | 探测运行环境、依赖版本、配置基线 | 项目初始化、CI 前置检查、故障定位前置 |
| 2 | 开发 Skill | 代码生成、构建脚本、本地调试 | 应用开发、脚手架、本地联调 |
| 3 | 部署 Skill | 蓝绿/金丝雀/滚动发布、IaC 部署 | 应用上线、基础设施编排、回滚 |
| 4 | 安全 Skill | 漏洞扫描、密钥审计、合规检查 | 代码审计、供应链安全、合规治理 |
| 5 | 检查问题 Skill | 代码审查、配置校验、lint | PR 审查、配置漂移检测 |
| 6 | **监控 Skill** | 指标采集、告警规则、Dashboard 生成 | Prometheus/Grafana 配置、SLO 定义、告警降噪 |
| 7 | **备份恢复 Skill** | 备份策略、快照管理、灾难恢复 | 数据库备份、PV 快照、RTO/RPO 演练 |
| 8 | **网络诊断 Skill** | 连通性、抓包、DNS、链路追踪 | 跨可用区不通、Service 访问失败、TLS 排障 |
| 9 | **性能调优 Skill** | 火焰图、内核参数、JVM 调优 | 高负载定位、慢查询、吞吐瓶颈 |
| 10 | **用户权限管理 Skill** | RBAC、sudo 策略、IAM 审计 | K8s 权限收敛、云账号最小权限、SSH key 治理 |
| 11 | **日志分析 Skill** | 日志采集、聚合查询、模式识别 | EFK/Loki 配置、故障根因挖掘、异常检测 |
| 12 | **容器运维 Skill** | Dockerfile 优化、镜像扫描、K8s 排障 | 镜像瘦身、CrashLoopBackOff、Pod 资源调优 |
| 13 | **数据库运维 Skill** | 慢查询、备份、迁移、容量规划 | MySQL/PG 调优、Schema 迁移、主从切换 |
| 14 | **故障排查 Skill** | 根因分析、Runbook、事后复盘 | 生产事故应急、P0 故障定位、Postmortem |
| 15 | **配置管理 Skill** | 配置漂移、IaC、幂等性 | Ansible/Terraform/Helm 生成与校验 |

### 2.2 每类 Skill 的具体示例

下表给出每类 3-5 个具体 Skill 示例（命名遵循 SKILL.md 的 `name` 字段约定，kebab-case）。

#### 1. 环境检查 Skill
| Skill 示例 | 触发场景 | 核心动作 |
|-----------|---------|---------|
| `env-preflight` | 动工前环境依赖校验 | 检查 Node/Python/Go 版本、Docker daemon、kubectl 上下文 |
| `dependency-audit` | 依赖完整性核验 | 扫描 package.json/go.mod/requirements.txt 与 lock 文件一致性 |
| `baseline-snapshot` | 五绿门禁基线确认 | typecheck/lint/test/build 五绿状态快照 |
| `port-conflict-check` | 服务启动前端口检查 | 检测 8080/3000/5432 等常用端口占用 |

#### 2. 开发 Skill
| Skill 示例 | 触发场景 | 核心动作 |
|-----------|---------|---------|
| `scaffold-feature` | 新功能脚手架 | 按项目约定生成 component/hook/test 三件套 |
| `local-debug-setup` | 本地联调 | 配置 launch.json、环境变量、mock 服务 |
| `commit-convention` | Git 提交 | 按约定式提交生成 message、智能 staging |

#### 3. 部署 Skill
| Skill 示例 | 触发场景 | 核心动作 |
|-----------|---------|---------|
| `blue-green-deploy` | 蓝绿发布 | 切流、健康检查、回滚预案 |
| `canary-release` | 金丝雀发布 | 灰度比例控制、指标观察、自动 pause |
| `helm-release` | Helm 部署 | chart 渲染、diff、values 校验 |
| `terraform-apply` | IaC 部署 | plan 审查、state 锁、apply 审批门 |

#### 4. 安全 Skill
| Skill 示例 | 触发场景 | 核心动作 |
|-----------|---------|---------|
| `secret-scan` | 提交前密钥扫描 | 检测 AK/SK/token/私钥硬编码 |
| `supplychain-audit` | 供应链审计 | SBOM 生成、CVE 比对、许可证合规 |
| `iam-least-privilege` | 权限收敛 | 分析 IAM 策略、生成最小权限版本 |
| `container-image-scan` | 镜像扫描 | Trivy/Grype 集成、CVE 报告 |

#### 5. 检查问题 Skill
| Skill 示例 | 触发场景 | 核心动作 |
|-----------|---------|---------|
| `code-review` | PR 审查 | 按团队规范审查质量/安全/性能 |
| `config-drift-check` | 配置漂移 | 比对实际配置与 IaC 声明 |
| `yaml-lint` | K8s YAML 校验 | kubeval/kube-linter 集成 |
| `lint-staged-check` | 提交前 lint | 按 lint-staged 配置执行 |

#### 6. 监控 Skill（补充）
| Skill 示例 | 触发场景 | 核心动作 |
|-----------|---------|---------|
| `promql-generator` | Prometheus 查询 | 自然语言 → PromQL |
| `grafana-dashboard-gen` | Dashboard 生成 | 指标列表 → Grafana JSON |
| `slo-architect` | SLO 设计 | SLI 选择、错误预算、燃烧率告警 |
| `alert-noise-reduction` | 告警降噪 | 重复告警聚合、静默规则 |
| `golden-signals-dashboard` | 黄金信号面板 | 延迟/流量/错误/饱和度四面板 |

#### 7. 备份恢复 Skill（补充）
| Skill 示例 | 触发场景 | 核心动作 |
|-----------|---------|---------|
| `db-backup-strategy` | 数据库备份 | 全量/增量计划、保留策略 |
| `pv-snapshot` | PV 快照 | kubectl volume snapshot、一致性校验 |
| `disaster-recovery-drill` | DR 演练 | RTO/RPO 度量、跨区切换演练 |
| `restore-runbook` | 恢复 Runbook | 按时间点恢复、PITR 流程 |

#### 8. 网络诊断 Skill（补充）
| Skill 示例 | 触发场景 | 核心动作 |
|-----------|---------|---------|
| `connectivity-troubleshoot` | 跨区不通 | ping/traceroute/mtr 链路分析 |
| `dns-debug` | DNS 排障 | dig/nslookup、解析链路、TTL 分析 |
| `tcpdump-analyzer` | 抓包分析 | tcpdump 过滤、Wireshark 字段解读 |
| `tls-handshake-debug` | TLS 排障 | 证书链、SNI、cipher suite 诊断 |
| `service-mesh-trace` | 服务网格链路 | Istio/Linkerd 流量拓扑、xDS 解析 |

#### 9. 性能调优 Skill（补充）
| Skill 示例 | 触发场景 | 核心动作 |
|-----------|---------|---------|
| `flamegraph-gen` | CPU 性能 | perf/async-profiler 采样、火焰图渲染 |
| `kernel-tuning` | 内核调优 | sysctl 推荐、网络栈/文件句柄 |
| `jvm-tuning` | JVM 调优 | GC 日志分析、堆参数推荐 |
| `slow-query-analysis` | 慢查询 | EXPLAIN 解读、索引建议 |

#### 10. 用户权限管理 Skill（补充）
| Skill 示例 | 触发场景 | 核心动作 |
|-----------|---------|---------|
| `k8s-rbac-review` | K8s 权限审计 | ClusterRole/Binding 收敛、危险动词检测 |
| `sudo-policy-gen` | sudo 策略 | 最小 sudo 规则生成、NOPASSWD 风险检查 |
| `ssh-key-hygiene` | SSH key 治理 | authorized_keys 巡检、弱密钥淘汰 |
| `iam-permission-audit` | 云 IAM 审计 | 权限使用率分析、闲置角色清理 |

#### 11. 日志分析 Skill（补充）
| Skill 示例 | 触发场景 | 核心动作 |
|-----------|---------|---------|
| `logql-generator` | Loki 查询 | 自然语言 → LogQL |
| `log-pattern-mining` | 日志模式 | 频繁模式聚类、异常模板提取 |
| `efk-stack-config` | EFK 配置 | Fluentd/Filebeat 采集规则、索引模板 |
| `log-anomaly-detect` | 异常检测 | 基线学习、突增突降告警 |

#### 12. 容器运维 Skill（补充）
| Skill 示例 | 触发场景 | 核心动作 |
|-----------|---------|---------|
| `dockerfile-optimizer` | 镜像瘦身 | 多阶段构建、层缓存、root 检测 |
| `k8s-debug` | K8s 排障 | Pod 状态机诊断、events 解读 |
| `crashloop-diagnose` | CrashLoopBackOff | 日志/退出码/OOM 定位 |
| `resource-rightsize` | 资源调优 | HPA/VPA 推荐、request/limit 调整 |

#### 13. 数据库运维 Skill（补充）
| Skill 示例 | 触发场景 | 核心动作 |
|-----------|---------|---------|
| `schema-migration` | Schema 迁移 | online DDL、回滚脚本、锁分析 |
| `db-failover` | 主从切换 | 故障检测、提升从库、流量切换 |
| `capacity-planning` | 容量规划 | 增长预测、分库分表建议 |
| `db-health-check` | 健康检查 | 连接池、慢日志、复制延迟 |

#### 14. 故障排查 Skill（补充）
| Skill 示例 | 触发场景 | 核心动作 |
|-----------|---------|---------|
| `systematic-debugging` | 系统化排障 | 假设→插桩→复现→分析→修复→验证六步 |
| `root-cause-analysis` | 根因分析 | 5 Whys、鱼骨图、时间线还原 |
| `incident-runbook` | 应急 Runbook | 按告警类型匹配 Runbook、分级响应 |
| `postmortem-writer` | 事后复盘 | blameless 复盘、action item 跟踪 |

#### 15. 配置管理 Skill（补充）
| Skill 示例 | 触发场景 | 核心动作 |
|-----------|---------|---------|
| `ansible-playbook-gen` | 批量配置 | playbook 生成、幂等性校验 |
| `terraform-module-gen` | IaC 模块 | 可复用 module、state 后端配置 |
| `helm-chart-builder` | Helm chart | chart 脚手架、values schema |
| `config-drift-detect` | 漂移检测 | 实际态 vs 声明态 diff |

---

## 三、开源 Skill 资源清单（联网核实）

> **核实说明**：下表所有 `Stars` 与 `License` 均于 2026-07-24 通过 `gh repo view --json` 实时获取，非文章转述。`License` 为 `null` 表示仓库未声明许可证文件（GitHub API 返回 null），并非"开源"，复用前需另行确认。

### 3.1 官方仓库

| 仓库 | Stars | License | 功能描述 | 运维相关性 | 可复用性 |
|------|-------|---------|---------|-----------|---------|
| [anthropics/skills](https://github.com/anthropics/skills) | 163,876 | 混合（示例 Apache 2.0 + document-skills 为 source-available） | 官方 17 个 skill：xlsx/docx/pptx/pdf/skill-creator/mcp-builder/webapp-testing 等 | ❌ 无运维 skill | ✅ 可作为 SKILL.md 编写范本 |

**官方仓库目录实测**（`gh api repos/anthropics/skills/contents/skills`）：algorithmic-art / brand-guidelines / canvas-design / claude-api / doc-coauthoring / docx / frontend-design / internal-comms / mcp-builder / pdf / pptx / skill-creator / slack-gif-creator / theme-factory / web-artifacts-builder / webapp-testing / xlsx — **17 个，无一是运维方向**。

### 3.2 社区策展（Awesome 列表）

| 仓库 | Stars | License | 功能描述 | 运维 skill 覆盖 |
|------|-------|---------|---------|----------------|
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | 69,824 | 未声明 | 1000+ skills 聚合，分类齐全 | 含 DevOps 分类 |
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | 50,831 | Other | Claude Code skills/hooks/agents 索引 | 含 ops 类索引 |
| [sickn33/agentic-awesome-skills](https://github.com/sickn33/agentic-awesome-skills) | 43,802 | MIT | 1,987+ skills，含 AAS Core CLI、本地 MCP、Workbench | 含 DevOps & Cloud Bundle ⭐ |
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | 28,835 | MIT | 1000+ skills，最严策展（Anthropic/Microsoft/Sentry/Trail of Bits 等官方团队产出） | 含 DevOps/SRE 分类 ⭐ |
| [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | 14,272 | 未声明 | 精选清单，偏 Claude Code 工作流 | 部分 |
| [BehiSecc/awesome-claude-skills](https://github.com/BehiSecc/awesome-claude-skills) | 9,825 | 未声明 | 社区清单 | 部分 |
| [karanb192/awesome-claude-skills](https://github.com/karanb192/awesome-claude-skills) | 439 | MIT | 50+ verified skills，社区驱动 | 含 TDD/debugging |
| [JackyST0/awesome-agent-skills](https://github.com/JackyST0/awesome-agent-skills) | 601 | CC0-1.0 | 跨平台（Cursor/Claude Code/Copilot/Windsurf/Codex/OpenCode） | 含 DevOps 分类，一键安装脚本 |

> ⭐ 表示该仓库提供了角色化 Bundle 或严格策展，是运维 skill 选型的优质入口。

### 3.3 通用 Skill 大库（含运维子集）

| 仓库 | Stars | License | 功能描述 | 运维 skill 子集 |
|------|-------|---------|---------|----------------|
| [obra/superpowers](https://github.com/obra/superpowers) | 260,423 | MIT | 14+ skill，软件开发全生命周期方法论 | `systematic-debugging`（系统化排障）⭐ |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | 29,432 | 未声明 | Vercel 官方前端工程 skill | 前端为主，运维弱 |
| [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) | 23,117 | MIT | 345 skills，跨 Claude/Codex/Gemini | `engineering/` 含 chaos-engineering、docker-development、helm-chart-builder、kubernetes-operator、slo-architect、terraform-patterns、data-quality-auditor、feature-flags-architect、llm-cost-optimizer 等 ⭐ |
| [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills) | 10,712 | MIT | 66 skills，全栈开发 | `devops-engineer`、`sre-engineer`、`kubernetes-specialist`、`terraform-engineer` ⭐ |
| [trailofbits/skills](https://github.com/trailofbits/skills) | 6,247 | CC-BY-SA-4.0 | 21 个安全审计 skill | 安全审计、漏洞检测、Semgrep 规则 |

### 3.4 专门运维 Skill 仓库（核心清单）

> **关键发现**：纯运维 skill 仓库 star 普遍偏低（< 300），说明运维 skill 生态远不如开发 skill 成熟。任务要求"star > 100"，下表如实列出符合条件的，并对 star < 100 的标注说明。

| 仓库 | Stars | License | 功能描述 | 是否可复用 |
|------|-------|---------|---------|-----------|
| [aj-geddes/useful-ai-prompts](https://github.com/aj-geddes/useful-ai-prompts) | 301 | MIT | 通用 AI prompts 合集，含 `ansible-automation` skill | ✅ Ansible playbook 生成 |
| [akin-ozer/cc-devops-skills](https://github.com/akin-ozer/cc-devops-skills) | 280 | Apache 2.0 | 32 个 DevOps skill，generator+validator 配对 ⭐ | ✅ 见下方详表 |
| [ahmedasmar/devops-claude-skills](https://github.com/ahmedasmar/devops-claude-skills) | 189 | 未声明 | DevOps 工作流市场，含 Terraform/K8s/CI-CD | ⚠️ 需确认许可后复用 |
| [cosmix/loom](https://github.com/cosmix/loom) | 53 | MIT | Rust 编写的 Claude Code 多实例编排器（非 skill，是工具） | ✅ 可作为运维编排基础设施 |
| [KnoxOps/open-devops-skills](https://github.com/KnoxOps/open-devops-skills) | 38 | Apache 2.0 | SRE 专用，ICO（Infra Cost Optimizer）多云闲置资源检测 ⭐ | ✅ 成本优化场景 |
| [microsoft/azure-devops-skills](https://github.com/microsoft/azure-devops-skills) | 31 | MIT | Azure DevOps MCP Server 示例 skill | ✅ Azure 场景 |

#### akin-ozer/cc-devops-skills 详细 skill 清单（32 个，实测 `gh api`）

该仓库采用 **generator + validator 配对**模式，覆盖 IaC 与 CI/CD 全链路：

| 类别 | Generator（生成） | Validator（校验） |
|------|------------------|------------------|
| 配置管理 | ansible-generator | ansible-validator |
| CI/CD | azure-pipelines-generator / github-actions-generator / gitlab-ci-generator / jenkinsfile-generator | 对应 validator |
| 容器/编排 | dockerfile-generator / helm-generator / k8s-yaml-generator | 对应 validator |
| 监控日志 | fluentbit-generator / loki-config-generator / promql-generator / logql-generator | promql-validator / logql-validator |
| IaC | terraform-generator / terragrunt-generator | 对应 validator |
| 脚本 | bash-script-generator / makefile-generator | 对应 validator |
| 故障排查 | k8s-debug（仅一个，无配对） | — |

#### KnoxOps/open-devops-skills 的 ICO 能力

ICO（Infra Cost Optimizer）是目前社区**唯一一个成熟的成本优化 skill**，能力包括：
- 多云闲置资源检测（10+ 资源类型，CPU/网络/登录/QPS/IOPS 等多维信号）
- SSH 深度画像（流量拓扑、运行服务、cron、磁盘、业务归属）
- 安全隔离与自动回滚（iptables/安全组/scale-to-zero，异常即回滚）
- 删除前七点重评估 + 人工审批门 + 加密备份
- 自包含 HTML 报告 + 完整审计链

Roadmap 显示后续将覆盖：K8s（Pod 排障/OOM/集群右尺寸）、安全（密钥 sprawl/IAM 审计）、监控（覆盖盲区/告警降噪/Dashboard 健康分）。

### 3.5 Skill 目录与 Marketplace（非 GitHub 仓库）

| 平台 | 规模 | 特点 | 链接 |
|------|------|------|------|
| skills.sh（Vercel 出品） | 57,000+ public skills | "npm for agent skills"，`npx skills add <package>` | https://skills.sh |
| explainx.ai | 10,000+ reviewed | 人工审核、排名、verified 作者徽章 | https://explainx.ai/skills |
| SkillsMP | 1,200,000+ scraped | 最大索引，但多为低质量抓取 | https://skillsmp.com |
| ClawHub.ai | — | 社区市场 | https://clawhub.ai |
| 腾讯 SkillHub | — | 国内市场 | https://skillhub.tencent.com |
| agent-skills.md | — | 社区搜索引擎 | https://agent-skills.md |

### 3.6 未找到的资源（如实说明）

| 资源 | 说明 |
|------|------|
| `dirien/agent-skills`（含 pulumi-typescript） | `gh repo view` 返回非零退出码，**仓库不存在或已删除/改名**。多个社区文章引用此仓库，但实际无法访问，疑为文章信息过期 |
| 专门的"Linux 教学 skill"仓库 | 全网搜索未找到 star > 50 的、以 Linux 命令教学为核心目标的 Claude skill 仓库，**这是明确空白** |
| 专门的"网络诊断 skill"仓库 | 未找到独立仓库，能力散落在通用 DevOps skill 中 |
| 专门的"备份恢复 skill"仓库 | 未找到独立仓库，仅 KnoxOps ICO 涉及删除前备份 |

---

## 四、"是否需要 Skill"判断矩阵

### 4.1 判断原则

Claude Skill 的本质是**"经验封装"而非"工具扩展"**（引自掘金专栏独立分析）。判断一个运维任务是否需要 Skill 的三条铁律：

1. **大模型直接能解决 → 不需要 Skill**。例如"解释 `ls -la` 输出"，Claude 内置知识足够。
2. **需要固定流程、多步骤、本地工具调用 → 需要 Skill**。例如"K8s Pod CrashLoopBackOff 排障"需要 kubectl logs/describe/events 多步调用 + 退出码解读 + OOM 判断的固定流程。
3. **需要团队私有上下文（内部 API、定制流程）→ 必须自定义 Skill**。通用 skill 教不会 Claude 你的内部约定。

### 4.2 判断矩阵

| 任务类型 | 是否需要 Skill | 理由 | 推荐来源 |
|---------|--------------|------|---------|
| 解释单条 Linux 命令（如 `chmod 755`） | ❌ 不需要 | Claude 内置知识足够，Skill 反而增加 token 税 | — |
| 生成一段 bash 脚本（< 20 行） | ❌ 不需要 | 单次生成即可，无需固定流程 | — |
| 解释报错信息（如 `Permission denied`） | ❌ 不需要 | 通用知识，无需封装 | — |
| 回答概念问题（如"什么是 inode"） | ❌ 不需要 | 知识问答，Skill 无增益 | — |
| K8s Pod CrashLoopBackOff 排障 | ✅ 需要 | 多步 kubectl 调用 + 退出码/事件/OOM 多维判断，需固定流程 | `akin-ozer/cc-devops-skills` 的 `k8s-debug` |
| Dockerfile 生产级优化 | ✅ 需要 | 多阶段构建/层缓存/root 检测有标准 checklist | `akin-ozer` 的 `dockerfile-generator` + `dockerfile-validator` |
| Prometheus 告警规则编写 | ✅ 需要 | PromQL 语法易错 + 需配合 label/for 时长 | `akin-ozer` 的 `promql-generator` |
| 生产事故根因分析 | ✅ 需要 | 需强制走"假设→验证"六步法，避免 Claude 直接给 5 个猜测 | `obra/superpowers` 的 `systematic-debugging` |
| SLO/SLI 设计 | ✅ 需要 | 错误预算/燃烧率有专业方法论 | `Jeffallan` 的 `sre-engineer`、`alirezarezvani` 的 `slo-architect` |
| Terraform module 设计 | ✅ 需要 | state 后端/变量约定/多环境有固定模式 | `akin-ozer` 的 `terraform-generator` |
| 多云闲置资源清理 | ✅ 需要 | 多步 SSH 画像 + 安全隔离 + 审批门 | `KnoxOps/open-devops-skills` 的 ICO |
| 团队内部部署流程 | ✅ 必须自定义 | 涉及内部 API、专属审批流，通用 skill 无法覆盖 | 自研 |
| 高危命令拦截规则维护 | ✅ 必须自定义 | 项目专属红线，需结合本地风险引擎 | 自研（TDSF 项目核心） |
| Ansible playbook 批量配置 | ✅ 需要 | 幂等性校验有标准 | `aj-geddes` 的 `ansible-automation` |
| 安全漏洞审计 | ✅ 需要 | SAST/SCA/Semgrep 有专业流程 | `trailofbits/skills` |
| 代码审查 | ✅ 需要 | 团队规范需固化 | 官方 `/review` 或 `obra/superpowers` |

### 4.3 Skill 选型五步过滤框架

引自 segmentfault《装了 30 个 Skills 之后》的实战经验（agentskillreport.com 数据支撑）：

1. **是否教 Claude 不知道的东西？** — 排除通用最佳实践（通用知识 Skill 是负资产）
2. **description 是否精准触发？** — 避免宽泛描述导致误加载（description 应像路由规则，不是宣传语）
3. **SKILL.md 是否 ≤ 500 行？** — 控制 token 税（核心指令精简，细节推到 `references/`）
4. **近三个月有维护吗？** — 保障兼容新版 Claude Code
5. **是否每周使用 ≥ 3 次？** — 避免装一堆用不上的 Skill

> **关键数据**：社区 skill 中 **22% 连基本验证都过不了**，**52% 的 token 是非功能性内容**（许可证/构建产物/schema 白占上下文）。装 34 个 skill 不如精选 11 个。

---

## 五、教学场景的 Skill（Linux 教学专用）

### 5.1 现状：教学 skill 是明确空白

全网调研发现，**目前没有 star > 50 的、以 Linux 命令教学为核心目标的 Claude skill 仓库**。教学场景是待填补的蓝海，对 TDSF Linux Desktop 项目（本身定位为"SSH 终端 + AI 辅助 + 教学"）是差异化机会。

### 5.2 四类教学 Skill 设计建议

#### 1. 命令解释 Skill
| 字段 | 内容 |
|------|------|
| `name` | `linux-command-explainer` |
| `description` | Use when user asks to explain a Linux command, its flags, or output. Triggers on "这个命令什么意思"/"explain command"/命令 + 问号。 |
| 核心能力 | 拆解命令 + 选项 + 参数；类比解释；给出常见陷阱；提供 man 页关键行 |
| 教学增强 | 不只解释，还给出"为什么这样写"的设计意图（如 `chmod 755` 为何是 rwxr-xr-x） |
| 参考实现 | LabEx 的 Claude Computer Use Demo 提供了类似交互体验（见下方参考资源） |

#### 2. 错误诊断教学 Skill
| 字段 | 内容 |
|------|------|
| `name` | `linux-error-tutor` |
| `description` | Use when a Linux command fails and user wants to understand why. Triggers on non-zero exit code / stderr / "为什么报错"。 |
| 核心能力 | 解读退出码 + stderr；定位根因；给出修复命令；**追问引导**（不直接给答案，先问"你觉得哪个参数有问题"） |
| 教学增强 | 苏格拉底式追问，培养排障思维而非依赖给答案；记录"错题本"到本地 |
| 配套 | 与 TDSF 的高危命令拦截、日志分析模块联动 |

#### 3. 实验环境搭建 Skill
| 字段 | 内容 |
|------|------|
| `name` | `linux-lab-provisioner` |
| `description` | Use when user wants to set up a Linux lab environment for practice. Triggers on "搭个实验环境"/"lab"/"练习环境"。 |
| 核心能力 | Docker/VM 一键拉起指定主题实验环境（如"文件权限练习""网络配置练习""systemd 服务管理"）；自动注入预设故障供学员排查 |
| 安全约束 | 强制沙箱（Claude Code 原生 sandbox：macOS Seatbelt / Linux bubblewrap / WSL2）；禁止访问主机 `/`、`~`、SSH 密钥 |
| 参考实现 | LabEx 已提供 Claude Computer Use 的 Docker 化实验环境（`ghcr.io/anthropics/anthropic-quickstarts:computer-use-demo-latest`） |

#### 4. 学习路径推荐 Skill
| 字段 | 内容 |
|------|------|
| `name` | `linux-learning-path` |
| `description` | Use when user asks for a Linux learning plan or progress tracking. Triggers on "学习路径"/"learning path"/"从哪开始学"。 |
| 核心能力 | 评估当前水平 → 生成阶梯式学习路径（基础命令→文本处理→进程管理→网络→shell 脚本→systemd→安全）→ 跟踪完成度 → 推荐下一实验 |
| 数据持久化 | 学习进度写入本地 SQLite（与 TDSF 知识库模块复用） |
| 参考 | TDSF 项目已有 `方案书-v0.9.0-Sprint9-学习路径推荐完成.md`，可直接转化为 SKILL.md |

### 5.3 教学场景参考资源

| 资源 | 类型 | 说明 | 链接 |
|------|------|------|------|
| LabEx Claude Computer Use Demo | 实验平台 | 浏览器内 Linux VM + Claude 交互，已预装 htop/文件管理/系统监控等教学场景 | https://labex.io/zh/tutorials/docker-instant-claude-computer-use-demo-414899 |
| Claude Code Sandboxing 官方文档 | 沙箱机制 | macOS Seatbelt / Linux bubblewrap / WSL2，教学环境安全基石 | https://docs.anthropic.com/zh-CN/docs/claude-code/sandboxing |
| anthropics/skills 的 skill-creator | 元 skill | 官方 skill 创作工具，教学 skill 开发起步工具 | https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md |
| anthropics/skills 的 doc-coauthoring | 工作流范本 | 三阶段结构化协作流程，可迁移为"教学对话流" | https://github.com/anthropics/skills/blob/main/skills/doc-coauthoring/SKILL.md |

---

## 六、对 TDSF 项目的落地建议

### 6.1 优先复用（Apache 2.0 / MIT，可商用）

| 优先级 | Skill | 来源仓库 | 落地方式 |
|--------|-------|---------|---------|
| P0 | `k8s-debug` / `dockerfile-*` / `promql-*` / `terraform-*` | akin-ozer/cc-devops-skills (Apache 2.0) | 直接拷贝 SKILL.md 到 `.claude/skills/` |
| P0 | `systematic-debugging` | obra/superpowers (MIT) | 拆出单 skill，避免引入全套 14 skill 增加上下文税 |
| P0 | `devops-engineer` / `sre-engineer` | Jeffallan/claude-skills (MIT) | 按需挑 1-2 个，注意 66 skill 全装会撑爆上下文 |
| P1 | ICO（成本优化） | KnoxOps/open-devops-skills (Apache 2.0) | 适合云资源治理场景 |
| P1 | `chaos-engineering` / `slo-architect` / `kubernetes-operator` | alirezarezvani/claude-skills (MIT) | 从 engineering/ 目录精选 |

### 6.2 必须自研（项目专属）

| Skill | 理由 |
|-------|------|
| 高危命令拦截规则维护 | TDSF 核心红线，需结合本地 DecisionEngine/RiskEngine |
| SSH 会话教学引导 | 与 TDSF xterm.js 终端深度集成 |
| 日志分析与可信决策联动 | 复用 TDSF LangGraph 后端 |

### 6.3 教学差异化

TDSF 应重点投入 `linux-command-explainer`、`linux-error-tutor`、`linux-lab-provisioner`、`linux-learning-path` 四个自研教学 skill，这是目前社区空白且与项目定位高度契合的差异化方向。可基于 TDSF 已有的 `方案书-v0.9.0-Sprint9-学习路径推荐完成.md` 直接转化。

---

## 七、调研方法与数据可信度声明

### 7.1 调研方法

1. **agent-reach skill 体检**：确认 GitHub CLI（tier 0，完整可用）作为主数据源
2. **GitHub API 实时核实**：所有仓库的 stars/license 均通过 `gh repo view --json` 与 `gh api repos/<owner>/<repo>/contents` 实时获取
3. **多源交叉验证**：GitHub API 数据 + WebSearch 文章 + 社区评测三方交叉
4. **修正二手资料错误**：搜索文章中 `sickn33/antigravity-awesome-skills` 实际不存在，真实仓库为 `sickn33/agentic-awesome-skills`（43,802 stars）；`dirien/agent-skills` 实际无法访问，已如实标注

### 7.2 数据可信度分级

| 可信度 | 数据 | 说明 |
|--------|------|------|
| 🟢 高（API 实测） | 所有 GitHub stars、license、目录结构 | 2026-07-24 通过 gh CLI 实时获取 |
| 🟡 中（多源引用） | 生态规模数据（15000+ 仓库、22% 不合格率、52% token 浪费） | 来自 agentskillreport.com，多个独立文章引用 |
| 🟠 低（单源未核实） | skills.sh/explainx.ai/SkillsMP 的规模数据 | 来自 explainx 博客，未独立核实 |

### 7.3 局限性

- star 数为调研当日快照，会随时间波动
- 部分仓库 license 为 null（未声明），复用前需 `gh api repos/<owner>/<repo>/license` 或人工阅读 LICENSE 文件二次确认
- 社区 skill 质量参差不齐，**装前必读 SKILL.md 前 50 行**（segmentfault 实战经验）

---

## 附录 A：关键仓库速查表（按 star 降序）

| # | 仓库 | Stars | License | 运维相关性 |
|---|------|-------|---------|-----------|
| 1 | obra/superpowers | 260,423 | MIT | 🟡 含 systematic-debugging |
| 2 | anthropics/skills（官方） | 163,876 | 混合 | ❌ 无运维 |
| 3 | ComposioHQ/awesome-claude-skills | 69,824 | 未声明 | 🟢 策展含 DevOps |
| 4 | hesreallyhim/awesome-claude-code | 50,831 | Other | 🟢 索引含 ops |
| 5 | sickn33/agentic-awesome-skills | 43,802 | MIT | 🟢 DevOps Bundle |
| 6 | VoltAgent/awesome-agent-skills | 28,835 | MIT | 🟢 严策展含 SRE |
| 7 | vercel-labs/agent-skills | 29,432 | 未声明 | 🔴 前端为主 |
| 8 | alirezarezvani/claude-skills | 23,117 | MIT | 🟢 engineering/ 含运维 |
| 9 | travisvn/awesome-claude-skills | 14,272 | 未声明 | 🟡 部分 |
| 10 | Jeffallan/claude-skills | 10,712 | MIT | 🟢 devops/sre/k8s/terraform |
| 11 | BehiSecc/awesome-claude-skills | 9,825 | 未声明 | 🟡 部分 |
| 12 | trailofbits/skills | 6,247 | CC-BY-SA-4.0 | 🟡 安全审计 |
| 13 | JackyST0/awesome-agent-skills | 601 | CC0-1.0 | 🟢 跨平台含 DevOps |
| 14 | karanb192/awesome-claude-skills | 439 | MIT | 🟡 50+ verified |
| 15 | aj-geddes/useful-ai-prompts | 301 | MIT | 🟡 含 ansible |
| 16 | akin-ozer/cc-devops-skills | 280 | Apache 2.0 | 🟢🟢 32 个运维 skill |
| 17 | ahmedasmar/devops-claude-skills | 189 | 未声明 | 🟢 DevOps 市场 |
| 18 | cosmix/loom | 53 | MIT | 🟡 编排工具 |
| 19 | KnoxOps/open-devops-skills | 38 | Apache 2.0 | 🟢 ICO 成本优化 |
| 20 | microsoft/azure-devops-skills | 31 | MIT | 🟡 Azure 专用 |

> 图例：🟢🟢 强相关且可复用 / 🟢 强相关 / 🟡 部分相关 / 🔴 不相关 / ❌ 无

---

**报告完成。所有 GitHub 链接均经 `gh repo view` 实测可访问，stars 与 license 为 2026-07-24 实时数据。**
