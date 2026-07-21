/**
 * KnowledgePage v1 — 类型定义 + Mock 数据
 *
 * 设计稿：tdsf-linux-redesign/pages/knowledge.html
 *
 * 数据来源：知识库列表设计稿（12 条知识 + 5 条热门 + 3 条最近浏览）
 */
import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Clock,
  Eye,
  Star,
} from 'lucide-react'

/** 知识条目分类枚举（8 类） */
export type KnowledgeCategory =
  | 'all'
  | 'nginx'
  | 'mysql'
  | 'docker'
  | 'network'
  | 'security'
  | 'shell'
  | 'systemd'

/** 知识条目数据结构 */
export interface KnowledgeItem {
  /** 知识 ID（路由参数） */
  id: string
  /** 标题 */
  title: string
  /** 摘要（2 行截断） */
  summary: string
  /** 分类 */
  category: Exclude<KnowledgeCategory, 'all'>
  /** 标签列表 */
  tags: string[]
  /** 更新时间（人类可读） */
  updatedAt: string
  /** 阅读量 */
  views: number
  /** AI 匹配度（0-100） */
  matchScore: number
}

/** 分类配置（id → 中文标签） */
export const CATEGORIES: { id: KnowledgeCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'nginx', label: 'nginx' },
  { id: 'mysql', label: 'mysql' },
  { id: 'docker', label: 'docker' },
  { id: 'network', label: 'network' },
  { id: 'security', label: 'security' },
  { id: 'shell', label: 'shell' },
  { id: 'systemd', label: 'systemd' },
]

