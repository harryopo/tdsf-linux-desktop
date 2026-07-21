# TDSF-Linux Desktop - 知识库教程模块架构设计 v1.0

> 适用版本：v8.0
> 更新日期：2026-07-16
> 关联文档：[DEV_SKILLS.md](DEV_SKILLS.md)、[AGENTS.md](AGENTS.md)

---

## 1. 定位与目标

### 1.1 一句话定位

**教程 = 可检索的"运维知识外脑"，从主流官方权威源爬取并结构化，支持全文/关键词/标签搜索，可一键执行或复制命令。**

### 1.2 三大目标

1. **权威性**：所有教程来源于官方文档（红帽/Ubuntu/Linux Foundation/Apache/Nginx 等），绝不爬取 CSDN/博客园的二手内容
2. **可操作性**：每条教程包含可直接复制执行的命令片段（带预期输出）
3. **可发现性**：支持中英文搜索、标签筛选、章节浏览、相关推荐

### 1.3 与现有知识库的关系

| 维度 | command_skill | incident_case | **tutorial（新）** |
|------|---------------|---------------|---------------------|
| 粒度 | 单一命令 | 故障案例 | 完整章节 |
| 来源 | 内部沉淀 | 内部沉淀 | **官方文档** |
| 长度 | 100-300 字 | 500-1500 字 | 2000-20000 字 |
| 检索 | Jaccard | Jaccard | Jaccard + 全文 + 标签 |
| 写入 | 用户手动 | 用户手动 | **应用启动时从本地种子加载** |

---

## 2. 权威数据源清单

### 2.1 Linux 基础

| 来源 | URL | 语言 | 章节数 | 特点 |
|------|-----|------|--------|------|
| **Red Hat 官方文档（中文）** | https://docs.redhat.com/zh-cn/ | 中 | 50+ | 体系最完整，企业级 |
| **Ubuntu Server Guide** | https://ubuntu.com/server/docs | 英 | 50+ | LTS 长期支持 |
| **Linux Foundation LFS101** | https://training.linuxfoundation.cn/courses/118 | 英 | 18 | 入门官方课程 |
| **Linux Foundation LFS207** | https://training.linuxfoundation.cn/courses/74 | 英 | 36 | LFCS 认证预备 |
| **Arch Wiki** | https://wiki.archlinux.org/ | 英 | 数千 | 深度百科，社区维护 |
| **Debian Administrator's Handbook** | https://debian-handbook.info/ | 中英 | 25 | Debian 体系 |

### 2.2 服务器管理

| 来源 | URL | 内容 |
|------|-----|------|
| RHEL 9 System Administration | docs.redhat.com | 用户/组、SELinux、防火墙、systemd |
| Ubuntu Server Guide § 3-5 | ubuntu.com/server/docs | Networking, Security, Managing |
| Samba 官方 | samba.org | 文件共享 |
| NFS 官方 | linux-nfs.org | 网络文件系统 |
| OpenSSH 官方 | openssh.com | 安全 Shell |

### 2.3 虚拟化与云计算

| 来源 | URL | 内容 |
|------|-----|------|
| KVM 官方 | linux-kvm.org | 内核虚拟化 |
| QEMU 官方 | qemu.org | 模拟器 |
| Docker 官方 | docs.docker.com | 容器化 |
| Kubernetes 官方 | kubernetes.io/zh-cn/docs | 编排 |
| Linux Foundation LFS200 | training.linuxfoundation.cn | 云基础 |

### 2.4 Web 部署

| 来源 | URL | 内容 |
|------|-----|------|
| Apache 官方 | httpd.apache.org/docs/ | Web 服务器 |
| Nginx 官方 | nginx.org/en/docs/ | 反向代理 |
| WordPress 官方 | wordpress.org/documentation/ | CMS |
| MariaDB 官方 | mariadb.com/kb | 数据库 |
| PHP 官方 | php.net/docs.php | 脚本语言 |
| DigitalOcean Tutorials | digitalocean.com/community/tutorials | 实操 |

