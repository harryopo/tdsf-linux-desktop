/**
 * 启动就绪竞态测试（R0）
 *
 * 生产构建里应用会永久停在启动页，两个根因：
 * 1. 主进程只推过 'ipc-ready'，'done' 从来没人推；而且推送发生在渲染层挂载之前时
 *    fire-and-forget 的推送没有任何订阅者 → 渲染层必须还能"拉"一次。
 * 2. 就绪判定挂在 requestAnimationFrame 数帧上，窗口最小化/被遮挡时 RAF 停摆，
 *    进度条走不完 → 按钮点不动。
 * 这两条都由本文件钉住，防止以后又写回"靠动画猜就绪"。
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
    expect(getLatestBootStage()).toEqual({ stage: 'done', progress: 100, message: '就绪 · 点击进入工作台' })
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

  it('就绪不再依赖 requestAnimationFrame', () => {
    const rafEffect = /requestAnimationFrame[\s\S]{0,900}?\n  \}, \[reducedMotion\]\)/.exec(bootPage)
    expect(rafEffect, '找不到 RAF 效果块，接线可能又变了').toBeTruthy()
    expect(rafEffect![0].includes('setBootDone'), 'RAF 里仍在决定就绪').toBe(false)
    expect(bootPage.includes('setTimeout(() => setMinElapsed'), '最小展示时长不再用定时器').toBe(true)
  })
})
