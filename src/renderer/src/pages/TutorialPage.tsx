/**
 * TutorialPage — 运维教程页（1:1 复刻 tutorial.html 设计稿）
 *
 * 路由：/tutorial
 * 设计稿：tdsf-linux-redesign/pages/tutorial.html
 * Spec: build-runnable-tdsf-from-design · Task 2.6
 *
 * 结构（6 section，1:1 对齐设计稿）：
 *   1. Page Header：scroll-text 图标 + 标题"运维教程" + 副标题 + 返回工作台按钮
 *   2. 顶部统计行：grid-cols-3（12 门课程 / 48 课时 / 3.2k 学习人次）
 *   3. 精选课程：md:grid-cols-2（Nginx 调优 65% + 故障排查 30%，含进度条 + 按钮）
 *   4. 课程分类导航：6 个标签（全部/Linux 基础/网络运维/故障排查/安全加固/自动化脚本）
 *   5. 课程列表：lg:grid-cols-3（6 门课程，含图标/难度/时长/人次/进度）
 *   6. 推荐学习路径：3 条路径（运维新手/性能优化/安全运维，最后一步 brand-popup 高亮）
 *
 * 数据：严格使用设计稿 tutorial.html 示例数据（12/48/3.2k + 2 精选 + 6 课程 + 3 路径）
 * 视觉：全部 var(--trae-*) token，无硬编码 hex/rgba
 * 无障碍：button type + aria-label/aria-pressed，prefers-reduced-motion 禁用按压动画
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ScrollText, ArrowLeft, ArrowRight, Star, Sparkles, Clock, UserCircle,
  ChevronRight, Terminal, Zap, Box, Cpu, Globe, Shield,
} from 'lucide-react'
import './TutorialPage.css'

// ==================== 类型定义 ====================

type CourseLevel = '初级' | '中级' | '进阶'
type CourseCategory = 'all' | 'basic' | 'network' | 'troubleshoot' | 'security' | 'script'

interface Course {
  id: string
  title: string
  description: string
  level: CourseLevel
  category: Exclude<CourseCategory, 'all'>
  duration: string
  learnerCount: string
  progress: number
  completed?: boolean
  icon: LucideIcon
  domId?: string
  cta?: string
}

interface LearningPath {
  id: string
  title: string
  steps: { label: string; active?: boolean }[]
}

// ==================== 静态示例数据（1:1 来自设计稿 tutorial.html） ====================

const STATS: { value: string; unit: string; hint: string }[] = [
  { value: '12', unit: '门课程', hint: '涵盖 Linux 运维全栈知识' },
  { value: '48', unit: '课时', hint: '平均每门 4 个实操课时' },
  { value: '3.2k', unit: '学习人次', hint: '运维工程师实战首选' },
]

const FEATURED_COURSES: Course[] = [
  { id: 'nginx-tuning', title: 'Nginx 性能调优实战', description: '从 worker_connections 到内核参数，全面优化 nginx 性能', level: '进阶', category: 'network', duration: '2h30min', learnerCount: '1.8k 人', progress: 65, icon: Cpu, domId: 'open-course', cta: '继续学习' },
  { id: 'linux-troubleshoot', title: 'Linux 故障排查方法论', description: '系统性排查 CPU / 内存 / 网络 / 磁盘故障的标准流程', level: '中级', category: 'troubleshoot', duration: '1h45min', learnerCount: '1.5k 人', progress: 30, icon: Terminal, domId: 'open-course-2', cta: '开始学习' },
]

const CATEGORIES: { id: CourseCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'basic', label: 'Linux 基础' },
  { id: 'network', label: '网络运维' },
  { id: 'troubleshoot', label: '故障排查' },
  { id: 'security', label: '安全加固' },
  { id: 'script', label: '自动化脚本' },
]

const COURSES: Course[] = [
  { id: 'ssh-security', title: 'SSH 安全配置指南', description: '密钥认证、端口加固、fail2ban 配置与审计日志最佳实践', level: '初级', category: 'security', duration: '45min', learnerCount: '1.2k 人', progress: 0, icon: Terminal },
  { id: 'shell-script', title: 'Shell 脚本自动化', description: '变量、流程控制、正则与文本处理，打造可复用自动化脚本', level: '中级', category: 'script', duration: '1h20min', learnerCount: '890 人', progress: 100, completed: true, icon: Zap },
  { id: 'docker-ops', title: 'Docker 容器运维', description: '镜像构建、容器编排、数据卷与网络管理实战', level: '中级', category: 'basic', duration: '2h', learnerCount: '2.1k 人', progress: 0, icon: Box },
  { id: 'mysql-tuning', title: 'MySQL 性能优化', description: '索引优化、慢查询分析、连接池调优与分表策略', level: '进阶', category: 'basic', duration: '3h', learnerCount: '670 人', progress: 0, icon: Cpu },
  { id: 'network-capture', title: '网络抓包与分析', description: 'tcpdump、wireshark 抓包分析与 TCP 协议深度解读', level: '中级', category: 'network', duration: '1h', learnerCount: '540 人', progress: 45, icon: Globe },
  { id: 'system-security', title: '系统安全加固', description: 'SELinux、防火墙、入侵检测与基线核查全流程', level: '进阶', category: 'security', duration: '2h15min', learnerCount: '980 人', progress: 0, icon: Shield },
]

const LEARNING_PATHS: LearningPath[] = [
  { id: 'newbie', title: '运维新手入门', steps: [{ label: 'Linux 基础' }, { label: 'SSH 配置' }, { label: 'Shell 脚本', active: true }] },
  { id: 'perf-expert', title: '性能优化专家', steps: [{ label: 'Nginx 调优' }, { label: 'MySQL 优化' }, { label: '系统监控', active: true }] },
  { id: 'security-engineer', title: '安全运维工程师', steps: [{ label: '安全加固' }, { label: '漏洞扫描' }, { label: '入侵检测', active: true }] },
]

// ==================== 辅助函数 ====================

/** 难度标签样式（课程列表卡片，初级带边框） */
function levelBadgeClassName(level: CourseLevel): string {
  if (level === '初级') return 'tut-level-badge--sm tut-level-badge--neutral'
  if (level === '中级') return 'tut-level-badge--sm tut-level-badge--warning'
  return 'tut-level-badge--sm'
}

