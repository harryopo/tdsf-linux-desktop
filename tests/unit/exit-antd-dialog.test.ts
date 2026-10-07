/**
 * 退出 antd 第 2 批：对话框不许再回 antd Modal
 *
 * 无表单的弹窗已全部换成自研 Dialog（radix 包一层），
 * 还带 Form 的三个留在白名单里，等表单原语就绪再换。
 * 这里钉住的是"别悄悄退回去"：
 *   1. 已转换的文件不再从 antd 导入任何东西
 *   2. 还在用 <Modal 的文件必须恰好等于白名单（转换后要从白名单删掉）
 *   3. antd Modal 专有 props 与手写 ant- 类名不再出现
 *   4. 安全弹窗（主机密钥确认）保持不可关闭；沙箱审批弹窗关闭等同拒绝
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 相对仓库根、统一正斜杠的渲染层源码清单 */
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) walk(p, acc)
    else if (/\.tsx$/.test(e.name)) acc.push(p)
  }
  return acc
}

const files = walk('src/renderer/src')

/** 还从 antd 导入的文件：props/类名两项检查对它们暂不适用（等它们退出 antd 自动纳入） */
const antdFree = () => files.filter((rel) => !/from 'antd'/.test(read(rel)))

/** 已完成迁移的文件：这些文件里再出现 antd 就是回流 */
const MIGRATED = [
  'src/renderer/src/ui/overlay.tsx',
  'src/renderer/src/components/workbench/ChmodDialog.tsx',
  'src/renderer/src/components/workbench/RenameDialog.tsx',
  'src/renderer/src/components/ssh/HostKeyPromptDialog.tsx',
  'src/renderer/src/pages/DecisionPage.tsx',
  'src/renderer/src/pages/DecisionDetailPage.tsx',
  'src/renderer/src/pages/TutorialDetailPage.tsx',
  'src/renderer/src/pages/WorkbenchPage.tsx',
  'src/renderer/src/components/ErrorBoundary.tsx',
  'src/renderer/src/components/workbench/FileChangeNotice.tsx',
  'src/renderer/src/components/logs/v1/LogToolbar.tsx',
  'src/renderer/src/components/tutorial/CourseList.tsx',
  'src/renderer/src/pages/DecisionSettings.tsx',
  'src/renderer/src/components/monitor/AlertDrawer.tsx',
  'src/renderer/src/components/logs/AiLogAnalysisPanel.tsx',
  'src/renderer/src/components/layout/ConnectDialog.tsx',
  'src/renderer/src/pages/SshSettings.tsx',
  'src/renderer/src/main.tsx',
  'src/renderer/src/components/workbench/EditorArea.tsx',
]

/** 仍带 antd Form 的弹窗：2026-10-07 全部换完，这张表清空，再出现就是引回旧依赖 */
const PENDING_FORM: string[] = []

/** 还 import antd 的渲染层文件数闸门：2026-10-07 第 7 批后实测 0，只许是 0 */
const CAP_ANTD_FILES = 0

describe('对话框已统一到自研 Dialog', () => {
  it('扫到了源码文件（不是空跑）', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('已迁移的文件不再从 antd 导入任何东西', () => {
    const hits = MIGRATED.filter((rel) => /from 'antd'/.test(read(rel)))
    expect(hits, `这些文件又引回 antd 了：\n${hits.join('\n')}`).toEqual([])
  })

  it('还在用 <Modal 的文件恰好是待办白名单', () => {
    const hits = files.filter((rel) => /<Modal[\s>]/.test(read(rel))).sort()
    expect(hits, `与白名单不一致（转换完请把文件从 PENDING_FORM 删掉）`).toEqual(
      [...PENDING_FORM].sort()
    )
  })

  it('还依赖 antd 的文件数不超过闸门值', () => {
    const users = files.filter((rel) => /from 'antd'/.test(read(rel)))
    // 每退出一批就把这个数字降下来；只许减不许加
    expect(
      users.length,
      `依赖 antd 的渲染层文件从 ${CAP_ANTD_FILES} 涨到 ${users.length}：\n${users.join('\n')}`
    ).toBeLessThanOrEqual(CAP_ANTD_FILES)
  })

  it('@ant-design/icons 也不再被渲染层引用', () => {
    const users = files.filter((rel) => /@ant-design\/icons/.test(read(rel)))
    expect(users, `图标已统一用 lucide，这些文件又引回 antd 图标：\n${users.join('\n')}`).toEqual([])
  })

  it('脱离 antd 的文件不会残留 antd 专有 props', () => {    const ANTD_PROPS = /maskClosable|okButtonProps|cancelButtonProps|destroyOnClose|confirmLoading|keyboard=\{false\}/g
    const hits = antdFree()
      .map((rel) => ({ rel, n: (read(rel).match(ANTD_PROPS) ?? []).length }))
      .filter((x) => x.n > 0)
      .map((x) => `${x.rel}×${x.n}`)
    expect(antdFree().length, '扫描集为空，说明检查失效').toBeGreaterThan(60)
    expect(hits, `不用 antd 却留着 antd props：\n${hits.join('\n')}`).toEqual([])
  })

  it('不再手写 ant- 类名借 antd 的样式', () => {
    const hits = antdFree()
      .map((rel) => ({ rel, n: (read(rel).match(/"\s*ant-[a-z]/g) ?? []).length }))
      .filter((x) => x.n > 0)
      .map((x) => `${x.rel}×${x.n}`)
    expect(hits, `不用 antd 却借了 antd 的类名：\n${hits.join('\n')}`).toEqual([])
  })

  it('主机密钥确认不可关闭，且不依赖 @ant-design/icons', () => {
    const src = read('src/renderer/src/components/ssh/HostKeyPromptDialog.tsx')
    expect(src).toMatch(/dismissible=\{false\}/)
    expect(src).not.toMatch('@ant-design/icons')
  })

  it('沙箱审批弹窗关闭等同拒绝（fail-closed）', () => {
    const src = read('src/renderer/src/pages/TutorialDetailPage.tsx')
    expect(src).toMatch(/onOpenChange=\{[^}]*!next && void handleApprove\(false\)/)
  })

  it('Esc 与遮罩是两个独立开关', () => {
    const src = read('src/renderer/src/ui/overlay.tsx')
    const escapeHandler = src.match(/const blockEscape[\s\S]*?\n\s*}/)?.[0] ?? ''
    const outsideHandler = src.match(/const blockOutside[\s\S]*?\n\s*}/)?.[0] ?? ''
    expect(escapeHandler).toMatch(/!dismissible/)
    expect(escapeHandler).not.toMatch(/closeOnOverlayClick/)
    expect(outsideHandler).toMatch(/!dismissible \|\| !closeOnOverlayClick/)
  })
})
