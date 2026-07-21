/**
 * EmbeddingBanner — 首次使用语义检索引导条（Sprint 7 任务 F）
 *
 * 设计目标：
 * - 当后端 EmbeddingService 未加载模型时，提示用户下载 BGE-small-zh-v1.5（约 24MB）
 * - 用户可选「下载模型」（触发 backfillEmbeddings）或「跳过」（仅用关键词检索）
 * - 下载过程显示进度（phase: downloading-model / generating-embeddings / done / error）
 * - 完成后 1.5s 自动隐藏，错误状态保留显示供用户查看
 *
 * 视觉规范：
 * - 提示色用 var(--trae-status-alert-*)（醒目但不刺眼）
 * - 字体：正文 Inter，数字 JetBrains Mono（等宽）
 * - 暗色模式默认（背景与主背景区分）
 * - hover 仅阴影变化（遵循项目硬约束）
 *
 * 交互：
 * - 受控组件，所有状态由父组件（useHybridSearch Hook）管理
 * - onDownload：触发模型下载 + embedding 回填
 * - onSkip：跳过本次提示（父组件可持久化到 localStorage）
 * - onDismiss：手动关闭 banner（仅 done 状态自动隐藏，其他状态由用户控制）
 */
import { useEffect } from 'react'
import {
  Download,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Cpu,
} from 'lucide-react'
import type {
  SearchStatus,
  BackfillProgress,
} from './hybrid-search-types'

export interface EmbeddingBannerProps {
  /** 检索能力快照（null 表示 API 不可用，此时不渲染 Banner） */
  status: SearchStatus | null
  /** 回填进度（null 表示尚未开始下载） */
  progress: BackfillProgress | null
  /** 是否已跳过（跳过后不渲染 Banner，由父组件持久化） */
  skipped: boolean
  /** 点击「下载模型」回调（父组件触发 backfillEmbeddings） */
  onDownload: () => void
  /** 点击「跳过」回调（父组件持久化 skipped=true） */
  onSkip: () => void
  /** 点击「关闭」回调（仅 done 状态自动触发，用户也可手动关闭错误状态） */
  onDismiss: () => void
}

/**
 * 根据进度计算百分比（0-100）
 *
 * - total <= 0 或 total < 0（未知）：返回 null（显示 indeterminate 状态）
 * - current >= total：返回 100
 * - 其他：Math.round(current / total * 100)
 */
function computePercent(progress: BackfillProgress): number | null {
  if (progress.total <= 0) return null
  if (progress.current >= progress.total) return 100
  return Math.round((progress.current / progress.total) * 100)
}

/** 进度阶段中文标签 */
function phaseLabel(phase: BackfillProgress['phase']): string {
  switch (phase) {
    case 'downloading-model':
      return '正在下载 BGE 模型'
    case 'generating-embeddings':
      return '正在生成向量索引'
    case 'done':
      return '准备就绪'
    case 'error':
      return '下载失败'
  }
}

