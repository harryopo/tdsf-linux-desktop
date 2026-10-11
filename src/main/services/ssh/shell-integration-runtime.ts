/**
 * 远端 Shell 集成的真实现装配（#61）
 *
 * shell-integration.ts 里的类只认 RemoteFs 这个接口，装配放这里：
 * exec 走 SshConnectionManager.exec，也就是**必然过风险闸**（闸在 exec 里，不在 IPC 里），
 * 文件读写走同一会话的 SFTP 通道。
 */
import { ElectermSftpManager } from './electerm-sftp'
import { SshConnectionManager } from './connection-manager'
import { ShellIntegrationService, type RemoteFs } from './shell-integration'

const sshManager = SshConnectionManager.getInstance()
const sftpManager = new ElectermSftpManager(sshManager)

const remoteFs: RemoteFs = {
  exec: (sessionId, command) => sshManager.exec(sessionId, command),
  stat: (sessionId, remotePath) => sftpManager.stat(sessionId, remotePath),
  readFile: (sessionId, remotePath) => sftpManager.readFile(sessionId, remotePath),
  writeFile: (sessionId, remotePath, content) => sftpManager.writeFile(sessionId, remotePath, content),
  unlink: (sessionId, remotePath) => sftpManager.delete(sessionId, remotePath),
}

export const shellIntegration = new ShellIntegrationService(remoteFs)
