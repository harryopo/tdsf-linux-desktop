/**
 * db:status IPC handler 单元测试（A4：SQLite 降级可见化 · IPC 4 步同步铁律）
 *
 * 验证的是"通道名两侧一致 + handler 真的把 getStatus() 透传出去"：
 * 这一步光看类型对不出来（preload 与 main 各写一次通道常量引用），
 * 打错一个字符的表现是渲染层 catch 到"无 handler"，然后横幅永远不显示。
 *
 * 步骤 1/2：main 层 handler 注册到 ipcMain.handle（本文件捕获验证）
 * 步骤 3/4：preload 暴露 + electron.d.ts 类型声明由 typecheck:node / typecheck:web 验证
 */
import { describe, it, expect, vi } from 'vitest'
import { DB } from '../../src/shared/ipc-channels'

const handlers: Record<string, (...args: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: unknown) => {
      handlers[channel] = handler as (...args: unknown[]) => unknown
    },
  },
}))

describe('db:status handler', () => {
  it('注册到共享常量 DB.STATUS，并原样返回 getStatus()', async () => {
    const { registerDbHandlers } = await import('../../src/main/ipc/db')
    const fakeStatus = {
      available: false,
      vectorEnabled: false,
      schemaVersion: null,
      targetSchemaVersion: 1,
      degradedReason: '原生模块未能加载',
      migrationError: null,
      migrationPending: false,
    }
    const getStatus = vi.fn(() => fakeStatus)

    registerDbHandlers({ getStatus } as never)

    expect(Object.keys(handlers)).toEqual([DB.STATUS])
    expect(handlers[DB.STATUS]).toBeTypeOf('function')
    const result = await handlers[DB.STATUS]({} as never)
    expect(result).toBe(fakeStatus)
    expect(getStatus).toHaveBeenCalledTimes(1)
  })

  it('通道字面量固定为 db:status（改名要同步 preload 与横幅，故显式钉住）', () => {
    expect(DB.STATUS).toBe('db:status')
  })
})
