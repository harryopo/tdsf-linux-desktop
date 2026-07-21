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
import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ScrollText, ArrowLeft, ArrowRight, Star, Sparkles, Clock, UserCircle,
  ChevronRight, Terminal, Zap, Box, Cpu, Globe, Shield,
} from 'lucide-react'

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
function levelBadgeStyle(level: CourseLevel): CSSProperties {
  if (level === '初级') return { background: 'var(--trae-bg-overlay-l2)', color: 'var(--trae-text-secondary)', border: '1px solid var(--trae-border-neutral-l1)' }
  if (level === '中级') return { background: 'var(--trae-status-warning-surface-l1)', color: 'var(--trae-status-warning-default)' }
  return { background: 'var(--trae-bg-brand-popup)', color: 'var(--trae-text-brand)' }
}

/** 难度标签样式（精选课程大卡，无边框） */
function featuredLevelStyle(level: CourseLevel): CSSProperties {
  if (level === '中级') return { background: 'var(--trae-status-warning-surface-l1)', color: 'var(--trae-status-warning-default)' }
  return { background: 'var(--trae-bg-brand-popup)', color: 'var(--trae-text-brand)' }
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
    <main style={{ background: 'var(--trae-bg-base-default)', color: 'var(--trae-text-default)', minHeight: '100%' }}>
      {/* ====== 1. Page Header ====== */}
      <header className="flex items-center justify-between" style={{ padding: '18px 32px', borderBottom: '1px solid var(--trae-border-neutral-l1)' }}>
        <div className="flex items-center" style={{ gap: 14 }}>
          <ScrollText size={26} strokeWidth={2} style={{ color: 'var(--trae-icon-brand)' }} />
          <div className="flex flex-col" style={{ gap: 2 }}>
            <span style={{ fontFamily: 'var(--trae-heading-2xl-font-family)', fontSize: 'var(--trae-heading-2xl-font-size)', fontWeight: 'var(--trae-font-weight-strong)', lineHeight: 'var(--trae-heading-2xl-line-height)', color: 'var(--trae-text-default)' }}>运维教程</span>
            <span style={{ fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 'var(--trae-body-xs-line-height)', color: 'var(--trae-text-tertiary)' }}>从入门到精通的 Linux 运维实战课程</span>
          </div>
        </div>
        <button type="button" data-dom-id="back-workbench" aria-label="返回工作台" onClick={handleBack} className="flex cursor-pointer items-center transition-colors" style={{ gap: 6, padding: '7px 14px', border: '1px solid var(--trae-border-neutral-l2)', borderRadius: 'var(--trae-radius-6)', background: 'transparent', color: 'var(--trae-text-secondary)', fontSize: 'var(--trae-body-md-font-size)' }}>
          <ArrowLeft size={14} style={{ color: 'var(--trae-icon-secondary)' }} />
          <span>返回工作台</span>
        </button>
      </header>

      {/* ====== 内容容器 ====== */}
      <div style={{ padding: '28px 32px 64px' }}>
        {/* ====== 2. 顶部统计行 grid-cols-3 ====== */}
        <div className="grid grid-cols-3 gap-3">
          {STATS.map((s) => (
            <div key={s.unit} style={{ background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: '18px 20px' }}>
              <div className="flex items-baseline" style={{ gap: 8 }}>
                <span style={{ fontFamily: 'var(--trae-heading-2xl-font-family)', fontSize: 'var(--trae-heading-2xl-font-size)', fontWeight: 'var(--trae-font-weight-strong)', color: 'var(--trae-text-brand)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
                <span style={{ fontSize: 'var(--trae-body-sm-font-size)', color: 'var(--trae-text-tertiary)' }}>{s.unit}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-tertiary)' }}>{s.hint}</div>
            </div>
          ))}
        </div>

        {/* ====== 3. 精选课程 md:grid-cols-2 ====== */}
        <section style={{ marginTop: 36 }} aria-label="精选课程">
          <div className="flex items-center" style={{ gap: 8, marginBottom: 16 }}>
            <Star size={18} fill="currentColor" style={{ color: 'var(--trae-icon-brand)' }} />
            <h2 style={{ fontFamily: 'var(--trae-heading-md-font-family)', fontSize: 'var(--trae-heading-md-font-size)', fontWeight: 'var(--trae-font-weight-strong)', lineHeight: 'var(--trae-heading-md-line-height)', color: 'var(--trae-text-default)', margin: 0 }}>精选课程</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {FEATURED_COURSES.map((c) => (
              <div key={c.id} style={{ background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="flex items-center" style={{ gap: 8 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 8px', height: 20, borderRadius: 'var(--trae-radius-4)', fontSize: 'var(--trae-body-xs-font-size)', fontWeight: 'var(--trae-font-weight-medium)', lineHeight: 1, ...featuredLevelStyle(c.level) }}>{c.level}</span>
                  <span className="flex items-center" style={{ gap: 4, fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-tertiary)' }}>
                    <Clock size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                    {c.duration}
                  </span>
                </div>
                <h3 style={{ fontFamily: 'var(--trae-heading-sm-font-family)', fontSize: 'var(--trae-heading-sm-font-size)', fontWeight: 'var(--trae-font-weight-strong)', lineHeight: 'var(--trae-heading-sm-line-height)', color: 'var(--trae-text-default)', margin: 0 }}>{c.title}</h3>
                <p style={{ fontSize: 'var(--trae-body-sm-font-size)', lineHeight: 'var(--trae-body-sm-line-height)', color: 'var(--trae-text-secondary)', margin: 0 }}>{c.description}</p>
                <div>
                  <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-tertiary)' }}>学习进度</span>
                    <span style={{ fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-brand)', fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--trae-font-weight-medium)' }}>{c.progress}%</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--trae-bg-overlay-l3)', borderRadius: 'var(--trae-radius-full)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${c.progress}%`, background: 'var(--trae-bg-brand)', borderRadius: 'var(--trae-radius-full)' }} />
                  </div>
                </div>
                <div>
                  <button type="button" data-dom-id={c.domId} aria-label={c.cta} onClick={() => handleOpenCourse(c.id)} className="btn-press inline-flex cursor-pointer items-center transition-colors" style={{ gap: 6, padding: '7px 14px', border: '1px solid var(--trae-border-brand)', borderRadius: 'var(--trae-radius-6)', background: 'transparent', color: 'var(--trae-text-brand)', fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)' }}>
                    {c.cta}
                    <ArrowRight size={12} style={{ color: 'var(--trae-text-brand)' }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ====== 4. 课程分类导航 ====== */}
        <nav style={{ marginTop: 36 }} aria-label="课程分类">
          <div className="flex flex-nowrap overflow-x-auto no-scrollbar" style={{ gap: 8, padding: '2px 0' }}>
            {CATEGORIES.map((cat) => {
              const active = activeCategory === cat.id
              return (
                <button key={cat.id} type="button" onClick={() => setActiveCategory(cat.id)} aria-pressed={active} className="btn-press shrink-0 cursor-pointer whitespace-nowrap transition-colors" style={{ padding: '6px 14px', border: `1px solid ${active ? 'var(--trae-border-brand)' : 'var(--trae-border-neutral-l2)'}`, borderRadius: 'var(--trae-radius-6)', background: active ? 'var(--trae-bg-brand)' : 'transparent', color: active ? 'var(--trae-text-onbrand)' : 'var(--trae-text-secondary)', fontSize: 'var(--trae-body-sm-font-size)', fontWeight: active ? 'var(--trae-font-weight-medium)' : undefined }}>
                  {cat.label}
                </button>
              )
            })}
          </div>
        </nav>

        {/* ====== 5. 课程列表 lg:grid-cols-3 ====== */}
        <section style={{ marginTop: 20 }} aria-label="课程列表">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCourses.map((c) => {
              const Icon = c.icon
              const progressColor = c.progress > 0 ? 'var(--trae-text-brand)' : 'var(--trae-text-tertiary)'
              return (
                <div key={c.id} style={{ background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="flex items-center justify-between">
                    <Icon size={20} style={{ color: 'var(--trae-icon-secondary)' }} />
                    <span className="flex items-center" style={{ gap: 6 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 8px', height: 18, borderRadius: 'var(--trae-radius-4)', fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 1, ...levelBadgeStyle(c.level) }}>{c.level}</span>
                      {c.completed && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 8px', height: 18, borderRadius: 'var(--trae-radius-4)', background: 'var(--trae-status-success-surface-l1)', color: 'var(--trae-status-success-default)', fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 1 }}>已完成</span>
                      )}
                    </span>
                  </div>
                  <h4 style={{ fontSize: 'var(--trae-body-md-font-size)', fontWeight: 'var(--trae-font-weight-strong)', lineHeight: 'var(--trae-body-md-strong-line-height)', color: 'var(--trae-text-default)', margin: 0 }}>{c.title}</h4>
                  <p style={{ fontSize: 'var(--trae-body-xs-font-size)', lineHeight: 'var(--trae-body-sm-line-height)', color: 'var(--trae-text-tertiary)', margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.description}</p>
                  <div className="flex items-center" style={{ gap: 12, fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-tertiary)' }}>
                    <span className="flex items-center" style={{ gap: 4 }}>
                      <Clock size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                      {c.duration}
                    </span>
                    <span className="flex items-center" style={{ gap: 4 }}>
                      <UserCircle size={12} style={{ color: 'var(--trae-icon-tertiary)' }} />
                      {c.learnerCount}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                      <span style={{ fontSize: 'var(--trae-body-xs-font-size)', color: 'var(--trae-text-tertiary)' }}>进度</span>
                      <span style={{ fontSize: 'var(--trae-body-xs-font-size)', color: progressColor, fontVariantNumeric: 'tabular-nums', fontWeight: c.progress > 0 ? 'var(--trae-font-weight-medium)' : undefined }}>{c.progress}%</span>
                    </div>
                    <div style={{ height: 3, background: 'var(--trae-bg-overlay-l3)', borderRadius: 'var(--trae-radius-full)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${c.progress}%`, background: 'var(--trae-bg-brand)' }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ====== 6. 推荐学习路径 ====== */}
        <section style={{ marginTop: 40 }} aria-label="推荐学习路径">
          <div className="flex items-center" style={{ gap: 8, marginBottom: 16 }}>
            <Sparkles size={18} style={{ color: 'var(--trae-icon-brand)' }} />
            <h2 style={{ fontFamily: 'var(--trae-heading-md-font-family)', fontSize: 'var(--trae-heading-md-font-size)', fontWeight: 'var(--trae-font-weight-strong)', lineHeight: 'var(--trae-heading-md-line-height)', color: 'var(--trae-text-default)', margin: 0 }}>推荐学习路径</h2>
          </div>
          <div className="flex flex-col" style={{ gap: 10 }}>
            {LEARNING_PATHS.map((path) => (
              <div key={path.id} className="flex items-center" style={{ gap: 16, padding: '14px 18px', background: 'var(--trae-bg-base-secondary)', border: '1px solid var(--trae-border-neutral-l1)', borderRadius: 'var(--trae-radius-8)' }}>
                <span style={{ fontSize: 'var(--trae-body-sm-font-size)', fontWeight: 'var(--trae-font-weight-medium)', color: 'var(--trae-text-default)', minWidth: 120, flexShrink: 0 }}>{path.title}</span>
                <span className="flex min-w-0 flex-1 items-center overflow-x-auto no-scrollbar" style={{ gap: 8 }}>
                  {path.steps.map((step, i) => (
                    <span key={step.label} className="flex items-center" style={{ gap: 8 }}>
                      {i > 0 && <ChevronRight size={12} style={{ color: 'var(--trae-text-tertiary)', flexShrink: 0 }} />}
                      <span style={{ padding: '4px 12px', borderRadius: 'var(--trae-radius-4)', fontSize: 'var(--trae-body-xs-font-size)', whiteSpace: 'nowrap', flexShrink: 0, fontWeight: step.active ? 'var(--trae-font-weight-medium)' : undefined, background: step.active ? 'var(--trae-bg-brand-popup)' : 'var(--trae-bg-overlay-l3)', color: step.active ? 'var(--trae-text-brand)' : 'var(--trae-text-default)' }}>{step.label}</span>
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ====== 按压动画 + 无障碍降级 ====== */}
      <style>{`
        .btn-press { transition: transform 80ms ease-out; }
        .btn-press:active { transform: scale(0.92); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { scrollbar-width: none; }
        @media (prefers-reduced-motion: reduce) {
          .btn-press:active { transform: none !important; }
        }
      `}</style>
    </main>
  )
}
