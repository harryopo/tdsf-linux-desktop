import { useState, useRef, useEffect, type FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { message } from 'antd'
import {
  ArrowUp, AtSign, ChevronDown, Cpu, Hash,
  Image as ImageIcon, Loader2, Square, Workflow, X,
} from 'lucide-react'
import { cn } from '@/components/trae/utils'
import { MOCK_COMPOSER_CHIPS } from './mock-data'
import { useLoopEngineering } from './useLoopEngineering'
import ContextBadge from './ContextBadge'
import type { PersistedProviderConfig, TokenStats } from '@shared/agent-types'
import type { ImageUploadResult } from '@/types/electron'

/**
 * v2.2 P1 修复 #22：图片附件类型
 *
 * 简化方案：仅保存 base64 data URL + 文件名 + 大小，不引入图片压缩。
 * 发送时将 dataUrl 拼接到消息文本末尾（WIP：真实 vision model 集成需要修改 useAgentChat 接口）。
 */
export interface ImageAttachment {
  /** base64 data URL（可直接用于 <img src>） */
  dataUrl: string
  /** 文件名（含扩展名） */
  fileName: string
  /** 文件大小（字节） */
  fileSize: number
  /** MIME 类型 */
  mimeType: string
}

/** Composer props */
export interface ComposerProps {
  demoMode: boolean
  setDemoMode: (v: boolean | ((prev: boolean) => boolean)) => void
  isStreaming: boolean
  loop: ReturnType<typeof useLoopEngineering>
  activeSessionId: string | null
  providers: PersistedProviderConfig[]
  selectedProviderId: string | null
  setSelectedProviderId: (id: string) => void
  tokenStats: TokenStats
  send: (text: string) => Promise<void>
  cancel: () => Promise<void>
  /** 用户成功发送消息后回调（父组件收起 demo） */
  onAfterSend: () => void
  /** 压缩上下文回调（T.7） */
  onCompressContext?: () => void
}

/** AIPanel 输入区域（Composer chips + 输入框 + 工具栏 + Provider 选择 + Send 按钮） */
const Composer: FC<ComposerProps> = ({
  demoMode,
  setDemoMode,
  isStreaming,
  loop,
  activeSessionId,
  providers,
  selectedProviderId,
  setSelectedProviderId,
  tokenStats,
  send,
  cancel,
  onAfterSend,
  onCompressContext,
}) => {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [activeChip, setActiveChip] = useState<string | null>(null)
  // v2.2 P1 修复 #22：图片附件列表（基础版，不引入图片压缩库）
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const providerMenuRef = useRef<HTMLDivElement>(null)

  const selectedProvider = providers.find((p) => p.id === selectedProviderId) ?? null
  const providerLabel = selectedProvider
    ? selectedProvider.name || selectedProvider.model || selectedProvider.id
    : providers.length === 0
      ? '未配置模型'
      : '选择模型'

  /** 上下文窗口用量（从今日 token 估算，模型窗口按 200K 计） */
  const ctxUsedPct = Math.min(100, Math.round((tokenStats.today / 200_000) * 100))
  const ctxUsedTokens = tokenStats.today >= 1000 ? `${(tokenStats.today / 1000).toFixed(1)}K` : String(tokenStats.today)
  const ctxTotalTokens = '200K'

  /** 点击外部关闭 Provider 菜单 */
  useEffect(() => {
    if (!providerMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!providerMenuRef.current?.contains(e.target as Node)) {
        setProviderMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [providerMenuOpen])

  /** textarea auto-resize */
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [input])

  /** 处理发送/停止 — 主路径 agent:chat 或 演示模式 loop:start */
  const handleSendToggle = () => {
    // 演示模式：循环工程运行中 → 点击发送键表示取消
    if (demoMode && loop.isRunning) {
      void loop.cancel()
      return
    }
    // 普通模式：流式生成中 → 取消
    if (!demoMode && isStreaming) {
      void cancel()
      return
    }
    if (!input.trim() && attachments.length === 0) return
    // v2.2 P1 修复 #22：发送时如果有图片附件，将 base64 data URL 拼接到消息文本末尾
    // 简化方案：不修改 useAgentChat 接口，直接拼接（WIP：真实 vision model 集成需修改接口）
    const text = attachments.length > 0
      ? `${input.trim()}\n\n[图片附件]\n${attachments.map((a) => a.dataUrl).join('\n')}`
      : input
    setInput('')
    setAttachments([])
    onAfterSend()

    if (demoMode) {
      // 演示模式：启动循环工程 7 步 HITL
      if (!activeSessionId) {
        loop.reset()
        message.warning('演示模式需要先连接 SSH。请用顶栏服务器菜单或「设置 → SSH」连接主机。')
        return
      }
      if (providers.length === 0) {
        message.warning('请先配置模型 Provider（设置 → 模型）')
        return
      }
      void loop.start(text, activeSessionId, {
        providerId: selectedProviderId ?? undefined,
        strength: 'standard',
      })
    } else {
      void send(text)
    }
  }

  /** 在输入框追加前缀 */
  const insertPrefix = (prefix: string) => {
    setInput((prev) => {
      const sep = prev.endsWith(' ') || prev === '' ? '' : ' '
      return `${prev}${sep}${prefix}`
    })
    textareaRef.current?.focus()
  }

  /**
   * 上传图片附件（v2.2 P1 修复 #22：真实实现，替代原 WIP message.warning）
   *
   * 调用 fsUploadImage IPC：主进程弹出文件选择对话框 → 读取图片 → 返回 base64 data URL。
   * 简化方案：不引入图片压缩库，限制 4MB，支持 png/jpg/jpeg/gif/webp/bmp。
   */
  const handleUploadImage = async () => {
    if (isUploadingImage) return
    const api = window.electronAPI
    if (!api?.fsUploadImage) {
      message.warning('当前环境不支持图片上传（非 Electron 环境）')
      return
    }
    setIsUploadingImage(true)
    try {
      const result = await api.fsUploadImage()
      if (result.success) {
        const uploadData = result as ImageUploadResult
        // 限制最多 4 张图片（避免消息过长）
        if (attachments.length >= 4) {
          message.warning('最多支持 4 张图片附件')
          return
        }
        setAttachments((prev) => [...prev, {
          dataUrl: uploadData.dataUrl,
          fileName: uploadData.fileName,
          fileSize: uploadData.fileSize,
          mimeType: uploadData.mimeType,
        }])
      } else if (result.error !== '用户取消选择') {
        // 用户取消不提示错误
        message.error(`图片上传失败：${result.error}`)
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      message.error(`图片上传失败：${reason}`)
    } finally {
      setIsUploadingImage(false)
    }
  }

  /** 删除指定索引的图片附件 */
  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  /** chip 快捷填入可直接发送的运维提示词 */
  const handleChipClick = (chip: string) => {
    setActiveChip((c) => (c === chip ? null : chip))
    const prompts: Record<string, string> = {
      诊断:
        '请诊断当前主机健康状态：磁盘(df -h)、内存(free -m)、负载(uptime)、关键服务(systemctl --failed)。只读命令，给出结论与建议。',
      部署: '请给出 Nginx 反向代理部署检查清单：配置语法、端口监听、上游健康、证书与 reload 风险点。',
      巡检:
        '请做一次只读巡检：磁盘使用率、inode、内存与 swap、失败的 systemd 单元、最近 journal 错误摘要。',
      回滚: '若最近一次配置变更导致服务异常，请给出安全的回滚步骤与验证命令（先读后写，写操作需人工确认）。',
      扩容: '请分析当前资源瓶颈（CPU/内存/磁盘/网络）并给出扩容建议与验证指标。',
    }
    setInput(prompts[chip] ?? `${chip}：`)
    textareaRef.current?.focus()
  }

  return (
    <>
      {/* ===== Composer chips ===== */}
      <div className="ai-composer-chips">
        {/* 演示模式切换 chip —— 接入真实循环工程 7 步 HITL */}
        <button
          type="button"
          title={demoMode ? '退出演示模式（回到普通 agent:chat）' : '进入演示模式（接入循环工程 7 步 HITL：假设置→决策卡片→执行→验证）'}
          onClick={() => {
            if (loop.isRunning) {
              // 切换前先取消进行中的循环工程
              void loop.cancel()
            }
            setDemoMode((v) => !v)
          }}
          className={cn(
            'ai-composer-chip btn-press',
            demoMode && 'ai-chip-primary',
          )}
        >
          <Workflow className="size-3" />
          {demoMode ? '演示模式：开' : '演示模式'}
          {demoMode && !activeSessionId && (
            <span className="ml-0.5 inline-flex h-3.5 items-center rounded-full bg-[var(--trae-status-alert-surface-l1)] px-1 text-[11px] text-[var(--trae-status-alert-default)]">
              未连接
            </span>
          )}
        </button>

        <span className="ai-composer-divider" />

        {MOCK_COMPOSER_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => handleChipClick(chip)}
            className={cn(
              'ai-composer-chip btn-press',
              activeChip === chip && 'ai-chip-primary',
            )}
          >
            {chip}
          </button>
        ))}
      </div>

      {/* ===== Composer 输入框 ===== */}
      <div className="ai-composer-outer">
        <div className="ai-composer">
          <div className="ai-composer-top">
            <span className="ai-agent-badge">
              <Cpu className="size-3" />
              Agent
              <span className="ai-agent-dot" />
            </span>
            <span
              className="ai-composer-placeholder"
              style={{ display: input ? 'none' : undefined }}
            >
              您正在与Agent聊天，输入 '/' 获取更多能力
            </span>
          </div>

          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendToggle()
              }
            }}
            className="ai-composer-textarea"
            placeholder=""
            style={{ maxHeight: 120 }}
          />

          {/* v2.2 P1 修复 #22：图片附件预览区（缩略图 + 删除按钮） */}
          {attachments.length > 0 && (
            <div
              className="ai-composer-attachments"
              style={{
                display: 'flex',
                gap: 'var(--trae-spacing-xs, 4px)',
                padding: '4px 0',
                flexWrap: 'wrap',
              }}
            >
              {attachments.map((attachment, index) => (
                <div
                  key={`${attachment.fileName}-${index}`}
                  style={{
                    position: 'relative',
                    width: '48px',
                    height: '48px',
                    borderRadius: 'var(--trae-radius-4, 4px)',
                    overflow: 'hidden',
                    border: '1px solid var(--trae-border-neutral-l2)',
                    background: 'var(--trae-bg-overlay-l1)',
                  }}
                  title={`${attachment.fileName} (${(attachment.fileSize / 1024).toFixed(1)}KB)`}
                >
                  <img
                    src={attachment.dataUrl}
                    alt={attachment.fileName}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(index)}
                    aria-label={`删除附件 ${attachment.fileName}`}
                    title="删除"
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      width: '16px',
                      height: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--trae-bg-overlay-l3)',
                      border: 'none',
                      borderRadius: '0 0 0 var(--trae-radius-4, 4px)',
                      cursor: 'pointer',
                      color: 'var(--trae-text-onbrand)',
                      padding: 0,
                    }}
                  >
                    <X className="size-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="ai-composer-toolbar">
            <div className="ai-composer-tools-left">
              <button
                type="button"
                title="@提及"
                onClick={() => insertPrefix('@')}
                className="ai-composer-icon-btn btn-press"
              >
                <AtSign className="size-3.5" />
              </button>
              <button
                type="button"
                title="#引用资源"
                onClick={() => insertPrefix('#')}
                className="ai-composer-icon-btn btn-press"
              >
                <Hash className="size-3.5" />
              </button>
              <button
                type="button"
                title="图片"
                onClick={handleUploadImage}
                disabled={isUploadingImage}
                className="ai-composer-icon-btn btn-press"
                style={isUploadingImage ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
              >
                {isUploadingImage ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="size-3.5" />
                )}
              </button>
              <span className="ai-composer-divider" />

              {/* 上下文使用率徽章 */}
              <ContextBadge
                ctxUsedPct={ctxUsedPct}
                ctxUsedTokens={ctxUsedTokens}
                ctxTotalTokens={ctxTotalTokens}
                onCompress={onCompressContext}
              />

              {/* Provider 选择（真列表） */}
              <div className="relative" ref={providerMenuRef}>
                <button
                  type="button"
                  title="切换模型"
                  onClick={() => setProviderMenuOpen((v) => !v)}
                  className="ai-model-btn btn-press"
                >
                  <span className="truncate">{providerLabel}</span>
                  <ChevronDown className="size-2.5 shrink-0" />
                </button>
                {providerMenuOpen && (
                  <div className="absolute bottom-[calc(100%+4px)] left-0 z-50 min-w-[180px] rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] py-1 shadow-xl">
                    {providers.length === 0 ? (
                      <div className="px-3 py-2 text-[11px] text-[var(--trae-text-tertiary)]">
                        暂无 Provider，请到设置 → 模型配置添加
                      </div>
                    ) : (
                      providers.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={cn(
                            'flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors hover:bg-[var(--trae-bg-overlay-l2)]',
                            p.id === selectedProviderId && 'bg-[var(--trae-bg-overlay-l1)]',
                          )}
                          onClick={() => {
                            setSelectedProviderId(p.id)
                            setProviderMenuOpen(false)
                          }}
                        >
                          <span className="text-[11px] text-[var(--trae-text-default)]">
                            {p.name || p.id}
                          </span>
                          <span className="text-[11px] text-[var(--trae-text-tertiary)]">
                            {p.model}
                          </span>
                        </button>
                      ))
                    )}
                    <div className="my-1 border-t border-[var(--trae-border-neutral-l1)]" />
                    <button
                      type="button"
                      className="flex w-full px-3 py-1.5 text-left text-[11px] text-[var(--trae-text-brand)] hover:bg-[var(--trae-bg-overlay-l2)]"
                      onClick={() => {
                        setProviderMenuOpen(false)
                        navigate('/settings/model')
                      }}
                    >
                      打开模型设置…
                    </button>
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              title={
                demoMode
                  ? (loop.isRunning ? '取消循环工程' : '启动循环工程')
                  : (isStreaming ? '停止生成' : '发送')
              }
              onClick={handleSendToggle}
              disabled={
                demoMode
                  ? (!loop.isRunning && !input.trim())
                  : (!isStreaming && !input.trim())
              }
              className="ai-send-btn btn-press wb-send-btn disabled:opacity-40"
            >
              {(demoMode && loop.isRunning) || (!demoMode && isStreaming) ? (
                <Square className="fill-[var(--trae-text-onbrand)] text-[var(--trae-text-onbrand)]" />
              ) : (
                <ArrowUp />
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

export default Composer
