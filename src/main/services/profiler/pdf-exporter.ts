/**
 * PDF 导出器（PdfExporter）
 *
 * 将 Markdown 报告导出为 PDF 文件。
 *
 * 实现方案（**零外部依赖**，仅依赖 Electron 内置能力）：
 *   1. 自实现一个最小的 md → html 转换器（仅支持报告用到的语法）
 *   2. 在主进程中创建一个隐藏 BrowserWindow，加载内联 HTML
 *   3. 等待页面渲染完成后调用 webContents.printToPDF()
 *   4. 把 PDF Buffer 写入用户指定的文件路径
 *   5. 关闭隐藏窗口
 *
 * 为什么不用 markdown-pdf / md-to-pdf？
 *   - markdown-pdf 依赖 phantomjs（已废弃，2018 年停止维护）
 *   - md-to-pdf 引入 puppeteer（增加 ~150MB 安装体积）
 *   - Electron 自身已带 Chromium，printToPDF 是最轻量方案
 *
 * 为什么不直接让用户在浏览器里"打印为 PDF"？
 *   - 用户明确要求"一键导出"，需要在软件内闭环
 *   - 软件内闭环可保证样式与报告 md 一致
 */

import { BrowserWindow } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// ==================================================================
// 最小 Markdown → HTML 转换器
// ==================================================================

/**
 * 转义 HTML 特殊字符
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 解析行内元素（粗体、代码、链接）
 * 注意：必须按特定顺序处理（先粗体，后代码，避免冲突）
 */
function parseInline(text: string): string {
  let out = escapeHtml(text)
  // 行内代码 `code`（优先处理，避免内部被其他规则影响）
  out = out.replace(/`([^`\n]+?)`/g, '<code>$1</code>')
  // 粗体 **text**
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
  // 斜体 *text*（避免与粗体冲突：用 \b 包围）
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
  // 链接 [text](url)
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank">$1</a>'
  )
  return out
}

/**
 * 表格行解析为表头/单元格数组
 */
function parseTableRow(line: string): string[] {
  // 去掉首尾 |，按 | 分割
  const trimmed = line.trim().replace(/^\||\|$/g, '')
  return trimmed.split('|').map((c) => c.trim())
}

/**
 * 判断是否为表格分隔行 |---|---|---|
 */
function isTableSeparator(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false
  const cells = parseTableRow(trimmed)
  return cells.every((c) => /^:?-+:?$/.test(c))
}

/**
 * 主转换函数：Markdown → HTML
 *
 * 支持的语法：
 *   # ## ###        标题
 *   ```             代码块（围栏）
 *   ---             分隔线
 *   >               引用
 *   -               无序列表
 *   1.              有序列表
 *   | col | col |   表格（需含 |---| 分隔行）
 *   **粗体** / *斜体* / `代码` / [链接](url)
 */
export function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/)
  const html: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 代码块（围栏）
    if (line.startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // 跳过结束的 ```
      html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    // 分隔线
    if (/^---+\s*$/.test(line)) {
      html.push('<hr>')
      i++
      continue
    }

    // 标题
    const h3Match = line.match(/^###\s+(.*)$/)
    if (h3Match) {
      html.push(`<h3>${parseInline(h3Match[1])}</h3>`)
      i++
      continue
    }
    const h2Match = line.match(/^##\s+(.*)$/)
    if (h2Match) {
      html.push(`<h2>${parseInline(h2Match[1])}</h2>`)
      i++
      continue
    }
    const h1Match = line.match(/^#\s+(.*)$/)
    if (h1Match) {
      html.push(`<h1>${parseInline(h1Match[1])}</h1>`)
      i++
      continue
    }

    // 表格（要求下一行是 |---|---|）
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headerCells = parseTableRow(line)
      const bodyRows: string[][] = []
      i += 2 // 跳过分隔行
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        bodyRows.push(parseTableRow(lines[i]))
        i++
      }
      const thead = `<thead><tr>${headerCells.map((c) => `<th>${parseInline(c)}</th>`).join('')}</tr></thead>`
      const tbody = `<tbody>${bodyRows
        .map(
          (row) =>
            `<tr>${row.map((c) => `<td>${parseInline(c)}</td>`).join('')}</tr>`
        )
        .join('')}</tbody>`
      html.push(`<table>${thead}${tbody}</table>`)
      continue
    }

    // 引用（可连续多行）
    if (line.startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      html.push(`<blockquote>${parseInline(quoteLines.join('<br>'))}</blockquote>`)
      continue
    }

    // 无序列表
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        const text = lines[i].replace(/^[-*]\s+/, '')
        items.push(`<li>${parseInline(text)}</li>`)
        i++
      }
      html.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    // 有序列表
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\d+\.\s+/, '')
        items.push(`<li>${parseInline(text)}</li>`)
        i++
      }
      html.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    // 空行
    if (line.trim() === '') {
      i++
      continue
    }

    // 普通段落（合并连续非空行）
    const paragraphLines: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('>') &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i])
    ) {
      paragraphLines.push(lines[i])
      i++
    }
    html.push(`<p>${parseInline(paragraphLines.join(' '))}</p>`)
  }

  return html.join('\n')
}

