/**
 * AI 预填通道（Zustand）
 *
 * 只留一件事：把终端选中/翻译生成的提示词递给输入框，不自动发送。
 *
 * 这份 store 以前还挂着对话消息、流式标志、决策卡、工作流状态、工具调用与待审批共 13 个键。
 * 全仓 `useAIStore` 的调用点只有两处（Composer 与 SelectionPopover），都只碰预填这三个键，
 * 其余键既没人写也没人读，于是界面结论和真状态是两套（旧 AgentWorkflow 早就换成了
 * agent-store 的那条链）。2026-10-16 删空壳，判据见 tests/unit/store-keys-consumed.test.ts。
 */
import { create } from 'zustand'

/** AI 预填通道状态 */
interface AIState {
  /** 待预填到输入框的消息（不自动发送） */
  prefillMessage: string | null
  /** 预填时间戳（同一条消息连点两次也要触发，所以按它判新一次请求） */
  prefillAt: number | null

  /** 设置预填消息（终端选中/翻译联动） */
  setPrefillMessage: (msg: string | null) => void
}

export const useAIStore = create<AIState>()((set) => ({
  prefillMessage: null,
  prefillAt: null,

  setPrefillMessage: (msg) =>
    set({
      prefillMessage: msg,
      prefillAt: msg ? Date.now() : null,
    }),
}))
