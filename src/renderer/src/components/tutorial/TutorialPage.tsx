/**
 * TutorialPage 教程页面
 *
 * 职责：
 * - 展示从官方权威源整理的 Linux 教程
 * - 左侧分类导航（15 大类）
 * - 右侧教程列表（按分类过滤 + 关键词搜索）
 * - 点击教程弹出详情（md 渲染 + 命令片段 + 复制按钮）
 * - v0.6.0 起：支持一键刷新（爬虫从 Arch Wiki / LDP 等官方源拉取）
 *
 * 数据源：src/main/services/tutorial/seeds.ts（首批 10 篇官方教程）
 *         + src/main/services/tutorial/crawler/（v0.6.0 爬虫同步）
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Input, Tag, Empty, Spin, message, Modal, Button, Space, Tooltip, Checkbox, Progress, Collapse, Alert, Badge } from 'antd'
import {
  SearchOutlined,
  ReadOutlined,
  ClockCircleOutlined,
  LinkOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  RocketOutlined,
  ReloadOutlined,
  CloudDownloadOutlined,
  GlobalOutlined,
  InfoCircleOutlined,
  ExclamationCircleOutlined,
  BookOutlined,
  FileTextOutlined,
  AppstoreOutlined,
  LinuxOutlined,
  ProfileOutlined,
  HistoryOutlined,
  ApiOutlined,
  CloseCircleOutlined,
  MinusCircleOutlined,
  EyeOutlined,
} from '@ant-design/icons'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import { StaggerList } from '../common'
import type { TutorialEntry, TutorialCategory, TutorialCategorySummary } from '@shared/tutorial-types'
import { TUTORIAL_CATEGORY_LABELS, TUTORIAL_DIFFICULTY_LABELS, TUTORIAL_DIFFICULTY_COLORS } from '@shared/tutorial-types'
import type { TutorialSourceSpec, CrawlProgress } from '@shared/crawler-types'
// v2.2 修复问题 #43：dangerouslySetInnerHTML 渲染 Markdown HTML 需经 DOMPurify 消毒防 XSS
// 教程内容来源含爬虫抓取的 HTML，可能包含 <script> / on*=/javascript: 等恶意载荷
import DOMPurify from 'dompurify'
import './TutorialPage.css'

/** 简易 Markdown 渲染（支持标题、代码块、列表、段落、加粗） */
function renderMarkdown(md: string): string {
  if (!md) return ''
  const lines = md.split('\n')
  const html: string[] = []
  let inCodeBlock = false
  let inList = false
  let listType: 'ul' | 'ol' = 'ul'

  const closeList = () => {
    if (inList) {
      html.push(listType === 'ul' ? '</ul>' : '</ol>')
      inList = false
    }
  }

  for (const line of lines) {
    // 代码块
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        html.push('</code></pre>')
        inCodeBlock = false
      } else {
        closeList()
        const codeLang = line.slice(3).trim()
        html.push(`<pre class="tutorial-md-code"><code class="lang-${codeLang}">`)
        inCodeBlock = true
      }
      continue
    }
    if (inCodeBlock) {
      html.push(escapeHtml(line) + '\n')
      continue
    }

    // 标题
    if (line.startsWith('# ')) { closeList(); html.push(`<h1>${inlineMd(line.slice(2))}</h1>`); continue }
    if (line.startsWith('## ')) { closeList(); html.push(`<h2>${inlineMd(line.slice(3))}</h2>`); continue }
    if (line.startsWith('### ')) { closeList(); html.push(`<h3>${inlineMd(line.slice(4))}</h3>`); continue }

    // 列表
    if (line.match(/^[\-\*] /)) {
      if (!inList || listType !== 'ul') {
        closeList()
        html.push('<ul>')
        inList = true
        listType = 'ul'
      }
      html.push(`<li>${inlineMd(line.slice(2))}</li>`)
      continue
    }
    if (line.match(/^\d+\. /)) {
      if (!inList || listType !== 'ol') {
        closeList()
        html.push('<ol>')
        inList = true
        listType = 'ol'
      }
      html.push(`<li>${inlineMd(line.replace(/^\d+\. /, ''))}</li>`)
      continue
    }

    // 引用
    if (line.startsWith('> ')) {
      closeList()
      html.push(`<blockquote>${inlineMd(line.slice(2))}</blockquote>`)
      continue
    }

    // 空行
    if (line.trim() === '') {
      closeList()
      continue
    }

    // 段落
    closeList()
    html.push(`<p>${inlineMd(line)}</p>`)
  }

  closeList()
  if (inCodeBlock) html.push('</code></pre>')
  return html.join('\n')
}

