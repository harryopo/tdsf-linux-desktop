/**
 * 系统 ssh-agent 的套接字/命名管道解析
 *
 * 只做"去哪儿找 agent"，不碰密钥：私钥始终留在 agent 进程里，
 * 应用只把 socket 路径交给 ssh2。找不到时返回 null，由调用方给出可行动的报错。
 */
import { existsSync } from 'node:fs'

/** Windows 自带 OpenSSH Authentication Agent 的固定命名管道 */
export const WINDOWS_OPENSSH_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent'

export function resolveSshAgentSocket(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  pipeExists: (path: string) => boolean = existsSync
): string | null {
  // Windows 优先用 OpenSSH 的命名管道：Git Bash 里的 SSH_AUTH_SOCK 常是 MSYS 路径，
  // ssh2 在原生 Windows 进程里连不上；只有管道不存在时才退回环境变量（如 Cygwin 转发）。
  if (platform === 'win32' && pipeExists(WINDOWS_OPENSSH_AGENT_PIPE)) {
    return WINDOWS_OPENSSH_AGENT_PIPE
  }
  const fromEnv = env.SSH_AUTH_SOCK?.trim()
  if (fromEnv) return fromEnv
  return null
}

export const SSH_AGENT_MISSING_MESSAGE =
  '未找到 ssh-agent：Linux/macOS 请先启动 ssh-agent 并设置 SSH_AUTH_SOCK；' +
  'Windows 请在「服务」里启用 OpenSSH Authentication Agent，并把密钥加入 ssh-add。'
