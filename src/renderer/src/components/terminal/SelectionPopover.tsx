/**
 * 选词操作浮层 - SelectionPopover
 *
 * 教学术语：
 * - Portal（传送门）：React 提供的将子节点渲染到任意 DOM 节点的能力
 * - 浮层（Popover）：浮在内容上方的操作面板
 *
 * 职责：
 * 1. 监听 translate-store 中的选区信息
 * 2. 浮层定位在选区位置
 * 3. 提供"翻译"和"发送到 AI"两个核心操作按钮
 * 4. 翻译面板展开后展示结果
 *
 * UI 风格：暗色系 + 慢动画（与项目整体一致）
 * 不使用 emoji（按用户要求）
 *
 * @module terminal/SelectionPopover
 */

import { createPortal } from 'react-dom'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslateStore } from '../../stores/translate-store'
import { useAIStore } from '../../stores/ai-store'
import { translate, loadDict, type TranslateResult } from './translator'
import { getCourseHint } from '../../utils/course-matcher'
import './SelectionPopover.css'

/** 浮层位置偏移（距离鼠标） */
const POPOVER_OFFSET_X = 8
const POPOVER_OFFSET_Y = -44  // 浮在选区上方
const PANEL_OFFSET_Y = 8      // 翻译面板在选区下方

/** 浮层尺寸估算（用于防越界） */
const POPOVER_MIN_WIDTH = 280
const PANEL_MIN_WIDTH = 320

/** 关闭按钮字符（无 emoji，按用户要求） */
const CLOSE_ICON = '×'

