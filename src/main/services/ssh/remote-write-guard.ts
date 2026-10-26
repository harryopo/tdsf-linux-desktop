/**
 * 远端改写类操作的目的地闸（唯一一张口）
 *
 * 病根（2026-10-15 全维度审查 P0）：系统关键路径的保护只长在**命令文本**上，
 * 而 SFTP 这族平行入口把渲染层传来的 `remotePath` 直接喂给 createWriteStream/unlink——
 * 于是 `echo x > /etc/passwd` 走 shell 会被拦，编辑器保存 /etc/passwd 却一路放行。
 * 2026-10-21 复查又发现 UI 文件面板走的是另一套 `ElectermSftpManager`，闸只装在了
 * `SftpManager` 上，等于同一件事的两个出口只有一个装了锁。所以抽到独立模块，两套都要走。
 *
 * 连接表单默认用户名是 root，放行就等于真覆写系统文件。
 */
import { isProtectedWriteDestination } from '../../core/command-gate'
import { posix as posixPath } from 'node:path'

export function assertRemoteWriteAllowed(op: string, remotePath: string): void {
  if (isProtectedWriteDestination(remotePath)) {
    throw new Error(
      `${op}被拒绝：${remotePath} 属于系统关键路径（/etc、/usr、/var/log、/root、/dev 等）。` +
        '这类文件不在文件面板/编辑器/AI 写文件里直接改——请在终端里自己执行，那会过高危命令闸并给你解释原因。'
    )
  }
}

/**
 * 远端读路径必须是绝对路径（find 家族唯一有效的形状闸）
 *
 * 真靶机实测（2026-10-26，WSL Ubuntu-24.04 / findutils 4.9.0）：`find` **不认** `--`。
 * 它的语法是"[起点路径...] [表达式]"，任何以 `-` 开头的参数都被读成表达式的一部分，
 * `--` 只是被静默忽略：`find -- '-delete' -type f` 与 `find '-delete' -type f` 结果一样，
 * 起点退化成当前目录并把删除动作作用在整个目录上（实测两个临时目录里的文件都被删光）。
 * 而绝对路径不可能以 `-` 开头，所以要求"必须是绝对路径"才是真的挡住了这一类。
 */
export function assertRemotePathAbsolute(label: string, remotePath: string): void {
  if (typeof remotePath !== 'string' || !posixPath.isAbsolute(remotePath)) {
    throw new Error(
      `${label}被拒绝：${JSON.stringify(remotePath)} 不是绝对路径。` +
        '远程路径必须以 / 开头——find 这类命令没有选项终止符语义，' +
        '以 - 开头的相对路径会被当成命令自己的表达式而不是路径。'
    )
  }
}

/** 把远端 `realpath` 包装成 Promise（ssh2 的 SFTPWrapper 是回调式的） */
export type RealpathFn = (remotePath: string) => Promise<string>

export function sftpRealpathFn(sftp: {
  realpath(path: string, cb: (err: Error | null | undefined, resolvedPath: string) => void): void
}): RealpathFn {
  return (remotePath) =>
    new Promise<string>((resolve, reject) => {
      sftp.realpath(remotePath, (err, resolvedPath) => {
        if (err) reject(err)
        else resolve(resolvedPath)
      })
    })
}

/**
 * 带符号链接解析的写目的地闸（#237）
 *
 * 字符串闸只看路径长相，`/home/u/notes -> /etc/passwd` 这种符号链接能整条绕过去：
 * 路径不在 /etc 下，写下去却落进 /etc。所以真写之前问一次远端"这个路径最终指向哪"：
 * - 目标已存在（含符号链接）→ realpath(目标) 就是真身；
 * - 目标不存在 → realpath(父目录) + 文件名（父目录本身也可能是链接）。
 *
 * 边界：检查与写入之间仍有 TOCTOU 窗口（对方有 shell 时可以在这一瞬把目录换成链接）。
 * SFTP 协议没有 O_NOFOLLOW，这个窗口在客户端侧关不死；这里关掉的是"先布好链接再让你写"
 * 这条不需要抢时间的路。
 */
/**
 * 递归删除前的符号链接闸（#241）
 *
 * 实测 GNU coreutils：`rm -rf /tmp/a/link/`（link -> /tmp/victim）会跟进去删光 victim。
 * 文件面板删除目录走远端 `rm -rf`，只判字符串拦不住这种情况——链接本身不在受保护前缀下。
 * 所以要求：绝对路径、字面路径与远端 realpath 一致；不一致（符号链接 / 非规范写法）
 * 一律拒绝，让用户到终端里自己处理。
 */
export function assertDeleteTargetNotSymlink(rawPath: string, resolvedPath: string): void {
  const normalized = posixPath.normalize(rawPath).replace(/\/+$/, '') || '/'
  if (!posixPath.isAbsolute(normalized)) {
    throw new Error(
      `递归删除被拒绝：${rawPath} 不是绝对路径。请用绝对路径删除，或到终端里自行处理。`
    )
  }
  if (resolvedPath !== normalized) {
    throw new Error(
      `递归删除被拒绝：${rawPath} 实际指向 ${resolvedPath}（符号链接或非规范路径）。` +
        '顺着链接删会把目标目录一起删掉——请到终端里自行处理。'
    )
  }
  assertRemoteWriteAllowed('递归删除', resolvedPath)
}

export async function assertRemoteWriteAllowedResolved(
  op: string,
  remotePath: string,
  realpath: RealpathFn
): Promise<void> {
  assertRemoteWriteAllowed(op, remotePath)
  let resolved: string | null = null
  try {
    resolved = await realpath(remotePath)
  } catch {
    try {
      const parent = await realpath(posixPath.dirname(remotePath))
      resolved = posixPath.join(parent, posixPath.basename(remotePath))
    } catch {
      // 父目录也解析不出来：这条写本来就会失败，交给底层报 ENOENT，别在这里换一条错话
      return
    }
  }
  if (resolved && isProtectedWriteDestination(resolved)) {
    throw new Error(
      `${op}被拒绝：${remotePath} 实际指向 ${resolved}，属于系统关键路径（/etc、/usr、/var/log、/root、/dev 等）。` +
        '符号链接不能绕过这道闸——要改这些文件请在终端里自己执行。'
    )
  }
}
