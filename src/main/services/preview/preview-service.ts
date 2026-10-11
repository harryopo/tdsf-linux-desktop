/**
 * 预览服务的进程内单例（W5）
 *
 * 协议处理器（每个子资源请求一次）与 IPC handler（铸句柄那一次）必须用同一个
 * transport：它底下是"按 sessionId 缓存的 SFTP 客户端"，两边各建一份就是
 * 同一条连接开两套子系统通道。
 *
 * 句柄的回收挂在会话关闭上：SSH 连接一没，它名下所有预览句柄同时作废——
 * 否则重连后拿同一个 token 还能读到新会话的文件（sessionId 是复用不了的，
 * 但 token 表如果不清，越界判据就落在一个已经不存在的连接上）。
 */
import { SshConnectionManager } from '../ssh/connection-manager'
import { ElectermSftpManager } from '../ssh/electerm-sftp'
import type { PreviewTarget } from '@shared/models'
import { previewHandles } from './preview-handles'
import { createPreviewTransport, forwardHttpRequest, openForwardOut, type PreviewTransport } from './preview-transport'

let transport: PreviewTransport | null = null
let sftp: ElectermSftpManager | null = null
let wired = false

/** 整个预览侧只用一套 SFTP 客户端缓存：多建一份就是同一条连接开两套子系统通道 */
function getSftp(): ElectermSftpManager {
  if (!sftp) sftp = new ElectermSftpManager(SshConnectionManager.getInstance())
  return sftp
}

export function getPreviewTransport(): PreviewTransport {
  if (!transport) {
    const ssh = SshConnectionManager.getInstance()
    const sftpManager = getSftp()
    transport = createPreviewTransport({
      readFile: (sessionId, remotePath) => sftpManager.readFileBuffer(sessionId, remotePath),
      httpViaForward: forwardHttpRequest(openForwardOut((sessionId) => ssh.getClient(sessionId))),
    })
  }
  if (!wired) {
    wired = true
    SshConnectionManager.getInstance().onSessionClosed((sessionId) => {
      previewHandles.revokeSession(sessionId)
    })
  }
  return transport
}

/**
 * 铸句柄前的可读性检查。
 *
 * 返回 null 表示可以预览，否则返回给用户看的错误原因。
 * 端口目标不预先探测：远端 127.0.0.1 上有没有监听是瞬时事实，
 * 真请求时拿不到就是 502，这里探测一次反而会让"服务还没起来"的常见场景开不了预览。
 */
export async function checkPreviewTargetReadable(target: PreviewTarget): Promise<string | null> {
  if (target.kind !== 'file') return null
  try {
    const entry = await getSftp().stat(target.sessionId, target.path)
    if (!entry) return `远端文件不存在：${target.path}`
    if (!entry.isDirectory) return null
    return `预览目标必须是文件，不是目录：${target.path}`
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