### 2.5 不爬取的内容源

- ❌ CSDN / 博客园 / 简书 / 知乎专栏（二手内容，可能过时或错误）
- ❌ 个人博客（除非作者是公认专家）
- ❌ AI 生成内容（与"权威"原则冲突）
- ❌ StackOverflow 单条问答（需要社区投票验证）

---

## 3. 数据模型

### 3.1 TutorialEntry 接口

```typescript
/** 教程条目（从官方文档爬取的结构化内容） */
export interface TutorialEntry {
  /** 唯一 ID（slug 形式） */
  id: string
  /** 教程标题 */
  title: string
  /** 简短描述（1-2 句话） */
  summary: string
  /** 来源标识 */
  source: {
    /** 来源名称（如 "Red Hat"、"Ubuntu"、"LFS"） */
    name: string
    /** 原始 URL */
    url: string
    /** 抓取时间戳 */
    crawledAt: number
    /** License（如 "CC BY-SA 4.0"） */
    license: string
  }
  /** 分类（一级） */
  category: TutorialCategory
  /** 标签 */
  tags: string[]
  /** 难度等级 */
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  /** 预估阅读时间（分钟） */
  readingTime: number
  /** Markdown 主体内容 */
  content: string
  /** 关键命令片段（用于知识库搜索/Agent 引用） */
  commands: string[]
  /** 关键词（用于 Jaccard 搜索） */
  keywords: string[]
  /** 关联服务器（哪些发行版相关） */
  distros: LinuxDistro[]
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

/** 教程分类 */
export type TutorialCategory =
  | 'linux-basics'        // Linux 基础
  | 'user-management'     // 用户与权限
  | 'package-management'  // 软件包管理
  | 'networking'          // 网络
  | 'security'            // 安全
  | 'storage'             // 存储
  | 'services'            // 服务管理
  | 'virtualization'      // 虚拟化
  | 'containers'          // 容器
  | 'web-server'          // Web 服务器
  | 'database'            // 数据库
  | 'shell-scripting'     // Shell 脚本
  | 'monitoring'          // 监控
  | 'troubleshooting'     // 故障排查
  | 'cloud'               // 云计算

/** 关联 Linux 发行版 */
export type LinuxDistro = 'rhel' | 'centos' | 'rocky' | 'ubuntu' | 'debian' | 'arch' | 'opensuse' | 'fedora'
```

### 3.2 TutorialCollection（种子数据）

```typescript
/** 教程集合（打包到应用内，启动时加载到 SQLite） */
export interface TutorialCollection {
  /** 版本号（用于增量更新） */
  version: string
  /** 最后更新时间 */
  updatedAt: number
  /** 教程列表 */
  entries: TutorialEntry[]
}
```

---

## 4. 模块架构

### 4.1 目录结构

```
src/
├── main/
│   ├── services/
│   │   └── tutorial/
│   │       ├── types.ts                    # TutorialEntry / Collection 接口
│   │       ├── seed-loader.ts              # 从 JSON 加载种子数据
│   │       ├── tutorial-repo.ts            # SQLite CRUD（复用 knowledge 表）
│   │       ├── tutorial-search.ts          # Jaccard + 全文搜索
│   │       ├── tutorial-crawler.ts         # （可选）增量爬取
│   │       └── seeds/                       # 内置种子
│   │           ├── redhat-rhel9.json       # 红帽教程
│   │           ├── ubuntu-server.json      # Ubuntu 教程
│   │           ├── linux-foundation.json   # LF 教程
│   │           ├── web-deploy.json         # Web 部署教程
│   │           └── index.ts                # 种子入口
│   └── ipc/
│       └── tutorial.ts                     # 教程 IPC handlers
├── preload/
│   └── index.ts                            # 暴露 tutorial API
└── renderer/
    └── src/
        ├── components/
        │   └── tutorial/
        │       ├── TutorialPage.tsx        # 教程首页（分类+列表）
        │       ├── TutorialDetail.tsx      # 教程详情（md 渲染）
        │       ├── TutorialSearch.tsx      # 搜索组件
        │       └── TutorialList.tsx        # 列表组件
        └── pages/
            └── TutorialPage.css
```

