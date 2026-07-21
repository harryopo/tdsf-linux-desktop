/**
 * KnowledgePage — 运维知识库页（1:1 复刻 knowledge.html 设计稿）
 *
 * 路由：/knowledge
 * 设计稿：tdsf-linux-redesign/pages/knowledge.html
 * Spec: build-runnable-tdsf-from-design · Task 2.8
 *
 * 结构（4 section，1:1 对齐设计稿）：
 *   1. Page Header：layers 图标 + 标题"运维知识库" + 副标题 + 返回工作台按钮
 *   2. 搜索栏：搜索框 + AI检索按钮 + 8 个分类标签（all/nginx/mysql/docker/network/security/shell/systemd）
 *   3. 两栏布局：
 *      - 左：5 个推荐知识卡片（标题 + 匹配度 + 摘要 + 标签/时间/浏览量/查看详情）
 *      - 右：热门知识 Top5 + 最近浏览 3 项
 *   4. AI 知识沉淀：已收录 1,247 条 / 本周新增 23 条 / AI 贡献率 68% + 贡献知识按钮
 *
 * 数据：严格使用设计稿 knowledge.html 示例数据（5 卡片 + 5 热门 + 3 最近 + 贡献统计）
 * 视觉：全部 var(--trae-*) token，无硬编码 hex/rgba
 * 无障碍：button type + aria-label/aria-pressed，prefers-reduced-motion 禁用按压动画
 */
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Layers, ArrowLeft, Search, Sparkles, Clock, Eye,
  ArrowUpRight, Star, FileText, Plus,
} from 'lucide-react'

// ==================== 类型定义 ====================

type KnowledgeCategory = 'all' | 'nginx' | 'mysql' | 'docker' | 'network' | 'security' | 'shell' | 'systemd'

interface KnowledgeItem {
  id: string
  title: string
  summary: string
  category: Exclude<KnowledgeCategory, 'all'>
  updatedAt: string
  views: string
  matchScore: number
}

interface HotItem { rank: number; title: string; views: string; id: string }
interface RecentItem { title: string; time: string; id: string }

// ==================== 静态示例数据（1:1 来自设计稿 knowledge.html） ====================

const CATEGORIES: { id: KnowledgeCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'nginx', label: 'nginx' },
  { id: 'mysql', label: 'mysql' },
  { id: 'docker', label: 'docker' },
  { id: 'network', label: 'network' },
  { id: 'security', label: 'security' },
  { id: 'shell', label: 'shell' },
  { id: 'systemd', label: 'systemd' },
]

const KNOWLEDGE_ITEMS: KnowledgeItem[] = [
  { id: 'KB-NGINX-014', title: 'Nginx worker_connections 调优指南', summary: '当worker_connections达到上限时,请求将排队等待,响应延迟急剧上升。本文详解worker_processes与worker_connections的协同调优,含压力测试数据。', category: 'nginx', updatedAt: '2天前', views: '1.2k', matchScore: 98 },
  { id: 'KB-MYSQL-007', title: 'MySQL连接数过多的排查与解决', summary: 'SHOW PROCESSLIST查看活跃连接,调整max_connections与wait_timeout,定位慢查询与长事务,释放被占用的连接池资源。', category: 'mysql', updatedAt: '5天前', views: '890', matchScore: 95 },
  { id: 'KB-SHELL-021', title: 'Linux磁盘空间满的应急处理', summary: '使用du和find定位大文件,清理日志、临时文件与孤立数据,扩展分区或挂载新盘,避免服务因磁盘写满而崩溃。', category: 'shell', updatedAt: '1周前', views: '2.1k', matchScore: 92 },
  { id: 'KB-DOCKER-003', title: 'Docker容器日志清理方案', summary: 'docker system prune清理无用镜像和日志,配置log-rotate与max-size限制,持久化日志到外部采集系统。', category: 'docker', updatedAt: '3天前', views: '670', matchScore: 88 },
  { id: 'KB-SEC-009', title: 'SSH安全加固最佳实践', summary: '禁用root登录、密钥认证替代密码、修改默认端口、配置fail2ban防暴力破解,构建最小化暴露面。', category: 'security', updatedAt: '1周前', views: '1.5k', matchScore: 85 },
]

