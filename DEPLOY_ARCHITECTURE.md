# TDSF-Linux Desktop - Web 部署助手模块架构设计 v1.0

> 适用版本：v8.0
> 更新日期：2026-07-16
> 关联文档：[TUTORIAL_ARCHITECTURE.md](TUTORIAL_ARCHITECTURE.md)、[DEV_SKILLS.md](DEV_SKILLS.md)、[AGENTS.md](AGENTS.md)

---

## 1. 定位与目标

### 1.1 一句话定位

**Web 部署助手 = AI 驱动的"应用商店 + 一键部署"对话框，把官方教程转化成可执行的部署流水线，集成风险评估与实时日志。**

### 1.2 三大目标

1. **降低门槛**：零基础用户也能在 5 分钟内完成 LAMP / WordPress / Nginx / Docker 部署
2. **可解释性**：每条命令都来自官方教程，附带来源链接与可回滚方案
3. **人机协同**：高风险步骤（防火墙、SELinux、systemctl）强制二次确认

### 1.3 与教程模块的关系

| 维度 | 教程（Tutorial） | **部署助手（Deploy）** |
|------|-----------------|------------------------|
| 形态 | 阅读型 md | 交互式向导 |
| 来源 | 内置种子 | 教程子集（部署类） |
| 输出 | 知识 | **真实执行结果** |
| 风险 | 无 | 命令分级 + 二次确认 |
| 落地 | 不改服务器 | SSH 远程执行 + 日志回传 |

---

## 2. 部署模板（v8.0 首批 4 个）

### 2.1 模板清单

| ID | 名称 | 分类 | 难度 | 关键命令数 | 关联教程 |
|----|------|------|------|-----------|---------|
| `lamp` | LAMP 部署（Linux+Apache+MariaDB+PHP） | web-server | ⭐⭐ | 8 | `tut-lamp-centos` |
| `wordpress` | WordPress 一键安装 | web-server | ⭐ | 7 | `tut-wordpress-ubuntu` |
| `nginx-proxy` | Nginx 反向代理 + HTTPS | web-server | ⭐⭐ | 5 | `tut-nginx-reverse-proxy` |
| `docker` | Docker + Docker Compose | containers | ⭐ | 6 | `tut-docker-basics` |

### 2.2 命令风险分级

```typescript
type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical'

// 示例：LAMP 模板
const LAMP_TEMPLATE: DeployStep[] = [
  {
    id: 'lamp-1',
    description: '更新系统软件包索引',
    command: 'dnf check-update',
    risk: 'safe',          // 只读
    rollback: null,
    estimatedSeconds: 5
  },
  {
    id: 'lamp-2',
    description: '安装 Apache httpd',
    command: 'dnf install -y httpd',
    risk: 'medium',        // 安装软件
    rollback: 'dnf remove -y httpd',
    estimatedSeconds: 30
  },
  {
    id: 'lamp-3',
    description: '启动 Apache 并设置开机自启',
    command: 'systemctl enable --now httpd',
    risk: 'medium',
    rollback: 'systemctl disable --now httpd',
    estimatedSeconds: 3
  },
  {
    id: 'lamp-4',
    description: '放行 HTTP/HTTPS 端口',
    command: 'firewall-cmd --permanent --add-service=http && firewall-cmd --reload',
    risk: 'high',          // 改防火墙
    rollback: 'firewall-cmd --permanent --remove-service=http',
    estimatedSeconds: 2,
    requiresConfirm: true
  },
  ...
]
```

### 2.3 风险等级说明

| 等级 | 颜色 | 是否二次确认 | 示例 |
|------|------|-------------|------|
| safe | 🟢 | 否 | `cat /etc/os-release` |
| low | 🔵 | 否 | `mkdir /var/www/mysite` |
| medium | 🟡 | 否 | `dnf install -y pkg`、`systemctl start svc` |
| high | 🟠 | 是 | 防火墙放行、用户授权 |
| critical | 🔴 | 是 + 强制输入 "YES" | 格式化磁盘、删除用户 |

---

## 3. 模块架构

### 3.1 目录结构

