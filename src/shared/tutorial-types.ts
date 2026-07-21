/**
 * 教程模块 - 类型定义（主进程 + 渲染进程共享）
 *
 * 教程是从官方权威源爬取/整理的结构化知识，
 * 与命令技能（command_skill）和故障案例（incident_case）共同构成知识库三轨制。
 *
 * 数据流：
 *   seeds/*.json (内置) → SQLite knowledge_entries (type='tutorial')
 *   UI 渲染时按 category / tags / 关键词检索
 */

/** 教程分类（一级） */
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
export type LinuxDistro =
  | 'rhel' | 'centos' | 'rocky' | 'fedora'
  | 'ubuntu' | 'debian'
  | 'arch' | 'opensuse'

/** 难度等级 */
export type TutorialDifficulty = 'beginner' | 'intermediate' | 'advanced'

/** 来源信息 */
export interface TutorialSource {
  /** 来源名称（如 "Red Hat"、"Ubuntu"、"LFS"） */
  name: string
  /** 原始 URL */
  url: string
  /** 抓取/整理时间戳 */
  crawledAt: number
  /** License（如 "CC BY-SA 4.0"、"Free Documentation"） */
  license: string
  /**
   * License 详情页 URL（点击 License 标签跳转）
   * 留空时按 license 字符串自动识别：
   * - "CC BY-SA 4.0" → https://creativecommons.org/licenses/by-sa/4.0/
   * - "GNU FDL 1.3" → https://www.gnu.org/licenses/fdl-1.3.html
   * - "MIT" → https://opensource.org/licenses/MIT
   */
  licenseUrl?: string
  /**
   * 来源类型（用于 UI 区分）
   * - offline-dump：官方月度快照（Arch Wiki）
   * - github-clone：GitHub 仓库 clone（tldr-pages）
   * - online-crawl：在线增量抓取
   */
  kind?: 'offline-dump' | 'github-clone' | 'online-crawl'
}

/** 教程条目 */
export interface TutorialEntry {
  id: string
  title: string
  summary: string
  source: TutorialSource
  category: TutorialCategory
  tags: string[]
  difficulty: TutorialDifficulty
  /** 预估阅读时间（分钟） */
  readingTime: number
  /** Markdown 主体内容 */
  content: string
  /** 关键命令片段（用于知识库搜索/Agent 引用） */
  commands: string[]
  /** 关键词（用于 Jaccard 搜索） */
  keywords: string[]
  /** 关联 Linux 发行版 */
  distros: LinuxDistro[]
  createdAt: number
  updatedAt: number
}

/** 教程集合（打包到应用内，启动时加载到 SQLite） */
export interface TutorialCollection {
  /** 版本号（用于增量更新） */
  version: string
  /** 最后更新时间 */
  updatedAt: number
  /** 教程列表 */
  entries: TutorialEntry[]
}

/** 教程 IPC 响应 */
export interface TutorialListItem {
  id: string
  title: string
  summary: string
  category: TutorialCategory
  tags: string[]
  difficulty: TutorialDifficulty
  readingTime: number
  sourceName: string
  updatedAt: number
}

/** 分类汇总 */
export interface TutorialCategorySummary {
  category: TutorialCategory
  count: number
  label: string
}

/** 中文分类标签 */
export const TUTORIAL_CATEGORY_LABELS: Record<TutorialCategory, string> = {
  'linux-basics': '🐧 Linux 基础',
  'user-management': '👥 用户权限',
  'package-management': '📦 软件管理',
  'networking': '🌐 网络',
  'security': '🔒 安全',
  'storage': '💾 存储',
  'services': '⚙️ 服务管理',
  'virtualization': '🖥️ 虚拟化',
  'containers': '📦 容器',
  'web-server': '🌐 Web 服务器',
  'database': '🗄️ 数据库',
  'shell-scripting': '📜 Shell 脚本',
  'monitoring': '📊 监控',
  'troubleshooting': '🆘 排障',
  'cloud': '☁️ 云'
}

/** 难度等级标签 */
export const TUTORIAL_DIFFICULTY_LABELS: Record<TutorialDifficulty, string> = {
  beginner: '入门',
  intermediate: '中级',
  advanced: '高级'
}

/** 难度等级颜色 */
export const TUTORIAL_DIFFICULTY_COLORS: Record<TutorialDifficulty, string> = {
  beginner: '#52c41a',
  intermediate: '#faad14',
  advanced: '#f5222d'
}
