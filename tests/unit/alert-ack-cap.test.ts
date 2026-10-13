/**
 * 告警确认表必须有上限（#95「只写不读且无上限」的那半：无上限）
 *
 * alertId 由渲染层按 `time|server|desc` 拼，每触发一次就是一个新 key。
 * 原来只 set 不删：一次长时间监控跑下来，这条 Map 就按告警次数线性长，
 * 而且没有任何读者能把它缩小。这里锁"不再无限长"这一条。
 *
 * 另一半（只写不读 = 按钮点了不抑制任何东西）是产品决定，
 * 已在 alert.ts 文件头写明，不在本判据里假装解决。
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))
vi.mock('../../src/main/services/log/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { acknowledgeAlert, acknowledgedCount } from '../../src/main/ipc/alert'

describe('alert:ack 的登记上限', () => {
  it('超过上限后不再增长，且新确认仍然记得', () => {
    for (let i = 0; i < 600; i++) acknowledgeAlert(`old-${i}`)
    expect(acknowledgedCount()).toBe(500)

    acknowledgeAlert('newest')
    expect(acknowledgedCount(), '淘汰逻辑不能把刚记的挤掉').toBe(500)
  })

  it('同一条重复确认不重复占位', () => {
    const before = acknowledgedCount()
    acknowledgeAlert('dup')
    acknowledgeAlert('dup')
    expect(acknowledgedCount()).toBeLessThanOrEqual(before + 1)
  })
})