const HOT_ITEMS: HotItem[] = [
  { rank: 1, title: 'P99延迟优化实战', views: '4.2k', id: 'KB-NGINX-014' },
  { rank: 2, title: '系统巡检脚本大全', views: '3.8k', id: 'KB-SYS-005' },
  { rank: 3, title: 'iptables防火墙配置', views: '3.1k', id: 'KB-NET-011' },
  { rank: 4, title: 'Cron定时任务指南', views: '2.7k', id: 'KB-SHELL-021' },
  { rank: 5, title: '内存泄漏排查', views: '2.3k', id: 'KB-MYSQL-007' },
]

const RECENT_ITEMS: RecentItem[] = [
  { title: 'Nginx日志分析', time: '3小时前', id: 'KB-NGINX-021' },
  { title: 'CPU负载高排查', time: '昨天', id: 'KB-NGINX-014' },
  { title: 'systemd服务管理', time: '2天前', id: 'KB-SYS-005' },
]

const CONTRIBUTION_STATS: { label: string; value: string; brand: boolean }[] = [
  { label: '已收录', value: '1,247 条', brand: false },
  { label: '本周新增', value: '23 条', brand: false },
  { label: 'AI贡献率', value: '68%', brand: true },
]

// ==================== 主组件 ====================

/** KnowledgePage — 运维知识库页 */
export function KnowledgePage() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<KnowledgeCategory>('all')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const handleBack = () => navigate('/workbench')
  const handleOpenKnowledge = (id: string) => navigate(`/knowledge/${id}`)
  const handleAiSearchFocus = () => searchInputRef.current?.focus()
  const handleContribute = () => {
    window.alert('贡献知识功能正在开发中，敬请期待后续版本接入知识新增弹窗。')
  }

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return KNOWLEDGE_ITEMS.filter((item) => {
      const catMatch = activeCategory === 'all' || item.category === activeCategory
      const searchMatch = q === '' || item.title.toLowerCase().includes(q) || item.summary.toLowerCase().includes(q)
      return catMatch && searchMatch
    })
  }, [searchQuery, activeCategory])

  return (
    <main style={{ background: 'var(--trae-bg-base-default)', color: 'var(--trae-text-default)', minHeight: '100%' }}>
      <div style={{ padding: '24px 24px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ====== 1. Page Header ====== */}
        <header className="flex items-start justify-between gap-6 pb-5" style={{ borderBottom: '1px solid var(--trae-border-neutral-l1)' }}>
          <div className="flex min-w-0 flex-col" style={{ gap: 6 }}>
            <div className="flex items-center" style={{ gap: 10 }}>
              <Layers size={26} strokeWidth={2} style={{ color: 'var(--trae-icon-brand)' }} />
              <h1 style={{ fontFamily: 'var(--trae-heading-2xl-font-family)', fontSize: 'var(--trae-heading-2xl-font-size)', lineHeight: 'var(--trae-heading-2xl-line-height)', fontWeight: 'var(--trae-font-weight-strong)', color: 'var(--trae-text-default)', margin: 0, wordBreak: 'keep-all' }}>运维知识库</h1>
            </div>
            <p style={{ fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 'var(--trae-body-xs-line-height)', color: 'var(--trae-text-tertiary)', margin: 0 }}>AI驱动的运维知识检索与沉淀</p>
          </div>
          <button type="button" data-dom-id="back-workbench" aria-label="返回工作台" onClick={handleBack} className="btn-press inline-flex shrink-0 cursor-pointer items-center transition-colors" style={{ gap: 6, height: 32, padding: '0 12px', border: '1px solid var(--trae-border-neutral-l2)', borderRadius: 'var(--trae-radius-6)', background: 'var(--trae-bg-overlay-l2)', color: 'var(--trae-text-default)', fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)' }}>
            <ArrowLeft size={14} style={{ color: 'var(--trae-icon-default)' }} />
            <span>返回工作台</span>
          </button>
        </header>

        {/* ====== 2. Search Bar ====== */}
        <div style={{ background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: 12 }}>
          {/* 搜索输入框 + AI检索按钮 */}
          <div className="flex items-center" style={{ gap: 8 }}>
            <div className="kb-search-wrapper flex h-10 min-w-0 flex-1 items-center" style={{ gap: 8, padding: '0 12px', background: 'var(--trae-bg-base-tertiary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-6)' }}>
              <Search size={16} className="shrink-0" style={{ color: 'var(--trae-icon-secondary)' }} />
              <input
                ref={searchInputRef}
                type="text"
                data-dom-id="search-knowledge"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索知识、故障、解决方案..."
                aria-label="搜索知识"
                className="placeholder:text-[var(--trae-text-tertiary)] min-w-0 flex-1 border-none bg-transparent outline-none"
                style={{ fontFamily: 'var(--trae-font-family-mono)', fontSize: 'var(--trae-body-md-font-size)', lineHeight: 'var(--trae-body-md-line-height)', color: 'var(--trae-text-default)' }}
              />
            </div>
            <button type="button" aria-label="AI检索" onClick={handleAiSearchFocus} className="btn-press inline-flex h-10 shrink-0 cursor-pointer items-center transition-colors" style={{ gap: 6, padding: '0 16px', background: 'var(--trae-bg-brand)', color: 'var(--trae-text-onbrand)', border: '1px solid var(--trae-bg-brand)', borderRadius: 'var(--trae-radius-6)', fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)' }}>
              <Sparkles size={16} style={{ color: 'var(--trae-icon-onbrand)' }} />
              <span>AI检索</span>
            </button>
          </div>
          {/* 分类标签栏 */}
          <div className="no-scrollbar mt-3 flex items-center overflow-x-auto" style={{ gap: 8 }}>
            {CATEGORIES.map((cat) => {
              const active = activeCategory === cat.id
              return (
                <button key={cat.id} type="button" onClick={() => setActiveCategory(cat.id)} aria-pressed={active} className="btn-press inline-flex h-6 shrink-0 cursor-pointer items-center whitespace-nowrap border transition-colors" style={{ padding: '0 10px', background: active ? 'var(--trae-bg-brand-popup)' : 'var(--trae-bg-overlay-l2)', color: active ? 'var(--trae-text-brand)' : 'var(--trae-text-secondary)', borderColor: active ? 'var(--trae-border-brand)' : 'var(--trae-border-neutral-l1)', fontSize: 'var(--trae-body-xs-font-size)', fontWeight: active ? 'var(--trae-font-weight-medium)' : undefined, borderRadius: 'var(--trae-radius-4)' }}>
                  {cat.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* ====== 3. Two-column Layout ====== */}
        <div className="flex flex-col lg:flex-row" style={{ gap: 16 }}>
          {/* 左栏：知识卡片列表 */}
          <div className="flex min-w-0 flex-1 flex-col" style={{ gap: 12 }}>
            {filteredItems.length === 0 ? (
              <div style={{ background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: 32, textAlign: 'center', color: 'var(--trae-text-tertiary)', fontSize: 'var(--trae-body-sm-font-size)' }}>未找到匹配的知识条目</div>
            ) : (
              filteredItems.map((item) => (
                <article key={item.id} className="kb-card" style={{ background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: 16 }}>
                  <div className="mb-2 flex items-start justify-between" style={{ gap: 12 }}>
                    <h3 className="min-w-0 truncate" style={{ fontSize: 'var(--trae-body-base-strong-font-size)', lineHeight: 'var(--trae-body-base-strong-line-height)', fontWeight: 'var(--trae-font-weight-strong)', color: 'var(--trae-text-default)', margin: 0 }}>{item.title}</h3>
                    <span className="inline-flex h-5 shrink-0 items-center whitespace-nowrap" style={{ padding: '0 8px', background: 'var(--trae-bg-brand-popup)', color: 'var(--trae-text-brand)', fontSize: 'var(--trae-body-xs-font-size)', fontWeight: 'var(--trae-font-weight-medium)', borderRadius: 'var(--trae-radius-2)', border: '1px solid var(--trae-border-brand)', fontVariantNumeric: 'tabular-nums' }}>{item.matchScore}%匹配</span>
                  </div>
                  <p className="line-clamp-2 mb-3" style={{ fontSize: 'var(--trae-body-sm-font-size)', lineHeight: 'var(--trae-body-sm-line-height)', color: 'var(--trae-text-secondary)', margin: 0 }}>{item.summary}</p>
                  <div className="flex flex-wrap items-center" style={{ gap: 12, fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-tertiary)' }}>
                    <span className="inline-flex h-5 items-center" style={{ padding: '0 8px', background: 'var(--trae-bg-overlay-l3)', color: 'var(--trae-text-secondary)', borderRadius: 'var(--trae-radius-2)' }}>{item.category}</span>
                    <span className="inline-flex items-center" style={{ gap: 4 }}>
                      <Clock size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                      {item.updatedAt}
                    </span>
                    <span className="inline-flex items-center" style={{ gap: 4 }}>
                      <Eye size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{item.views}</span>
                    </span>
                    <button type="button" data-dom-id={`goto-knowledge-${item.id}`} aria-label={`查看详情：${item.title}`} onClick={() => handleOpenKnowledge(item.id)} className="btn-press ml-auto inline-flex cursor-pointer items-center transition-colors" style={{ gap: 4, color: 'var(--trae-text-brand)', fontSize: 'var(--trae-body-xs-font-size)', background: 'transparent', border: 'none', padding: 0 }}>
                      查看详情
                      <ArrowUpRight size={12} style={{ color: 'var(--trae-icon-brand)' }} />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>

          {/* 右栏：侧边栏 280px */}
          <aside className="flex w-full shrink-0 flex-col lg:w-[280px]" style={{ gap: 12 }}>
            {/* 热门知识 */}
            <section style={{ background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: 16 }}>
              <div className="mb-3 flex items-center" style={{ gap: 8 }}>
                <Star size={16} style={{ color: 'var(--trae-icon-brand)' }} />
                <h2 style={{ fontSize: 'var(--trae-heading-xs-font-size)', lineHeight: 'var(--trae-heading-xs-line-height)', fontWeight: 'var(--trae-heading-xs-font-weight)', color: 'var(--trae-text-default)', margin: 0 }}>热门知识</h2>
              </div>
              <ol className="flex flex-col" style={{ gap: 10, margin: 0, padding: 0, listStyle: 'none' }}>
                {HOT_ITEMS.map((hot) => (
                  <li key={hot.id} data-dom-id={`goto-hot-knowledge-${hot.id}`} onClick={() => handleOpenKnowledge(hot.id)} className="flex cursor-pointer items-center" style={{ gap: 10 }}>
                    <span className="w-4 shrink-0 text-center" style={{ fontSize: 'var(--trae-body-sm-font-size)', lineHeight: 'var(--trae-body-sm-line-height)', fontWeight: 'var(--trae-font-weight-strong)', color: 'var(--trae-text-brand)', fontVariantNumeric: 'tabular-nums' }}>{hot.rank}</span>
                    <span className="min-w-0 flex-1 truncate" style={{ fontSize: 'var(--trae-body-sm-font-size)', lineHeight: 'var(--trae-body-sm-line-height)', color: 'var(--trae-text-default)' }}>{hot.title}</span>
                    <span className="shrink-0" style={{ fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{hot.views}</span>
                  </li>
                ))}
              </ol>
            </section>

            {/* 最近浏览 */}
            <section style={{ background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: 16 }}>
              <div className="mb-3 flex items-center" style={{ gap: 8 }}>
                <Clock size={16} style={{ color: 'var(--trae-icon-brand)' }} />
                <h2 style={{ fontSize: 'var(--trae-heading-xs-font-size)', lineHeight: 'var(--trae-heading-xs-line-height)', fontWeight: 'var(--trae-heading-xs-font-weight)', color: 'var(--trae-text-default)', margin: 0 }}>最近浏览</h2>
              </div>
              <ul className="flex flex-col" style={{ gap: 10, margin: 0, padding: 0, listStyle: 'none' }}>
                {RECENT_ITEMS.map((recent) => (
                  <li key={recent.id} data-dom-id={`goto-recent-knowledge-${recent.id}`} onClick={() => handleOpenKnowledge(recent.id)} className="flex cursor-pointer items-center" style={{ gap: 10 }}>
                    <FileText size={14} className="shrink-0" style={{ color: 'var(--trae-icon-secondary)' }} />
                    <span className="min-w-0 flex-1 truncate" style={{ fontSize: 'var(--trae-body-sm-font-size)', lineHeight: 'var(--trae-body-sm-line-height)', color: 'var(--trae-text-default)' }}>{recent.title}</span>
                    <span className="shrink-0" style={{ fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-tertiary)' }}>{recent.time}</span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>

        {/* ====== 4. AI 知识沉淀 ====== */}
        <section className="flex flex-col lg:flex-row lg:items-center" style={{ gap: 16, background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: 20 }}>
          <div className="flex min-w-0 flex-1 flex-col" style={{ gap: 6 }}>
            <div className="flex items-center" style={{ gap: 8 }}>
              <Sparkles size={16} style={{ color: 'var(--trae-icon-brand)' }} />
              <h2 style={{ fontSize: 'var(--trae-heading-sm-font-size)', lineHeight: 'var(--trae-heading-sm-line-height)', fontWeight: 'var(--trae-heading-sm-font-weight)', color: 'var(--trae-text-default)', margin: 0 }}>AI知识沉淀</h2>
            </div>
            <p style={{ fontSize: 'var(--trae-body-sm-font-size)', lineHeight: 'var(--trae-body-sm-line-height)', color: 'var(--trae-text-secondary)', margin: 0 }}>AI Agent在运维过程中自动沉淀知识,持续丰富知识库</p>
          </div>
          <div className="flex flex-wrap items-center" style={{ gap: 24 }}>
            {CONTRIBUTION_STATS.map((stat) => (
              <div key={stat.label} className="flex flex-col">
                <span style={{ fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 'var(--trae-body-xs-line-height)', color: 'var(--trae-text-tertiary)' }}>{stat.label}</span>
                <span style={{ fontSize: 'var(--trae-heading-md-font-size)', lineHeight: 'var(--trae-heading-md-line-height)', fontWeight: 'var(--trae-font-weight-strong)', color: stat.brand ? 'var(--trae-text-brand)' : 'var(--trae-text-default)', fontVariantNumeric: 'tabular-nums' }}>{stat.value}</span>
              </div>
            ))}
          </div>
          <button type="button" data-dom-id="goto-ai-contribution" aria-label="贡献知识" onClick={handleContribute} className="btn-press inline-flex shrink-0 cursor-pointer items-center transition-colors" style={{ gap: 6, height: 32, padding: '0 12px', border: '1px solid var(--trae-border-brand)', borderRadius: 'var(--trae-radius-6)', background: 'transparent', color: 'var(--trae-text-brand)', fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)' }}>
            <Plus size={14} style={{ color: 'var(--trae-icon-brand)' }} />
            <span>贡献知识</span>
          </button>
        </section>
      </div>

      {/* ====== 按压动画 + 卡片 hover + 搜索框 focus + 无障碍降级 ====== */}
      <style>{`
        .btn-press { transition: transform 80ms ease-out; }
        .btn-press:active { transform: scale(0.92); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { scrollbar-width: none; }
        .kb-card { transition: border-color 160ms ease-out, background 160ms ease-out; }
        .kb-card:hover { border-color: var(--trae-border-brand); background: var(--trae-bg-overlay-l1); }
        .kb-search-wrapper:focus-within { border-color: var(--trae-border-brand); background: var(--trae-bg-overlay-l2); }
        @media (prefers-reduced-motion: reduce) {
          .btn-press:active { transform: none !important; }
          .kb-card { transition: none; }
        }
      `}</style>
    </main>
  )
}