### 4.2 IPC 接口

```typescript
// preload 暴露
{
  tutorialList: (category?: TutorialCategory) => Promise<TutorialEntry[]>
  tutorialGet: (id: string) => Promise<TutorialEntry | null>
  tutorialSearch: (query: string, limit?: number) => Promise<TutorialEntry[]>
  tutorialByTag: (tag: string) => Promise<TutorialEntry[]>
  tutorialCategories: () => Promise<{ category: string; count: number }[]>
  tutorialSeedVersion: () => Promise<string>
}
```

### 4.3 启动加载流程

```
应用启动
  ↓
tutorial:seed 通道 → main 检查 SQLite 中 tutorial 数量
  ↓
若 0 或 version 过期 → 从内置 seeds/*.json 加载
  ↓
写入 knowledge_entries 表（type='tutorial'）
  ↓
完成
```

---

## 5. UI 设计

### 5.1 教程首页（侧边栏 + 主区）

```
┌────────────────────────────────────────────────────────────┐
│  📚 知识库教程                                            │
├──────────┬─────────────────────────────────────────────────┤
│ 分类      │  搜索框 [____________________] [🔍]            │
│          │                                                  │
│ 🐧 Linux基础 │  ━━━━━━━ 推荐教程 ━━━━━━━                   │
│ 👥 用户权限 │  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│ 📦 软件管理 │  │ RHEL安装  │ │ Ubuntu网络│ │ LAMP部署  │    │
│ 🌐 网络    │  │ 入门      │ │ 配置     │ │ 一键      │    │
│ 🔒 安全    │  │ ⭐4.8    │ │ ⭐4.6    │ │ ⭐4.9    │    │
│ 💾 存储    │  └──────────┘ └──────────┘ └──────────┘    │
│ ⚙️ 服务   │                                                  │
│ 🖥️ 虚拟化│  ━━━━━━━ 最新教程 ━━━━━━━                     │
│ 📦 容器   │  ...                                            │
│ 🌐 Web   │                                                  │
│ 🗄️ 数据库│                                                  │
│ 📜 Shell │                                                  │
│ 📊 监控  │                                                  │
│ 🆘 排障  │                                                  │
│ ☁️ 云    │                                                  │
└──────────┴─────────────────────────────────────────────────┘
```

### 5.2 教程详情页

```
┌────────────────────────────────────────────────────────────┐
│  ← 返回    📖 在 RHEL 9 上安装 LAMP                     ⭐  │
├────────────────────────────────────────────────────────────┤
│  来源：Red Hat 官方文档 · 难度：中级 · 12 分钟              │
│  标签：[RHEL] [LAMP] [Web] [Apache] [MariaDB] [PHP]       │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  # 在 RHEL 9 上安装 LAMP                                  │
│                                                            │
│  ## 1. 安装 Apache                                         │
│  ```bash                                                   │
│  sudo dnf install httpd                                    │
│  sudo systemctl enable --now httpd                         │
│  ```                                                       │
│  ...                                                       │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  [📋 复制全部命令]  [▶ 在终端执行]  [🔗 打开原文]         │
└────────────────────────────────────────────────────────────┘
```

### 5.3 与知识库的双向打通

- 教程详情页底部"相关知识库"：列出关联的 command_skill / incident_case
- 知识库详情页"相关教程"：列出关联的 tutorial
- AI 对话面板中可引用教程 ID（`@tutorial:rhcsa-lamp-install`）

---

## 6. AI 整体助手整合

### 6.1 助手能力矩阵

