// @vitest-environment jsdom
/**
 * 设置写失败必须说话（2026-10-21 全维度审查 C3）
 *
 * configSet 回 false 时旧代码只挂 .catch，false 被静默吞掉：磁盘满/权限不足时
 * 用户看到的仍是"设置已生效"。这里验 usePersistentState 的写回路径会弹一次错误。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

import { toast } from 'sonner'
import { usePersistentState } from '@renderer/hooks/usePersistentState'

const setSpy = vi.fn()
const getSpy = vi.fn()

beforeEach(() => {
  setSpy.mockReset()
  getSpy.mockReset()
  getSpy.mockResolvedValue(undefined)
  vi.mocked(toast.error).mockClear()
  // 不能替换整个 window：jsdom 的 document 挂在它上面，替换掉就再也拿不到容器
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      configGet: getSpy,
      configSet: setSpy,
    },
  })
})

describe('usePersistentState 写回失败', () => {
  it('configSet 回 false → 提示"未保存"，不假装成功', async () => {
    setSpy.mockResolvedValue(false)
    const { result } = renderHook(() => usePersistentState('test.key', 1))
    await waitFor(() => expect(getSpy).toHaveBeenCalled())

    act(() => result.current[1](2))
    await waitFor(() => expect(setSpy).toHaveBeenCalledWith('test.key', 2))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
  })
})
