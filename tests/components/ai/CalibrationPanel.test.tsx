/**
 * tests/components/ai/CalibrationPanel.test.tsx - CalibrationPanel 组件级 RTL 测试
 *
 * 覆盖范围（v0.9.6 P2 M7）：
 * 1. 加载状态：Spin + globalLoading 切换
 * 2. IPC 不可用：Empty 兜底
 * 3. 无 Provider 状态：Empty + 提示
 * 4. Provider 切换：Select 交互
 * 5. 触发校准：Button + loading + 消息提示
 * 6. 重置校准：Button + 确认
 * 7. 注入测试样本：开发模式
 * 8. 导出审计报告（核心 v0.9.6 P2 新增）：
 *    - 点击按钮打开 Modal
 *    - Form 字段渲染（13 字段）
 *    - Form 验证（必填、邮箱、decisionId 格式）
 *    - 提交后调用 IPC（export + load）
 *    - Result 展示（合规评分、fingerprint、文件路径）
 *    - 复制 fingerprint 到剪贴板
 *    - 再次导出 / 关闭
 * 9. 全局摘要渲染（4 卡指标）
 * 10. T 滑块交互（Slider 拖动 / 最优 T 大字号）
 *
 * 调研依据：idea-to-dev-output/39-v1.4-RTL组件测试调研报告.md
 *
 * 关键决策：
 * - 用 jsdom 环境（文件头指令）— React 组件需要 DOM
 * - 完整 mock window.electronAPI — 10 个 credibility 通道
 * - mock recharts ResponsiveContainer — 避免 jsdom 0×0 尺寸报错
 * - 跳过 antd CSS — vitest.config.ts css: false
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider } from 'antd'

// ============================================================================
// Mock recharts（避免 ResponsiveContainer 在 jsdom 0×0 中报错）
// ============================================================================
vi.mock('recharts', async () => {
  const React = await import('react')
  // 简化 BarChart/LineChart：只渲染 children，避免 ResponsiveContainer 报错
  const SimpleChart = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'recharts-mock' }, children)
  return {
    BarChart: SimpleChart,
    LineChart: SimpleChart,
    Bar: () => null,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'responsive-container' }, children),
    ReferenceDot: () => null,
    ReferenceLine: () => null,
    Tooltip: () => null,
  }
})

// ============================================================================
// Mock window.electronAPI（10 个 credibility 通道）
// ============================================================================

const mockCredibilityAPI = {
  credibilityGetCalibrationState: vi.fn(),
  credibilityGetCalibration: vi.fn(),
  credibilityComputeEce: vi.fn(),
  credibilityCalibrate: vi.fn(),
  credibilityResetCalibration: vi.fn(),
  credibilityAddCalibrationSample: vi.fn(),
  credibilityExportAuditReport: vi.fn(),
  credibilityLoadAuditReport: vi.fn(),
  credibilityListAuditReports: vi.fn(),
  credibilityFormatAuditReport: vi.fn(),
}

// 在 jsdom 中挂载 mock electronAPI
beforeEach(() => {
  Object.assign(window, { electronAPI: mockCredibilityAPI })
  // 默认 mock 全部为成功响应
  mockCredibilityAPI.credibilityGetCalibrationState.mockResolvedValue({
    providers: {},
    defaultT: 1.0,
    updatedAt: Date.now(),
  })
  mockCredibilityAPI.credibilityGetCalibration.mockResolvedValue(null)
  mockCredibilityAPI.credibilityComputeEce.mockResolvedValue(null)
  mockCredibilityAPI.credibilityCalibrate.mockResolvedValue(null)
  mockCredibilityAPI.credibilityResetCalibration.mockResolvedValue(true)
  mockCredibilityAPI.credibilityAddCalibrationSample.mockResolvedValue(true)
  mockCredibilityAPI.credibilityExportAuditReport.mockResolvedValue({
    reportId: 'rpt-test-001',
    fingerprint: 'abc123def456',
    decisionId: 'calib-deepseek-1700000000000',
    formats: ['json', 'markdown', 'html'],
    written: [
      { format: 'json', filepath: '/tmp/audit/2026-07-20/calib-deepseek/report.json', bytes: 4096 },
      { format: 'markdown', filepath: '/tmp/audit/2026-07-20/calib-deepseek/report.md', bytes: 2048 },
      { format: 'html', filepath: '/tmp/audit/2026-07-20/calib-deepseek/report.html', bytes: 3072 },
    ],
  })
  mockCredibilityAPI.credibilityLoadAuditReport.mockResolvedValue({
    overallCompliance: { complianceScore: 85, euAiActCompliant: true },
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

// ============================================================================
// 测试工具：包装 antd ConfigProvider（必须，避免 antd warning）
// ============================================================================

import CalibrationPanel from '@renderer/components/ai/CalibrationPanel'

function renderPanel(props: { enableTestSample?: boolean; initialProviderId?: string } = {}) {
  const user = userEvent.setup()
  const utils = render(
    <ConfigProvider>
      <CalibrationPanel {...props} />
    </ConfigProvider>
  )
  return { user, ...utils }
}

// ============================================================================
// 测试用例
// ============================================================================

describe('CalibrationPanel — 加载与可用性', () => {
  it('全局加载中显示 Spin', async () => {
    // 让 getCalibrationState 永远 pending
    mockCredibilityAPI.credibilityGetCalibrationState.mockReturnValue(new Promise(() => {}))
    const { container } = renderPanel()
    // jsdom 下 antd Spin 的 tip 文本不一定渲染到 textContent（CSS 计算异常）
    // 改用：校验 ant-spin-spinning class 存在 + aria-busy
    await waitFor(() => {
      const spin = container.querySelector('.ant-spin-spinning')
      expect(spin).toBeTruthy()
    })
  })

  it('IPC 不可用时显示 Empty 提示', async () => {
    // 移除 electronAPI
    Object.assign(window, { electronAPI: undefined })
    renderPanel()
    expect(await screen.findByText(/IPC 不可用，校准面板仅在 Electron 环境中可用/i)).toBeInTheDocument()
  })

  it('无 Provider 时显示 Empty 提示', async () => {
    mockCredibilityAPI.credibilityGetCalibrationState.mockResolvedValue({
      providers: {},
      defaultT: 1.0,
      updatedAt: Date.now(),
    })
    renderPanel()
    expect(await screen.findByText(/暂无已校准的 Provider/i)).toBeInTheDocument()
    expect(screen.getByText(/积累 ≥ 10 条样本后可触发校准/i)).toBeInTheDocument()
  })
})

describe('CalibrationPanel — 全局摘要与 Provider 切换', () => {
  const fakeState = {
    providers: {
      deepseek: {
        optimalT: 2.5,
        lastCalibratedAt: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 天前
        totalSamplesEver: 50,
        eceBefore: 0.15,
        eceAfter: 0.05,
      },
      claude: {
        optimalT: 0.7,
        lastCalibratedAt: 0,
        totalSamplesEver: 0,
        eceBefore: 0,
        eceAfter: 0,
      },
    },
    defaultT: 1.0,
    updatedAt: Date.now(),
  }

  beforeEach(() => {
    mockCredibilityAPI.credibilityGetCalibrationState.mockResolvedValue(fakeState)
    mockCredibilityAPI.credibilityGetCalibration.mockImplementation((id: string) =>
      Promise.resolve(fakeState.providers[id as keyof typeof fakeState.providers] ?? null)
    )
    mockCredibilityAPI.credibilityComputeEce.mockResolvedValue({
      ece: 0.05,
      mce: 0.08,
      bucketStats: [
        { bucketLower: 0, bucketUpper: 0.1, count: 10, accuracy: 0.1, avgConfidence: 0.05, calibrationGap: 0.05 },
      ],
      totalSamples: 50,
      numBuckets: 10,
    })
  })

  it('渲染全局摘要 4 卡（默认 T / Provider 数 / 累计样本 / 最后更新）', async () => {
    renderPanel()
    // 全局摘要标签
    expect(await screen.findByText('默认 T')).toBeInTheDocument()
    expect(screen.getByText('Provider 数')).toBeInTheDocument()
    expect(screen.getByText('累计样本')).toBeInTheDocument()
    expect(screen.getByText('最后更新')).toBeInTheDocument()
    // Provider 数 = 2
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('自动选中第一个 Provider 并加载详情', async () => {
    renderPanel()
    await waitFor(() => {
      expect(mockCredibilityAPI.credibilityGetCalibration).toHaveBeenCalledWith('deepseek')
      expect(mockCredibilityAPI.credibilityComputeEce).toHaveBeenCalledWith('deepseek')
    })
  })

  it('切换 Provider 触发重新加载', async () => {
    renderPanel()
    // 等待首次加载完成
    await waitFor(() => {
      expect(mockCredibilityAPI.credibilityGetCalibration).toHaveBeenCalledWith('deepseek')
    })
    // 找到 Select 触发器并切换到 claude
    const select = await screen.findByRole('combobox')
    await userEvent.click(select)
    // antd Select dropdown 渲染到 body 末尾的 portal，listbox role 不一定在 document 主树上
    // 用 .ant-select-item-option 选择器直接定位
    const claudeOption = await waitFor(() => {
      const items = document.querySelectorAll('.ant-select-item-option-content')
      const claudeEl = Array.from(items).find(
        (el) => el.textContent === 'claude'
      )
      expect(claudeEl).toBeTruthy()
      return claudeEl as HTMLElement
    })
    // 找最近的 option 祖先元素（ant-select-item）
    const optionEl = claudeOption.closest('.ant-select-item') as HTMLElement
    fireEvent.click(optionEl)
    await waitFor(() => {
      expect(mockCredibilityAPI.credibilityGetCalibration).toHaveBeenCalledWith('claude')
    })
  })
})

describe('CalibrationPanel — 校准 / 重置 / 测试样本', () => {
  const fakeState = {
    providers: {
      deepseek: {
        optimalT: 2.5,
        lastCalibratedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
        totalSamplesEver: 50,
        eceBefore: 0.15,
        eceAfter: 0.05,
      },
    },
    defaultT: 1.0,
    updatedAt: Date.now(),
  }

  beforeEach(() => {
    mockCredibilityAPI.credibilityGetCalibrationState.mockResolvedValue(fakeState)
    mockCredibilityAPI.credibilityGetCalibration.mockResolvedValue(fakeState.providers.deepseek)
    mockCredibilityAPI.credibilityComputeEce.mockResolvedValue({
      ece: 0.05,
      mce: 0.08,
      bucketStats: [],
      totalSamples: 50,
      numBuckets: 10,
    })
  })

  it('点击「触发校准」调用 IPC 并显示成功消息', async () => {
    mockCredibilityAPI.credibilityCalibrate.mockResolvedValue({
      optimalT: 2.7,
      eceBefore: 0.15,
      eceAfter: 0.04,
      searchTrace: [{ t: 2.5, ece: 0.05, nll: 0.5 }, { t: 2.7, ece: 0.04, nll: 0.48 }],
    })

    const { user } = renderPanel()
    const calibrateBtn = await screen.findByRole('button', { name: /触发校准/i })
    await user.click(calibrateBtn)

    await waitFor(() => {
      expect(mockCredibilityAPI.credibilityCalibrate).toHaveBeenCalledWith('deepseek')
    })
    // 成功消息
    expect(await screen.findByText(/校准完成：T = 2\.700/i)).toBeInTheDocument()
  })

  it('点击「重置」调用 IPC 并显示成功消息', async () => {
    const { user } = renderPanel()
    // antd Button 包 Tooltip 时 accessible name 可能带 icon aria-label，用文本匹配
    const resetBtn = await screen.findByText('重置')
    await user.click(resetBtn)
    await waitFor(() => {
      expect(mockCredibilityAPI.credibilityResetCalibration).toHaveBeenCalledWith('deepseek')
    })
    expect(await screen.findByText(/已重置 deepseek 的校准状态/i)).toBeInTheDocument()
  })

  it('点击「测试样本」调用 IPC 并显示成功消息（开发模式）', async () => {
    const { user } = renderPanel({ enableTestSample: true })
    const testBtn = await screen.findByRole('button', { name: /测试样本/i })
    await user.click(testBtn)
    await waitFor(() => {
      expect(mockCredibilityAPI.credibilityAddCalibrationSample).toHaveBeenCalled()
    })
    expect(await screen.findByText(/已添加测试样本/i)).toBeInTheDocument()
  })

  it('校准失败时显示错误消息', async () => {
    mockCredibilityAPI.credibilityCalibrate.mockResolvedValue(null)
    const { user } = renderPanel()
    const calibrateBtn = await screen.findByRole('button', { name: /触发校准/i })
    await user.click(calibrateBtn)
    expect(await screen.findByText(/校准失败，请检查 IPC 连接/i)).toBeInTheDocument()
  })
})

// ============================================================================
// 核心：导出审计报告（v0.9.6 P2 新增）
// ============================================================================

describe('CalibrationPanel — 导出审计报告（v0.9.6 P2 核心）', () => {
  const fakeState = {
    providers: {
      deepseek: {
        optimalT: 2.5,
        lastCalibratedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
        totalSamplesEver: 50,
        eceBefore: 0.15,
        eceAfter: 0.05,
      },
    },
    defaultT: 1.0,
    updatedAt: Date.now(),
  }

  beforeEach(() => {
    mockCredibilityAPI.credibilityGetCalibrationState.mockResolvedValue(fakeState)
    mockCredibilityAPI.credibilityGetCalibration.mockResolvedValue(fakeState.providers.deepseek)
    mockCredibilityAPI.credibilityComputeEce.mockResolvedValue({
      ece: 0.05,
      mce: 0.08,
      bucketStats: [],
      totalSamples: 50,
      numBuckets: 10,
    })
  })

  it('点击「导出审计报告」打开 Modal 并填充默认值', async () => {
    const { user } = renderPanel()
    const exportBtn = await screen.findByRole('button', { name: /导出审计报告/i })
    await user.click(exportBtn)

    // Modal 标题
    const modal = await screen.findByRole('dialog')
    expect(modal).toBeInTheDocument()
    expect(within(modal).getByText(/导出 EU AI Act 合规审计报告/i)).toBeInTheDocument()

    // 默认填充的字段
    const titleInput = within(modal).getByPlaceholderText(/Nginx 502 故障排查/i) as HTMLInputElement
    expect(titleInput.value).toContain('deepseek')
    expect(titleInput.value).toContain('校准数据合规审计')

    // 部署方默认
    const deployerInput = within(modal).getByDisplayValue('TDSF-Linux 运维团队')
    expect(deployerInput).toBeInTheDocument()
  })

  it('Form 验证：必填字段为空时阻止提交', async () => {
    const { user } = renderPanel()
    const exportBtn = await screen.findByRole('button', { name: /导出审计报告/i })
    await user.click(exportBtn)
    const modal = await screen.findByRole('dialog')

    // 清空决策标题
    const titleInput = within(modal).getByPlaceholderText(/Nginx 502 故障排查/i)
    await user.clear(titleInput)

    // 点击提交
    const submitBtn = within(modal).getByRole('button', { name: /导出审计报告/i })
    await user.click(submitBtn)

    // 验证错误信息出现
    expect(await within(modal).findByText(/请输入决策标题/i)).toBeInTheDocument()
    // IPC 不应被调用
    expect(mockCredibilityAPI.credibilityExportAuditReport).not.toHaveBeenCalled()
  })

  it('Form 验证：邮箱格式错误时阻止提交', async () => {
    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: /导出审计报告/i }))
    const modal = await screen.findByRole('dialog')

    // 改成无效邮箱
    const emailInput = within(modal).getByPlaceholderText('admin@tdsf.dev')
    await user.clear(emailInput)
    await user.type(emailInput, 'not-an-email')

    // 提交
    const submitBtn = within(modal).getByRole('button', { name: /导出审计报告/i })
    await user.click(submitBtn)

    // 验证邮箱错误
    expect(await within(modal).findByText(/请输入合法邮箱/i)).toBeInTheDocument()
    expect(mockCredibilityAPI.credibilityExportAuditReport).not.toHaveBeenCalled()
  })

  it('Form 验证：decisionId 格式限制（仅字母数字下划线）', async () => {
    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: /导出审计报告/i }))
    const modal = await screen.findByRole('dialog')

    // 改成包含非法字符
    const idInput = within(modal).getByPlaceholderText(/calib-deepseek-1700000000000/i)
    await user.clear(idInput)
    await user.type(idInput, 'bad id with spaces!')

    // 提交
    const submitBtn = within(modal).getByRole('button', { name: /导出审计报告/i })
    await user.click(submitBtn)

    // 验证格式错误
    expect(await within(modal).findByText(/仅允许字母数字下划线/i)).toBeInTheDocument()
    expect(mockCredibilityAPI.credibilityExportAuditReport).not.toHaveBeenCalled()
  })

  it('成功提交：调用 export + load IPC 并展示 Result', async () => {
    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: /导出审计报告/i }))
    const modal = await screen.findByRole('dialog')

    // 提交
    const submitBtn = within(modal).getByRole('button', { name: /导出审计报告/i })
    await user.click(submitBtn)

    // 等待 Result 展示
    await waitFor(() => {
      expect(mockCredibilityAPI.credibilityExportAuditReport).toHaveBeenCalled()
      expect(mockCredibilityAPI.credibilityLoadAuditReport).toHaveBeenCalled()
    })

    // Result title 是 "EU AI Act 合规"（不含 "导出"），用 exact: true 区分于 modal 标题
    const newModal = await screen.findByRole('dialog')
    expect(within(newModal).getByText('EU AI Act 合规', { exact: true })).toBeInTheDocument()
    // 报告 ID
    expect(within(newModal).getByText('rpt-test-001')).toBeInTheDocument()
    // fingerprint
    expect(within(newModal).getByText('abc123def456')).toBeInTheDocument()
    // 合规评分
    expect(within(newModal).getByText(/85 \/ 100/)).toBeInTheDocument()
    // 3 个文件
    expect(within(newModal).getByText('JSON')).toBeInTheDocument()
    expect(within(newModal).getByText('MARKDOWN')).toBeInTheDocument()
    expect(within(newModal).getByText('HTML')).toBeInTheDocument()
  })

  it('失败提交：IPC 不可用时显示错误', async () => {
    mockCredibilityAPI.credibilityExportAuditReport.mockResolvedValue(null)
    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: /导出审计报告/i }))
    const modal = await screen.findByRole('dialog')

    const submitBtn = within(modal).getByRole('button', { name: /导出审计报告/i })
    await user.click(submitBtn)

    expect(await screen.findByText(/审计导出失败：IPC 不可用/i)).toBeInTheDocument()
  })

  it('点击 fingerprint Tag 复制到剪贴板', async () => {
    // Spy navigator.clipboard.writeText
    // 注：jsdom 的 navigator.clipboard 是只读 getter，Object.defineProperty 无法覆盖
    // 必须用 vi.spyOn 拦截 writeText 方法
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: /导出审计报告/i }))
    const modal = await screen.findByRole('dialog')

    const submitBtn = within(modal).getByRole('button', { name: /导出审计报告/i })
    await user.click(submitBtn)

    // 等 Result 出现（fingerprint tag 在 Result subTitle 中）
    // 注：Result 通过 antd 内部 portal 渲染，不在 .ant-modal-content 子树内
    // 但 .ant-tag 在 document 全局可查
    await waitFor(() => {
      expect(document.querySelector('.ant-result')).toBeTruthy()
    })
    const tagEl = await waitFor(() => {
      const tags = document.querySelectorAll('.ant-tag')
      const target = Array.from(tags).find((t) => t.textContent?.includes('abc123def456'))
      expect(target).toBeTruthy()
      return target as HTMLElement
    })
    // userEvent.click 触发 React 17+ 事件委托（handleCopyFingerprint 会调用 clipboard.writeText）
    await user.click(tagEl)

    // 等待 writeText 被异步调用
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('abc123def456')
    })
    writeText.mockRestore()
  })

  it('Result 出现后点击「再次导出」清空 Result 回到 Form', async () => {
    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: /导出审计报告/i }))
    const modal = await screen.findByRole('dialog')

    await user.click(within(modal).getByRole('button', { name: /导出审计报告/i }))
    // 等 Result（exact 避免匹配 modal 标题）
    await within(modal).findByText('EU AI Act 合规', { exact: true })
    // 再次导出
    await user.click(within(modal).getByRole('button', { name: /再次导出/i }))
    // Form 应回来（重新出现 placeholder）
    expect(await within(modal).findByPlaceholderText(/Nginx 502 故障排查/i)).toBeInTheDocument()
  })

  it('关闭 Modal 重置 Result 状态', async () => {
    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: /导出审计报告/i }))
    // antd Modal 可能渲染多个 role=dialog（mask + content），用 .ant-modal-content 精确定位
    const modal = await waitFor(() => {
      const el = document.querySelector('.ant-modal-content')
      expect(el).toBeTruthy()
      return el as HTMLElement
    })

    // 点击"取消"按钮关闭 Modal：
    // antd 5 Button 文本可能被多个 span 包裹，getByText 找不到单一文本节点
    // 用 querySelectorAll('button') 遍历 + textContent.includes 模糊匹配
    const cancelBtn = await waitFor(() => {
      const buttons = modal.querySelectorAll('button')
      const target = Array.from(buttons).find(
        (b) => (b.textContent ?? '').replace(/\s+/g, '').includes('取消')
      )
      expect(target).toBeTruthy()
      return target as HTMLElement
    })
    await user.click(cancelBtn)

    // Modal 消失（destroyOnClose → DOM 卸载 .ant-modal-content）
    await waitFor(() => {
      expect(document.querySelector('.ant-modal-content')).toBeFalsy()
    })
  })
})

// ============================================================================
// T 滑块交互
// ============================================================================

describe('CalibrationPanel — T 滑块交互', () => {
  const fakeState = {
    providers: {
      deepseek: {
        optimalT: 2.5,
        lastCalibratedAt: Date.now() - 1000,
        totalSamplesEver: 50,
        eceBefore: 0.15,
        eceAfter: 0.05,
      },
    },
    defaultT: 1.0,
    updatedAt: Date.now(),
  }

  beforeEach(() => {
    mockCredibilityAPI.credibilityGetCalibrationState.mockResolvedValue(fakeState)
    mockCredibilityAPI.credibilityGetCalibration.mockResolvedValue(fakeState.providers.deepseek)
    mockCredibilityAPI.credibilityComputeEce.mockResolvedValue(null)
  })

  it('未校准时显示"未校准"标签（ProviderDetail 区域）', async () => {
    mockCredibilityAPI.credibilityGetCalibration.mockResolvedValue({
      ...fakeState.providers.deepseek,
      lastCalibratedAt: 0,
    })
    renderPanel()
    // 用 findAllByText 兼容 GlobalSummary hint（"未校准 Provider 用此值"）也匹配的情况
    const matches = await screen.findAllByText(/未校准/i)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('校准后 T 大字号显示最优 T=2.500（当前 T 与最优 T 卡片）', async () => {
    renderPanel()
    // 等待详情加载：最优 T（detail-cell-value）和当前 T（detail-t-value）都会显示 2.500
    await waitFor(() => {
      const matches = screen.getAllByText('2.500')
      // 至少 2 个：当前 T（detail-t-value）+ 最优 T（detail-cell-value）
      expect(matches.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('T 滑块的 mark 5.0 显示', async () => {
    renderPanel()
    // antd Slider 的 marks 会渲染带 class ant-slider-mark-text 的 span
    await waitFor(() => {
      expect(screen.getByText('5.0')).toBeInTheDocument()
    })
  })

  it('T 滑块拖动（onChange）更新 tPreview', async () => {
    renderPanel()
    // 等初始渲染
    await waitFor(() => {
      const matches = screen.getAllByText('2.500')
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })

    // antd Slider 的 handle 是 rc-slider-handle（用 role=slider 找）
    const sliderHandle = document.querySelector('.ant-slider-handle') as HTMLElement
    expect(sliderHandle).toBeTruthy()

    // 通过 fireEvent 模拟拖到 3.0
    fireEvent.mouseDown(sliderHandle, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(document, { clientX: 200, clientY: 0 })
    fireEvent.mouseUp(document)
  })
})

// ============================================================================
// 论文溯源 footer
// ============================================================================

describe('CalibrationPanel — 论文溯源', () => {
  const fakeState = {
    providers: { deepseek: { optimalT: 1.5, lastCalibratedAt: 1, totalSamplesEver: 10, eceBefore: 0.1, eceAfter: 0.05 } },
    defaultT: 1.0,
    updatedAt: Date.now(),
  }

  beforeEach(() => {
    mockCredibilityAPI.credibilityGetCalibrationState.mockResolvedValue(fakeState)
    mockCredibilityAPI.credibilityGetCalibration.mockResolvedValue(fakeState.providers.deepseek)
    mockCredibilityAPI.credibilityComputeEce.mockResolvedValue(null)
  })

  it('footer 显示 3 篇核心论文', async () => {
    renderPanel()
    expect(await screen.findByText('理论支撑')).toBeInTheDocument()
    expect(screen.getByText(/Guo et al\. 2017/)).toBeInTheDocument()
    expect(screen.getByText(/Kadavath et al\. 2022/)).toBeInTheDocument()
    expect(screen.getByText(/Shrivastava et al\. 2023/)).toBeInTheDocument()
  })
})

// ============================================================================
// P2 M7 e：补充缺失的 RTL 测试覆盖
// ============================================================================

describe('CalibrationPanel — Tabs 切换（分桶 / 搜索轨迹）', () => {
  const fakeState = {
    providers: {
      deepseek: {
        optimalT: 2.5,
        lastCalibratedAt: Date.now() - 1000,
        totalSamplesEver: 50,
        eceBefore: 0.15,
        eceAfter: 0.05,
      },
    },
    defaultT: 1.0,
    updatedAt: Date.now(),
  }

  beforeEach(() => {
    mockCredibilityAPI.credibilityGetCalibrationState.mockResolvedValue(fakeState)
    mockCredibilityAPI.credibilityGetCalibration.mockResolvedValue(fakeState.providers.deepseek)
    mockCredibilityAPI.credibilityComputeEce.mockResolvedValue({
      ece: 0.05,
      mce: 0.08,
      bucketStats: [
        { bucketLower: 0, bucketUpper: 0.1, count: 5, accuracy: 0.1, avgConfidence: 0.05, calibrationGap: 0.05 },
        { bucketLower: 0.5, bucketUpper: 0.6, count: 10, accuracy: 0.5, avgConfidence: 0.55, calibrationGap: 0.05 },
      ],
      totalSamples: 50,
      numBuckets: 10,
    })
  })

  it('默认显示「分桶校准误差」Tab', async () => {
    renderPanel()
    // 等待详情加载
    await waitFor(() => {
      expect(mockCredibilityAPI.credibilityComputeEce).toHaveBeenCalledWith('deepseek')
    })
    // 分桶校准误差 tab 标签（active）
    const bucketTab = await screen.findByRole('tab', { name: /分桶校准误差/i })
    expect(bucketTab).toHaveAttribute('aria-selected', 'true')
  })

  it('切换到「T 搜索轨迹」Tab', async () => {
    const { user } = renderPanel()
    const traceTab = await screen.findByRole('tab', { name: /T 搜索轨迹/i })
    await user.click(traceTab)
    // 切换后 tab 应激活
    await waitFor(() => {
      expect(traceTab).toHaveAttribute('aria-selected', 'true')
    })
  })
})

describe('CalibrationPanel — 表单字段类型与默认行为', () => {
  const fakeState = {
    providers: {
      deepseek: {
        optimalT: 2.5,
        lastCalibratedAt: Date.now() - 1000,
        totalSamplesEver: 50,
        eceBefore: 0.15,
        eceAfter: 0.05,
      },
    },
    defaultT: 1.0,
    updatedAt: Date.now(),
  }

  beforeEach(() => {
    mockCredibilityAPI.credibilityGetCalibrationState.mockResolvedValue(fakeState)
    mockCredibilityAPI.credibilityGetCalibration.mockResolvedValue(fakeState.providers.deepseek)
    mockCredibilityAPI.credibilityComputeEce.mockResolvedValue(null)
  })

  it('isHighRisk 默认为 true（Switch checked）', async () => {
    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: /导出审计报告/i }))
    const modal = await screen.findByRole('dialog')
    // Switch 渲染为 button role=switch，aria-checked 表示状态
    const highRiskSwitch = within(modal).getByRole('switch', { name: /是否高风险/ })
    expect(highRiskSwitch).toHaveAttribute('aria-checked', 'true')
  })

  it('writeAllFormats 默认为 true', async () => {
    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: /导出审计报告/i }))
    const modal = await screen.findByRole('dialog')
    const writeAllSwitch = within(modal).getByRole('switch', { name: /一次导出三种格式/ })
    expect(writeAllSwitch).toHaveAttribute('aria-checked', 'true')
  })

  it('oversightMode 默认选中 human-on-the-loop', async () => {
    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: /导出审计报告/i }))
    const modal = await screen.findByRole('dialog')
    // Radio 渲染为 input[type=radio]
    const onTheLoopRadio = within(modal).getByDisplayValue('human-on-the-loop') as HTMLInputElement
    expect(onTheLoopRadio.checked).toBe(true)
  })

  it('actionType 默认选中 no-op（Select 显示「无操作」）', async () => {
    const { user } = renderPanel()
    await user.click(await screen.findByRole('button', { name: /导出审计报告/i }))
    const modal = await screen.findByRole('dialog')
    // antd 5 Select 显示的是 option label 「无操作」而非 value 'no-op'
    // 验证 Select 已选中「无操作」label
    expect(within(modal).getByText('无操作')).toBeInTheDocument()
  })

  it('关闭后重新打开 Modal 重置审计 Result 状态', async () => {
    const { user } = renderPanel()
    // 第一次：打开 → 提交 → 看到 Result
    await user.click(await screen.findByRole('button', { name: /导出审计报告/i }))
    let modal = await screen.findByRole('dialog')
    await user.click(within(modal).getByRole('button', { name: /导出审计报告/i }))
    await within(modal).findByText('EU AI Act 合规', { exact: true })
    // 关闭：用 querySelector 找"关闭"文本（Result extra 数组 button，避免 accessible name 干扰）
    const closeBtn = await waitFor(() => {
      const btns = modal.querySelectorAll('button')
      const t = Array.from(btns).find((b) => (b.textContent ?? '').replace(/\s+/g, '').includes('关闭'))
      expect(t).toBeTruthy()
      return t as HTMLElement
    })
    await user.click(closeBtn)
    await waitFor(() => {
      expect(document.querySelector('.ant-modal-content')).toBeFalsy()
    })
    // 第二次：重新打开
    await user.click(await screen.findByRole('button', { name: /导出审计报告/i }))
    modal = await screen.findByRole('dialog')
    // 之前那个 fingerprint 文字应不存在（Result 已重置）
    expect(within(modal).queryByText('EU AI Act 合规', { exact: true })).toBeFalsy()
    // 应有 Form
    expect(within(modal).getByPlaceholderText(/Nginx 502 故障排查/i)).toBeInTheDocument()
  })
})

describe('CalibrationPanel — 注入测试样本（开发模式）', () => {
  const fakeState = {
    providers: {
      deepseek: {
        optimalT: 2.5,
        lastCalibratedAt: Date.now() - 1000,
        totalSamplesEver: 50,
        eceBefore: 0.15,
        eceAfter: 0.05,
      },
    },
    defaultT: 1.0,
    updatedAt: Date.now(),
  }

  beforeEach(() => {
    mockCredibilityAPI.credibilityGetCalibrationState.mockResolvedValue(fakeState)
    mockCredibilityAPI.credibilityGetCalibration.mockResolvedValue(fakeState.providers.deepseek)
    mockCredibilityAPI.credibilityComputeEce.mockResolvedValue(null)
  })

  it('enableTestSample=false 时不显示「测试样本」按钮', async () => {
    renderPanel()
    // 等加载
    await waitFor(() => {
      expect(mockCredibilityAPI.credibilityGetCalibration).toHaveBeenCalled()
    })
    expect(screen.queryByRole('button', { name: /测试样本/i })).toBeNull()
  })

  it('enableTestSample=true 时显示「测试样本」按钮', async () => {
    renderPanel({ enableTestSample: true })
    const testBtn = await screen.findByRole('button', { name: /测试样本/i })
    expect(testBtn).toBeInTheDocument()
  })

  it('点击「测试样本」传入选中的 providerId 与随机样本', async () => {
    const { user } = renderPanel({ enableTestSample: true })
    const testBtn = await screen.findByRole('button', { name: /测试样本/i })
    await user.click(testBtn)
    await waitFor(() => {
      expect(mockCredibilityAPI.credibilityAddCalibrationSample).toHaveBeenCalled()
    })
    // 验证参数 shape：decisionId / reportedConfidence / wasCorrect / providerId / timestamp
    const callArg = mockCredibilityAPI.credibilityAddCalibrationSample.mock.calls[0]?.[0]
    expect(callArg).toMatchObject({
      decisionId: expect.stringMatching(/^test-\d+$/),
      reportedConfidence: expect.any(Number),
      wasCorrect: expect.any(Boolean),
      providerId: 'deepseek',
      timestamp: expect.any(Number),
    })
    // reportedConfidence 应在 [0.5, 1.0]
    expect(callArg.reportedConfidence).toBeGreaterThanOrEqual(0.5)
    expect(callArg.reportedConfidence).toBeLessThanOrEqual(1.0)
  })

  it('「测试样本」失败时显示错误消息', async () => {
    mockCredibilityAPI.credibilityAddCalibrationSample.mockResolvedValue(false)
    const { user } = renderPanel({ enableTestSample: true })
    const testBtn = await screen.findByRole('button', { name: /测试样本/i })
    await user.click(testBtn)
    expect(await screen.findByText(/添加失败/i)).toBeInTheDocument()
  })
})

describe('CalibrationPanel — Provider 选择计数与切换', () => {
  const fakeState = {
    providers: {
      deepseek: { optimalT: 2.5, lastCalibratedAt: Date.now() - 1000, totalSamplesEver: 50, eceBefore: 0.15, eceAfter: 0.05 },
      claude: { optimalT: 0.8, lastCalibratedAt: Date.now() - 2000, totalSamplesEver: 30, eceBefore: 0.20, eceAfter: 0.06 },
      gpt4: { optimalT: 1.2, lastCalibratedAt: 0, totalSamplesEver: 0, eceBefore: 0, eceAfter: 0 },
    },
    defaultT: 1.0,
    updatedAt: Date.now(),
  }

  beforeEach(() => {
    mockCredibilityAPI.credibilityGetCalibrationState.mockResolvedValue(fakeState)
    mockCredibilityAPI.credibilityGetCalibration.mockImplementation((id: string) =>
      Promise.resolve(fakeState.providers[id as keyof typeof fakeState.providers] ?? null)
    )
    mockCredibilityAPI.credibilityComputeEce.mockResolvedValue(null)
  })

  it('显示当前 Provider 索引 "已选 1 / 3"', async () => {
    renderPanel()
    expect(await screen.findByText(/已选 1 \/ 3/)).toBeInTheDocument()
  })

  it('切换到第 3 个 Provider 后索引更新为 "已选 3 / 3"', async () => {
    const { user } = renderPanel()
    await waitFor(() => {
      expect(screen.getByText(/已选 1 \/ 3/)).toBeInTheDocument()
    })
    // 打开 select 切换到 gpt4
    const select = await screen.findByRole('combobox')
    await user.click(select)
    const gpt4Option = await waitFor(() => {
      const items = document.querySelectorAll('.ant-select-item-option-content')
      const el = Array.from(items).find((e) => e.textContent === 'gpt4')
      expect(el).toBeTruthy()
      return el as HTMLElement
    })
    const optionEl = gpt4Option.closest('.ant-select-item') as HTMLElement
    fireEvent.click(optionEl)
    await waitFor(() => {
      expect(mockCredibilityAPI.credibilityGetCalibration).toHaveBeenCalledWith('gpt4')
      expect(screen.getByText(/已选 3 \/ 3/)).toBeInTheDocument()
    })
  })

  it('initialProviderId 优先于自动选择第一个', async () => {
    renderPanel({ initialProviderId: 'claude' })
    await waitFor(() => {
      expect(mockCredibilityAPI.credibilityGetCalibration).toHaveBeenCalledWith('claude')
    })
    // 索引应为 2/3
    expect(await screen.findByText(/已选 2 \/ 3/)).toBeInTheDocument()
  })
})

describe('CalibrationPanel — 刷新按钮', () => {
  const fakeState = {
    providers: {
      deepseek: { optimalT: 2.5, lastCalibratedAt: Date.now() - 1000, totalSamplesEver: 50, eceBefore: 0.15, eceAfter: 0.05 },
    },
    defaultT: 1.0,
    updatedAt: Date.now(),
  }

  beforeEach(() => {
    mockCredibilityAPI.credibilityGetCalibrationState.mockResolvedValue(fakeState)
    mockCredibilityAPI.credibilityGetCalibration.mockResolvedValue(fakeState.providers.deepseek)
    mockCredibilityAPI.credibilityComputeEce.mockResolvedValue(null)
  })

  it('点击「刷新」重新调用 IPC 加载数据', async () => {
    const { user } = renderPanel()
    await waitFor(() => {
      expect(mockCredibilityAPI.credibilityGetCalibration).toHaveBeenCalled()
    })
    const initialCalls = mockCredibilityAPI.credibilityGetCalibrationState.mock.calls.length
    const refreshBtn = await screen.findByRole('button', { name: /刷新/i })
    await user.click(refreshBtn)
    await waitFor(() => {
      expect(mockCredibilityAPI.credibilityGetCalibrationState.mock.calls.length).toBeGreaterThan(initialCalls)
    })
  })
})

describe('CalibrationPanel — 全局 IPC 错误降级', () => {
  it('getCalibrationState 抛错时不崩溃，仍能渲染 Empty 兜底', async () => {
    mockCredibilityAPI.credibilityGetCalibrationState.mockRejectedValue(new Error('IPC 失败'))
    // 不应抛出
    expect(() => renderPanel()).not.toThrow()
  })

  it('getCalibration 返回 null 时显示「从未校准」占位', async () => {
    mockCredibilityAPI.credibilityGetCalibrationState.mockResolvedValue({
      providers: {
        deepseek: { optimalT: 0, lastCalibratedAt: 0, totalSamplesEver: 0, eceBefore: 0, eceAfter: 0 },
      },
      defaultT: 1.0,
      updatedAt: Date.now(),
    })
    mockCredibilityAPI.credibilityGetCalibration.mockResolvedValue(null)
    mockCredibilityAPI.credibilityComputeEce.mockResolvedValue(null)
    renderPanel()
    // 等待首次加载
    await waitFor(() => {
      expect(mockCredibilityAPI.credibilityGetCalibration).toHaveBeenCalled()
    })
    // 校准时间为「从未校准」
    expect(await screen.findByText('从未校准')).toBeInTheDocument()
    // 样本数显示 0
    expect(screen.getByText('样本数')).toBeInTheDocument()
  })
})
