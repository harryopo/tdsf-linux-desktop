/**
 * EmbeddingBanner — 混合检索能力引导横幅
 *
 * 场景：
 * - 用户首次访问教程页时，BGE-small-zh-v1.5 模型尚未下载、向量未回填
 * - 语义检索不可用 → 显示 idle 状态横幅，引导用户「下载模型 + 回填向量」
 * - 用户点击「开始回填」→ 显示 loading 状态 + 真实进度条（v2.5 异步 4 通道）
 * - 回填完成 → 显示 ready 状态（用户手动点击 × 关闭，或刷新页面后由 bannerVisible 守卫控制）
 * - 回填失败 → 显示 error 状态 + 错误信息 + 重试按钮
 *
 * 4 状态对应的 CSS 类：
 * - idle:    .tut-embedding-banner--idle    （中性灰，提示性）
 * - loading: .tut-embedding-banner--loading  （品牌蓝，进行中）
 * - ready:   .tut-embedding-banner--ready    （成功绿，已完成）
 * - error:   .tut-embedding-banner--error    （错误红，失败）
 *
 * 进度条：
 * - 已知 total（>0）→ 显示真实百分比进度条 .tut-embedding-progress-bar-fill
 * - 未知 total（=-1）→ 显示 indeterminate 动画 .tut-embedding-indeterminate
 *
 * v2.5 Phase C 升级：
 * - 进度从 indeterminate 升级为真实 pct（processed/total）
 * - 新增「取消」按钮（异步模式可用时）
 * - 完成后自动刷新 status，无需用户手动刷新页面
 */
import type { MouseEvent } from 'react'
import type {
  BackfillProgress,
  SearchStatus,
} from '@/components/tutorial/v1/hybrid-search-types'

/** EmbeddingBanner 组件 Props */
export interface EmbeddingBannerProps {
  /** 检索能力快照（null 表示 API 不可用，不渲染 Banner） */
  status: SearchStatus | null
  /** 回填进度（null 表示尚未开始） */
  progress: BackfillProgress | null
  /** 是否正在异步回填中（v2.5 异步模式：控制取消按钮显隐） */
  isBackfilling: boolean
  /** 是否支持取消（v2.5 异步 4 通道可用时为 true） */
  canCancel: boolean
  /** 触发回填（点击「开始回填」按钮） */
  onBackfill: () => void
  /** 取消回填（点击「取消」按钮，仅 isBackfilling=true 时有效） */
  onCancel: () => void
  /** 关闭横幅（点击 ×，仅当前会话） */
  onClose: () => void
}

/**
 * 根据状态和进度计算 Banner 显示模式
 *
 * 4 模式：
 * - 'idle'    ：模型未加载 + 无进度 → 引导用户开始
 * - 'loading' ：模型下载中 / 向量回填中 → 显示进度
 * - 'ready'   ：模型已加载 + 向量已就绪 / progress.phase='done' → 成功
 * - 'error'   ：progress.phase='error' → 失败
 */
type BannerMode = 'idle' | 'loading' | 'ready' | 'error'

function computeMode(
  status: SearchStatus | null,
  progress: BackfillProgress | null,
): BannerMode {
  // 错误优先
  if (progress?.phase === 'error') return 'error'
  // 进行中（下载模型 + 生成向量）
  if (
    progress?.phase === 'downloading-model' ||
    progress?.phase === 'generating-embeddings'
  ) {
    return 'loading'
  }
  // 已完成
  if (progress?.phase === 'done') return 'ready'
  // 模型已加载（无需引导）
  if (status?.embeddingModelLoaded) return 'ready'
  // 默认：idle 引导
  return 'idle'
}

/**
 * 计算进度百分比（0-100）
 * - total <= 0：未知，返回 -1（触发 indeterminate）
 * - total > 0：current / total * 100，限制 0-100
 */
function computePct(current: number, total: number): number {
  if (total <= 0) return -1
  const pct = Math.round((current / total) * 100)
  return Math.min(100, Math.max(0, pct))
}

/** 模式对应的 CSS 类名 */
const MODE_CLASS: Record<BannerMode, string> = {
  idle: 'tut-embedding-banner--idle',
  loading: 'tut-embedding-banner--loading',
  ready: 'tut-embedding-banner--ready',
  error: 'tut-embedding-banner--error',
}

