import { useState, useRef, useEffect, useMemo, type FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowUp, Check, FileText, Plus, SlidersHorizontal,
  Sparkles, Square, X, Zap,
} from 'lucide-react'
import { cn } from '@/components/trae/utils'
import {
  Chip, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger,
} from '@/ui'
import { latestContextTokens, useAgentStore, type CompressResult } from '@/stores/agent-store'
import { compressFeedback, resolveContextUsage } from './context-usage'
// B（2026-11-05）：auto 档的实际落点用主进程同一个纯函数在本地算，界面回显「自动 → 深度/标准」
import { resolveThinkingStrength } from '@shared/thinking-router'
// v2.6 修复断链：editor-store.injectedAtCommand 此前只写不读（SelectionPopover 注入后无人消费）
import { useEditorStore } from '@/stores/editor-store'
import { useAIStore } from '@/stores/ai-store'
// 正文一律取自 QUICK_PROMPTS 单源；能力面板与空态建议都引用同一份文案
import { QUICK_PROMPTS, type QuickPromptTemplate } from './mock-data'
import type { UsePaorLoopResult } from './usePaorLoop'
import CapabilityPalette from './CapabilityPalette'
import RemoteFilePicker from './RemoteFilePicker'
import {
  fitReferences, MAX_REFERENCE_CHARS_PER_FILE, MAX_REFERENCE_CHARS_TOTAL,
  type RawRemoteFile, type RemoteFileReference,
} from './composer-references'
import type { PersistedProviderConfig, ThinkingStrength } from '@shared/agent-types'
import type { PaorPhaseState } from '@shared/paor-types'


/** Composer props */
export interface ComposerProps {
  isStreaming: boolean
  /** PAOR 自动循环（v0.9.5 P0-3：Plan→Act→Observe→Reflect） */
  paor: UsePaorLoopResult
  activeSessionId: string | null
  providers: PersistedProviderConfig[]
  selectedProviderId: string | null
  setSelectedProviderId: (id: string) => void
  send: (text: string, refs?: RemoteFileReference[]) => Promise<void>
  cancel: () => Promise<void>
  /** 压缩上下文回调（T.7） */
  onCompressContext?: () => CompressResult
}

/** 思考档位在界面上的三项；`fast` 不进 UI（拍板 2） */
const THINKING_OPTIONS: readonly { value: ThinkingStrength | 'auto'; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'standard', label: '标准' },
  { value: 'deep', label: '深度' },
]

/** PAOR 阶段的中文名（2026-11-05 D，阶段进度条用） */
const PHASE_LABEL: Record<PaorPhaseState['phase'], string> = {
  plan: '规划',
  act: '执行',
  observe: '观察',
  reflect: '反思',
}

/** 毫秒显示：不足 1 秒给 ms，避免全被四舍五入成 0.0s */
const msText = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)

/**
 * AIPanel 输入区：一行式（2026-11-05 A）
 *
 * 主行只保留 `+`、文本域、「选项」、发送四个元素；
 * 5 个能力 chip 进 `/` 面板，模型/思考档位/上下文进右侧「选项」菜单，
 * PAOR 启停进 `+` 菜单、仅运行中在顶部显示状态条。
 */
