import { useState, useRef, useEffect, type FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { message } from 'antd'
import {
  ArrowUp, AtSign, ChevronDown, Cpu, Hash,
  Image as ImageIcon, Loader2, Sparkles, Square, X, Zap,
} from 'lucide-react'
import { cn } from '@/components/trae/utils'
import { useAgentStore } from '@/stores/agent-store'
// v2.6 修复断链：editor-store.injectedAtCommand 此前只写不读（SelectionPopover 注入后无人消费）
import { useEditorStore } from '@/stores/editor-store'
// v2.3.7 修复：MOCK_COMPOSER_CHIPS → QUICK_PROMPT_TEMPLATES（mock-data.ts v2.3.6 已重命名）
// 之前的 import 指向不存在的导出 → Composer 模块加载失败 → AIPanel 整个组件崩 → "Agent 调用失败"
import { QUICK_PROMPT_TEMPLATES } from './mock-data'
import { useLoopEngineering } from './useLoopEngineering'
import type { UsePaorLoopResult } from './usePaorLoop'
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
  isStreaming: boolean
  loop: ReturnType<typeof useLoopEngineering>
  /** PAOR 自动循环（v0.9.5 P0-3：Plan→Act→Observe→Reflect） */
  paor: UsePaorLoopResult
  activeSessionId: string | null
  providers: PersistedProviderConfig[]
  selectedProviderId: string | null
  setSelectedProviderId: (id: string) => void
  tokenStats: TokenStats
  send: (text: string) => Promise<void>
  cancel: () => Promise<void>
  /** 压缩上下文回调（T.7） */
  onCompressContext?: () => void
}

