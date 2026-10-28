import { useState, useRef, useEffect, type FC } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowUp, AtSign, ChevronDown, Hash,
  Sparkles, Square, Zap,
} from 'lucide-react'
import { cn } from '@/components/trae/utils'
import { useRailOverflow } from '@/hooks/useRailOverflow'
import { Button, Chip, Divider, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from '@/ui'
import { latestContextTokens, useAgentStore, type CompressResult } from '@/stores/agent-store'
import { resolveContextUsage } from './context-usage'
// v2.6 修复断链：editor-store.injectedAtCommand 此前只写不读（SelectionPopover 注入后无人消费）
import { useEditorStore } from '@/stores/editor-store'
import { useAIStore } from '@/stores/ai-store'
// v2.3.7 修复：MOCK_COMPOSER_CHIPS → QUICK_PROMPT_TEMPLATES（mock-data.ts v2.3.6 已重命名）
// 之前的 import 指向不存在的导出 → Composer 模块加载失败 → AIPanel 整个组件崩 → "Agent 调用失败"
// #253：正文一律取自 QUICK_PROMPTS 单源，这里不再自己抄一份
import { QUICK_PROMPTS, QUICK_PROMPT_TEMPLATES, type QuickPromptTemplate } from './mock-data'
import type { UsePaorLoopResult } from './usePaorLoop'
import ContextBadge from './ContextBadge'
import type { PersistedProviderConfig } from '@shared/agent-types'


/** Composer props */
export interface ComposerProps {
  isStreaming: boolean
  /** PAOR 自动循环（v0.9.5 P0-3：Plan→Act→Observe→Reflect） */
  paor: UsePaorLoopResult
  activeSessionId: string | null
  providers: PersistedProviderConfig[]
  selectedProviderId: string | null
  setSelectedProviderId: (id: string) => void
  send: (text: string) => Promise<void>
  cancel: () => Promise<void>
  /** 压缩上下文回调（T.7） */
  onCompressContext?: () => CompressResult
}

/** AIPanel 输入区域（Composer chips + 输入框 + 工具栏 + Provider 选择 + Send 按钮） */
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
  // 划词翻译「发送到 AI」的落点：v0.8.0 只写了 store，消费者在界面重写时丢了，
  // 于是那个按钮点了等于没反应。这里补回落点：灌进输入框并聚焦，不自动发送。
  const prefillMessage = useAIStore((s) => s.prefillMessage)
  const prefillAt = useAIStore((s) => s.prefillAt)
  const clearPrefillMessage = useAIStore((s) => s.setPrefillMessage)
  const [activeChip, setActiveChip] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const promptRailRef = useRailOverflow<HTMLDivElement>()

  // v2.5 深度思考开关；v2.10 改三态：auto（自动路由）→ deep（强制深度）→ standard（强制标准）
  const thinkingStrength = useAgentStore((s) => s.thinkingStrength)
  const setThinkingStrength = useAgentStore((s) => s.setThinkingStrength)
  const deepThinking = thinkingStrength === 'deep'

  const selectedProvider = providers.find((p) => p.id === selectedProviderId) ?? null
  // providers 来自 store，进 store 前已按"能不能真用"过滤，所以标签上不必再标未配置
  const providerLabel = selectedProvider
    ? selectedProvider.name || selectedProvider.model || selectedProvider.id
    : providers.length === 0
      ? '未配置模型'
      : '选择模型'

  /**
   * 上下文用量（#89 → 2026-10-15 Wave B）：分子是**末步真实占用**（latestContextTokens），
   * 分母是选中模型声明的窗口（provider:list 把 capabilities 带出来）。
   * 旧实现拿"今日累计 token"除以写死的 200K —— 累计量跨天只涨不回落，窗口也不随模型变，
   * 那个百分比跟"当前对话还能装多少"没关系，却正在被当成压缩时机的依据。
   */
  const lastContextTokens = useAgentStore((s) => latestContextTokens(s.messages))
  const contextUsage = resolveContextUsage({
    usedTokens: lastContextTokens,
    windowTokens: selectedProvider?.capabilities?.contextWindow ?? 0,
  })

  /**
   * textarea auto-resize
   *
   * 上限与 --ui-collapse-max-composer 对齐（原来 JS 卡在 120px，比 CSS 的 240px 先撞顶，
   * 于是"最大高度"这个令牌其实是假的）；下限交给 CSS 的 min-height（三行），
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
  // （同上一条一样，是"store 只写不读"那类断链，判据见 tests/e2e/terminal-translate.spec.ts）
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

  /** chip 快捷填入可直接发送的运维提示词（正文只有一份，见 mock-data 的 QUICK_PROMPTS） */
  const handleChipClick = (chip: QuickPromptTemplate) => {
    setActiveChip((c) => (c === chip ? null : chip))
    setInput(QUICK_PROMPTS[chip])
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
   * - handleSendToggle：普通消息走 agent:chat，一次一问一答
   * - handlePaorStart：多步运维任务走 paor.start(task, sessionId, 5)（agent:paor），由主进程 Supervisor 编排
   *
   * 注意：PAOR 运行中无法取消（主进程目前不支持 agent:paor:cancel），
   * 只能等迭代上限或人工拒绝高危命令触发 riskBlocked。
   */
  const handlePaorStart = async () => {
    if (paor.isRunning) {
      toast.warning('PAOR 循环正在运行中，请等待完成')
      return
    }
    const task = input.trim()
    if (!task) {
      toast.warning('请输入运维任务描述后再点击 PAOR 自主循环')
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


  return (
    <footer className="shrink-0 border-t border-line bg-canvas p-2">
      {/* ===== Composer 卡 =====
          原先 hover 会把描边换成品牌蓝，focus 再叠一圈 1px 蓝色阴影环——鼠标划过就给整块
          上一圈主色边，是用户明确说过最讨厌的那种包边，而且和 focus 同色，两种状态分不出来。
          现在：悬停什么都不改（悬停在这块卡片上不携带信息）；只保留聚焦时一条主色描边，
          那是键盘/输入焦点的可见性凭据（WCAG 2.4.7），不是装饰。 */}
      <div
        className={cn(
          'flex flex-col overflow-hidden rounded-(--ui-radius-panel) border border-line-strong bg-panel',
          'transition-colors duration-[var(--ui-dur-fast)]',
          'focus-within:border-accent-solid'
        )}
      >
        {/* 输入区：用原生 placeholder，不再另起一个 span 叠在框上 */}
        <label htmlFor="ai-composer-input" className="sr-only">
          给 AI 的运维指令
        </label>
        <textarea
          id="ai-composer-input"
          ref={textareaRef}
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSendToggle()
            }
          }}
          placeholder="您正在与 Agent 聊天，输入 / 获取更多能力（Enter 发送，Shift+Enter 换行）"
          className={cn(
            'w-full resize-none bg-transparent px-3 py-2 text-composer leading-normal text-ink',
            'min-h-(--ui-size-composer-min) max-h-(--ui-collapse-max-composer) overflow-y-auto outline-none',
            'placeholder:text-ink-placeholder'
          )}
        />

        {/* 快捷排：PAOR 自主循环 + 快捷运维提示词
            第④笔（#253）挪到输入框**下方**——它原来压在输入框上面，等于把"上一条回答"和
            "你在哪儿打字"中间塞了一排辅助按钮；主表面该在上面，辅助的排往下。
            判据：tests/e2e/composer-layout.spec.ts（真窗口量两块的上下位置）
            单行 + 横向滚动：这一排在 560px 面板里换行会把输入区挤成一行高（用户 2026-10-08 指出）
            滚动轨道要带溢出淡出（useRailOverflow），被硬切一半会被读成界面画坏了（2026-10-11） */}
        <div
          ref={promptRailRef}
          className="ai-composer-rail flex flex-nowrap items-center gap-1 overflow-x-auto border-t border-line px-2 py-1.5"
        >
          <Button
            size="sm"
            variant={paor.isRunning ? 'selected' : 'ghost'}
            disabled={paor.isRunning}
            onClick={handlePaorStart}
            className="whitespace-nowrap"
            title={
              paor.isRunning
                ? `PAOR 循环运行中（已迭代 ${paor.currentIteration} 轮）`
                : 'PAOR 自主循环（Plan→Act→Observe→Reflect 多步运维任务自动编排，高危命令自动拦截）'
            }
          >
            <Zap className="size-3" />
            {paor.isRunning ? `PAOR 运行中(${paor.currentIteration})` : 'PAOR 自主循环'}
            {!activeSessionId && !paor.isRunning ? <Chip tone="warning">未连接</Chip> : null}
          </Button>

          <Divider vertical />

          {QUICK_PROMPT_TEMPLATES.map((chip) => (
            <Button
              key={chip}
              size="sm"
              variant={activeChip === chip ? 'selected' : 'ghost'}
              className="whitespace-nowrap"
              onClick={() => handleChipClick(chip)}
            >
              {chip}
            </Button>
          ))}
        </div>

        {/* 底部工具条：左簇动作与模型，右簇发送/停止（比容器深一档，形成底座带） */}
        <div className="flex items-center justify-between gap-2 bg-sunken px-1.5 py-1">
          {/*
            flex-wrap：这一排左簇有 @/#/图片/上下文/思考强度/模型 六个控件，
            窄窗口（实测 1120px 带 AI 面板）放不下。原先靠把模型 chip 压到看不清来"塞进去"，
            结果是箭头探出按钮 3px。宁可让它换一行，也不要裁切或压瘪。
          */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 gap-y-1">
            <Tooltip content="@提及">
              <IconButton label="@提及" size="sm" onClick={() => insertPrefix('@')}>
                <AtSign className="size-3.5" />
              </IconButton>
            </Tooltip>
            <Tooltip content="#引用资源">
              <IconButton label="#引用资源" size="sm" onClick={() => insertPrefix('#')}>
                <Hash className="size-3.5" />
              </IconButton>
            </Tooltip>
            <Divider vertical />

            <ContextBadge
              ctxUsedPct={contextUsage.pct}
              ctxUsedTokens={contextUsage.usedLabel}
              ctxTotalTokens={contextUsage.totalLabel}
              onCompress={onCompressContext}
            />

            {/* 思考强度三态：auto → deep → standard。文案强制不换行（旧版在窄面板里会竖排断字） */}
            <Button
              size="sm"
              variant={thinkingStrength === 'auto' || deepThinking ? 'selected' : 'ghost'}
              className="whitespace-nowrap"
              title={
                thinkingStrength === 'auto'
                  ? '思考强度：自动（按问题复杂度智能选择）— 点击切为深度'
                  : deepThinking
                    ? '思考强度：深度（强制思考链，耗时与 token 增加）— 点击切为标准'
                    : '思考强度：标准 — 点击切为自动'
              }
              onClick={() =>
                setThinkingStrength(
                  thinkingStrength === 'auto' ? 'deep' : deepThinking ? 'standard' : 'auto'
                )
              }
            >
              <Sparkles className="size-3" />
              {thinkingStrength === 'auto' ? '智能思考' : deepThinking ? '深度思考' : '标准思考'}
            </Button>

            {/* 模型选择：radix Menu 接管开合、焦点与 Esc，不再手写 outside-click */}
            <Menu>
              <MenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  title={providerLabel}
                  // 132px 是上限不是死宽：基类的 shrink-0 会让它在窄窗口里把整排顶出容器
                  // （实测 1120px 宽时溢出 111px，模型名压到发送钮底下）。
                  // 放开收缩，长名字由内层 truncate 收尾。
                  // gap-1/px-1.5：基类的 gap-2 + px-2 让"内边距+箭头"就占掉 36px，
                  // 收缩后仍要裁掉箭头 7px（用户会看到半个箭头）。这里把固定开销压到 28px。
                  className="w-[132px] max-w-[132px] min-w-0 shrink gap-1 px-1.5"
                >
                  <span className="min-w-0 flex-1 truncate">{providerLabel}</span>
                  <ChevronDown className="size-3 shrink-0" />
                </Button>
              </MenuTrigger>
              <MenuContent className="min-w-[240px]">
                {providers.length === 0 ? (
                  <div className="px-2 py-1.5 text-caption text-ink-mute">
                    没有可用的模型，请到设置 → 模型配置填 API Key
                  </div>
                ) : (
                  providers.map((p) => (
                    // 列表来源已按"能不能真用"过滤（见 provider-choice），
                    // 所以这里不再画灰色不可点项——那正是用户说的"弹出来一堆没配置的"
                    <MenuItem
                      key={p.id}
                      onSelect={() => setSelectedProviderId(p.id)}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="text-md text-ink">{p.name || p.id}</span>
                      <span className="text-caption text-ink-mute">{p.model}</span>
                    </MenuItem>
                  ))
                )}
                <MenuSeparator />
                <MenuItem onSelect={() => navigate('/settings/model')} className="text-accent-ink">
                  打开模型设置…
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>

          {/* 发送与停止共用一个位置（cc-gui 的 submit-button 语义），停止态换危险色 */}
          <button
            type="button"
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
    </footer>
  )
}

export default Composer