```
src/
├── main/
│   ├── services/
│   │   └── deploy/
│   │       ├── types.ts                # DeployTemplate / DeployStep / DeployPlan / DeployResult
│   │       ├── templates/              # 内置部署模板
│   │       │   ├── lamp.ts             # LAMP 模板
│   │       │   ├── wordpress.ts        # WordPress 模板
│   │       │   ├── nginx-proxy.ts      # Nginx 反向代理
│   │       │   ├── docker.ts           # Docker
│   │       │   └── index.ts            # 模板注册表
│   │       ├── plan-builder.ts         # 根据模板 + 变量生成 DeployPlan
│   │       ├── executor.ts             # SSH 执行引擎（含日志推送）
│   │       └── deploy-service.ts       # 顶层服务（单例）
│   └── ipc/
│       └── deploy.ts                   # IPC handlers
├── preload/
│   └── index.ts                        # 暴露 deploy API
└── renderer/
    └── src/
        ├── components/
        │   └── deploy/
        │       ├── DeployDialog.tsx    # 部署向导主对话框
        │       ├── DeployTemplateCard.tsx
        │       ├── DeployPlanView.tsx
        │       ├── DeployLogView.tsx   # 实时日志（终端风格）
        │       └── DeployDialog.css
        └── utils/
            └── electron-api.ts
```

### 3.2 状态机

```
[关闭] --点击"部署"--> [选模板] --选模板--> [选服务器+填变量] --> [生成计划]
                                                              ↓
[关闭] <--取消-- [执行中] <--确认-- [计划预览] <--生成计划-- [生成计划]
                ↓  ↑日志推送
              [成功/失败] --关闭--> [关闭]
```

### 3.3 IPC 接口

```typescript
// preload 暴露
{
  deployListTemplates: () => Promise<DeployTemplate[]>
  deployBuildPlan: (templateId: string, variables: Record<string, string>) => Promise<DeployPlan>
  deployExecute: (sessionId: string, planId: string) => Promise<DeployResult>
  deployCancel: (planId: string) => Promise<boolean>
  deployGetPlan: (planId: string) => Promise<DeployPlan | null>
}

// 事件（主 → 渲染）
{
  'deploy:log': (planId: string, stepId: string, stream: 'stdout'|'stderr'|'system', data: string) => void
  'deploy:stepUpdate': (planId: string, step: DeployStepResult) => void
  'deploy:done': (planId: string, result: DeployResult) => void
}
```

---

## 4. UI 设计

### 4.1 模板选择（左栏）

```
┌────────────────────────────┐
│  🚀 部署模板                │
├────────────────────────────┤
│  ┌──────────────────────┐  │
│  │ 🌐 LAMP 部署        │  │  ← 选中态
│  │  Apache+MariaDB+PHP  │  │
│  │  ⭐⭐ 8 条命令  5分钟  │  │
│  └──────────────────────┘  │
│  ┌──────────────────────┐  │
│  │ 📝 WordPress         │  │
│  │  CMS 一键安装        │  │
│  │  ⭐ 7 条命令  3分钟   │  │
│  └──────────────────────┘  │
│  ┌──────────────────────┐  │
│  │ 🔀 Nginx 反向代理    │  │
│  │  HTTPS + 负载均衡     │  │
│  │  ⭐⭐ 5 条命令  4分钟  │  │
│  └──────────────────────┘  │
│  ┌──────────────────────┐  │
│  │ 🐳 Docker           │  │
│  │  容器化运行时         │  │
│  │  ⭐ 6 条命令  5分钟   │  │
│  └──────────────────────┘  │
└────────────────────────────┘
```

### 4.2 配置 + 计划预览（右栏）