const Composer: FC<ComposerProps> = ({
  isStreaming,
  paor,
  activeSessionId,
  providers,
  selectedProviderId,
  setSelectedProviderId,
  send,
  cancel,
  onCompressContext,
}) => {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [capabilityOpen, setCapabilityOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  // 引用先存"原始全文"，预算裁剪在派生层统一算：
  // 删一条/再加一条时总能按剩余预算重新分配，而不是对已裁过的内容再裁一次。
  const [rawRefs, setRawRefs] = useState<RawRemoteFile[]>([])
  const refs = useMemo(() => fitReferences(rawRefs), [rawRefs])
  // 划词翻译「发送到 AI」的落点：灌进输入框并聚焦，不自动发送
  const prefillMessage = useAIStore((s) => s.prefillMessage)
  const prefillAt = useAIStore((s) => s.prefillAt)
  const clearPrefillMessage = useAIStore((s) => s.setPrefillMessage)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const thinkingStrength = useAgentStore((s) => s.thinkingStrength)
  const setThinkingStrength = useAgentStore((s) => s.setThinkingStrength)

  const selectedProvider = providers.find((p) => p.id === selectedProviderId) ?? null
  const modelName = selectedProvider?.name || selectedProvider?.model || '未配置模型'

  // B：思考档位回显。auto 档的实际落点由共享纯函数按"当前输入"估算；
  // 发送时主进程用同一函数对真实最后一条 user 消息再解析一次并写日志，两边规则同源。
  const autoResolution = resolveThinkingStrength('auto', input)
  const resolvedLabel = autoResolution.resolved === 'deep' ? '深度' : '标准'
  const thinkingLabel =
    thinkingStrength === 'auto'
      ? `自动 → ${resolvedLabel}`
      : thinkingStrength === 'deep'
        ? '深度'
        : thinkingStrength === 'fast'
          ? '快速'
          : '标准'

  // D：运行条显示"最近的阶段 + 耗时 + 重试"。没有阶段事件（旧主进程）时回落旧文案。
  // durationMs 缺省表示该阶段刚开始（只有 Act 开始那一次），显示"执行中"而不是编一个 0ms。
  const paorRoundText = paor.currentIteration > 0 ? `第 ${paor.currentIteration} 轮` : '准备中'
  const paorPhaseText = paor.currentPhase
    ? `${PHASE_LABEL[paor.currentPhase.phase]}${
        paor.currentPhase.durationMs == null ? '中' : ` · ${msText(paor.currentPhase.durationMs)}`
      }`
    : '执行中'
  const paorRetryText =
    paor.currentPhase?.retryCount ? ` · 已重试 ${paor.currentPhase.retryCount} 次` : ''

  /**
   * 上下文用量（#89 → 2026-10-15 Wave B）：分子是**末步真实占用**（latestContextTokens），
   * 分母是选中模型声明的窗口（provider:list 把 capabilities 带出来）。
   * 模型没有声明窗口时诚实地显示"无法估算"，不演一个百分比。
   */
  const lastContextTokens = useAgentStore((s) => latestContextTokens(s.messages))
  const contextUsage = resolveContextUsage({
    usedTokens: lastContextTokens,
    windowTokens: selectedProvider?.capabilities?.contextWindow ?? 0,
  })
  const contextLabel =
    contextUsage.pct === null
      ? '模型未声明上下文窗口，无法估算'
      : `${contextUsage.pct}% · ${contextUsage.usedLabel} / ${contextUsage.totalLabel}`

  /**
   * textarea auto-resize
   *
   * 上限与 --ui-collapse-max-composer 对齐；下限交给 CSS 的 min-height（一行），
   * 这里只负责"内容多了往上长"。
   */
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
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

  // 终端划词翻译的「发送到 AI / 问 AI」：填进输入框并聚焦，不自动发送
  useEffect(() => {
    if (!prefillMessage) return
    setInput((prev) =>
      prev.trim() ? `${prev.trim()}\n\n${prefillMessage}` : prefillMessage,
    )
    clearPrefillMessage(null)
    const el = textareaRef.current
    el?.focus()
    if (el) el.setSelectionRange(el.value.length, el.value.length)
    // prefillAt 让"同一段文字连着发两次"也能各自生效
  }, [prefillMessage, prefillAt, clearPrefillMessage])

  /** 处理发送/停止 — 主路径 agent:chat */
  const handleSendToggle = () => {
    // 流式生成中 → 取消
    if (isStreaming) {
      void cancel()
      return
    }
    if (!input.trim()) return
    const text = input

    // 检查 Provider 是否配置
    if (providers.length === 0) {
      toast.warning('请先配置模型 Provider（设置 → 模型）')
      return
    }

    void send(text, refs.length > 0 ? refs : undefined)
    // 引用只对当轮有效：发出后清空，避免下一条消息又悄悄把同一批文件带上去
    if (refs.length > 0) setRawRefs([])
  }

  /** 选中远端文件：同一路径不重复添加 */
  const handleAddReference = (file: RawRemoteFile) => {
    setRawRefs((prev) => {
      if (prev.some((f) => f.path === file.path)) return prev
      if (
        prev.length > 0 &&
        prev.reduce((n, f) => n + f.text.length, 0) + file.text.length > MAX_REFERENCE_CHARS_TOTAL
      ) {
        toast.warning(
          `本轮引用已达合计 ${MAX_REFERENCE_CHARS_TOTAL} 字符上限，超出部分会被标注截断`
        )
      }
      return [...prev, file]
    })
  }

  /** `/` 面板选中：填入正文、聚焦、关闭面板；不自动发送 */
  const handlePickCapability = (key: QuickPromptTemplate) => {
    setInput(QUICK_PROMPTS[key])
    setCapabilityOpen(false)
    textareaRef.current?.focus()
  }

  /** 压缩上下文：按真实结果反馈（本地截断，瞬时完成） */
  const handleCompress = () => {
    if (!onCompressContext) {
      void toast.warning('当前环境不支持上下文压缩')
      return
    }
    const result = onCompressContext()
    const text = compressFeedback(result)
    void (result?.compressed ? toast.success(text) : toast.info(text))
  }

  /**
   * 停止正在跑的 PAOR（2026-11-01）
   *
   * 停止是协作式的：主进程在下一轮开始前 / 下一次发命令前退出，
   * **当前那条远端命令会执行完**。所以文案写"已请求停止，当前命令执行完后不再继续"，
   * 不写"已中断"；返回 false 说明没有可停的循环（多半刚结束）。
   */
  const handlePaorStop = async () => {
    const ok = await paor.cancel()
    if (ok) toast.info('已请求停止：当前那条命令执行完后不再继续')
    else toast.warning('没有正在执行的 PAOR 任务（可能刚刚结束）')
  }

  /**
   * 启动 PAOR 自动循环（v0.9.5 P0-3）
   *
   * 与 handleSendToggle 的区别：
   * - handleSendToggle：普通消息走 agent:chat，一次一问一答
   * - handlePaorStart：多步运维任务走 paor.start(task, sessionId, 5)（agent:paor），由主进程 Supervisor 编排
   */
  const handlePaorStart = async () => {
    if (paor.isRunning) {
      await handlePaorStop()
      return
    }
    const task = input.trim()
    if (!task) {
      toast.warning('请输入运维任务描述后再启动 PAOR 自主循环')
      textareaRef.current?.focus()
      return
    }
    if (!activeSessionId) {
      toast.warning('PAOR 需要先连接 SSH 服务器（顶栏服务器菜单或「设置 → SSH」）')
      return
    }
    if (providers.length === 0) {
      toast.warning('请先配置模型 Provider（设置 → 模型）')
      return
    }
    setInput('')
    const ok = await paor.start(task, activeSessionId, 5)
    if (ok) {
      toast.info(
        `PAOR 自主循环已启动 · 任务：${task.length > 60 ? `${task.slice(0, 60)}...` : task} · 最大迭代 5 轮`
      )
    }
  }

  /** 无会话且未运行时，PAOR 入口禁用并显示原因 */
  const paorDisabled = !paor.isRunning && !activeSessionId

  return (
    <footer className="shrink-0 border-t border-line bg-canvas p-2">
      <div
        className={cn(
          'flex flex-col overflow-hidden rounded-(--ui-radius-panel) border border-line-strong bg-panel',
          'transition-colors duration-[var(--ui-dur-fast)]',
          'focus-within:border-accent-solid'
        )}
      >
        {/* PAOR 运行状态条：只在运行时出现，不占常驻主行 */}
        {paor.isRunning && (
          <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-caption text-ink-dim">
            <Zap className="size-3.5 shrink-0 text-accent-solid" />
            <span className="min-w-0 flex-1 truncate">
              PAOR {paorRoundText} · {paorPhaseText}
              {paorRetryText}
            </span>
            <button
              type="button"
              onClick={() => void handlePaorStop()}
              className="shrink-0 rounded-(--ui-radius-control) px-1.5 py-0.5 text-caption font-medium text-error-text transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-solid"
            >
              停止
            </button>
          </div>
        )}

        {/* 已选引用：来源/路径/字符数/是否截断一眼可见，可单独移除 */}
        {refs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
            {rawRefs.map((f, i) => {
              const r = refs[i]
              return (
                <Chip
                  key={f.path}
                  tone={r.truncated ? 'warning' : 'accent'}
                  className="max-w-full gap-1.5"
                  title={`${f.path}：${r.truncated ? `原 ${r.totalChars} 字符，只带入前 ${r.includedChars} 字符` : `${r.includedChars} 字符，未截断`}`}
                >
                  <span className="shrink-0 text-caption text-ink-mute">远端</span>
                  <span className="min-w-0 truncate">{f.path}</span>
                  <span className="shrink-0">
                    {r.includedChars} 字符{r.truncated ? '，已截断' : ''}
                  </span>
                  <button
                    type="button"
                    aria-label={`移除引用 ${f.path}`}
                    onClick={() => setRawRefs((prev) => prev.filter((x) => x.path !== f.path))}
                    className="shrink-0 rounded-(--ui-radius-inline) p-0.5 text-ink-mute transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-solid"
                  >
                    <X className="size-3" />
                  </button>
                </Chip>
              )
            })}
            <span className="text-caption text-ink-mute">
              只读 · 单文件上限 {MAX_REFERENCE_CHARS_PER_FILE} 字符
            </span>
          </div>
        )}

        {/* 主行：`+` · 文本域 · 选项 · 发送 */}
        <div className="flex items-end gap-1 px-1.5 py-1">
          <Menu>
            <MenuTrigger asChild>
              <IconButton label="更多操作" size="md" className="shrink-0">
                <Plus className="size-4" />
              </IconButton>
            </MenuTrigger>
            <MenuContent side="top" align="start" sideOffset={6} className="min-w-[220px]">
              <MenuLabel>快捷操作</MenuLabel>
              <MenuItem onSelect={() => setCapabilityOpen(true)}>
                <Sparkles className="size-3.5 shrink-0" />
                提示词模板（/）
              </MenuItem>
              <MenuItem
                onSelect={() => setPickerOpen(true)}
                title={!activeSessionId ? '未连接 SSH：远端文件选择器需要已建立的 SFTP 通道' : undefined}
              >
                <FileText className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">引用远端文件…（@）</span>
                {!activeSessionId ? (
                  <span className="shrink-0 text-caption text-ink-mute">未连接 SSH</span>
                ) : null}
              </MenuItem>
              <MenuItem
                disabled={paorDisabled}
                onSelect={() => void handlePaorStart()}
                className="gap-2"
                title={paorDisabled ? '未连接 SSH：PAOR 需要远端命令执行通道' : undefined}
              >
                <Zap className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {paor.isRunning ? `停止 PAOR（第 ${paor.currentIteration} 轮）` : '自主循环 PAOR…'}
                </span>
                {paorDisabled ? (
                  <span className="shrink-0 text-caption text-ink-mute">未连接 SSH</span>
                ) : null}
              </MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={() => navigate('/settings/model')} className="text-accent-ink">
                打开模型设置…
              </MenuItem>
            </MenuContent>
          </Menu>

          {/* 输入区：用原生 placeholder，不再另起一个 span 叠在框上 */}
          <label htmlFor="ai-composer-input" className="sr-only">
            给 AI 的运维指令
          </label>
          <textarea
            id="ai-composer-input"
            data-testid="composer-input"
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendToggle()
                return
              }
              // 输入为空时键入 `@` 打开远端文件选择器，不插入字符
              if (
                e.key === '@' &&
                input.trim() === '' &&
                !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey
              ) {
                e.preventDefault()
                setPickerOpen(true)
                return
              }
              // 输入为空时键入 `/` 打开提示词模板面板，不插入字符
              if (
                e.key === '/' &&
                input.trim() === '' &&
                !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey
              ) {
                e.preventDefault()
                setCapabilityOpen(true)
              }
            }}
            placeholder="给 Agent 一段指令…"
            title="Enter 发送，Shift+Enter 换行；输入为空时按 / 打开提示词模板、@ 引用远端文件"
            className={cn(
              'min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-composer leading-normal text-ink',
              'min-h-(--ui-size-composer-min) max-h-(--ui-collapse-max-composer) overflow-y-auto outline-none',
              'placeholder:text-ink-placeholder'
            )}
          />

          {/* 右侧选项：模型 / 思考档位 / 上下文，都不占主行 */}
          <Menu>
            <MenuTrigger asChild>
              <IconButton
                label="选项"
                size="md"
                className="shrink-0"
                title={`模型：${modelName}；思考：${thinkingLabel}`}
              >
                <SlidersHorizontal className="size-4" />
              </IconButton>
            </MenuTrigger>
            <MenuContent side="top" align="end" sideOffset={6} className="min-w-[260px]">
              <MenuLabel>模型</MenuLabel>
              {providers.length === 0 ? (
                <div className="px-2 py-1.5 text-caption text-ink-mute">
                  没有可用的模型，请到设置 → 模型配置填 API Key
                </div>
              ) : (
                providers.map((p) => (
                  <MenuItem
                    key={p.id}
                    onSelect={() => setSelectedProviderId(p.id)}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="flex w-full items-center gap-1 text-md text-ink">
                      <span className="min-w-0 flex-1 truncate">{p.name || p.id}</span>
                      {p.id === selectedProviderId ? <Check className="size-3.5 shrink-0" /> : null}
                    </span>
                    <span className="text-caption text-ink-mute">{p.model}</span>
                  </MenuItem>
                ))
              )}

              <MenuSeparator />
              <MenuLabel>思考档位：{thinkingLabel}</MenuLabel>
              {THINKING_OPTIONS.map((opt) => (
                <MenuItem
                  key={opt.value}
                  onSelect={() => setThinkingStrength(opt.value)}
                  className="gap-2"
                >
                  <span>{opt.label}</span>
                  {opt.value === 'auto' ? (
                    <span className="text-caption text-ink-mute">→ {resolvedLabel}</span>
                  ) : null}
                  {thinkingStrength === opt.value ? (
                    <Check className="ml-auto size-3.5 shrink-0" />
                  ) : null}
                </MenuItem>
              ))}
              <div className="px-2 pb-1 text-caption text-ink-mute">
                自动档按当前输入估算；发送时主进程用同一函数解析并写日志
              </div>

              <MenuSeparator />
              <MenuLabel>上下文</MenuLabel>
              <div className="px-2 py-1.5 text-caption text-ink-dim">{contextLabel}</div>
              <MenuItem onSelect={handleCompress}>压缩上下文</MenuItem>
            </MenuContent>
          </Menu>

          {/* 发送与停止共用一个位置（cc-gui 的 submit-button 语义），停止态换危险色 */}
          <button
            type="button"
            data-testid="composer-send"
            aria-label={isStreaming ? '停止生成' : '发送'}
            title={isStreaming ? '停止生成' : '发送'}
            onClick={handleSendToggle}
            disabled={!isStreaming && !input.trim()}
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-(--ui-radius-control)',
              'text-(--text-on-accent) transition-colors duration-[var(--ui-dur-fast)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-solid',
              'disabled:cursor-not-allowed disabled:opacity-50',
              isStreaming ? 'bg-error hover:bg-error/85' : 'bg-accent-solid hover:bg-accent-solid-hover'
            )}
          >
            {isStreaming ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />}
          </button>
        </div>
      </div>

      <CapabilityPalette
        open={capabilityOpen}
        onOpenChange={setCapabilityOpen}
        onPick={handlePickCapability}
      />

      <RemoteFilePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        sessionId={activeSessionId}
        onPick={handleAddReference}
      />
    </footer>
  )
}

export default Composer
