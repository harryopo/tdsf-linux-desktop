/**
 * 预览 IPC Handlers（W5）
 *
 * 这张表上只有"铸句柄 / 作废句柄 / 读入口文件文本"三件事，没有"按路径给字节"的通道：
 * 子资源一律由 tdsf-preview: 协议带着 token 来取，笼子在主进程判，
 * 渲染层（以及被它嵌进来的不可信页面）拿不到笼子外的路径与端口。
 *
 * 入参形状由 preload 侧按 IPC 契约校验过，这里做的是契约管不到的那半：
 * 会话是否真的活着、目标是否真的可读。
 */
import { ipcMain } from 'electron'
import { PREVIEW } from '@shared/ipc-channels'
import type { PreviewHandleInfo, PreviewTarget } from '@shared/models'
import { SshConnectionManager } from '../services/ssh/connection-manager'
import { previewHandles } from '../services/preview/preview-handles'
import { previewUrl } from '../services/preview/preview-protocol'
import { checkPreviewTargetReadable, getPreviewTransport } from '../services/preview/preview-service'

export function registerPreviewHandlers(): void {
  ipcMain.handle(PREVIEW.OPEN, async (_event, target: PreviewTarget): Promise<PreviewHandleInfo> => {
    // 会话必须活着且已连接：getClient 对不存在/未连接的会话直接抛错，正好当准入闸门
    SshConnectionManager.getInstance().getClient(target.sessionId)
    const reason = await checkPreviewTargetReadable(target)
    if (reason) throw new Error(reason)
    const handle = previewHandles.mint(target)
    return {
      token: handle.token,
      url: previewUrl(handle),
      kind: handle.target.kind,
      entryPath: handle.entryPath,
    }
  })

  ipcMain.handle(PREVIEW.CLOSE, (_event, token: string) => {
    previewHandles.revoke(token)
    return true
  })

  // Markdown 不进 iframe：它由渲染层的安全渲染器（产出 React 元素，不拼 HTML）显示，
  // 所以这里要的是文本本身，走同一个句柄、同一套笼子。
  ipcMain.handle(PREVIEW.READ_TEXT, async (_event, token: string) => {
    const handle = previewHandles.resolve(token)
    if (!handle) throw new Error('预览句柄不存在或已过期')
    if (handle.target.kind !== 'file') throw new Error('只有文件预览能读文本')
    const asset = await getPreviewTransport().load(handle, 'GET', '/')
    if (asset.status !== 200) throw new Error(asset.body.toString('utf-8'))
    return asset.body.toString('utf-8')
  })
}