/** 难度标签样式（精选课程大卡，无边框） */
function featuredLevelClassName(level: CourseLevel): string {
  if (level === '中级') return 'tut-level-badge tut-level-badge--warning'
  return 'tut-level-badge'
}

// ==================== 主组件 ====================

/** TutorialPage — 运维教程页 */
export function TutorialPage() {
  const navigate = useNavigate()
  const [activeCategory, setActiveCategory] = useState<CourseCategory>('all')

  const handleBack = () => navigate('/workbench')
  const handleOpenCourse = (id: string) => navigate(`/tutorial/${id}`)

  const filteredCourses = activeCategory === 'all' ? COURSES : COURSES.filter((c) => c.category === activeCategory)

  return (
    <main className="tut-page" style={{ height: '100%', overflowY: 'auto' }}>
      {/* ====== 1. Page Header ====== */}
      <header className="tut-page-header">
        <div className="tut-page-header__left">
          <ScrollText size={26} strokeWidth={2} style={{ color: 'var(--trae-icon-brand)' }} />
          <div className="tut-page-header__title-wrap">
            <span className="tut-page-title">运维教程</span>
            <span className="tut-page-subtitle">从入门到精通的 Linux 运维实战课程</span>
          </div>
        </div>
        <button type="button" data-dom-id="back-workbench" aria-label="返回工作台" onClick={handleBack} className="tut-back-btn">
          <ArrowLeft size={14} style={{ color: 'var(--trae-icon-secondary)' }} />
          <span>返回工作台</span>
        </button>
      </header>

      {/* ====== 内容容器 ====== */}
      <div className="tut-container">
        {/* ====== 2. 顶部统计行 grid-cols-3 ====== */}
        <div className="tut-stats-grid">
          {STATS.map((s) => (
            <div key={s.unit} className="tut-stat-card">
              <div className="tut-stat-value-row">
                <span className="tut-stat-value">{s.value}</span>
                <span className="tut-stat-unit">{s.unit}</span>
              </div>
              <div className="tut-stat-desc">{s.hint}</div>
            </div>
          ))}
        </div>

        {/* ====== 3. 精选课程 md:grid-cols-2 ====== */}
        <section className="tut-section" aria-label="精选课程">
          <div className="tut-section-title-row">
            <Star size={18} fill="currentColor" style={{ color: 'var(--trae-icon-brand)' }} />
            <h2 className="tut-section-title">精选课程</h2>
          </div>
          <div className="tut-featured-grid">
            {FEATURED_COURSES.map((c) => (
              <div key={c.id} className="tut-featured-card">
                <div className="tut-featured-head">
                  <span className={featuredLevelClassName(c.level)}>{c.level}</span>
                  <span className="tut-duration-tag">
                    <Clock size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                    {c.duration}
                  </span>
                </div>
                <h3 className="tut-featured-title">{c.title}</h3>
                <p className="tut-featured-desc">{c.description}</p>
                <div className="tut-progress-block">
                  <div className="tut-progress-row">
                    <span className="tut-progress-label">学习进度</span>
                    <span className="tut-progress-value">{c.progress}%</span>
                  </div>
                  <div className="tut-progress-bar">
                    <div className="tut-progress-bar-fill" style={{ width: `${c.progress}%` }} />
                  </div>
                </div>
                <div>
                  <button type="button" data-dom-id={c.domId} aria-label={c.cta} onClick={() => handleOpenCourse(c.id)} className="tut-featured-btn tut-btn-press">
                    {c.cta}
                    <ArrowRight size={12} style={{ color: 'var(--trae-text-brand)' }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ====== 4. 课程分类导航 ====== */}
        <nav className="tut-cat-nav" aria-label="课程分类">
          <div className="tut-cat-row tut-no-scrollbar">
            {CATEGORIES.map((cat) => {
              const active = activeCategory === cat.id
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  aria-pressed={active}
                  className={`tut-cat-label tut-btn-press${active ? ' tut-cat-label--active' : ''}`}
                >
                  {cat.label}
                </button>
              )
            })}
          </div>
        </nav>

        {/* ====== 5. 课程列表 lg:grid-cols-3 ====== */}
        <section className="tut-section tut-section--courses" aria-label="课程列表">
          <div className="tut-courses-grid">
            {filteredCourses.map((c) => {
              const Icon = c.icon
              return (
                <div key={c.id} className="tut-course-card">
                  <div className="tut-course-head">
                    <Icon size={20} className="tut-course-icon" />
                    <span className="tut-course-badges">
                      <span className={levelBadgeClassName(c.level)}>{c.level}</span>
                      {c.completed && <span className="tut-completed-badge">已完成</span>}
                    </span>
                  </div>
                  <h4 className="tut-course-title">{c.title}</h4>
                  <p className="tut-course-desc">{c.description}</p>
                  <div className="tut-course-meta">
                    <span className="tut-course-meta-item">
                      <Clock size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                      {c.duration}
                    </span>
                    <span className="tut-course-meta-item">
                      <UserCircle size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                      {c.learnerCount}
                    </span>
                  </div>
                  <div className="tut-progress-block">
                    <div className="tut-progress-row tut-progress-row--tight">
                      <span className="tut-progress-label">进度</span>
                      <span className={c.progress > 0 ? 'tut-progress-value' : 'tut-progress-value tut-progress-value--zero'}>{c.progress}%</span>
                    </div>
                    <div className="tut-progress-bar tut-progress-bar--thin">
                      <div className="tut-progress-bar-fill" style={{ width: `${c.progress}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ====== 6. 推荐学习路径 ====== */}
        <section className="tut-section tut-section--paths" aria-label="推荐学习路径">
          <div className="tut-section-title-row">
            <Sparkles size={18} style={{ color: 'var(--trae-icon-brand)' }} />
            <h2 className="tut-section-title">推荐学习路径</h2>
          </div>
          <div className="tut-paths-list">
            {LEARNING_PATHS.map((path) => (
              <div key={path.id} className="tut-path-row">
                <span className="tut-path-title">{path.title}</span>
                <span className="tut-path-steps tut-no-scrollbar">
                  {path.steps.map((step, i) => (
                    <span key={step.label} className="tut-path-step">
                      {i > 0 && <ChevronRight size={12} className="tut-path-chevron" />}
                      <span className={`tut-path-step${step.active ? ' tut-path-step--active' : ''}`}>
                        {step.label}
                      </span>
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
