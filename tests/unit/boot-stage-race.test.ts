/**
 * 启动就绪竞态测试（R0）
 *
 * 生产构建里应用会永久停在启动页，两个根因：
 * 1. 主进程只推过 'ipc-ready'，'done' 从来没人推；而且推送发生在渲染层挂载之前时
 *    fire-and-forget 的推送没有任何订阅者 → 渲染层必须还能"拉"一次。
 * 2. 就绪判定挂在 requestAnimationFrame 数帧上，窗口最小化/被遮挡时 RAF 停摆，
 *    进度走不完 → 永远停在启动页。这条现在由 BootPage.test.tsx 第 8 条按行为钉
 *    （把 RAF 打成永不调用，仍要自动进工作台）。
 * 本文件钉第 1 条（push + pull 双通道）与"四个阶段都推全"，防止以后又写回"靠动画猜就绪"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const handle = vi.fn()
vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => handle(...args) },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('../../src/main/services/log/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  pushBootLoadingStage,
  getLatestBootStage,
  registerBootHandlers,
  __resetBootStageForTest,
} from '../../src/main/ipc/boot'
import { BOOT } from '../../src/shared/ipc-channels'

const ROOT = path.resolve(__dirname, '../..')

describe('boot 阶段：push + pull 双通道', () => {
  beforeEach(() => {
    __resetBootStageForTest()
    handle.mockClear()
  })

  it('未推送过时拉取返回 null（不许伪造一个默认阶段）', () => {
    expect(getLatestBootStage()).toBeNull()
  })

  it('推送会被记住，供晚到的订阅者拉取', () => {
    pushBootLoadingStage('done', [])
    // toEqual 认整个形状：载荷里长回一个没人读的字段（比如曾经的 progress）就会红
    expect(getLatestBootStage()).toEqual({ stage: 'done', message: '准备就绪' })
  })

  it('记住的是最后一次，不是第一次', () => {
    pushBootLoadingStage('ipc-ready', [])
    pushBootLoadingStage('sqlite-init', [])
    expect(getLatestBootStage()?.stage).toBe('sqlite-init')
  })

  it('registerBootHandlers 用中央表常量注册 boot:get-state', () => {
    registerBootHandlers()
    expect(handle).toHaveBeenCalledTimes(1)
    const [channel, fn] = handle.mock.calls[0]
    expect(channel).toBe(BOOT.GET_STATE)
    pushBootLoadingStage('done', [])
    expect((fn as () => unknown)()).toEqual(getLatestBootStage())
  })
})

describe('启动序列与渲染层的接线（源码级）', () => {
  const mainIndex = fs.readFileSync(path.join(ROOT, 'src/main/index.ts'), 'utf8')
  const bootPage = fs.readFileSync(path.join(ROOT, 'src/renderer/src/pages/BootPage.tsx'), 'utf8')

  it('主进程把四个阶段都推全，尤其不能少 done', () => {
    // ipc-ready 在 ipc/index.ts 注册完成时推，其余三个在 main/index.ts 的启动序列里推
    const startup =
      mainIndex + '\n' + fs.readFileSync(path.join(ROOT, 'src/main/ipc/index.ts'), 'utf8')
    for (const stage of ['ipc-ready', 'sqlite-init', 'kb-indexed', 'done']) {
      expect(startup.includes(`pushBootLoadingStage('${stage}'`), `没推 ${stage}`).toBe(true)
    }
  })

  it('BootPage 订阅之后会补一次拉取', () => {
    expect(bootPage.includes('bootGetState')).toBe(true)
  })

  // 根因 2（就绪不许靠 requestAnimationFrame 数帧）改由行为判据钉住：
  // tests/components/pages/BootPage.test.tsx 第 8 条——把 RAF 打成永不调用，
  // 启动页仍然要自动进工作台。原来这条是拿正则去找"RAF 效果块"，
  // 而进度条删掉之后那段代码本就不存在了：正则红的是形式，不是语义。
})