const SelectionPopover: React.FC = () => {
  const selection = useTranslateStore((s) => s.currentSelection)
  const clear = useTranslateStore((s) => s.clear)
  const setPrefillMessage = useAIStore((s) => s.setPrefillMessage)

  const [panelOpen, setPanelOpen] = useState(false)

  // 当选区清空时，自动关闭翻译面板
  useEffect(() => {
    if (!selection) {
      setPanelOpen(false)
    }
  }, [selection])

  // ESC 键关闭浮层（绑定到 window，仅在有选区时监听）
  useEffect(() => {
    if (!selection) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        clear()
        setPanelOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selection, clear])

  /**
   * 翻译结果（memo 化，依赖 selection.text）
   */
  const result: TranslateResult | null = useMemo(() => {
    if (!selection) return null
    return translate(selection.text, loadDict())
  }, [selection])

  /** 课程关联 */
  const courseHint = useMemo(() => {
    if (!result) return null
    return getCourseHint(result)
  }, [result])

  /**
   * 构造 AI 提示词
   */
  const buildPrompt = useCallback((text: string, res: TranslateResult | null): string => {
    let prompt = `请解释以下 Linux 终端内容：\n\n\`\`\`\n${text}\n\`\`\``
    if (res?.matched && res.primary) {
      prompt += `\n\n（本地词典参考：${res.primary.entry.zh}）`
    }
    return prompt
  }, [])

  /**
   * 发送到 AI 助手
   */
  const handleSendToAI = useCallback(() => {
    if (!selection) return
    setPrefillMessage(buildPrompt(selection.text, result))
    clear()
    setPanelOpen(false)
  }, [selection, result, setPrefillMessage, clear, buildPrompt])

  /**
   * 复制到剪贴板（同步优先，降级异步）
   */
  const handleCopy = useCallback(() => {
    if (!selection) return
    const text = selection.text
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        // 降级：传统 execCommand
        fallbackCopy(text)
      })
    } else {
      fallbackCopy(text)
    }
    setPanelOpen(false)
  }, [selection])

  /**
   * 询问 AI（词典无命中时的兜底）
   */
  const handleAskAI = useCallback(() => {
    if (!selection) return
    setPrefillMessage(`"${selection.text}" 是什么意思？请用中文解释。`)
    clear()
    setPanelOpen(false)
  }, [selection, setPrefillMessage, clear])

  /**
   * 关闭浮层
   */
  const handleClose = useCallback(() => {
    clear()
    setPanelOpen(false)
  }, [clear])

  /**
   * 切换翻译面板
   */
  const togglePanel = useCallback(() => {
    setPanelOpen(v => !v)
  }, [])

  // ===== 位置计算（避免浮层超出视口） =====
  const popoverStyle = useMemo<React.CSSProperties | null>(() => {
    if (!selection) return null
    return {
      position: 'fixed',
      left: clamp(selection.screenX + POPOVER_OFFSET_X, 8, window.innerWidth - POPOVER_MIN_WIDTH),
      top: clamp(selection.screenY + POPOVER_OFFSET_Y, 8, window.innerHeight - 60),
      zIndex: 9999,
    }
  }, [selection])

  const panelStyle = useMemo<React.CSSProperties | null>(() => {
    if (!selection) return null
    return {
      position: 'fixed',
      left: clamp(selection.screenX + POPOVER_OFFSET_X, 8, window.innerWidth - PANEL_MIN_WIDTH),
      top: selection.screenY + PANEL_OFFSET_Y,
      zIndex: 9998,
    }
  }, [selection])

  // 无选区则不渲染
  if (!selection || !popoverStyle) return null

  return createPortal(
    <>
      {/* 操作浮层（按钮组） */}
      <div className="sel-popover" style={popoverStyle}>
        <button
          className="sel-btn sel-btn-ai"
          onClick={handleSendToAI}
          title="将选中文本发送给 AI 助手"
        >
          <span className="sel-btn-label">发送到 AI</span>
          <kbd className="sel-kbd">Ctrl+Shift+A</kbd>
        </button>
        <button
          className={`sel-btn sel-btn-trans ${panelOpen ? 'active' : ''}`}
          onClick={togglePanel}
          title="查询本地词典翻译"
        >
          <span className="sel-btn-label">翻译</span>
          <kbd className="sel-kbd">Ctrl+Shift+T</kbd>
        </button>
        <button
          className="sel-btn sel-btn-copy"
          onClick={handleCopy}
          title="复制到剪贴板"
        >
          <span className="sel-btn-label">复制</span>
        </button>
        <button
          className="sel-btn sel-btn-close"
          onClick={handleClose}
          title="关闭"
          aria-label="关闭浮层"
        >
          <span className="sel-btn-icon">{CLOSE_ICON}</span>
        </button>
      </div>

      {/* 翻译结果面板 */}
      {panelOpen && panelStyle && (
        <div className="trans-panel" style={panelStyle}>
          <div className="trans-header">
            <span className="trans-word">{selection.text}</span>
            {result?.primary?.entry.pos && (
              <span className="trans-pos">{result.primary.entry.pos}</span>
            )}
            <button
              className="trans-close"
              onClick={() => setPanelOpen(false)}
              aria-label="关闭翻译面板"
            >
              {CLOSE_ICON}
            </button>
          </div>

          {result?.matched ? (
            <>
              <div className="trans-zh">{result.primary?.entry.zh}</div>

              {/* 分段翻译（路径等多段） */}
              {result.segments.length > 1 && (
                <div className="trans-segments">
                  <div className="trans-seg-title">分词翻译</div>
                  {result.segments.map((s, i) => (
                    <div key={i} className="trans-seg-item">
                      <code className="trans-seg-word">{s.word}</code>
                      <span className="trans-seg-arrow">→</span>
                      <span className="trans-seg-zh">
                        {s.entry?.zh || '（无）'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* 例句 */}
              {result.primary?.entry.example && (
                <div className="trans-example">
                  <span className="trans-example-label">例</span>
                  <code>{result.primary.entry.example}</code>
                </div>
              )}

              {/* 关联课程（待课程模块完善后启用跳转） */}
              {courseHint && (
                <div className="trans-course" title="点击跳转到该章节（待课程模块启用）">
                  <span className="trans-course-label">关联课程</span>
                  <span className="trans-course-title">{courseHint.title}</span>
                </div>
              )}
            </>
          ) : (
            <div className="trans-empty">
              <span>词典中暂无此词翻译</span>
              <button className="trans-ask-ai" onClick={handleAskAI}>
                询问 AI
              </button>
            </div>
          )}
        </div>
      )}
    </>,
    document.body
  )
}

// ============================================================
// 工具函数
// ============================================================

/** 数值范围限制 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

/** 降级复制（兼容老浏览器/Electron 旧版本） */
function fallbackCopy(text: string): void {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    document.execCommand('copy')
  } catch {
    // ignore
  }
  document.body.removeChild(textarea)
}

export default SelectionPopover
