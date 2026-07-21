/**
 * overnight-smoke-check.cjs — 静态验收：关键文件与 API 接线是否存在
 * 不启动 Electron，只做交付路径健全性检查
 */
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')

const checks = [
  ['src/renderer/src/pages/SshSettings.tsx', /useServerStore|sshConnect|ConnectDialog/],
  ['src/renderer/src/components/workbench/FileTree.tsx', /sftpList|sftpMkdir|sftpDelete/],
  ['src/renderer/src/components/workbench/EditorArea.tsx', /sftpReadFile|sftpWriteFile|TerminalView/],
  ['src/renderer/src/components/workbench/useAgentChat.ts', /agentChat|activeSessionId/],
  ['src/main/core/agent/supervisor.ts', /ssh_readonly|isStepCount|sshSessionId/],
  ['src/main/ipc/agent-runtime.ts', /sshSessionId/],
  ['src/renderer/src/pages/BootPage.tsx', /ShaderMaterial|进入工作台/],
  ['src/renderer/src/styles/workbench-density.css', /min-height:\s*32px|font-size:\s*13px/],
  ['src/renderer/src/pages/TutorialPage.tsx', /tutorialList|realCourses|暂无教程数据/],
  ['src/renderer/src/pages/TutorialDetailPage.tsx', /tutorialGet|教程未找到|parseTutorial/],
  ['src/renderer/src/pages/KnowledgePage.tsx', /tutorialList|kbExport|realItems/],
]

let failed = 0
console.log('=== Overnight Smoke Check ===')
for (const [rel, re] of checks) {
  const p = path.join(root, rel)
  const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
  let ok = !!text && re.test(text)
  if (ok && rel.includes('TutorialDetailPage')) {
    if (/MOCK_TUTORIAL|MOCK_CHAPTERS|MOCK_PARSED_TUTORIAL/.test(text)) {
      console.log(`✗ ${rel} (still has MOCK_*)`)
      failed++
      continue
    }
  }
  console.log(`${ok ? '✓' : '✗'} ${rel}`)
  if (!ok) failed++
}
console.log(failed ? `\nFAILED ${failed}` : '\nALL PASS')
process.exit(failed ? 1 : 0)