// ==================================================================
// 报告专用 HTML 模板
// ==================================================================

/**
 * 报告专用 CSS 样式（参考方案书 v8.0 板块 A.4 排版规范）
 *
 * 排版要点：
 *   - 字号 11pt / 行高 1.6（适合 A4 打印）
 *   - 标题层级清晰，配色专业（蓝/灰）
 *   - 代码块等宽字体 + 浅灰背景
 *   - 表格边框 + 斑马纹
 *   - 引用块左侧蓝色边
 *   - 风险高亮块用浅黄底
 */
const REPORT_CSS = `
* { box-sizing: border-box; }

body {
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif;
  font-size: 11pt;
  line-height: 1.6;
  color: #2c3e50;
  max-width: 100%;
  margin: 0;
  padding: 24px 32px;
  background: #fff;
}

h1 {
  font-size: 22pt;
  font-weight: 700;
  color: #1a1a1a;
  border-bottom: 3px solid #2c7be5;
  padding-bottom: 12px;
  margin: 24px 0 16px;
}

h2 {
  font-size: 16pt;
  font-weight: 600;
  color: #2c7be5;
  border-left: 4px solid #2c7be5;
  padding-left: 12px;
  margin: 28px 0 14px;
}

h3 {
  font-size: 13pt;
  font-weight: 600;
  color: #34495e;
  margin: 18px 0 10px;
}

p {
  margin: 8px 0;
  text-align: justify;
}

code {
  font-family: "JetBrains Mono", "Cascadia Code", "Consolas", "Courier New", monospace;
  font-size: 10pt;
  background: #f1f3f5;
  padding: 2px 6px;
  border-radius: 3px;
  color: #c7254e;
}

pre {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 4px;
  padding: 12px 14px;
  overflow-x: auto;
  margin: 10px 0;
  page-break-inside: avoid;
}

pre code {
  background: transparent;
  padding: 0;
  color: #2c3e50;
  font-size: 9.5pt;
  line-height: 1.5;
}

table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
  font-size: 10pt;
  page-break-inside: avoid;
}

th, td {
  border: 1px solid #dee2e6;
  padding: 8px 12px;
  text-align: left;
  vertical-align: top;
}

th {
  background: #f1f3f5;
  font-weight: 600;
  color: #495057;
}

tbody tr:nth-child(even) {
  background: #fafbfc;
}

blockquote {
  border-left: 4px solid #2c7be5;
  background: #e7f1ff;
  padding: 10px 16px;
  margin: 12px 0;
  color: #2c3e50;
  border-radius: 0 4px 4px 0;
}

ul, ol {
  padding-left: 24px;
  margin: 8px 0;
}

li {
  margin: 4px 0;
}

hr {
  border: 0;
  border-top: 1px solid #dee2e6;
  margin: 24px 0;
}

a {
  color: #2c7be5;
  text-decoration: none;
}

strong {
  font-weight: 600;
  color: #1a1a1a;
}

/* 风险等级颜色辅助类（供 inline 元素） */
.risk-critical { color: #d63031; font-weight: 600; }
.risk-high     { color: #e17055; font-weight: 600; }
.risk-medium   { color: #fdcb6e; font-weight: 600; }
.risk-low      { color: #00b894; font-weight: 600; }
.risk-info     { color: #74b9ff; font-weight: 600; }

/* 打印优化 */
@media print {
  body { padding: 0; }
  h1, h2 { page-break-after: avoid; }
  pre, table, blockquote { page-break-inside: avoid; }
}
`

