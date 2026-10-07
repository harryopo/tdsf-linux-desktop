// @vitest-environment jsdom
/**
 * AI 日志分析抽屉（Sheet 版）
 *
 * 2026-10-07 从 antd Drawer 换成自研 Sheet，这条测试锁的是换完仍然成立的降级口径：
 * 条件不够时不许能点、IPC 不在时说清为什么、sidecar 失败时给原因和重试、
 * 成功时严重度显示中文而不是把 critical 直接甩给用户。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AiLogAnalysisPanel } from '@/components/logs/AiLogAnalysisPanel'
import { TooltipProvider } from '@/ui'
import type { LogEntry } from '@/components/logs/v1/logs-data'

function logs(n: number): LogEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    timestamp: '10:00:00.000',
    level: 'INFO' as const,
    source: 'collector',
    message: `line ${i}`,
  }))
}

function setElectron(api: Record<string, unknown>) {
  ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = api
}

function draw(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
})

describe('AiLogAnalysisPanel', () => {
  it('日志不足 5 条时说清数量，并且不许点', () => {
    setElectron({ sidecarPipeline: vi.fn() })
    draw(<AiLogAnalysisPanel open logs={logs(3)} onClose={() => {}} />)
    expect(screen.getByText(/当前日志 3 条，至少需要 5 条/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /开始分析/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('不在 Electron 环境时说明为什么不能用，而不是转圈失败', () => {
    draw(<AiLogAnalysisPanel open logs={logs(8)} onClose={() => {}} />)
    expect(screen.getByText('主进程 IPC 不可用')).toBeTruthy()
    expect((screen.getByRole('button', { name: /开始分析/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('sidecar 失败时给原因和重试按钮', async () => {
    setElectron({
      sidecarStatus: vi.fn().mockResolvedValue({ status: 'ready' }),
      sidecarPipeline: vi.fn().mockResolvedValue({ ok: false, error: 'spawn ENOENT' }),
    })
    draw(<AiLogAnalysisPanel open logs={logs(8)} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /开始分析/ }))
    await waitFor(() => expect(screen.getByText('分析失败')).toBeTruthy())
    // ENOENT 要翻成可操作的指引，不能把底层报错原样丢给初学者
    expect(screen.getByText(/Python 分析引擎/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('分析成功时严重度显示中文标签', async () => {
    setElectron({
      sidecarStatus: vi.fn().mockResolvedValue({ status: 'ready' }),
      sidecarPipeline: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          parse: { templates: [{ template_id: 't1', template: 'connection <ID> closed', count: 7, examples: ['connection 1 closed'] }], total_lines: 42, unique_templates: 3 },
          diagnose: {
            root_cause: '数据库连接池耗尽',
            confidence: 0.82,
            severity: 'high',
            recommendations: ['调大连接池'],
            reasoning: ['出现大量 connection closed'],
            source: 'rule-based',
            related_risks: ['可能引发请求排队'],
          },
        },
      }),
    })
    draw(<AiLogAnalysisPanel open logs={logs(8)} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /开始分析/ }))
    await waitFor(() => expect(screen.getByText('数据库连接池耗尽')).toBeTruthy())
    expect(screen.getByText('严重度 高')).toBeTruthy()
    expect(screen.getByText('纯规则')).toBeTruthy()
    expect(screen.getByText('置信度 82%')).toBeTruthy()
    expect(screen.getByText('调大连接池')).toBeTruthy()
    expect(screen.getByText('可能引发请求排队')).toBeTruthy()
    expect(screen.queryByText(/critical|high|medium|low/)).toBeNull()
  })
})
