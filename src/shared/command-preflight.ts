/**
 * 命令前置环境预检（v2.6）—— 纯函数，主进程与渲染进程共用
 *
 * 背景：Agent（ssh_readonly）或用户批准的命令直接跑到服务器上，若所需命令
 * 不存在（如未装 docker），只会得到一堆 shell 报错。预检在【执行前】用一次
 * 轻量远程调用确认所有涉及的命令在目标机上可用，不可用时给出明确原因。
 *
 * 本模块只做纯文本解析与脚本拼装（可单测）；真正的远程执行由调用方完成：
 * - 主进程：src/main/services/ssh/command-preflight.ts（ConnectionManager.exec）
 * - 渲染层：AIPanel「在终端执行」前经 sshExec 调用
 */

/** shell 内建/关键字（无需也无法用 command -v 检查的词） */
const SHELL_BUILTINS = new Set([
  'cd', 'echo', 'pwd', 'export', 'set', 'unset', 'source', '.', 'alias',
  'unalias', 'history', 'type', 'command', 'test', '[', '[[', 'read',
  'printf', 'true', 'false', 'exit', 'wait', 'jobs', 'fg', 'bg', 'ulimit',
  'umask', 'trap', 'shift', 'local', 'return', 'let', 'eval', 'exec',
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done',
  'case', 'esac', 'in', 'function', 'select', 'declare', 'readonly',
])

/** 包装类命令：本身跳过检查，继续取下一个 token 作为真实命令 */
const WRAPPERS = new Set(['sudo', 'nohup', 'time', 'env', 'nice', 'ionice', 'timeout', 'watch', 'xargs'])

/** 命令名安全字符集（防止拼进检查脚本时被注入；不满足的 token 直接跳过不检查） */
const SAFE_NAME = /^[A-Za-z0-9_./-]+$/

/**
 * 从一条 shell 命令行中提取需要检查存在性的命令名列表（去重、保序）
 *
 * 策略：按 ; && || | & 与换行切分成段，每段取第一个"真实命令" token：
 * - 跳过环境变量赋值前缀（FOO=bar cmd）
 * - 跳过包装命令（sudo/nohup/env...），继续看下一个 token
 * - 跳过 shell 内建与关键字
 * - timeout/watch 的数字参数与选项（-n 5 等）一并跳过
 * - 含不安全字符（引号/$/反引号等）的 token 不检查（保守放行）
 */
export function extractCommandNames(command: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  // 切段：命令分隔符 + 管道 + 子 shell 起始
  const segments = command
    .split(/(?:\|\||&&|;|\||\n|&|\$\(|`|\((?=\s))/)
    .map((s) => s.trim())
    .filter(Boolean)

  for (const seg of segments) {
    const tokens = seg.split(/\s+/)
    for (const raw of tokens) {
      // 去掉重定向前缀（2>/dev/null 之类整个 token 跳过）
      if (/^[0-9]*[<>]/.test(raw)) continue
      // 环境变量赋值前缀：跳过继续找命令
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) continue
      // 选项/数字参数（出现在包装命令后，如 timeout 5、watch -n 1）
      if (raw.startsWith('-') || /^[0-9]+[smhd]?$/.test(raw)) continue
      // 包装命令：跳过本体，继续找真实命令
      if (WRAPPERS.has(raw)) continue
      // 内建/关键字：本段无需检查
      if (SHELL_BUILTINS.has(raw)) break
      // 不安全 token：保守跳过整段（不阻塞执行）
      if (!SAFE_NAME.test(raw)) break
      const name = raw
      if (!seen.has(name)) {
        seen.add(name)
        names.push(name)
      }
      break // 每段只取第一个真实命令
    }
  }
  return names
}

/**
 * 生成远程"缺失命令检查"脚本（POSIX sh 兼容）
 *
 * 输出：缺失的命令名以空格分隔打印到 stdout（全部存在则无输出）。
 * 入参必须来自 extractCommandNames（已过 SAFE_NAME 白名单），双引号包裹防注入。
 */
export function buildMissingCheckScript(names: string[]): string {
  const list = names.filter((n) => SAFE_NAME.test(n)).join(' ')
  return `missing=""; for c in ${list}; do command -v "$c" >/dev/null 2>&1 || missing="$missing $c"; done; printf '%s' "$missing"`
}

/** 解析检查脚本的 stdout → 缺失命令名列表 */
export function parseMissingOutput(stdout: string): string[] {
  return (stdout || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}