/** AIPanel 输入区域（Composer chips + 输入框 + 工具栏 + Provider 选择 + Send 按钮） */
const Composer: FC<ComposerProps> = ({
  isStreaming,
  // v2.3.7 修复：loop 由 AIPanel 单独控制循环工程面板，Composer 仅 PAOR chip
  loop: _loop,
  paor,
  activeSessionId,
  providers,
  selectedProviderId,
  setSelectedProviderId,
  tokenStats,
  send,
  cancel,
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

  // v2.5 深度思考开关；v2.10 改三态：auto（自动路由）→ deep（强制深度）→ standard（强制标准）
  const thinkingStrength = useAgentStore((s) => s.thinkingStrength)
  const setThinkingStrength = useAgentStore((s) => s.setThinkingStrength)
  const deepThinking = thinkingStrength === 'deep'

  const selectedProvider = providers.find((p) => p.id === selectedProviderId) ?? null
  const providerLabel = selectedProvider
    ? `${selectedProvider.name || selectedProvider.model || selectedProvider.id}${
        selectedProvider.hasApiKey === false ? ' (未配置Key)' : ''
      }`
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

  // v2.6 修复断链：消费 injectedAtCommand —— 编辑器/终端「发送到 AI」浮层与
  // 空态能力卡注入的文本填入输入框并聚焦（此前 store 只写不读，按钮形同摆设）
  const injectedAtCommand = useEditorStore((s) => s.injectedAtCommand)
  const clearInjectedAtCommand = useEditorStore((s) => s.clearInjectedAtCommand)
  useEffect(() => {
    if (!injectedAtCommand) return
    setInput((prev) => (prev.trim() ? `${prev} ${injectedAtCommand}` : injectedAtCommand))
    clearInjectedAtCommand()
    textareaRef.current?.focus()
  }, [injectedAtCommand, clearInjectedAtCommand])

  /** 处理发送/停止 — 主路径 agent:chat */
  const handleSendToggle = () => {
    // 流式生成中 → 取消
    if (isStreaming) {
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

    // 检查 Provider 是否配置
    if (providers.length === 0) {
      message.warning('请先配置模型 Provider（设置 → 模型）')
      return
    }

    void send(text)
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

  /**
   * 粘贴处理（v2.6）：剪贴板含图片（如截图）时转为图片附件；
   * 纯文本粘贴保持浏览器默认行为（不 preventDefault）。
   */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault()
        if (attachments.length >= 4) {
          message.warning('最多支持 4 张图片附件')
          return
        }
        const file = item.getAsFile()
        if (!file) return
        if (file.size > 4 * 1024 * 1024) {
          message.warning('图片超过 4MB，请压缩后再粘贴')
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result !== 'string') return
          setAttachments((prev) => {
            if (prev.length >= 4) return prev
            return [...prev, {
              dataUrl: reader.result as string,
              fileName: file.name || `粘贴图片-${Date.now()}.png`,
              fileSize: file.size,
              mimeType: file.type,
            }]
          })
        }
        reader.readAsDataURL(file)
        return
      }
    }
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

  /**
   * 启动 PAOR 自动循环（v0.9.5 P0-3）
   *
   * 流程：
   * 1. 校验：输入框不能为空、必须连接 SSH、必须配置 Provider
   * 2. 调用 paor.start(task, sshSessionId, maxIterations=5)
   * 3. 成功启动后清空输入框，UI 状态由 AIPanel 的 useEffect 监听 paor.iterations 展示
   *
   * 与 handleSendToggle 的区别：
   * - handleSendToggle：发送单条消息（agent:chat）或启动循环工程（loop.start）
   * - handlePaorStart：启动 PAOR 自主循环（agent:paor），主进程 Supervisor 编排多步运维任务
   *
   * 注意：PAOR 运行中无法取消（主进程目前不支持 agent:paor:cancel），
   * 只能等迭代上限或人工拒绝高危命令触发 riskBlocked。
   */
  const handlePaorStart = async () => {
    if (paor.isRunning) {
      message.warning('PAOR 循环正在运行中，请等待完成')
      return
    }
    const task = input.trim()
    if (!task) {
      message.warning('请输入运维任务描述后再点击 PAOR 自主循环')
      textareaRef.current?.focus()
      return
    }
    if (!activeSessionId) {
      message.warning('PAOR 需要先连接 SSH 服务器（顶栏服务器菜单或「设置 → SSH」）')
      return
    }
    if (providers.length === 0) {
      message.warning('请先配置模型 Provider（设置 → 模型）')
      return
    }
    setInput('')
    const ok = await paor.start(task, activeSessionId, 5)
    if (ok) {
      message.info({
        content: `PAOR 自主循环已启动\n任务：${task.length > 60 ? `${task.slice(0, 60)}...` : task}\n最大迭代：5 轮`,
        duration: 4,
      })
    }
  }

  return (
    <>
      {/* ===== Composer chips ===== */}
      <div className="ai-composer-chips">
        {/* PAOR 自主循环 chip —— v0.9.5 P0-3：Plan→Act→Observe→Reflect 主进程编排 */}
        <button
          type="button"
          title={
            paor.isRunning
              ? `PAOR 循环运行中（已迭代 ${paor.currentIteration} 轮）`
              : 'PAOR 自主循环（Plan→Act→Observe→Reflect 多步运维任务自动编排，高危命令自动拦截）'
          }
          onClick={handlePaorStart}
          disabled={paor.isRunning}
          className={cn(
            'ai-composer-chip btn-press',
            paor.isRunning && 'ai-chip-primary',
          )}
          style={paor.isRunning ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
        >
          <Zap className="size-3" />
          {paor.isRunning ? `PAOR 运行中(${paor.currentIteration})` : 'PAOR 自主循环'}
          {!activeSessionId && !paor.isRunning && (
            <span className="ml-0.5 inline-flex h-3.5 items-center rounded-full bg-[var(--trae-status-alert-surface-l1)] px-1 text-[11px] text-[var(--trae-status-alert-default)]">
              未连接
            </span>
          )}
        </button>

        <span className="ai-composer-divider" />

        {QUICK_PROMPT_TEMPLATES.map((chip) => (
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
            onPaste={handlePaste}
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

              {/* v2.10 思考强度三态开关：auto（智能）→ deep（深度）→ standard（标准）循环 */}
              <button
                type="button"
                title={
                  thinkingStrength === 'auto'
                    ? '思考强度：自动（按问题复杂度智能选择）— 点击切为深度'
                    : deepThinking
                      ? '思考强度：深度（强制思考链，耗时与 token 增加）— 点击切为标准'
                      : '思考强度：标准— 点击切为自动'
                }
                onClick={() =>
                  setThinkingStrength(
                    thinkingStrength === 'auto' ? 'deep' : deepThinking ? 'standard' : 'auto',
                  )
                }
                className={cn(
                  'btn-press inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[10px] transition-colors',
                  thinkingStrength === 'auto' || deepThinking
                    ? 'border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] text-[var(--trae-text-brand)]'
                    : 'border-[var(--trae-border-neutral-l2)] bg-transparent text-[var(--trae-text-secondary)] hover:text-[var(--trae-text-default)]',
                )}
              >
                <Sparkles className="size-3" />
                {thinkingStrength === 'auto' ? '智能思考' : deepThinking ? '深度思考' : '标准思考'}
              </button>

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
                          disabled={p.hasApiKey === false}
                          className={cn(
                            'flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors hover:bg-[var(--trae-bg-overlay-l2)]',
                            p.id === selectedProviderId && 'bg-[var(--trae-bg-overlay-l1)]',
                            p.hasApiKey === false && 'opacity-50 cursor-not-allowed',
                          )}
                          onClick={() => {
                            setSelectedProviderId(p.id)
                            setProviderMenuOpen(false)
                          }}
                          title={p.hasApiKey === false ? '未配置 API Key，请到设置 → 模型中配置' : ''}
                        >
                          <span className="text-[11px] text-[var(--trae-text-default)]">
                            {p.name || p.id}
                            {p.hasApiKey === false && (
                              <span className="ml-1 text-[10px] text-[var(--trae-status-alert-default)]">
                                (未配置Key)
                              </span>
                            )}
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
              title={isStreaming ? '停止生成' : '发送'}
              onClick={handleSendToggle}
              disabled={!isStreaming && !input.trim()}
              className="ai-send-btn btn-press wb-send-btn disabled:opacity-40"
            >
              {isStreaming ? (
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
