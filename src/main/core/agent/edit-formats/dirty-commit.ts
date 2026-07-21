/**
 * Dirty Commit 前置检查（v0.9.4 批次 3 - 任务 3）
 *
 * 借鉴 Aider 的 dirty commit 前置策略（base_coder.py:2175-2189, 2411-2419）：
 * 执行 edit 前要求用户先 commit 当前未提交的改动，
 * 这样 /undo 才能精确回滚到 edit 前的稳定状态。
 *
 * 设计要点：
 * - 本模块只做"检查"，不做"提交"：用户决策是手动 commit
 * - 通过 child_process.spawn 调用 git status --porcelain
 * - 超时 5 秒，避免阻塞主进程
 * - 非 git 仓库 / git 未安装 → 跳过检查（allowEdit=true）
 *
 * 方案书依据：v0.9.4 §11 第 3 类（edit format 多策略）
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\31-源码分析-Aider-终端优先与git沙箱回滚.md §3.4
 */
import { spawn } from 'child_process'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Dirty Commit 检查结果
 */
export interface DirtyCommitCheck {
  /** 是否允许执行 edit（true=clean working tree，可安全执行） */
  allowEdit: boolean
  /** 阻止原因（allowEdit=false 时填充） */
  reason?: string
  /** 未提交文件列表（用于 UI 提示） */
  dirtyFiles: string[]
  /** 建议操作（commit / stash / discard） */
  suggestion?: 'commit' | 'stash' | 'discard'
}

// ============================================================================
// 常量
// ============================================================================

/**
 * git status 命令超时时间（毫秒）
 *
 * 5 秒超时，避免 git 命令卡死阻塞主进程。
 */
export const GIT_STATUS_TIMEOUT_MS = 5000

// ============================================================================
// 主函数
// ============================================================================

/**
 * 检查工作区是否 dirty（Aider 风格：dirty commit 前置）
 *
 * 借鉴 Aider 的策略：执行 edit 前要求用户先 commit 当前未提交的改动，
 * 这样 /undo 才能精确回滚到 edit 前的稳定状态。
 *
 * 实现：
 * - 通过 git status --porcelain 命令获取未提交文件
 * - 解析 --porcelain 输出（前两字符是状态 XY，第三字符起是文件名）
 * - 空输出 → allowEdit=true（工作区干净）
 * - 有未提交文件 → allowEdit=false, suggestion='commit'
 * - 非 git 仓库 / git 未安装 → allowEdit=true, reason='not a git repo, skip dirty check'
 *
 * 注意：本函数不直接执行 git commit，仅暴露检查接口供调用方决策。
 * 实际的 commit/stash/discard 操作由用户在 UI 中手动执行。
 *
 * @param repoPath 仓库根路径
 * @returns 检查结果
 */
export async function checkDirtyCommit(repoPath: string): Promise<DirtyCommitCheck> {
  return new Promise<DirtyCommitCheck>((resolve) => {
    let stdout = ''
    let stderr = ''

    const child = spawn('git', ['status', '--porcelain'], {
      cwd: repoPath,
      windowsHide: true,
    })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({
        allowEdit: true,
        reason: 'git status timed out, skip dirty check',
        dirtyFiles: [],
      })
    }, GIT_STATUS_TIMEOUT_MS)

    child.stdout.on('data', (data: Buffer | string) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data: Buffer | string) => {
      stderr += data.toString()
    })

    child.on('error', (_err) => {
      // git 命令执行失败（git 未安装或路径错误）
      clearTimeout(timer)
      resolve({
        allowEdit: true,
        reason: 'git not available, skip dirty check',
        dirtyFiles: [],
      })
    })

    child.on('close', (code: number | null) => {
      clearTimeout(timer)

      // 非 git 仓库（exit code 128）或 git 命令失败
      if (code !== 0) {
        const isNotGitRepo =
          stderr.includes('not a git repository') ||
          stderr.includes('fatal: not a git')
        resolve({
          allowEdit: true,
          reason: isNotGitRepo
            ? 'not a git repo, skip dirty check'
            : `git status failed (exit ${code}), skip dirty check`,
          dirtyFiles: [],
        })
        return
      }

      // 解析 --porcelain 输出
      const dirtyFiles = parsePorcelainOutput(stdout)

      if (dirtyFiles.length === 0) {
        // 工作区干净，允许执行 edit
        resolve({
          allowEdit: true,
          dirtyFiles: [],
        })
      } else {
        // 有未提交文件，建议先 commit
        resolve({
          allowEdit: false,
          reason: `working tree is dirty: ${dirtyFiles.length} uncommitted file(s)`,
          dirtyFiles,
          suggestion: 'commit',
        })
      }
    })
  })
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 解析 git status --porcelain 输出
 *
 * --porcelain 格式：每行前两字符是状态码 XY，第三字符是空格，之后是文件名。
 * - X：索引状态（staged）
 * - Y：工作区状态（unstaged）
 *
 * 常见状态码：
 * - '  ' (两个空格)：未修改（不会出现在 --porcelain 输出中）
 * - ' M'：工作区已修改，未 staged
 * - 'M '：已 staged
 * - 'MM'：staged 后又修改
 * - '??'：未跟踪文件
 * - 'A '：新增已 staged
 * - 'D '：删除已 staged
 * - 'R '：重命名已 staged
 *
 * 注意：
 * - 文件名含特殊字符时 git 会用引号包裹（如 "file with space.txt"）
 * - 重命名（R）状态会有两列文件名（src -> dst），本实现简化处理取第二列
 *
 * @param output git status --porcelain 的完整输出
 * @returns 未提交文件路径列表（相对于仓库根）
 */
export function parsePorcelainOutput(output: string): string[] {
  const files: string[] = []
  const lines = output.split('\n')

  for (const line of lines) {
    if (!line) continue
    // 至少需要 3 个字符（XY + space + filename）
    if (line.length < 3) continue

    // XY 状态码在前两字符，第三字符是空格
    const status = line.slice(0, 2)
    let filePath = line.slice(3)

    // 处理重命名：R  src -> dst，取 dst
    if (status.startsWith('R') && filePath.includes(' -> ')) {
      filePath = filePath.split(' -> ')[1]
    }

    // 去除引号包裹（git 对含特殊字符的文件名会加引号）
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1)
    }

    files.push(filePath)
  }

  return files
}

/**
 * 同步检查（用于不能 await 的场景，仅做路径存在性检查）
 *
 * 注意：本函数仅做轻量检查，不调用 git 命令。
 * 完整的 dirty 检查请用 checkDirtyCommit()。
 *
 * @param dirtyFiles 已知未提交文件列表
 * @returns 是否允许执行 edit
 */
export function isClean(dirtyFiles: string[]): boolean {
  return dirtyFiles.length === 0
}