/**
 * 生成 PDF 报告完整 HTML（含 <html> <head> <body>）
 */
function buildReportHtml(md: string): string {
  const body = markdownToHtml(md)
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>系统架构感知报告</title>
  <style>${REPORT_CSS}</style>
</head>
<body>${body}</body>
</html>`
}

// ==================================================================
// PDF 导出（基于 Electron BrowserWindow.printToPDF）
// ==================================================================

/** 默认纸张：A4 */
const DEFAULT_PAGE_SIZE = 'A4' as const

/**
 * 将 Markdown 字符串渲染为 PDF Buffer
 *
 * @param md Markdown 文本（通常来自 markdown-renderer）
 * @returns Promise<Buffer> PDF 文件二进制内容
 */
export async function markdownToPdfBuffer(md: string): Promise<Buffer> {
  if (!md || md.trim() === '') {
    throw new Error('Markdown 内容为空，无法生成 PDF')
  }

  const html = buildReportHtml(md)
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      offscreen: false,
      sandbox: true,
      contextIsolation: true
    }
  })

  try {
    // 用 data URL 加载 HTML（避免写临时文件）
    const dataUrl = 'data:text/html;charset=UTF-8,' + encodeURIComponent(html)
    await win.loadURL(dataUrl)

    // 等待 DOM 渲染（loadURL 完成后已基本就绪）
    // 给浏览器一帧时间排版，避免 printToPDF 拿到未布局的 DOM
    await new Promise((resolve) => setTimeout(resolve, 200))

    const pdfBuffer = await win.webContents.printToPDF({
      pageSize: DEFAULT_PAGE_SIZE,
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
    })

    return pdfBuffer
  } finally {
    // 无论成功失败都关闭窗口
    if (!win.isDestroyed()) {
      win.destroy()
    }
  }
}

/**
 * 将 Markdown 字符串导出为 PDF 文件
 *
 * @param md Markdown 文本
 * @param outputPath 输出 PDF 文件绝对路径
 * @returns Promise<{ filePath: string; size: number }> 写入结果
 */
export async function exportMarkdownToPdf(
  md: string,
  outputPath: string
): Promise<{ filePath: string; size: number }> {
  const buffer = await markdownToPdfBuffer(md)

  // 确保目录存在
  const dir = path.dirname(outputPath)
  await fs.mkdir(dir, { recursive: true })

  await fs.writeFile(outputPath, buffer)
  return {
    filePath: outputPath,
    size: buffer.length
  }
}

/**
 * 将 Markdown 字符串写入文件
 *
 * @param md Markdown 文本
 * @param outputPath 目标文件绝对路径
 * @returns 写入结果（filePath / size）
 */
export async function writeMdFile(
  md: string,
  outputPath: string
): Promise<{ filePath: string; size: number }> {
  if (!md || md.trim() === '') {
    throw new Error('Markdown 内容为空，无法写入')
  }
  // 确保 BOM 以让 Windows 记事本正确识别 UTF-8（可选）
  const content = md.startsWith('\uFEFF') ? md : '\uFEFF' + md
  const dir = path.dirname(outputPath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(outputPath, content, 'utf8')
  // 计算字节数（BOM + 内容）
  const size = Buffer.byteLength(content, 'utf8')
  return { filePath: outputPath, size }
}

/**
 * 根据主机名 + 时间戳生成默认 PDF 文件名
 *
 * 形如：system-report-192.168.45.200-20260716-133000.pdf
 */
export function defaultPdfFileName(host: string, timestamp: number = Date.now()): string {
  const d = new Date(timestamp)
  const pad = (n: number) => n.toString().padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  // 主机名中的非法文件名字符替换为 _
  const safeHost = host.replace(/[\\/:*?"<>|]/g, '_')
  return `system-report-${safeHost}-${stamp}.pdf`
}

/** 导出供测试使用（无 Electron 依赖的部分） */
export const _internal = {
  escapeHtml,
  parseInline,
  parseTableRow,
  isTableSeparator,
  markdownToHtml,
  buildReportHtml,
  REPORT_CSS,
  defaultPdfFileName
}
