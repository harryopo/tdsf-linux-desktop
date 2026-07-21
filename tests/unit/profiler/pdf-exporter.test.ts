/**
 * PDF 导出器（PdfExporter）单元测试
 *
 * 覆盖：
 * - 最小 md→html 转换器的各种语法（H1-H3、粗体、行内代码、代码块、表格、引用、列表、分隔线、链接）
 * - HTML 转义（XSS 防护）
 * - defaultPdfFileName 文件名生成
 * - exportMarkdownToPdf 端到端（mock electron BrowserWindow）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 用 vi.hoisted 让 mock 在 import 之前生效
const { mockLoadURL, mockPrintToPDF, mockDestroy, mockIsDestroyed } = vi.hoisted(() => ({
  mockLoadURL: vi.fn(async () => undefined),
  mockPrintToPDF: vi.fn(async () => Buffer.from('PDF-BINARY-CONTENT')),
  mockDestroy: vi.fn(),
  mockIsDestroyed: vi.fn(() => false)
}))

// Mock electron 模块（在 import pdf-exporter 前）
vi.mock('electron', () => {
  return {
    BrowserWindow: class MockBrowserWindow {
      // loadURL 是 BrowserWindow 实例方法（不是 webContents 上的）
      loadURL = mockLoadURL
      webContents = {
        printToPDF: mockPrintToPDF
      }
      destroy = mockDestroy
      isDestroyed = mockIsDestroyed
    }
  }
})

// 现在导入被测模块
import {
  markdownToHtml,
  exportMarkdownToPdf,
  defaultPdfFileName,
  _internal
} from '../../../src/main/services/profiler/pdf-exporter'

// ==================================================================
// 工具函数 / HTML 转换器
// ==================================================================

describe('PdfExporter - 工具函数', () => {
  const { escapeHtml, parseInline, isTableSeparator, defaultPdfFileName: genName } = _internal

  describe('escapeHtml', () => {
    it('转义所有 HTML 特殊字符（XSS 防护）', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      )
      expect(escapeHtml("it's & ok")).toBe('it&#39;s &amp; ok')
    })

    it('空字符串', () => {
      expect(escapeHtml('')).toBe('')
    })
  })

  describe('parseInline', () => {
    it('粗体 **text**', () => {
      expect(parseInline('这是 **粗体** 文本')).toContain('<strong>粗体</strong>')
    })

    it('行内代码 `code`', () => {
      expect(parseInline('运行 `npm install`')).toContain('<code>npm install</code>')
    })

    it('链接 [text](url)', () => {
      expect(parseInline('参考 [官网](https://example.com)')).toContain(
        '<a href="https://example.com" target="_blank">官网</a>'
      )
    })

    it('斜体 *text*', () => {
      expect(parseInline('这是 *斜体* 文本')).toContain('<em>斜体</em>')
    })

    it('粗体内含特殊字符先转义', () => {
      // 特殊字符先被 escapeHtml 处理，再加 <strong> 标签
      expect(parseInline('**<a>危险</a>**')).toContain('<strong>')
    })
  })

  describe('isTableSeparator', () => {
    it('标准分隔行 |---|---|', () => {
      expect(isTableSeparator('|---|---|')).toBe(true)
      expect(isTableSeparator('| --- | --- |')).toBe(true)
    })

    it('对齐分隔行 |:---|---:|', () => {
      expect(isTableSeparator('|:---|---:|')).toBe(true)
    })

    it('非分隔行返回 false', () => {
      expect(isTableSeparator('| a | b |')).toBe(false)
      expect(isTableSeparator('---')).toBe(false)
      expect(isTableSeparator('普通文本')).toBe(false)
    })
  })

  describe('defaultPdfFileName', () => {
    it('生成标准格式 system-report-{host}-{timestamp}.pdf', () => {
      const ts = new Date(2026, 6, 16, 13, 30, 0).getTime()
      const name = genName('192.168.45.200', ts)
      expect(name).toBe('system-report-192.168.45.200-20260716-133000.pdf')
    })

    it('替换主机名中非法文件名字符', () => {
      const name = genName('host:with*bad?chars', new Date(2026, 0, 1).getTime())
      expect(name).not.toMatch(/[\\/:?"<>|]/)
      expect(name).toContain('host_with_bad_chars')
    })

    it('使用当前时间（不传参）', () => {
      const name = genName('server')
      expect(name).toMatch(/^system-report-server-\d{8}-\d{6}\.pdf$/)
    })
  })
})

// ==================================================================
// markdownToHtml 转换
// ==================================================================

describe('PdfExporter - markdownToHtml', () => {
  it('H1/H2/H3 标题', () => {
    const html = markdownToHtml('# 一级\n## 二级\n### 三级')
    expect(html).toContain('<h1>一级</h1>')
    expect(html).toContain('<h2>二级</h2>')
    expect(html).toContain('<h3>三级</h3>')
  })

  it('代码块（围栏）保留换行', () => {
    const html = markdownToHtml('```bash\nls -la\necho hi\n```')
    expect(html).toContain('<pre><code>')
    expect(html).toContain('ls -la')
    expect(html).toContain('echo hi')
  })

  it('分隔线 --- 转 <hr>', () => {
    expect(markdownToHtml('---')).toContain('<hr>')
    expect(markdownToHtml('-----')).toContain('<hr>')
  })

  it('引用 > 转 blockquote', () => {
    const html = markdownToHtml('> 这是提示')
    expect(html).toContain('<blockquote>这是提示</blockquote>')
  })

  it('无序列表', () => {
    const html = markdownToHtml('- 项目1\n- 项目2\n- 项目3')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>项目1</li>')
    expect(html).toContain('<li>项目3</li>')
  })

  it('有序列表', () => {
    const html = markdownToHtml('1. 第一\n2. 第二\n3. 第三')
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>第一</li>')
  })

  it('表格（带分隔行）', () => {
    const md = `| 列1 | 列2 |
| --- | --- |
| a | b |
| c | d |`
    const html = markdownToHtml(md)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>列1</th>')
    expect(html).toContain('<td>a</td>')
    expect(html).toContain('<td>d</td>')
  })

  it('普通段落', () => {
    const html = markdownToHtml('这是一个段落。\n换行后继续。')
    expect(html).toContain('<p>')
  })

  it('行内粗体 + 行内代码 + 链接组合', () => {
    const html = markdownToHtml('**粗体** 和 `代码` 还有 [链接](https://x.com)')
    expect(html).toContain('<strong>粗体</strong>')
    expect(html).toContain('<code>代码</code>')
    expect(html).toContain('<a href="https://x.com"')
  })

  it('XSS 防护：<script> 不会作为 HTML 执行', () => {
    const html = markdownToHtml('# 标题 <script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('空 markdown 不报错', () => {
    expect(markdownToHtml('')).toBe('')
  })

  it('完整报告样例（端到端）', () => {
    const md = `# 系统架构感知报告 — 192.168.45.200

> **目标主机**：192.168.45.200 · **生成时间**：2026-07-16 13:30

## 📊 风险概览

| 等级 | 数量 |
|------|------|
| 🔴 严重 | 1 |
| 🟠 高 | 2 |

### 🚨 磁盘爆满

- **描述**：磁盘已满
- **建议**：清理日志

## 一、系统标识

| 项 | 值 |
|----|----|
| 主机名 | \`server\` |

\`\`\`bash
uname -a
\`\`\`

- 已安装 \`docker\`
- 未安装 \`vim\`
`
    const html = markdownToHtml(md)
    expect(html).toContain('<h1>系统架构感知报告 — 192.168.45.200</h1>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<table>')
    expect(html).toContain('<pre><code>uname -a</code></pre>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<code>server</code>')
  })
})

// ==================================================================
// 端到端：exportMarkdownToPdf（mock electron）
// ==================================================================

describe('PdfExporter - 端到端导出', () => {
  beforeEach(() => {
    mockLoadURL.mockClear()
    mockPrintToPDF.mockClear()
    mockDestroy.mockClear()
    mockIsDestroyed.mockReset()
    mockIsDestroyed.mockReturnValue(false)
  })

  it('正常导出 PDF Buffer', async () => {
    const md = '# Test\n\nHello **world**'
    const buffer = await exportMarkdownToPdf(md, 'C:/tmp/test.pdf')

    // 调用了 BrowserWindow.loadURL
    expect(mockLoadURL).toHaveBeenCalledTimes(1)
    expect(mockLoadURL.mock.calls[0][0]).toMatch(/^data:text\/html/)

    // 调用了 printToPDF
    expect(mockPrintToPDF).toHaveBeenCalledTimes(1)
    const opts = mockPrintToPDF.mock.calls[0][0]
    expect(opts.pageSize).toBe('A4')
    expect(opts.printBackground).toBe(true)

    // 返回值包含文件路径与大小
    expect(buffer.filePath).toBe('C:/tmp/test.pdf')
    expect(buffer.size).toBeGreaterThan(0)

    // 销毁了窗口
    expect(mockDestroy).toHaveBeenCalled()
  })

  it('空 md 抛错', async () => {
    await expect(exportMarkdownToPdf('', 'C:/tmp/test.pdf')).rejects.toThrow(
      /Markdown 内容为空/
    )
  })

  it('空白 md 抛错', async () => {
    await expect(exportMarkdownToPdf('   \n\n  ', 'C:/tmp/test.pdf')).rejects.toThrow(
      /Markdown 内容为空/
    )
  })

  it('即使 BrowserWindow 已销毁仍能清理（finally）', async () => {
    mockIsDestroyed.mockReturnValue(true)  // 假装已销毁
    const buffer = await exportMarkdownToPdf('# ok', 'C:/tmp/test.pdf')
    // destroy 不应被调用（窗口已销毁）
    expect(mockDestroy).not.toHaveBeenCalled()
    expect(buffer.size).toBeGreaterThan(0)
  })

  it('A4 纸张 + 背景打印 + 0.4 英寸边距', async () => {
    await exportMarkdownToPdf('# Test', 'C:/tmp/test.pdf')
    const opts = mockPrintToPDF.mock.calls[0][0]
    expect(opts.pageSize).toBe('A4')
    expect(opts.printBackground).toBe(true)
    expect(opts.margins).toEqual({ top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 })
  })
})
