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

export function assertRemoteWriteAllowed(op: string, remotePath: string): void {
  if (isProtectedWriteDestination(remotePath)) {
    throw new Error(
      `${op}被拒绝：${remotePath} 属于系统关键路径（/etc、/usr、/var/log、/root、/dev 等）。` +
        '这类文件不在文件面板/编辑器/AI 写文件里直接改——请在终端里自己执行，那会过高危命令闸并给你解释原因。'
    )
  }
}
