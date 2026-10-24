// @vitest-environment jsdom
/**
 * tests/components/monitor/server-probe-card.test.tsx — 服务器体检卡（#212）
 *
 * 病根：`profiler:run` / `exportMd` / `exportPdf` / `defaultFileName` 四把键在渲染层零调用，
 * 但这台引擎是真跑通的——AI 在对话里能调（services/llm/tools/profiler-run.ts），
 * 报告正文的脱敏也在 #208 收口到了渲染出口。缺的只有"人按得到的那一下"。
 * 这一格把它接成界面能力：选中的 SSH 会话 → 跑一次体检 → 风险列出来 → 导出 md/PDF。
 *
 * 顺带改掉一个设计上通不了的洞：原来两个导出通道要渲染层递一个**绝对路径**，
 * 而沙箱里的渲染层既拿不到 userData、也没有保存对话框可用（全仓只有 showOpenDialog），
 * 也就是说这条路按原样接谁都会失败。现在导出改成传 host，路径由主进程定在
 * userData 下的报告目录，回来的 filePath 原样显示给用户。
 *
 * 判据各钉一件事：
 * 1. 没连上会话时不摆按钮不装忙，说清"没连上 + 下一步"（DESIGN §10）
 * 2. 跑完显示主进程给的摘要与每条风险的建议，数字不自己算
 * 3. 跑失败说原因，不留一张空卡、不写 0 条风险
 * 4. 导出把主进程回的文件路径显示出来
 * 5. 导出失败说原因，不假装写过文件
 * 6. 会话已连上但主机名还没读到：说"正在读主机名"，不谎报"没连上服务器"
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ProfilerRunResponse } from '@shared/models'

import { ServerProbeCard } from '@/components/monitor/ServerProbeCard'

function response(over: Partial<ProfilerRunResponse> = {}): ProfilerRunResponse {
  return {
    result: {
      host: '10.0.0.8',
      sessionId: 'sess-1',
      generatedAt: 0,
      totalDurationMs: 4200,
      items: [],
      errors: [],
    },
    md: '# 系统架构感知报告 — 10.0.0.8\n\n正文',
    risks: [
      {
        level: 'critical',
        category: '权限',
        title: 'SSH 允许 root 直接登录',
        description: 'PermitRootLogin yes',
        evidence: '/etc/ssh/sshd_config: PermitRootLogin yes',
        suggestion: '改成 no 后重启 sshd',
      },
    ],
    summary: { total: 1, critical: 1, high: 0, medium: 0, low: 0, info: 0 },
    ...over,
  }
}

function installApi(over: Record<string, unknown> = {}): Record<string, unknown> {
  const api = {
    profilerRun: vi.fn(async () => response()),
    profilerExportMd: vi.fn(async () => ({ filePath: 'C:/reports/probe.md', size: 1024 })),
    profilerExportPdf: vi.fn(async () => ({ filePath: 'C:/reports/probe.pdf', size: 2048 })),
    ...over,
  }
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api })
  return api
}

describe('ServerProbeCard — 服务器体检这一格', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. 没连上服务器时说不连 + 下一步，且不给能按的按钮', () => {
    installApi()
    render(<ServerProbeCard sessionId={null} host={null} />)

    expect(screen.getByText(/没连上服务器/)).toBeTruthy()
    expect(screen.getByText(/先在终端连上一台/)).toBeTruthy()
    const run = screen.getByRole('button', { name: /开始体检/ }) as HTMLButtonElement
    expect(run.disabled, '没会话还能点就是假按钮').toBe(true)
    // 没有目的地就不放按钮：没跑过体检，导出的位置也不该出现
    expect(screen.queryByRole('button', { name: /导出 md/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /导出 PDF/ })).toBeNull()
    expect(screen.queryByText(/共 \d+ 条风险/)).toBeNull()
  })

  it('2. 跑完显示主进程给的摘要与每条风险建议', async () => {
    const api = installApi()
    render(<ServerProbeCard sessionId="sess-1" host="10.0.0.8" />)

    fireEvent.click(screen.getByRole('button', { name: /开始体检/ }))

    expect(await screen.findByText('共 1 条风险 · 严重 1 · 高 0 · 中 0')).toBeTruthy()
    expect(api.profilerRun).toHaveBeenCalledWith('sess-1', '10.0.0.8')
    expect(screen.getByText('SSH 允许 root 直接登录')).toBeTruthy()
    expect(screen.getByText('改成 no 后重启 sshd')).toBeTruthy()
    // 导出一格是跑完之后才出现的
    expect(screen.getByRole('button', { name: /导出 md/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /导出 PDF/ })).toBeTruthy()
  })

  it('3. 跑失败说原因，不留空卡也不写"0 条风险"', async () => {
    installApi({
      profilerRun: vi.fn(async () => {
        throw new Error('会话已关闭')
      }),
    })
    render(<ServerProbeCard sessionId="sess-1" host="10.0.0.8" />)

    fireEvent.click(screen.getByRole('button', { name: /开始体检/ }))

    expect(await screen.findByText(/体检没做成/)).toBeTruthy()
    expect(screen.getByText(/会话已关闭/)).toBeTruthy()
    expect(screen.queryByText(/共 \d+ 条风险/)).toBeNull()
    expect(screen.queryByRole('button', { name: /导出 md/ })).toBeNull()
  })

  it('4. 导出 md 成功后显示主进程回的文件路径', async () => {
    const api = installApi()
    render(<ServerProbeCard sessionId="sess-1" host="10.0.0.8" />)

    fireEvent.click(screen.getByRole('button', { name: /开始体检/ }))
    await screen.findByText(/共 1 条风险/)
    fireEvent.click(screen.getByRole('button', { name: /导出 md/ }))

    await screen.findByText(/C:\/reports\/probe\.md/)
    // 渲染层不再自己拼路径：交给主进程的是 host，落点由它定
    expect(api.profilerExportMd).toHaveBeenCalledWith(expect.any(String), '10.0.0.8')
  })

  it('5. 导出失败说原因，不假装写过文件', async () => {
    installApi({
      profilerExportPdf: vi.fn(async () => {
        throw new Error('磁盘写入被拒绝')
      }),
    })
    render(<ServerProbeCard sessionId="sess-1" host="10.0.0.8" />)

    fireEvent.click(screen.getByRole('button', { name: /开始体检/ }))
    await screen.findByText(/共 1 条风险/)
    fireEvent.click(screen.getByRole('button', { name: /导出 PDF/ }))

    expect(await screen.findByText(/磁盘写入被拒绝/)).toBeTruthy()
    expect(screen.queryByText(/已导出/)).toBeNull()
  })

  it('6. 会话有了但主机名还没读到，说在读主机名而不是"没连上"', () => {
    installApi()
    render(<ServerProbeCard sessionId="sess-1" host={null} />)

    expect(screen.getByText(/正在读取这台机器的主机名/)).toBeTruthy()
    expect(screen.queryByText(/没连上服务器/)).toBeNull()
    const run = screen.getByRole('button', { name: /开始体检/ }) as HTMLButtonElement
    expect(run.disabled, '主机名没读到就能点，主进程只会回一句 host 无效').toBe(true)
  })
})
