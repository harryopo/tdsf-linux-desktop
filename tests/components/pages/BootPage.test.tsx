/**
 * tests/components/pages/BootPage.test.tsx — 启动页组件级测试
 *
 * 2026-10-17 随"启动页只做加载、加载完自动进"重写：
 * 旧版 8 条里那 4 条围绕「进入工作台」按钮与「已保存的服务器」卡片的断言已随功能一起删除，
 * 换成"该跳的时候自己跳"和"删掉的东西不许长回来"两类判据。
 *
 * 覆盖范围：
 * 1. WebGL 不支持时降级（jsdom 自然不支持，触发 catch 分支）
 * 2. prefers-reduced-motion 下立刻自动跳转
 * 3. 最短展示时长走完之前不跳转（避免一闪而过，也避免 boot 没完就进）
 * 4. Electron 环境里以主进程推来的 done 为准：没 done 就不跳
 * 5. 加载行有无障碍语义（role=status + aria-live），文字跟着主进程阶段变
 * 6. 页面上没有按钮 / 进度条 / 服务器卡片（这三样是本轮明确删掉的）
 * 7. 闪烁光标在 reduced-motion 下不带动画类
 * 8. RAF 停摆（窗口被遮挡）时仍自动跳转——R0 老根因的行为判据
 *
 * 关键决策：
 * - 不 mock three：jsdom 无法创建 WebGLRenderer，正好走 BootPage 的降级分支
 * - mock react-router-dom 的 useNavigate：跳转是唯一对外行为，直接断言它
 * - electron-api 用可控替身：第 4 条要断的是"以主进程推的 done 为准"，
 *   所以订阅回调由测试自己按阶段喂
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import { BootPage } from '@renderer/pages/BootPage'

const apiFlag = vi.hoisted(() => ({ available: false }))
vi.mock('@renderer/utils/electron-api', () => ({
  isElectronAPIAvailable: () => apiFlag.available,
}))

type StagePayload = { stage: string; progress: number; message: string }
/** 主进程推来的阶段由测试自己喂，才能断"没 done 就不跳" */
let pushStage: ((p: StagePayload) => void) | null = null

function createMatchMedia(matchesByQuery: Record<string, boolean> = {}) {
  return (query: string) => ({
    matches: matchesByQuery[query] ?? false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })
}

function setReducedMotion(on: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(createMatchMedia({ '(prefers-reduced-motion: reduce)': on })),
  })
}

describe('BootPage — 只负责加载，加载完自动进工作台', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    setReducedMotion(false)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockNavigate.mockClear()
    apiFlag.available = false
    pushStage = null
    window.electronAPI = undefined as unknown as typeof window.electronAPI
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('1. WebGL 不支持时降级到 fallback 层（catch 分支有日志）', async () => {
    const { container } = render(<BootPage />)

    await waitFor(() => {
      expect(container.querySelector('.pointer-events-none.z-\\[1\\]')).not.toBeNull()
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[BootPage] WebGL shader 初始化失败'),
      expect.any(Error),
    )
  })

  it('2. prefers-reduced-motion 下立刻自动跳转（不必等最短时长）', async () => {
    setReducedMotion(true)
    render(<BootPage />)

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/workbench', { replace: true }))
    expect(mockNavigate).toHaveBeenCalledTimes(1)
  })

  it('3. 最短展示时长没走完之前不跳转（一闪而过等于没告诉人在加载）', () => {
    setReducedMotion(false)
    render(<BootPage />)

    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('4. Electron 环境里以主进程推的 done 为准：没 done 就不跳', async () => {
    apiFlag.available = true
    setReducedMotion(true)
    window.electronAPI = {
      onBootLoadingStage: (cb: (p: StagePayload) => void) => {
        pushStage = cb
        return () => {
          pushStage = null
        }
      },
      bootGetState: async () => undefined,
    } as unknown as typeof window.electronAPI

    render(<BootPage />)
    await waitFor(() => expect(pushStage).not.toBeNull())

    pushStage!({ stage: 'sqlite-init', progress: 60, message: '正在加载本地数据库' })
    await waitFor(() => expect(screen.getByText('正在加载本地数据库')).toBeInTheDocument())
    expect(mockNavigate).not.toHaveBeenCalled()

    pushStage!({ stage: 'done', progress: 100, message: '准备就绪' })
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/workbench', { replace: true }))
  })

  it('5. 加载行是活区域（role=status + aria-live），文字随阶段更新', async () => {
    render(<BootPage />)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveAttribute('data-dom-id', 'boot-loading')
    // 非 Electron 环境走兜底分支：直接就绪，文案不再是"点击进入工作台"那种骗人的话
    await waitFor(() => expect(status).toHaveTextContent('准备就绪'))
  })

  it('6. 页面上没有按钮、没有进度条、没有服务器卡片（本轮明确删掉的三样）', async () => {
    apiFlag.available = true
    setReducedMotion(true)
    window.electronAPI = {
      onBootLoadingStage: (cb: (p: StagePayload) => void) => {
        pushStage = cb
        return () => {}
      },
      bootGetState: async () => undefined,
    } as unknown as typeof window.electronAPI

    const { container } = render(<BootPage />)
    // done 之前抓：这时页面还在"加载态"，最容易被重新塞回控件
    pushStage!({ stage: 'sqlite-init', progress: 60, message: '正在加载本地数据库' })
    await waitFor(() => expect(screen.getByText('正在加载本地数据库')).toBeInTheDocument())

    expect(container.querySelector('button')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByLabelText(/已保存的服务器/)).toBeNull()
    expect(container.textContent).not.toMatch(/进入工作台/)
  })

  it('7. 闪烁光标在 prefers-reduced-motion 下不带动画类', () => {
    setReducedMotion(true)
    const { container } = render(<BootPage />)

    const caret = container.querySelector('[data-dom-id="boot-loading"] span[aria-hidden="true"]')
    expect(caret).not.toBeNull()
    expect(caret!.className).not.toMatch(/animate-/)

    setReducedMotion(false)
    const { container: c2 } = render(<BootPage />)
    const caret2 = c2.querySelector('[data-dom-id="boot-loading"] span[aria-hidden="true"]')
    expect(caret2!.className).toMatch(/animate-pulse/)
  })

  it('8. RAF 停摆（窗口被遮挡/最小化）时照样自动进工作台', async () => {
    // R0 的老根因：就绪判定挂在"数帧"上，窗口一被遮挡 RAF 就不走，应用永远停在启动页。
    // 这条按行为钉：把 RAF 打成永不调用，启动页仍然要跳走。
    const realRaf = window.requestAnimationFrame
    const realCancel = window.cancelAnimationFrame
    window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame
    try {
      apiFlag.available = true
      setReducedMotion(false)
      window.electronAPI = {
        onBootLoadingStage: (cb: (p: StagePayload) => void) => {
          pushStage = cb
          return () => {}
        },
        bootGetState: async () => undefined,
      } as unknown as typeof window.electronAPI

      render(<BootPage />)
      await waitFor(() => expect(pushStage).not.toBeNull())
      pushStage!({ stage: 'done', progress: 100, message: '准备就绪' })

      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/workbench', { replace: true }), {
        timeout: 5000,
      })
    } finally {
      window.requestAnimationFrame = realRaf
      window.cancelAnimationFrame = realCancel
    }
  })
})
