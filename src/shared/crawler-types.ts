/**
 * 教程爬虫模块 - 类型定义（主进程 + 渲染进程共享）
 *
 * 爬虫是从官方权威源（Arch Wiki / LDP / Red Hat Docs ...）抓取教程内容的程序，
 * 与 LLM 工具调用、教程知识库共同构成"知识自动同步"体系。
 *
 * 教学术语：
 * - Crawler (爬虫)：自动从网页抓取内容的程序
 * - Offline Dump (离线转储)：官方主动提供的整站数据快照
 * - Robots.txt (爬虫协议)：网站根目录的 robots.txt 声明哪些路径允许爬
 * - Crawl-delay (爬取延迟)：两次请求之间的最小间隔（毫秒）
 * - User-Agent (用户代理)：HTTP 请求头中的客户端标识
 */

/**
 * 爬虫源类型
 *
 * 教学术语：
 * - Offline Dump (离线转储)：官方主动提供的整站数据快照（如 Arch Wiki 月度 tar.gz）
 * - GitHub Clone (GitHub 克隆)：直接克隆公开仓库作为内容源（如 tldr-pages、art-of-command-line）
 * - Online Crawl (在线爬取)：通过 HTTP 抓取 HTML 页面（如 Ubuntu Help、Red Hat Docs）
 *
 * 三种方式按"礼仪风险"从低到高：
 *   offline-dump = 0（官方提供） < github-clone = 0（公开仓库，git 协议） < online-crawl = 1+（需限流、robots.txt）
 */
export type CrawlerSourceKind = 'offline-dump' | 'github-clone' | 'online-crawl'

/** 爬虫源元数据（用于 UI 展示 + 启停控制） */
export interface TutorialSourceSpec {
  /** 唯一 ID（用于 IPC / 配置存储） */
  id: string
  /** 中文标签（UI 展示） */
  label: string
  /** 来源英文名 */
  name: string
  /** 类型：离线包 or 在线爬 */
  kind: CrawlerSourceKind
  /** 抓取入口 URL（离线包 URL 或爬取首页） */
  baseUrl: string
  /** robots.txt 规定的间隔（毫秒），离线包默认 0 */
  crawlDelayMs: number
  /** License */
  license: string
  /** 默认是否启用（用户可改） */
  enabledByDefault: boolean
  /** 来源描述（用于来源说明折叠面板） */
  description: string
  /** 优先级：P0 > P1 > P2 > P3 */
  priority: 'P0' | 'P1' | 'P2' | 'P3'
}

/** 抓取进度 */
export interface CrawlProgress {
  /** 源 ID */
  sourceId: string
  /** 源标签 */
  sourceLabel: string
  /** 当前阶段 */
  phase:
    | 'downloading'
    | 'extracting'
    | 'parsing'
    | 'persisting'
    | 'embedding'
    | 'done'
    | 'error'
  /** 阶段消息（中文） */
  message: string
  /** 进度 0-1 */
  progress: number
  /** 已处理数量 */
  processed: number
  /** 总数（未知则 0） */
  total: number
  /** 错误信息（如果有） */
  error?: string
}

/** 抓取结果 */
export interface CrawlResult {
  sourceId: string
  sourceLabel: string
  /** 新增教程数 */
  inserted: number
  /** 更新教程数 */
  updated: number
  /** 跳过数（重复） */
  skipped: number
  /** 失败数 */
  failed: number
  /** 总耗时（毫秒） */
  durationMs: number
  /** 错误信息列表（失败条目） */
  errors: string[]
}

/** 抓取任务参数 */
export interface CrawlStartArgs {
  /** 要抓取的源 ID 列表；空数组 = 全部启用的源 */
  sourceIds?: string[]
  /** 是否强制重新抓取（忽略 crawledAt 缓存） */
  force?: boolean
}

/** 抓取状态查询 */
export interface CrawlStatus {
  /** 是否正在抓取 */
  running: boolean
  /** 当前任务进度（running=true 时有效） */
  current?: CrawlProgress
  /** 已完成的任务结果 */
  history: CrawlResult[]
  /** 总开始时间 */
  startedAt?: number
  /** 是否已被用户取消 */
  cancelled?: boolean
  /** 累计过滤掉的数量（v0.7.0+） */
  totalFiltered?: number
  /** 累计 checkpoint 信息（v0.7.0+） */
  checkpointSummary?: {
    total: number
    done: number
    running: number
    failed: number
  }
}

/** 源启停配置（持久化到 electron-store） */
export interface SourceToggleConfig {
  sourceId: string
  enabled: boolean
  lastCrawledAt?: number
}
