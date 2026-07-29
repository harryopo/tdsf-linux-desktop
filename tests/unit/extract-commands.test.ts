/**
 * extractCommands 单测（v2.11 新增）
 *
 * 回归重点：AI 用 `>` 作提示符输出 shell 代码块时，此前会：
 *  - 把 "> free -h" 带着提示符原样当命令
 *  - 把单独的 ">" 行当成“空命令”条目（截图 4 条里 2 条空的根因）
 * 修复后：剥离 `>`/`$` 提示符、跳过纯提示符行、命令必须含字母数字。
 */
import { describe, it, expect } from 'vitest'
import { extractCommands } from '@/components/workbench/panels/LiveMessageRow'

/** 构造带语言标记的围栏代码块 */
function fence(lang: string, body: string): string {
  return '```' + lang + '\n' + body + '\n```'
}

describe('extractCommands', () => {
  it('剥离 > 提示符并过滤单独 > 行（截图 4→2 条根因）', () => {
    const md = fence('bash', ['> free -h', '>', '> ps aux --sort=-%mem | head -10', '>'].join('\n'))
    expect(extractCommands(md)).toEqual(['free -h', 'ps aux --sort=-%mem | head -10'])
  })

  it('剥离 $ 提示符', () => {
    const md = fence('bash', ['$ whoami', '$ pwd'].join('\n'))
    expect(extractCommands(md)).toEqual(['whoami', 'pwd'])
  })

  it('过滤纯符号行与空行（不产生空命令条目）', () => {
    const md = fence('sh', ['ls -la', '', '   ', '|', '$', 'df -h'].join('\n'))
    const out = extractCommands(md)
    expect(out).toEqual(['ls -la', 'df -h'])
    expect(out.some((c) => c.trim() === '')).toBe(false)
  })

  it('跳过注释行，保留真实命令', () => {
    const md = fence('bash', ['# 查看内存', 'free -h', '# 结束'].join('\n'))
    expect(extractCommands(md)).toEqual(['free -h'])
  })

  it('非 shell 语系代码块不提取（html/text/yaml）', () => {
    expect(extractCommands(fence('html', '<div>free -h</div>'))).toEqual([])
    expect(extractCommands(fence('text', 'free -h'))).toEqual([])
    expect(extractCommands(fence('yaml', 'key: value'))).toEqual([])
  })

  it('无代码块的纯文本不提取', () => {
    expect(extractCommands('请执行 free -h 查看内存')).toEqual([])
  })

  it('中文说明行与流程图字符被过滤', () => {
    const md = fence('bash', ['首先执行下面命令', 'systemctl status nginx', '▶ 分支'].join('\n'))
    expect(extractCommands(md)).toEqual(['systemctl status nginx'])
  })

  it('heredoc 多行命令合并为一条', () => {
    const body = ["cat > /tmp/a.conf << 'EOF'", 'server {', '  listen 80;', '}', 'EOF'].join('\n')
    const out = extractCommands(fence('bash', body))
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('cat > /tmp/a.conf')
    expect(out[0]).toContain('listen 80;')
  })
})
