/**
 * StreamStallHint — 流式"卡住了"的界面预告（2026-11-01）
 *
 * 主进程有逐块空闲预算（45 秒），到点会中止并报错；但在那之前界面只写"思考中…"，
 * 用户分不清"模型在想"与"上游断了"。连续 12 秒没有任何流式活动（token 或工具事件）
 * 就先说一句，让等待变成可解释的——不等到超时才给一个迟到的结论。
 *
 * 只提示不代替判定：真正的中止仍由主进程那层预算负责，这里不做任何自动动作。
 */
import { type FC, useEffect, useState } from 'react'
import { useAgentStore } from '@/stores/agent-store'

/** 12 秒：正常思考也可能几秒不吐字，太早提示会变成噪音 */
export const STALL_HINT_AFTER_MS = 12_000

export const StreamStallHint: FC = () => {
  const isStreaming = useAgentStore((s) => s.isStreaming)
  const lastAt = useAgentStore((s) => s.lastStreamActivityAt)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!isStreaming) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [isStreaming])

  if (!isStreaming || lastAt === null) return null
  const idleMs = now - lastAt
  if (idleMs < STALL_HINT_AFTER_MS) return null

  return (
    <p
      className="px-3 py-1 text-caption text-ink-mute"
      role="status"
      data-dom-id="stream-stall-hint"
    >
      已经有 {Math.floor(idleMs / 1000)} 秒没收到新内容，仍在等待上游；长时间无响应会自动中止并报错。
    </p>
  )
}