```
┌────────────────────────────────────────────────────┐
│  LAMP 部署 — 192.168.45.200                       │
├────────────────────────────────────────────────────┤
│  步骤 1/8  ✅ 完成                                  │
│  ├─ 描述：更新系统软件包索引                         │
│  ├─ 命令：dnf check-update                          │
│  ├─ 风险：[安全]                                     │
│  └─ 耗时：3.2 秒                                     │
│                                                    │
│  步骤 2/8  ▶️ 执行中...                             │
│  ├─ 描述：安装 Apache httpd                          │
│  ├─ 命令：dnf install -y httpd                      │
│  ├─ 风险：[中等]                                     │
│  └─ 输出：                                           │
│      Last metadata expiration check performed...   │
│      Dependencies resolved.                         │
│      ...                                            │
│                                                    │
│  步骤 3/8  ⏸️ 等待确认                              │
│  ├─ 描述：放行 HTTP/HTTPS 端口                       │
│  ├─ 命令：firewall-cmd --permanent --add-service...  │
│  ├─ 风险：[高]                                       │
│  └─ ⚠️ 此操作将修改防火墙规则，请确认后继续             │
│      [取消] [✅ 确认执行]                              │
│                                                    │
│  步骤 4-8/8  ⏳ 待执行                              │
│  ...                                                │
└────────────────────────────────────────────────────┘
```

---

## 5. 关键技术决策

### 5.1 模板变量插值

使用简单的 `${var}` 替换，部署前用户填入：

```typescript
// 模板定义
{ command: 'mysql -u root -e "CREATE DATABASE ${dbName};"' }

// 用户填入 { dbName: 'myapp_db' } 后
// 实际执行：mysql -u root -e "CREATE DATABASE myapp_db;"
```

变量值做安全转义（防 shell 注入）：
- 数字：直接使用
- 字符串：用 `'...'` 包裹，转义单引号 `'\''`

### 5.2 执行策略

- **串行执行**：步骤按顺序执行，前一步失败则中止
- **超时控制**：每步 60s 默认，可模板自定义
- **失败回滚**：从后往前执行 rollback 命令
- **断点续传**：已成功步骤不重复执行（重启应用后可继续）

### 5.3 日志推送

- 主进程在 SSH exec 时，把 stdout/stderr 行通过 `webContents.send('deploy:log', ...)` 推送
- 渲染进程用 ref 缓存的数组管理日志，节流渲染（>100 行/秒时合并）
- 终端风格：等宽字体 + 颜色区分（stdout=黑，stderr=红，system=灰）

### 5.4 风险评估 AI 加持（可选）

利用 LLM 分析用户的服务器架构（来自 Profiler），智能调整：
- 检测到 RHEL → 自动用 `dnf`
- 检测到 Ubuntu → 自动用 `apt`
- 检测到 SELinux enforcing → 自动加 `setsebool` 命令
- 检测到防火墙启用 → 自动加 `firewall-cmd` 命令

---

## 6. 与 AI 整体助手整合

### 6.1 统一入口设计

HomePage 顶部增加 4 大能力入口：

```
┌────────────────────────────────────────────────────┐
│  🤖 TDSF AI 助手                                  │
├────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │
│  │ 🔍 系统 │ │ 📚 教程 │ │ 🚀 部署 │ │ 💬 对话 │ │
│  │ 架构感知 │ │ 知识库  │ │ 助手    │ │ 面板    │ │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ │
└────────────────────────────────────────────────────┘
```

### 6.2 与教程双向打通

- 部署模板来自教程知识库
- 部署完成后写入 knowledge_entries（type='incident_case'）
- 教程详情页底部"一键部署此教程"按钮 → 打开 DeployDialog 并预填

---

## 7. 质量保障

- **每个模板必须在 CentOS 9 / Ubuntu 22.04 实际测试通过**
- **rollback 命令必须经过验证可正常回滚**
- **失败 case 必须记录到 history 表**
- **敏感操作（防火墙/格式化）强制二次确认**

---

## 8. 风险与限制

| 风险 | 缓解措施 |
|------|---------|
| 用户误操作 | 高危命令二次确认 + 关键步骤截图留痕 |
| SSH 中断 | 已完成步骤不重做，未完成步骤标记失败 |
| 模板过时 | 每版本校验 + 关联官方教程 |
| shell 注入 | 变量严格转义 + 不允许 `； & \| \` |
| 误部署到生产 | 部署前显示目标服务器名 + 二次确认 |