/** 行内 md 渲染（加粗、行内代码、链接） */
function inlineMd(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/`([^`\n]+?)`/g, '<code class="tutorial-md-inline-code">$1</code>')
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  return out
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 判断 source 是否受"Linux Journey 品牌限制"约束
 *
 * Linux Journey 的 CC BY-SA 4.0 协议**额外**要求：
 * 不得使用 "Linux Journey" 名称/品牌/课程组织制作"令人困惑地类似"的替代品
 *
 * 合规要求（必须）：
 * 1. 在来源标注中明确显示"非官方产品"
 * 2. 不使用 "Linux Journey" 作为产品名
 * 3. source.url 跳转回 labex.io/linuxjourney 原文
 */
function isLinuxJourneySource(sourceName: string): boolean {
  return /linux\s*journey/i.test(sourceName)
}

/** 格式化当前时间为 HH:mm:ss（固定格式，避免不同系统 locale 差异） */
function formatTime(date = new Date()): string {
  return date.toTimeString().slice(0, 8)
}

/** 提取 License 简码（如 "MIT"、"CC BY-SA 4.0"、"GPL-2.0"） */
function formatLicenseTag(license: string): { label: string; color: string } {
  const lc = license.toLowerCase()
  if (lc.includes('cc by-sa 4')) return { label: 'CC BY-SA 4.0', color: 'blue' }
  if (lc.includes('cc by-sa 3')) return { label: 'CC BY-SA 3.0', color: 'blue' }
  if (lc.includes('cc by-sa')) return { label: 'CC BY-SA', color: 'blue' }
  if (lc.includes('cc by 4')) return { label: 'CC BY 4.0', color: 'cyan' }
  if (lc.includes('cc by')) return { label: 'CC BY', color: 'cyan' }
  if (lc.includes('gpl-2') || lc.includes('gpl 2')) return { label: 'GPL-2.0', color: 'purple' }
  if (lc.includes('gpl-3') || lc.includes('gpl 3')) return { label: 'GPL-3.0', color: 'purple' }
  if (lc.includes('gpl')) return { label: 'GPL', color: 'purple' }
  if (lc.includes('gnu fdl')) return { label: 'GNU FDL', color: 'purple' }
  if (lc.includes('mit')) return { label: 'MIT', color: 'green' }
  if (lc.includes('apache')) return { label: 'Apache', color: 'orange' }
  if (lc.includes('bsd')) return { label: 'BSD', color: 'orange' }
  return { label: license, color: 'default' }
}

/** TutorialPage 教程页面 */
const TutorialPage: React.FC = () => {
  // ===== 状态 =====
  const [tutorials, setTutorials] = useState<TutorialEntry[]>([])
  const [categories, setCategories] = useState<TutorialCategorySummary[]>([])
  const [activeCategory, setActiveCategory] = useState<TutorialCategory | 'all'>('all')
  const [searchText, setSearchText] = useState('')
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<TutorialEntry | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [seedVersion, setSeedVersion] = useState<string>('')

  // v0.6.0 爬虫状态
  const [crawlModalOpen, setCrawlModalOpen] = useState(false)
  const [sources, setSources] = useState<TutorialSourceSpec[]>([])
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [crawlRunning, setCrawlRunning] = useState(false)
  const [crawlProgress, setCrawlProgress] = useState<CrawlProgress | null>(null)
  const [crawlLog, setCrawlLog] = useState<Array<{ time: string; text: string }>>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [logExpanded, setLogExpanded] = useState(true)
  const crawlLogRef = useRef<HTMLDivElement | null>(null)

  /** 实时日志最大保留条数（防止长时间运行内存泄漏） */
  const MAX_CRAWL_LOG_LINES = 500

  /** 加载教程列表 */
  const loadTutorials = useCallback(async () => {
    if (!isElectronAPIAvailable()) {
      message.error('electronAPI 不可用')
      return
    }
    setLoading(true)
    try {
      const [list, cats, ver] = await Promise.all([
        window.electronAPI.tutorialList(),
        window.electronAPI.tutorialCategories(),
        window.electronAPI.tutorialSeedVersion()
      ])
      setTutorials(list)
      setCategories(cats)
      setSeedVersion(ver)
    } catch (err) {
      message.error(`加载教程失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTutorials()
  }, [loadTutorials])

  /** 过滤后的教程 */
  const filtered = useMemo(() => {
    let list = tutorials
    if (activeCategory !== 'all') {
      list = list.filter((t) => t.category === activeCategory)
    }
    if (searchText.trim()) {
      const q = searchText.toLowerCase()
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.summary.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          t.commands.some((cmd) => cmd.toLowerCase().includes(q))
      )
    }
    return list
  }, [tutorials, activeCategory, searchText])

  /** 打开详情 */
  const openDetail = useCallback(async (t: TutorialEntry) => {
    try {
      const full = await window.electronAPI.tutorialGet(t.id)
      if (full) {
        setDetail(full)
        setDetailOpen(true)
      } else {
        message.warning('教程详情加载失败')
      }
    } catch (err) {
      message.error(`打开失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  /** 复制命令 */
  const copyCommand = useCallback((cmd: string) => {
    navigator.clipboard.writeText(cmd).then(
      () => message.success('已复制'),
      () => message.error('复制失败')
    )
  }, [])

  /** 复制全部命令 */
  const copyAllCommands = useCallback(() => {
    if (!detail) return
    const text = detail.commands.join('\n')
    navigator.clipboard.writeText(text).then(
      () => message.success(`已复制 ${detail.commands.length} 条命令`),
      () => message.error('复制失败')
    )
  }, [detail])

  /** 重新加载种子（仅 dev） */
  const handleReloadSeeds = useCallback(async () => {
    try {
      const count = await window.electronAPI.tutorialSeedReload()
      message.success(`已重新加载 ${count} 篇教程`)
      void loadTutorials()
    } catch (err) {
      message.error(`重载失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [loadTutorials])

  // ========== v0.6.0 爬虫 ==========

  /** 加载源列表 */
  const loadSources = useCallback(async () => {
    if (!isElectronAPIAvailable()) {
      message.error('electronAPI 不可用，无法加载爬虫源')
      return
    }
    setSourcesLoading(true)
    try {
      console.log('[Tutorial] 开始加载爬虫源...')
      const list = await window.electronAPI.tutorialListSources()
      console.log(`[Tutorial] 加载到 ${list.length} 个爬虫源`)
      setSources(list)
      // 默认勾选 enabledByDefault=true 的源
      setSelectedSourceIds(list.filter((s) => s.enabledByDefault).map((s) => s.id))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Tutorial] 加载源列表失败:', err)
      message.error(`加载源列表失败: ${msg}`)
    } finally {
      setSourcesLoading(false)
    }
  }, [])

  /** 打开爬虫 Modal */
  const openCrawlModal = useCallback(() => {
    setCrawlModalOpen(true)
    // 每次打开都重新加载（避免上次的 sources 被清空）
    void loadSources()
  }, [loadSources])

  /**
   * Modal 打开后再次检查（确保 sources 已加载）
   * useEffect 依赖 crawlModalOpen / sources / sourcesLoading
   */
  useEffect(() => {
    if (crawlModalOpen && sources.length === 0 && !sourcesLoading) {
      void loadSources()
    }
  }, [crawlModalOpen, sources.length, sourcesLoading, loadSources])

  /**
   * 追加一条实时日志（自动限制最大条数）
   */
  const appendCrawlLog = useCallback((text: string) => {
    setCrawlLog((prev) => {
      const next = [...prev, { time: formatTime(), text }]
      return next.length > MAX_CRAWL_LOG_LINES ? next.slice(-MAX_CRAWL_LOG_LINES) : next
    })
  }, [])

  /** 启动爬虫 */
  const startCrawl = useCallback(async () => {
    if (selectedSourceIds.length === 0) {
      message.warning('请至少选择一个源')
      return
    }
    setCrawlRunning(true)
    setCrawlLog([{ time: formatTime(), text: `准备抓取 ${selectedSourceIds.length} 个源...` }])
    setCrawlProgress(null)
    setLogExpanded(true)
    // 非阻塞调用：结果通过 tutorial:crawlProgress / tutorial:crawlDone 事件推送
    void window.electronAPI
      .tutorialCrawlStart({ sourceIds: selectedSourceIds })
      .then((res) => {
        if (!res.success) {
          message.error(`抓取失败: ${res.error}`)
        }
      })
      .catch((err) => {
        message.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        setCrawlRunning(false)
      })
  }, [selectedSourceIds, appendCrawlLog])

  /** 监听爬虫进度事件 */
  useEffect(() => {
    if (!isElectronAPIAvailable()) return
    const offProgress = window.electronAPI.onTutorialCrawlProgress((progress) => {
      setCrawlProgress(progress)
      const prefix = progress.error === '用户已取消' ? '⏹️' : progress.phase === 'error' ? '❌' : '📦'
      appendCrawlLog(`${prefix} [${progress.sourceLabel}] ${progress.message}`)
    })
    const offDone = window.electronAPI.onTutorialCrawlDone((result) => {
      const emoji = result.errors.length > 0 ? '❌' : '✅'
      appendCrawlLog(`${emoji} [${result.sourceLabel}] 新增 ${result.inserted}, 更新 ${result.updated}, 失败 ${result.failed}`)
    })
    return () => {
      offProgress()
      offDone()
    }
  }, [appendCrawlLog])

  /** 日志自动滚动到底部（日志变化或 Modal 重新打开时触发） */
  useEffect(() => {
    if (crawlLogRef.current && crawlLog.length > 0) {
      crawlLogRef.current.scrollTop = crawlLogRef.current.scrollHeight
    }
  }, [crawlLog, crawlModalOpen])

  /** 关闭爬虫 Modal（后台继续运行） */
  const closeCrawlModal = useCallback(() => {
    setCrawlModalOpen(false)
  }, [])

  /** 取消当前爬虫任务 */
  const cancelCrawl = useCallback(async () => {
    if (!isElectronAPIAvailable()) return
    try {
      await window.electronAPI.tutorialCrawlCancel()
      appendCrawlLog('[系统] 用户已取消抓取任务')
      message.info('已取消抓取任务')
      // 注意：不立即设置 crawlRunning=false，由 tutorialCrawlStart 的 finally 统一收尾
    } catch (err) {
      message.error(`取消失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [appendCrawlLog])

  /** Modal 打开时检查爬虫状态 */
  useEffect(() => {
    if (crawlModalOpen && isElectronAPIAvailable()) {
      void window.electronAPI.tutorialCrawlStatus().then((status) => {
        setCrawlRunning(status.running)
        // 仅当任务仍在运行时才显示当前进度；已结束时清空旧进度，避免误导
        setCrawlProgress(status.running ? status.current ?? null : null)
      })
    }
  }, [crawlModalOpen])

  return (
    <div className="tutorial-page">
      {/* ===== 左侧分类 ===== */}
      <aside className="tutorial-sidebar">
        <div className="tutorial-sidebar-header">
          <ReadOutlined style={{ color: '#2c7be5' }} />
          <span>教程分类</span>
          {seedVersion && (
            <Tooltip title={`种子版本: ${seedVersion}`}>
              <Tag color="blue" style={{ marginLeft: 'auto', fontSize: 11 }}>
                v{seedVersion.split('-').pop()}
              </Tag>
            </Tooltip>
          )}
        </div>
        <div className="tutorial-sidebar-list">
          <div
            className={`tutorial-cat-item ${activeCategory === 'all' ? 'active' : ''}`}
            onClick={() => setActiveCategory('all')}
          >
            <span>
              <AppstoreOutlined style={{ marginRight: 6 }} />
              全部
            </span>
            <span className="tutorial-cat-count">{tutorials.length}</span>
          </div>
          {categories.map((cat) => (
            <div
              key={cat.category}
              className={`tutorial-cat-item ${activeCategory === cat.category ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat.category)}
            >
              <span>{cat.label}</span>
              <span className="tutorial-cat-count">{cat.count}</span>
            </div>
          ))}
        </div>
        <div className="tutorial-sidebar-footer">
          <Button
            block
            size="small"
            icon={<ReloadOutlined />}
            onClick={handleReloadSeeds}
          >
            重新加载种子
          </Button>
          <Tooltip title="本项目知识库整体采用 CC BY-SA 4.0 协议发布（含 Linux Journey 等 CC BY-SA 内容时强制要求相同方式共享）">
            <div
              className="tutorial-sidebar-license"
              style={{ marginTop: 12, fontSize: 11, color: '#86868b', textAlign: 'center', cursor: 'help' }}
            >
              <InfoCircleOutlined style={{ marginRight: 4 }} />
              本知识库采用
              <a
                href="https://creativecommons.org/licenses/by-sa/4.0/"
                target="_blank"
                rel="noreferrer"
                style={{ marginLeft: 2 }}
              >
                CC BY-SA 4.0
              </a>
              协议
            </div>
          </Tooltip>
        </div>
      </aside>

      {/* ===== 右侧内容 ===== */}
      <div className="tutorial-main">
        <div className="tutorial-search-bar">
          <Input
            placeholder="搜索教程（标题/标签/命令）..."
            prefix={<SearchOutlined style={{ color: '#86868b' }} />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
            size="large"
            style={{ flex: 1 }}
          />
          <Tooltip title={crawlRunning ? '爬虫运行中，点击查看实时进度' : '从官方源（Arch Wiki / LDP 等）抓取最新教程'}>
            <Button
              type="primary"
              size="large"
              icon={crawlRunning ? <EyeOutlined /> : <CloudDownloadOutlined />}
              loading={crawlRunning}
              onClick={openCrawlModal}
            >
              {crawlRunning ? '抓取中…（点击查看）' : '刷新教程'}
            </Button>
          </Tooltip>
          <span className="tutorial-search-stat">
            共 <b>{filtered.length}</b> 篇
            {activeCategory !== 'all' && ` · ${TUTORIAL_CATEGORY_LABELS[activeCategory]}`}
          </span>
        </div>

        {loading ? (
          <div className="tutorial-loading">
            <Spin size="large" />
            <p>加载教程中...</p>
          </div>
        ) : filtered.length === 0 ? (
          <Empty description={searchText ? '没有匹配的教程' : '该分类下暂无教程'} />
        ) : (
          <StaggerList
            className="tutorial-list"
            stagger={30}
            duration={220}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-5)' }}
          >
            {filtered.map((t) => (
              <div
                key={t.id}
                className="tutorial-card"
                onClick={() => void openDetail(t)}
              >
                <div className="tutorial-card-head">
                  <h3 className="tutorial-card-title">{t.title}</h3>
                  <Tag color={TUTORIAL_DIFFICULTY_COLORS[t.difficulty]}>
                    {TUTORIAL_DIFFICULTY_LABELS[t.difficulty]}
                  </Tag>
                </div>
                <p className="tutorial-card-summary">{t.summary}</p>
                <div className="tutorial-card-tags">
                  {t.tags.slice(0, 5).map((tag) => (
                    <Tag key={tag} style={{ margin: 0 }}>{tag}</Tag>
                  ))}
                </div>
                <div className="tutorial-card-meta">
                  <span><ClockCircleOutlined /> {t.readingTime} 分钟</span>
                  <span><BookOutlined /> {t.source.name}</span>
                  <Tooltip title={`License: ${t.source.license}`}>
                    <Tag color={formatLicenseTag(t.source.license).color} style={{ margin: 0, cursor: 'help' }}>
                      {formatLicenseTag(t.source.license).label}
                    </Tag>
                  </Tooltip>
                  {t.distros.length > 0 && <span><LinuxOutlined /> {t.distros.join(' / ')}</span>}
                  {isLinuxJourneySource(t.source.name) && (
                    <Tag icon={<ExclamationCircleOutlined />} color="warning" style={{ margin: 0 }}>
                      非官方
                    </Tag>
                  )}
                </div>
              </div>
            ))}
          </StaggerList>
        )}
      </div>

      {/* ===== 教程详情弹窗 ===== */}
      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={920}
        title={
          detail && (
            <Space>
              <RocketOutlined style={{ color: '#2c7be5' }} />
              <span>{detail.title}</span>
              <Tag color={TUTORIAL_DIFFICULTY_COLORS[detail.difficulty]}>
                {TUTORIAL_DIFFICULTY_LABELS[detail.difficulty]}
              </Tag>
            </Space>
          )
        }
        className="tutorial-detail-modal"
      >
        {detail && (
          <>
            <div className="tutorial-detail-meta">
              <Space size="middle" wrap>
                <span>
                  <BookOutlined /> 来源：<a href={detail.source.url} target="_blank" rel="noreferrer">{detail.source.name}</a>
                </span>
                <span><ClockCircleOutlined /> {detail.readingTime} 分钟</span>
                <span><LinuxOutlined /> {detail.distros.join(' / ')}</span>
                <Tooltip title={`License: ${detail.source.license}${detail.source.licenseUrl ? `（${detail.source.licenseUrl}）` : ''}`}>
                  <Tag color={formatLicenseTag(detail.source.license).color} style={{ cursor: 'help' }}>
                    <ProfileOutlined style={{ marginRight: 4 }} />
                    {formatLicenseTag(detail.source.license).label}
                  </Tag>
                </Tooltip>
                {detail.source.crawledAt && (
                  <Tooltip title={`抓取时间：${new Date(detail.source.crawledAt).toLocaleString('zh-CN')}`}>
                    <span style={{ color: '#86868b', fontSize: 12 }}>
                      <HistoryOutlined /> {new Date(detail.source.crawledAt).toLocaleDateString('zh-CN')}
                    </span>
                  </Tooltip>
                )}
              </Space>
              <div className="tutorial-detail-tags">
                {detail.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>
            </div>

            {/* Linux Journey 品牌限制提示（合规必显） */}
            {isLinuxJourneySource(detail.source.name) && (
              <Alert
                message="内容来源说明"
                description={
                  <span>
                    本教程内容来自 <strong>Linux Journey</strong>（CC BY-SA 4.0 协议），
                    <strong>本产品为非官方独立学习工具</strong>，与 Linux Journey 官方无关联。
                    完整内容版权归原项目所有，详情见
                    <a href={detail.source.licenseUrl} target="_blank" rel="noreferrer"> CC BY-SA 4.0 协议</a>。
                  </span>
                }
                type="warning"
                showIcon
                icon={<ExclamationCircleOutlined />}
                style={{ marginBottom: 16 }}
              />
            )}

            <div
              className="tutorial-detail-content"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(detail.content)) }}
            />

            {detail.commands.length > 0 && (
              <div className="tutorial-detail-commands">
                <div className="tutorial-detail-commands-head">
                  <h4>
                    <CheckCircleOutlined style={{ color: '#52c41a' }} />
                    关键命令（{detail.commands.length}）
                  </h4>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={copyAllCommands}
                  >
                    复制全部
                  </Button>
                </div>
                <div className="tutorial-detail-cmd-list">
                  {detail.commands.map((cmd, idx) => (
                    <div key={idx} className="tutorial-detail-cmd-item">
                      <code>{cmd}</code>
                      <Tooltip title="复制此条">
                        <Button
                          size="small"
                          type="text"
                          icon={<CopyOutlined />}
                          onClick={() => copyCommand(cmd)}
                        />
                      </Tooltip>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="tutorial-detail-footer">
              <a
                href={detail.source.url}
                target="_blank"
                rel="noreferrer"
                className="tutorial-detail-source-link"
              >
                <LinkOutlined /> 查看原文：{detail.source.name}
              </a>
            </div>
          </>
        )}
      </Modal>

      {/* ===== 教程爬虫 Modal（v0.6.0） ===== */}
      <Modal
        open={crawlModalOpen}
        onCancel={closeCrawlModal}
        footer={
          <Space>
            {crawlRunning ? (
              <>
                <Button
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={() => void cancelCrawl()}
                >
                  取消抓取
                </Button>
                <Button
                  icon={<MinusCircleOutlined />}
                  onClick={closeCrawlModal}
                >
                  后台运行
                </Button>
              </>
            ) : (
              <Button onClick={closeCrawlModal}>关闭</Button>
            )}
            <Button
              type="primary"
              icon={<CloudDownloadOutlined />}
              loading={crawlRunning}
              disabled={selectedSourceIds.length === 0 || crawlRunning}
              onClick={startCrawl}
            >
              开始抓取（{selectedSourceIds.length} 个源）
            </Button>
          </Space>
        }
        width={900}
        title={
          <Space>
            <GlobalOutlined style={{ color: '#2c7be5' }} />
            <span>从官方源抓取教程</span>
            {crawlRunning && <Badge status="processing" text="运行中" />}
          </Space>
        }
        className="tutorial-crawl-modal"
      >
        <Alert
          message="合规说明"
          description={
            <span>
              所有抓取行为严格遵循各源 robots.txt 和 License。
              Phase 1 仅启用<strong>离线包</strong>（Arch Wiki / LDP），
              零爬虫礼仪风险；在线增量爬取（Phase 2）需用户手动勾选。
              <a href="https://wiki.archlinux.org/title/ArchWiki:Archive" target="_blank" rel="noreferrer">
                Arch Wiki 归档说明
              </a>
            </span>
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <div className="tutorial-crawl-sources">
          <div className="tutorial-crawl-sources-header">
            <span>
              <ApiOutlined style={{ marginRight: 6 }} />
              选择抓取源
            </span>
            <Space size="small">
              <Button
                size="small"
                type="link"
                disabled={crawlRunning}
                onClick={() => setSelectedSourceIds(sources.map((s) => s.id))}
              >
                全选
              </Button>
              <Button
                size="small"
                type="link"
                disabled={crawlRunning}
                onClick={() => setSelectedSourceIds([])}
              >
                清空
              </Button>
            </Space>
          </div>
          {sourcesLoading ? (
            <div style={{ padding: '24px', textAlign: 'center' }}>
              <Spin />
              <p style={{ marginTop: 8, color: 'var(--color-text-secondary)', fontSize: 12 }}>
                正在加载爬虫源列表...
              </p>
            </div>
          ) : sources.length === 0 ? (
            <Alert
              type="warning"
              showIcon
              message="暂无可用爬虫源"
              description={
                <span>
                  主进程未注册任何爬虫源。请检查：
                  <ul style={{ margin: '4px 0 0 16px', fontSize: 12 }}>
                    <li>查看 <code>src/main/services/tutorial/crawler/tutorial-source-registry.ts</code></li>
                    <li>检查主进程日志 <code>%APPDATA%/tdsf-linux-desktop/logs/</code></li>
                    <li>重启应用后再试</li>
                  </ul>
                </span>
              }
              style={{ marginBottom: 12 }}
            />
          ) : (
            <div className="tutorial-crawl-source-list">
              {sources.map((s) => {
                const checked = selectedSourceIds.includes(s.id)
                return (
                  <div
                    key={s.id}
                    className={`tutorial-crawl-source-card ${checked ? 'selected' : ''} ${crawlRunning ? 'disabled' : ''}`}
                    onClick={() => {
                      if (crawlRunning) return
                      setSelectedSourceIds((prev) =>
                        prev.includes(s.id) ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                      )
                    }}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={crawlRunning}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setSelectedSourceIds((prev) =>
                          checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                        )
                      }}
                    />
                    <div className="tutorial-crawl-source-info">
                      <div className="tutorial-crawl-source-title">
                        <span className="tutorial-crawl-source-name">{s.label}</span>
                        <Space size="small">
                          <Tag color={s.priority === 'P0' ? 'red' : s.priority === 'P1' ? 'orange' : 'default'}>
                            {s.priority}
                          </Tag>
                          <Tag color={s.kind === 'offline-dump' ? 'green' : s.kind === 'github-clone' ? 'cyan' : 'blue'}>
                            {s.kind === 'offline-dump' ? '离线包' : s.kind === 'github-clone' ? 'GitHub' : '在线爬'}
                          </Tag>
                          <Tag color={formatLicenseTag(s.license).color} style={{ fontSize: 11 }}>
                            {formatLicenseTag(s.license).label}
                          </Tag>
                        </Space>
                      </div>
                      <p className="tutorial-crawl-source-desc">{s.description}</p>
                      {s.id === 'linux-journey' && (
                        <div className="tutorial-crawl-source-notice">
                          <InfoCircleOutlined /> 该源采用 CC BY-SA 4.0 协议（带品牌限制条款）：
                          内容仅用于<strong>个人学习</strong>，本产品为<strong>非官方</strong>独立学习工具。
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {crawlProgress && (
          <div className="tutorial-crawl-progress">
            <Space style={{ marginBottom: 8, width: '100%', justifyContent: 'space-between' }}>
              <span>
                <strong>{crawlProgress.sourceLabel}</strong>
                <Tag
                  color={
                    crawlProgress.error === '用户已取消'
                      ? 'orange'
                      : crawlProgress.phase === 'error'
                        ? 'red'
                        : 'blue'
                  }
                  style={{ marginLeft: 8 }}
                >
                  {crawlProgress.error === '用户已取消' ? 'cancelled' : crawlProgress.phase}
                </Tag>
              </span>
              <span style={{ color: '#86868b' }}>
                {crawlProgress.total > 0
                  ? `${crawlProgress.processed} / ${crawlProgress.total}`
                  : `${(crawlProgress.progress * 100).toFixed(0)}%`}
              </span>
            </Space>
            <Progress
              percent={Math.round(crawlProgress.progress * 100)}
              status={crawlProgress.error === '用户已取消' ? 'normal' : crawlProgress.phase === 'error' ? 'exception' : 'active'}
              showInfo={false}
            />
            <p style={{ marginTop: 4, color: '#86868b', fontSize: 12 }}>
              {crawlProgress.message}
            </p>
          </div>
        )}

        <Collapse
          ghost
          activeKey={logExpanded ? 'log' : undefined}
          onChange={(keys) => setLogExpanded(keys.includes('log'))}
          style={{ marginTop: 16 }}
          items={[
            {
              key: 'log',
              label: (
                <span>
                  <FileTextOutlined style={{ marginRight: 6 }} />
                  实时日志（{crawlLog.length} 条）
                </span>
              ),
              children: (
                <div
                  ref={crawlLogRef}
                  className="tutorial-crawl-log"
                >
                  {crawlLog.length === 0 ? (
                    <span className="tutorial-crawl-log-empty">暂无日志</span>
                  ) : (
                    crawlLog.map((line, idx) => (
                      <div key={idx} className="tutorial-crawl-log-line">
                        <span className="tutorial-crawl-log-time">{line.time}</span>
                        <span className="tutorial-crawl-log-text">{line.text}</span>
                      </div>
                    ))
                  )}
                </div>
              )
            }
          ]}
        />
      </Modal>
    </div>
  )
}

export default TutorialPage