/** EmbeddingBanner 组件 */
export function EmbeddingBanner({
  status,
  progress,
  skipped,
  onDownload,
  onSkip,
  onDismiss,
}: EmbeddingBannerProps) {
  // ===== 不渲染条件 =====
  // 1. status 为 null（API 不可用）：不阻塞用户，静默降级
  // 2. status.embeddingModelLoaded === true：模型已加载，无需提示
  // 3. skipped === true：用户已跳过
  // 4. progress.phase === 'done' 完成后 1.5s 自动关闭（由 useEffect 触发 onDismiss）
  const isDone = progress?.phase === 'done'
  const isError = progress?.phase === 'error'
  const isProgressing =
    progress?.phase === 'downloading-model' ||
    progress?.phase === 'generating-embeddings'

  // 完成后自动关闭
  useEffect(() => {
    if (!isDone) return
    const timer = setTimeout(() => {
      onDismiss()
    }, 1500)
    return () => clearTimeout(timer)
  }, [isDone, onDismiss])

  // 不渲染场景
  if (!status || skipped) return null
  // 模型已加载且未在下载中：不渲染
  if (status.embeddingModelLoaded && !isProgressing && !isDone && !isError) {
    return null
  }

  // ===== 渲染分支 =====
  // 分支 1：默认未加载状态（无进度，或进度未启动）
  const isDefault = !progress || (!isProgressing && !isDone && !isError)

  // 分支 2：进度中
  const percent = progress ? computePercent(progress) : null

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 border px-4 py-3"
      style={{
        background: isError
          ? 'var(--trae-status-error-surface-l1)'
          : isDone
            ? 'var(--trae-status-success-surface-l1)'
            : 'var(--trae-status-alert-surface-l1)',
        borderColor: isError
          ? 'var(--trae-status-error-default)'
          : isDone
            ? 'var(--trae-status-success-default)'
            : 'var(--trae-status-alert-default)',
        borderRadius: 'var(--trae-radius-8)',
      }}
    >
      {/* ===== 左侧图标 ===== */}
      <div className="shrink-0">
        {isDefault && (
          <Cpu
            className="h-5 w-5"
            style={{ color: 'var(--trae-status-alert-default)' }}
          />
        )}
        {isProgressing && (
          <Loader2
            className="h-5 w-5 animate-spin"
            style={{ color: 'var(--trae-status-alert-default)' }}
          />
        )}
        {isDone && (
          <CheckCircle2
            className="h-5 w-5"
            style={{ color: 'var(--trae-status-success-default)' }}
          />
        )}
        {isError && (
          <AlertCircle
            className="h-5 w-5"
            style={{ color: 'var(--trae-status-error-default)' }}
          />
        )}
      </div>

      {/* ===== 中间内容（标题 + 描述 / 进度条） ===== */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* 标题行 */}
        <div
          className="flex items-baseline gap-2"
          style={{
            color: 'var(--trae-text-default)',
            fontSize: 'var(--trae-body-sm-strong-font-size)',
            fontWeight: 'var(--trae-font-weight-medium)',
            lineHeight: 'var(--trae-body-sm-strong-line-height)',
          }}
        >
          {isDefault && (
            <>
              <span>首次使用语义检索需下载模型</span>
              <span
                style={{
                  fontFamily: 'var(--trae-font-family-mono)',
                  fontSize: 'var(--trae-body-xs-font-size)',
                  color: 'var(--trae-text-secondary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                约 24MB · 10-30 秒
              </span>
            </>
          )}
          {isProgressing && (
            <>
              <span>{phaseLabel(progress!.phase)}</span>
              {percent !== null && (
                <span
                  style={{
                    fontFamily: 'var(--trae-font-family-mono)',
                    fontSize: 'var(--trae-body-xs-font-size)',
                    color: 'var(--trae-text-secondary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {percent}%
                </span>
              )}
              {progress!.total > 0 && (
                <span
                  style={{
                    fontFamily: 'var(--trae-font-family-mono)',
                    fontSize: 'var(--trae-body-xs-font-size)',
                    color: 'var(--trae-text-tertiary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  ({progress!.current} / {progress!.total})
                </span>
              )}
            </>
          )}
          {isDone && <span>模型已就绪，语义检索可用</span>}
          {isError && (
            <span style={{ color: 'var(--trae-status-error-default)' }}>
              下载失败：{progress?.errorMessage ?? '未知错误'}
            </span>
          )}
        </div>

        {/* 描述 / 进度条 */}
        {isDefault && (
          <p
            className="m-0"
            style={{
              fontSize: 'var(--trae-body-xs-font-size)',
              lineHeight: 'var(--trae-body-xs-line-height)',
              color: 'var(--trae-text-secondary)',
            }}
          >
            BGE-small-zh-v1.5 支持 512 维中英文语义向量，可显著提升检索准确率。
            当前知识库共 {status.totalEntries} 条目等待索引。
          </p>
        )}
        {isProgressing && (
          <div
            className="h-1 w-full overflow-hidden"
            style={{
              background: 'var(--trae-bg-overlay-l2)',
              borderRadius: 'var(--trae-radius-full)',
            }}
          >
            <div
              className="h-full transition-all"
              style={{
                width: percent !== null ? `${percent}%` : '100%',
                background: 'var(--trae-status-alert-default)',
                borderRadius: 'var(--trae-radius-full)',
                animation:
                  percent === null
                    ? 'embedding-banner-indeterminate 1.5s ease-in-out infinite'
                    : 'none',
              }}
            />
          </div>
        )}
        {isDone && (
          <p
            className="m-0"
            style={{
              fontSize: 'var(--trae-body-xs-font-size)',
              lineHeight: 'var(--trae-body-xs-line-height)',
              color: 'var(--trae-text-secondary)',
            }}
          >
            已成功生成向量索引，现在可以使用语义检索模式。
          </p>
        )}
        {isError && (
          <p
            className="m-0"
            style={{
              fontSize: 'var(--trae-body-xs-font-size)',
              lineHeight: 'var(--trae-body-xs-line-height)',
              color: 'var(--trae-text-secondary)',
            }}
          >
            可检查网络连接后重试，或暂时使用关键词检索模式。
          </p>
        )}
      </div>

      {/* ===== 右侧操作按钮 ===== */}
      <div className="flex shrink-0 items-center gap-2">
        {isDefault && (
          <>
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 border-0 px-3 transition-colors"
              style={{
                background: 'var(--trae-status-alert-default)',
                color: 'var(--trae-text-onbrand)',
                borderRadius: 'var(--trae-radius-4)',
                fontSize: 'var(--trae-body-xs-font-size)',
                fontWeight: 'var(--trae-font-weight-medium)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  'var(--trae-status-alert-hover)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  'var(--trae-status-alert-default)'
              }}
            >
              <Download className="h-3.5 w-3.5" />
              下载模型
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="inline-flex h-7 cursor-pointer items-center border px-3 transition-colors"
              style={{
                background: 'transparent',
                color: 'var(--trae-text-secondary)',
                borderColor: 'var(--trae-border-neutral-l2)',
                borderRadius: 'var(--trae-radius-4)',
                fontSize: 'var(--trae-body-xs-font-size)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--trae-text-default)'
                e.currentTarget.style.borderColor =
                  'var(--trae-border-neutral-l3)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--trae-text-secondary)'
                e.currentTarget.style.borderColor =
                  'var(--trae-border-neutral-l2)'
              }}
            >
              跳过
            </button>
          </>
        )}
        {isError && (
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex h-7 cursor-pointer items-center gap-1.5 border-0 px-3 transition-colors"
            style={{
              background: 'var(--trae-status-error-default)',
              color: 'var(--trae-text-onbrand)',
              borderRadius: 'var(--trae-radius-4)',
              fontSize: 'var(--trae-body-xs-font-size)',
              fontWeight: 'var(--trae-font-weight-medium)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background =
                'var(--trae-status-error-hover)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background =
                'var(--trae-status-error-default)'
            }}
          >
            <Download className="h-3.5 w-3.5" />
            重试
          </button>
        )}
        {/* 关闭按钮（done 自动关闭，其他状态用户可手动关闭） */}
        {!isProgressing && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="关闭提示"
            className="shrink-0 cursor-pointer rounded-full p-1 transition-colors"
            style={{
              color: 'var(--trae-text-tertiary)',
              background: 'transparent',
              border: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--trae-text-secondary)'
              e.currentTarget.style.background = 'var(--trae-bg-overlay-l2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--trae-text-tertiary)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ===== indeterminate 进度条动画 ===== */}
      <style>{`
        @keyframes embedding-banner-indeterminate {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}
