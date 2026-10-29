/**
 * 禁止把编出来的数字显示给用户
 *
 * 这个产品对外承诺"可信决策"，界面上出现一条来历不明的记录，
 * 用户就没法再相信其它记录是真的。所以凡是本轮清掉的假数据，
 * 都在这里留一条断言，防止以后又被塞回来。
 *
 * 判据是"源码里不许出现这些字面量"，不是"运行时看起来正常"——
 * 假数据一旦进 JSX，运行时也是"看起来正常"。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const RENDERER = path.join(ROOT, 'src/renderer/src')

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p)
  }
  return acc
}

const files = walk(RENDERER)

/** 剥掉注释，只看真正会执行的代码（清理记录里会提到被删的字面量，那是处置说明不是回流） */
function code(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 曾经真实出现在界面上的编造值：主机名、统计数、延迟、错误数、示例知识条目、示例课程数 */
const BANNED = [
  'prod-web-01', 'prod-db-02', 'backup-01', 'staging-web', '94.3%', 'P99 180ms', 'MOCK_CHAT_MESSAGES',
  // 阶段 F4 清掉的设计稿示例：知识详情页那篇 Nginx 假文章、知识库页的假热门/假贡献统计、教程页的假课程数
  'KB-NGINX-014', 'KB-NGINX-021', 'KB-MYSQL-007', 'KB-SYS-005', '运维团队', 'P99延迟优化实战',
  '1,247 条', '3.2k', 'worker_connections 调优指南',
]

describe('渲染层不许出现编造数据', () => {
  it('扫到了页面文件（不是空跑）', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('历史决策页不再自带示例记录', () => {
    const src = fs.readFileSync(path.join(RENDERER, 'pages/HistoryPage.tsx'), 'utf8')
    expect(src).not.toMatch(/DEFAULT_RECORDS|DEFAULT_STATS/)
    // 统计卡必须由 IPC 或当前记录派生，不许写基线值
    expect(src).not.toMatch(/value:\s*'247'/)
  })

  it('状态栏不写死错误数与延迟', () => {
    const src = fs.readFileSync(path.join(RENDERER, 'components/workbench/StatusBar.tsx'), 'utf8')
    expect(src).not.toContain('0 Errors')
    expect(src).not.toContain('P99 180ms')
  })

  it('全渲染层没有那批假主机名与假统计值', () => {
    const hits: string[] = []
    for (const f of files) {
      // 只看代码：本轮清掉假数据时，注释里会提到被删的值（"移除原硬编码的 94.3%"），
      // 那是记录处置过程，不是回流
      const text = code(f)
      for (const bad of BANNED) {
        if (text.includes(bad)) hits.push(`${path.relative(ROOT, f).replace(/\\/g, '/')} → ${bad}`)
      }
    }
    expect(hits, `疑似编造数据回流：\n${hits.join('\n')}`).toEqual([])
  })

  it('阶段 F4：设计稿示例数据模块与示例兜底常量已不存在', () => {
    // 知识详情页的示例文章（目录/诊断步骤/元信息/关联知识/FIX 命令块）
    expect(fs.existsSync(path.join(RENDERER, 'components/knowledge-detail/v1/detail-data.ts'))).toBe(false)
    const detail = code(path.join(RENDERER, 'pages/KnowledgeDetailPage.tsx'))
    expect(detail).not.toMatch(/\buseReal\b/)
    expect(detail).not.toMatch(/DIAGNOSE_STEPS|FIX_BEFORE|FIX_AFTER|VERIFY_CMD/)
    // 教程页不许再用示例课程/示例统计顶位
    const tutorial = code(path.join(RENDERER, 'pages/TutorialPage.tsx'))
    expect(tutorial).not.toMatch(/DEFAULT_COURSES|FEATURED_COURSES|LEARNING_PATHS|DEFAULT_STATS/)
    expect(tutorial).not.toContain('已使用本地示例数据')
    // 知识库页同理
    const kb = code(path.join(RENDERER, 'pages/KnowledgePage.tsx'))
    expect(kb).not.toMatch(/KNOWLEDGE_ITEMS|HOT_ITEMS|RECENT_ITEMS|CONTRIBUTION_STATS/)
    // 示例数据源头模块里也不许再导出这些常量
    const tutorialTypes = code(path.join(RENDERER, 'components/tutorial/types.ts'))
    expect(tutorialTypes).not.toMatch(/export const (DEFAULT_STATS|DEFAULT_COURSES|FEATURED_COURSES|LEARNING_PATHS)/)
    // 系统日志页：设计稿那 15 条假日志（含假拦截、假置信度、假 P99）与状态栏假计数已删
    const logs = code(path.join(RENDERER, 'pages/LogsPage.tsx'))
    expect(logs).not.toMatch(/LOG_ENTRIES|TOTAL_LOG_COUNT|LATEST_TIMESTAMP/)
    const logsData = code(path.join(RENDERER, 'components/logs/v1/logs-data.ts'))
    expect(logsData).not.toMatch(/export const (LOG_ENTRIES|TOTAL_LOG_COUNT|LATEST_TIMESTAMP)/)
  })

  it('#268 后续：反馈票没了，successRate 这个出厂常量不许再演成实测读数', () => {
    // 知识条目上那个 successRate 现在没有任何写入方（种子是常量、手填是 0）。
    // 界面上"成功率 X%／知识置信度／已验证"三类读数都是从这个常量派出来的样子货。
    for (const rel of [
      'pages/KnowledgePage.tsx',
      'pages/KnowledgeDetailPage.tsx',
      'components/knowledge-detail/v1/KnowledgeDetailSidebar.tsx',
    ]) {
      const text = code(path.join(RENDERER, rel))
      expect(text, `${rel} 又把没有生产者的 successRate 演成实测读数`).not.toMatch(
        /成功率|知识置信度|综合置信度评分|已验证/,
      )
    }
    // 侧栏那个"喂一个百分比就画环"的口子一起封掉
    const sidebar = code(path.join(RENDERER, 'components/knowledge-detail/v1/KnowledgeDetailSidebar.tsx'))
    expect(sidebar).not.toMatch(/confidencePct/)
    // 主进程给模型看的 kb_search 摘要同理——模型只会把这句原样复述给用户
    const supervisor = code(path.join(ROOT, 'src/main/core/agent/supervisor.ts'))
    expect(supervisor).not.toMatch(/成功率 \$\{/)
  })
})