| 能力 | 模块 | UI 入口 | 状态 |
|------|------|---------|------|
| 系统架构感知 | ProfilerDialog | ServerList 右键 | ✅ v8.0 |
| 知识库教程浏览 | TutorialPage | 侧边栏 | 🆕 v8.0 |
| 知识库搜索 | KnowledgePage | 侧边栏 | ✅ v7.0 |
| AI 对话 | ChatPanel | 主页 | ✅ v7.0 |
| Agent 决策 | AgentWorkflowPanel | 主页 | ✅ v7.0 |
| Web 部署助手 | DeployDialog | ServerList 右键 | 🆕 v8.0 |
| 服务器管理 | ServerList | 侧边栏 | ✅ |
| 实时监控 | MonitorPanel | 主页 | ✅ |
| LLM Trace | Langfuse | 设置 | ✅ v7.0 |
| MCP Server | 后台 | 无 | ✅ v7.0 |

### 6.2 AI 助手统一入口设计（HomePage）

```
┌────────────────────────────────────────────────────────────┐
│  🤖 TDSF AI 助手                                          │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │
│  │ 🔍 系统 │ │ 📚 教程 │ │ 🛠️ 部署 │ │ 💬 自由 │         │
│  │ 架构感知 │ │ 知识库  │ │ 助手    │ │ 对话    │         │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘         │
│                                                            │
│  ┌────────────────────────────────────────────────────┐   │
│  │ 💬 问我任何 Linux 问题...                          │   │
│  │                                                    │   │
│  └────────────────────────────────────────────────────┘   │
│                                                            │
│  最近活动：                                                │
│  • 15:30 - 探查了 192.168.45.200（发现 2 项中危）         │
│  • 14:20 - 在知识库添加了"SSH 密钥登录"案例              │
└────────────────────────────────────────────────────────────┘
```

---

## 7. 种子数据计划（v8.0 上线 ≥ 50 篇）

### 7.1 第一批（10 篇，v8.0 必交付）

1. **RHEL 9 系统更新与基础配置** (linux-basics, intermediate)
2. **Ubuntu 22.04 LTS 服务器初始化** (linux-basics, beginner)
3. **CentOS 7 / RHEL 防火墙配置（firewalld）** (security, intermediate)
4. **SELinux 基础与故障排查** (security, advanced)
5. **systemd 服务管理完全指南** (services, intermediate)
6. **在 Ubuntu 上配置静态 IP（Netplan）** (networking, beginner)
7. **LAMP 部署完整教程（CentOS）** (web-server, intermediate)
8. **WordPress 一键安装（Ubuntu 22.04）** (web-server, beginner)
9. **Nginx 反向代理配置** (web-server, intermediate)
10. **Docker 容器化入门** (containers, beginner)

### 7.2 第二批（20 篇，v8.1 扩展）

- 用户与组管理（5 篇）
- 软件包管理（5 篇）
- SSH 安全加固（3 篇）
- LVM 存储管理（4 篇）
- KVM 虚拟化（3 篇）

### 7.3 第三批（20+ 篇，v8.2 扩展）

- 监控告警（5 篇）
- 数据库（5 篇）
- Shell 脚本（5 篇）
- 故障排查（5 篇）
- 云计算入门（3 篇）

---

## 8. 质量保障

- **每条教程必须有 source.url 可点击验证**
- **每条命令必须经过本地 CentOS/RHEL 9 实际测试**
- **License 字段必须填写，避免 License 风险**
- **超过 12 个月未更新的源标注 ⚠️**

---

## 9. 风险与限制

| 风险 | 缓解措施 |
|------|---------|
| 官方源 URL 失效 | 缓存源快照到本地 |
| 官方源反爬 | 频率限制 ≤ 1 req/s + UA 标识 |
| 内容 License 风险 | 仅收录明确 License 的内容 |
| 翻译质量 | 优先中文官方源（红帽中文站），其次英文 |
| 教程过时 | 标注发布时间，v9.0 重审 |
