/** 预览用的最小 MIME 表（W5）：只列网页里会被浏览器再请求回来的类型 */
const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  pdf: 'application/pdf',
}

export function contentTypeForPath(remotePath: string): string {
  const base = remotePath.slice(remotePath.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  return MIME[base.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream'
}
