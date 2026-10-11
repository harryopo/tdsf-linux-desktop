/**
 * tdsf-preview 协议（W5）
 *
 * 预览面板里那个 iframe 的 src 只能指向这一个协议，而协议背后只认句柄表里
 * 铸过的 token——渲染层拿不到"任意远端路径"或"任意内网端口"的入口。
 *
 * 为什么不用 iframe 直接指向 http://127.0.0.1:随机端口：那等于把远端服务
 * 在本机开一个监听口，本机任何进程和其他浏览器标签都能连；而且页面里的
 * 绝对跳转会把用户带出我们的应用。
 */
import { protocol } from 'electron'
import { logger } from '../log/logger'
import { previewHandles, type PreviewHandle } from './preview-handles'
import type { PreviewAsset, PreviewTransport } from './preview-transport'

export const PREVIEW_SCHEME = 'tdsf-preview'

/**
 * 给被预览内容自己的一套 CSP。
 *
 * 远端页面是不可信的第三方内容，但它要能跑：所以放行同源脚本与内联脚本
 * （生成的 HTML 报告几乎都带内联 script/style），同时把所有出网口收紧到
 * 'self'（= 这个 token 自己的 origin）。不给 'unsafe-eval'——
 * 打包型 dev server 的实时刷新可能用 eval，这类页面会退化，是有意保留的边界。
 */
export const PREVIEW_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/** 句柄的入口 URL（'/' 由协议侧映射到铸句柄时定的入口） */
export function previewUrl(handle: PreviewHandle, path = '/'): string {
  const clean = path.startsWith('/') ? path : `/${path}`
  return `${PREVIEW_SCHEME}://${handle.token}${clean}`
}

/** 必须在 app ready 之前调用（Electron 对 privileged scheme 的硬要求） */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PREVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        // 不放行跨源 fetch：预览页只能问自己的 token 要东西
        corsEnabled: false,
      },
    },
  ])
}

function response(asset: PreviewAsset): Response {
  return new Response(asset.body.length ? asset.body : null, {
    status: asset.status,
    headers: {
      'Content-Type': asset.contentType,
      'Content-Security-Policy': PREVIEW_CSP,
      'Cache-Control': 'no-store',
      // 同源子资源在 sandbox 的 opaque origin 下按 no-cors 取，这里不需要 ACAO
    },
  })
}

/** 必须在 app ready 之后调用 */
export function installPreviewProtocol(transport: PreviewTransport): void {
  protocol.handle(PREVIEW_SCHEME, async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return response(plain(400, '预览地址非法'))
    }
    const handle = previewHandles.resolve(url.host)
    const asset = !handle
      ? plain(404, '预览句柄不存在或已过期')
      : await transport.load(handle, request.method, `${decodeURIComponent(url.pathname)}${url.search}` || '/')
    // 一行一条：预览出问题时（远端 404、隧道不通）这是唯一能看到全过程的地方。
    // 4xx/5xx 额外带上回给页面的原文，否则日志里只有一个状态码，查不到为什么。
    logger.info('PREVIEW', `${request.method} ${request.url}`, {
      status: asset.status,
      bytes: asset.body.length,
      ...(asset.status >= 400 ? { detail: asset.body.toString('utf-8').slice(0, 200) } : {}),
    })
    return response(asset)
  })
}

function plain(status: number, message: string): PreviewAsset {
  return { status, contentType: 'text/plain; charset=utf-8', body: Buffer.from(message, 'utf-8') }
}
