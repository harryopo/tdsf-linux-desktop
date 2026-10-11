/**
 * 预览取字节判据（W5）
 *
 * 这里最要紧的一条不是"能取到"，而是**越界时 deps.readFile 根本没被调用**：
 * 笼子必须在落到 SFTP 之前拦住，否则"先读再判"等于把远端文件系统敞开了一半。
 * 假 deps 的形状与真实现一致（ElectermSftpManager.readFileBuffer / forwardHttpRequest 的返回）。
 */
import { describe, it, expect, vi } from 'vitest'
import { createPreviewTransport, type PreviewAsset } from '@main/services/preview/preview-transport'
import type { PreviewHandle } from '@main/services/preview/preview-handles'

const FILE_HANDLE: PreviewHandle = {
  token: 't',
  target: { kind: 'file', sessionId: 's1', path: '/var/www/app/index.html' },
  entryPath: '/var/www/app/index.html',
  rootPrefix: '/var/www/app/',
  lastUsedAt: 0,
}

const PORT_HANDLE: PreviewHandle = {
  token: 'p',
  target: { kind: 'port', sessionId: 's1', port: 3000 },
  entryPath: null,
  rootPrefix: null,
  lastUsedAt: 0,
}

function makeDeps(over: Partial<Parameters<typeof createPreviewTransport>[0]> = {}) {
  return {
    readFile: vi.fn(async (sessionId: string, remotePath: string) => {
      if (remotePath === '/var/www/app/index.html') return Buffer.from('<h1>ok</h1>')
      if (remotePath === '/var/www/app/logo.png') return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00])
      throw new Error(`远程文件不存在: ${remotePath}`)
    }),
    httpViaForward: vi.fn(
      async (): Promise<PreviewAsset> => ({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: Buffer.from('served'),
      }),
    ),
    ...over,
  }
}

describe('preview transport', () => {
  it('文件预览按扩展名给类型，二进制原样透传', async () => {
    const t = createPreviewTransport(makeDeps())
    const html = await t.load(FILE_HANDLE, 'GET', '/index.html')
    expect(html).toMatchObject({ status: 200, contentType: 'text/html; charset=utf-8' })
    expect(html.body.toString('utf-8')).toBe('<h1>ok</h1>')

    const png = await t.load(FILE_HANDLE, 'GET', '/logo.png')
    expect(png.contentType).toBe('image/png')
    // 过一遍 utf-8 就会毁掉这几个字节，这里要的是原始 Buffer
    expect([...png.body]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x00])
  })

  it('根路径落到入口文件', async () => {
    const deps = makeDeps()
    const t = createPreviewTransport(deps)
    await t.load(FILE_HANDLE, 'GET', '/')
    expect(deps.readFile).toHaveBeenCalledWith('s1', '/var/www/app/index.html')
  })

  it('越界请求在落到 SFTP 之前就被拒（readFile 一次都没调用）', async () => {
    const deps = makeDeps()
    const t = createPreviewTransport(deps)
    const r = await t.load(FILE_HANDLE, 'GET', '/../etc/passwd')
    expect(r.status).toBe(403)
    expect(deps.readFile).not.toHaveBeenCalled()
  })

  it('读不到文件回 404，不抛给页面看栈', async () => {
    const t = createPreviewTransport(makeDeps())
    const r = await t.load(FILE_HANDLE, 'GET', '/missing.css')
    expect(r.status).toBe(404)
    expect(r.contentType).toContain('text/plain')
  })

  it('端口预览把空路径归一成 /，并带上定死的端口与会话', async () => {
    const deps = makeDeps()
    const t = createPreviewTransport(deps)
    const r = await t.load(PORT_HANDLE, 'GET', '')
    expect(deps.httpViaForward).toHaveBeenCalledWith('s1', 3000, 'GET', '/')
    expect(r.status).toBe(200)
    expect(r.body.toString()).toBe('served')
  })

  it('端口预览保留查询串（dev server 的 ?v=hash 要用）', async () => {
    const deps = makeDeps()
    const t = createPreviewTransport(deps)
    await t.load(PORT_HANDLE, 'GET', '/main.js?v=1b2c')
    expect(deps.httpViaForward).toHaveBeenCalledWith('s1', 3000, 'GET', '/main.js?v=1b2c')
  })

  it('隧道失败回 502 而不是把异常抛给 iframe', async () => {
    const t = createPreviewTransport(
      makeDeps({
        httpViaForward: vi.fn(async () => {
          throw new Error('隧道打不开 127.0.0.1:3000')
        }),
      }),
    )
    const r = await t.load(PORT_HANDLE, 'GET', '/')
    expect(r.status).toBe(502)
    expect(r.body.toString()).toContain('3000')
  })

  it('只读：POST/PUT 一律 405，两个来源都不许被写', async () => {
    const deps = makeDeps()
    const t = createPreviewTransport(deps)
    expect((await t.load(PORT_HANDLE, 'POST', '/')).status).toBe(405)
    expect((await t.load(FILE_HANDLE, 'PUT', '/index.html')).status).toBe(405)
    expect(deps.httpViaForward).not.toHaveBeenCalled()
    expect(deps.readFile).not.toHaveBeenCalled()
  })

  it('文件预览剥掉查询串（浏览器给子资源加的 ?v= 不是文件名的一部分）', async () => {
    const deps = makeDeps()
    const t = createPreviewTransport(deps)
    const r = await t.load(FILE_HANDLE, 'GET', '/index.html?v=1b2c')
    expect(deps.readFile).toHaveBeenCalledWith('s1', '/var/www/app/index.html')
    expect(r.status).toBe(200)
  })

  it('HEAD 只回状态与类型，不回正文', async () => {
    const t = createPreviewTransport(makeDeps())
    const r = await t.load(FILE_HANDLE, 'HEAD', '/index.html')
    expect(r.status).toBe(200)
    expect(r.body.length).toBe(0)
  })

  it('换行与控制字符的请求路径直接拒（防请求行注入）', async () => {
    const deps = makeDeps()
    const t = createPreviewTransport(deps)
    const r = await t.load(PORT_HANDLE, 'GET', '/x HTTP/1.1\r\nX-A: 1')
    expect(r.status).toBe(400)
    expect(deps.httpViaForward).not.toHaveBeenCalled()
  })
})