/** Mock 知识条目（12 条，覆盖 7 个分类） */
export const KNOWLEDGE_ITEMS: KnowledgeItem[] = [
  {
    id: 'KB-NGINX-014',
    title: 'Nginx worker_connections 调优指南',
    summary:
      '当 worker_connections 达到上限时,请求将排队等待,响应延迟急剧上升。本文详解 worker_processes 与 worker_connections 的协同调优,含压力测试数据。',
    category: 'nginx',
    tags: ['性能调优', '连接数'],
    updatedAt: '2天前',
    views: 1200,
    matchScore: 98,
  },
  {
    id: 'KB-MYSQL-007',
    title: 'MySQL 连接数过多的排查与解决',
    summary:
      'SHOW PROCESSLIST 查看活跃连接,调整 max_connections 与 wait_timeout,定位慢查询与长事务,释放被占用的连接池资源。',
    category: 'mysql',
    tags: ['连接池', '慢查询'],
    updatedAt: '5天前',
    views: 890,
    matchScore: 95,
  },
  {
    id: 'KB-SHELL-021',
    title: 'Linux 磁盘空间满的应急处理',
    summary:
      '使用 du 和 find 定位大文件,清理日志、临时文件与孤立数据,扩展分区或挂载新盘,避免服务因磁盘写满而崩溃。',
    category: 'shell',
    tags: ['磁盘', '应急'],
    updatedAt: '1周前',
    views: 2100,
    matchScore: 92,
  },
  {
    id: 'KB-DOCKER-003',
    title: 'Docker 容器日志清理方案',
    summary:
      'docker system prune 清理无用镜像和日志,配置 log-rotate 与 max-size 限制,持久化日志到外部采集系统。',
    category: 'docker',
    tags: ['日志', '清理'],
    updatedAt: '3天前',
    views: 670,
    matchScore: 88,
  },
  {
    id: 'KB-SEC-009',
    title: 'SSH 安全加固最佳实践',
    summary:
      '禁用 root 登录、密钥认证替代密码、修改默认端口、配置 fail2ban 防暴力破解,构建最小化暴露面。',
    category: 'security',
    tags: ['SSH', '加固'],
    updatedAt: '1周前',
    views: 1500,
    matchScore: 85,
  },
  {
    id: 'KB-NET-011',
    title: 'iptables 防火墙规则配置指南',
    summary:
      '详解 iptables 四表五链,常用规则编写,端口放行与 IP 黑白名单,持久化规则到 /etc/sysconfig/iptables。',
    category: 'network',
    tags: ['防火墙', 'iptables'],
    updatedAt: '4天前',
    views: 980,
    matchScore: 82,
  },
  {
    id: 'KB-SYS-005',
    title: 'systemd 服务管理实战',
    summary:
      'systemctl 启停服务,unit 文件编写,依赖关系与启动顺序,日志查看 journalctl,服务异常自动重启配置。',
    category: 'systemd',
    tags: ['服务管理', 'journalctl'],
    updatedAt: '6天前',
    views: 1120,
    matchScore: 80,
  },
  {
    id: 'KB-NGINX-021',
    title: 'Nginx upstream 后端健康检查',
    summary:
      '被动健康检查与主动健康检查对比,nginx_upstream_check_module 集成,健康检查间隔与阈值调优。',
    category: 'nginx',
    tags: ['upstream', '健康检查'],
    updatedAt: '2周前',
    views: 760,
    matchScore: 78,
  },
  {
    id: 'KB-MYSQL-013',
    title: 'MySQL 主从复制延迟排查',
    summary:
      'Seconds_Behind_Master 含义,大事务导致延迟,并行复制配置,binlog 格式选择,网络抖动排查。',
    category: 'mysql',
    tags: ['主从', '复制'],
    updatedAt: '8天前',
    views: 540,
    matchScore: 76,
  },
  {
    id: 'KB-DOCKER-018',
    title: 'Docker 多阶段构建优化镜像体积',
    summary:
      '多阶段 Dockerfile 编写,基础镜像选择 alpine vs slim,构建缓存优化,docker-slim 进一步压缩。',
    category: 'docker',
    tags: ['镜像优化', '构建'],
    updatedAt: '5天前',
    views: 420,
    matchScore: 74,
  },
  {
    id: 'KB-NET-026',
    title: 'TCP 连接状态排查与 TIME_WAIT 优化',
    summary:
      'ss/netstat 统计连接状态,TIME_WAIT 堆积原因,tw_reuse/tw_recycle 参数,短连接优化方案。',
    category: 'network',
    tags: ['TCP', 'TIME_WAIT'],
    updatedAt: '10天前',
    views: 830,
    matchScore: 71,
  },
  {
    id: 'KB-SEC-015',
    title: 'SELinux 故障排查与策略配置',
    summary:
      'sealert 日志分析,audit2allow 生成策略,setroubleshoot 工具使用,布尔值与端口标签管理。',
    category: 'security',
    tags: ['SELinux', '策略'],
    updatedAt: '2周前',
    views: 650,
    matchScore: 68,
  },
]

/** 热门知识 Top5（Mock，含 id 用于点击跳转详情） */
export const HOT_ITEMS: { rank: number; title: string; views: string; id: string }[] = [
  { rank: 1, title: 'P99 延迟优化实战', views: '4.2k', id: 'KB-NGINX-014' },
  { rank: 2, title: '系统巡检脚本大全', views: '3.8k', id: 'KB-SYS-005' },
  { rank: 3, title: 'iptables 防火墙配置', views: '3.1k', id: 'KB-NET-011' },
  { rank: 4, title: 'Cron 定时任务指南', views: '2.7k', id: 'KB-SHELL-021' },
  { rank: 5, title: '内存泄漏排查', views: '2.3k', id: 'KB-MYSQL-007' },
]

/** 最近浏览（Mock，含 id 用于点击跳转详情） */
export const RECENT_ITEMS: { title: string; time: string; id: string }[] = [
  { title: 'Nginx 日志分析', time: '3小时前', id: 'KB-NGINX-021' },
  { title: 'CPU 负载高排查', time: '昨天', id: 'KB-NGINX-014' },
  { title: 'systemd 服务管理', time: '2天前', id: 'KB-SYS-005' },
]

/** 导出 Lucide 图标供子组件复用（避免重复 import） */
export const ICONS: {
  Star: LucideIcon
  Clock: LucideIcon
  Eye: LucideIcon
  BookOpen: LucideIcon
} = { Star, Clock, Eye, BookOpen }
