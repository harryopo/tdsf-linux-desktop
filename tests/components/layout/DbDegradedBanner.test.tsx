/**
 * tests/components/layout/DbDegradedBanner.test.tsx
 * 数据库降级全局横幅组件测试（A4）
 *
 * 判据来源：计划 §A4 "人为制造失败必须显示横幅"。
 * 这里制造的失败是 store 层的 status（available=false），断言的是"界面确实出现了提示"，
 * 而不是只有日志——主进程侧的降级来源由 tests/unit/database-status.test.ts 覆盖。
 *
 * 关键决策：
 * - 直接 setState 注入 status + loaded=true，跳过 IPC hydrate（jsdom 下无 electronAPI）
 * - status=null（非 Electron / 查询失败）必须不显示：宁可少提醒也不误报"数据没保存"
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { DbDegradedBanner } from '@renderer/components/layout/DbDegradedBanner'
import { useDbStatusStore } from '@renderer/stores/db-status-store'
import type { DbStatus } from '@shared/db-types'

/** 构造一份"一切正常"的状态，用例按需覆盖字段 */
function makeStatus(overrides: Partial<DbStatus> = {}): DbStatus {
  return {
    available: true,
    vectorEnabled: false,
    schemaVersion: 1,
    targetSchemaVersion: 1,
    degradedReason: null,
    migrationError: null,
    migrationPending: false,
    ...overrides,
  }
}

/** 把 store 置为"已完成加载 + 指定状态"，避免组件真的去调 IPC */
function seed(status: DbStatus | null): void {
  useDbStatusStore.setState({ status, loaded: true, dismissed: false })
}

beforeEach(() => {
  seed(null)
})

describe('DbDegradedBanner', () => {
  it('1. 数据库不可用时显示红色横幅与降级原因', () => {
    seed(makeStatus({ available: false, schemaVersion: null, degradedReason: '原生模块加载失败' }))
    render(<DbDegradedBanner />)

    expect(screen.getByText('数据库不可用，本次会话的记录不会被保存')).toBeInTheDocument()
    expect(screen.getByText('原生模块加载失败')).toBeInTheDocument()
  })

  it('2. 迁移未到位时显示迁移提示，且带上版本号', () => {
    seed(makeStatus({ schemaVersion: 0, targetSchemaVersion: 3, migrationPending: true }))
    render(<DbDegradedBanner />)

    expect(screen.getByText('数据库结构迁移未完成，部分功能可能异常')).toBeInTheDocument()
    expect(screen.getByText('当前 v0，目标 v3')).toBeInTheDocument()
  })

  it('3. 迁移报错时优先展示错误原文', () => {
    seed(
      makeStatus({
        schemaVersion: 0,
        targetSchemaVersion: 3,
        migrationPending: true,
        migrationError: 'v1 迁移失败：no such table',
      })
    )
    render(<DbDegradedBanner />)

    expect(screen.getByText('v1 迁移失败：no such table')).toBeInTheDocument()
  })

  it('4. 一切正常时不渲染任何提示', () => {
    seed(makeStatus())
    const { container } = render(<DbDegradedBanner />)

    expect(container).toBeEmptyDOMElement()
  })

  it('5. 状态未知（非 Electron / 查询失败）时不渲染，避免误报数据丢失', () => {
    seed(null)
    const { container } = render(<DbDegradedBanner />)

    expect(container).toBeEmptyDOMElement()
  })

  it('6. 点"知道了"后本次会话不再显示', () => {
    seed(makeStatus({ available: false, schemaVersion: null, degradedReason: 'x' }))
    const { container } = render(<DbDegradedBanner />)
    expect(screen.getByText('数据库不可用，本次会话的记录不会被保存')).toBeInTheDocument()

    fireEvent.click(screen.getByText('知道了'))
    expect(container).toBeEmptyDOMElement()
  })
})