/** 模式对应的标题文案 */
const MODE_TITLE: Record<BannerMode, string> = {
  idle: '语义检索尚未就绪',
  loading: '正在准备语义检索能力',
  ready: '语义检索已就绪',
  error: '语义检索准备失败',
}

/** 模式对应的描述文案（动态生成，含数量） */
function describeMode(
  mode: BannerMode,
  status: SearchStatus | null,
  progress: BackfillProgress | null,
): string {
  switch (mode) {
    case 'idle':
      return status
        ? `检测到 ${status.totalEntries} 条教程待索引，下载 BGE-small-zh-v1.5 模型（约 24MB）后即可启用语义检索`
        : '下载 BGE-small-zh-v1.5 模型后即可启用语义检索'
    case 'loading':
      if (progress?.phase === 'downloading-model') {
        return '正在下载 BGE-small-zh-v1.5 模型，请稍候...'
      }
      if (progress?.phase === 'generating-embeddings') {
        const pct = computePct(progress.current, progress.total)
        if (pct < 0) {
          return '正在为教程生成向量 embedding（首次需 1-3 分钟）...'
        }
        return `已生成 ${progress.current} / ${progress.total} 条向量 embedding（${pct}%）`
      }
      return '正在准备语义检索能力...'
    case 'ready':
      return '混合检索（BM25 + 向量 KNN + RRF 融合）已可用'
    case 'error':
      return progress?.errorMessage ?? '请重试或查看控制台日志'
  }
}

export function EmbeddingBanner({
  status,
  progress,
  isBackfilling,
  canCancel,
  onBackfill,
  onCancel,
  onClose,
}: EmbeddingBannerProps) {
  const mode = computeMode(status, progress)
  const title = MODE_TITLE[mode]
  const desc = describeMode(mode, status, progress)

  // 进度条相关
  const pct = computePct(progress?.current ?? 0, progress?.total ?? -1)
  const showProgressTrack = mode === 'loading'
  const isIndeterminate = pct < 0

  // 按钮显隐逻辑
  const showStartBtn = mode === 'idle' || mode === 'error'
  const showCancelBtn = mode === 'loading' && isBackfilling && canCancel
  const showCloseBtn = mode === 'ready' || mode === 'error'

  /** 阻止冒泡（避免点击按钮触发父级事件） */
  const stop = (e: MouseEvent) => e.stopPropagation()

  return (
    <div
      className={`tut-embedding-banner ${MODE_CLASS[mode]}`}
      role="status"
      aria-live="polite"
      aria-label={title}
    >
      <div className="tut-embedding-content">
        <div className="tut-embedding-title-row">
          <span>{title}</span>
          {/* loading 模式下显示已处理数量 */}
          {mode === 'loading' && progress && progress.total > 0 && (
            <span
              className="tut-embedding-meta-num"
              aria-label={`进度 ${pct}%`}
            >
              {progress.current} / {progress.total}
            </span>
          )}
          {/* ready 模式下显示总条目数 */}
          {mode === 'ready' && status && (
            <span className="tut-embedding-meta-num--tertiary">
              {status.totalEntries} 条已索引
            </span>
          )}
        </div>

        <p className="tut-embedding-desc">{desc}</p>

        {/* 进度条（仅 loading 模式显示） */}
        {showProgressTrack && (
          <div
            className="tut-embedding-progress-bar"
            role="progressbar"
            aria-valuenow={isIndeterminate ? undefined : pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="回填进度"
          >
            {isIndeterminate ? (
              <div className="tut-embedding-indeterminate" />
            ) : (
              <div
                className="tut-embedding-progress-bar-fill"
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
        )}
      </div>

      {/* 按钮组 */}
      <div className="tut-embedding-actions">
        {showStartBtn && (
          <button
            type="button"
            className="tut-embedding-btn tut-embedding-btn--alert"
            onClick={(e) => {
              stop(e)
              onBackfill()
            }}
            disabled={isBackfilling}
          >
            {mode === 'error' ? '重试' : '开始回填'}
          </button>
        )}
        {showCancelBtn && (
          <button
            type="button"
            className="tut-embedding-btn tut-embedding-btn--ghost"
            onClick={(e) => {
              stop(e)
              onCancel()
            }}
          >
            取消
          </button>
        )}
        {showCloseBtn && (
          <button
            type="button"
            className="tut-embedding-close-btn"
            onClick={(e) => {
              stop(e)
              onClose()
            }}
            aria-label="关闭横幅"
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}
