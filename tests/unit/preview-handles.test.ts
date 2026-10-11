/**
 * 预览句柄与笼子判据（W5）
 *
 * 钉的是"预览只能看到铸句柄那一刻定死的那一个目录/那一个端口"。
 * 用例里的路径全部按真实 Linux 布局写（/var/www/…），编码绕过按攻击者真会用的
 * 那几种写法试：%2e%2e、双点、NUL、大小写混排。
 *
 * 最后一条是量具自检：证明"目录前缀"判的是带分隔符的前缀，不是裸 startsWith——
 * 否则 /var/www 这个根会顺手放过 /var/www-evil。
 */
import { describe, it, expect } from 'vitest'
import {
  PreviewHandleRegistry,
  confineToDir,
  validateTarget,
  type PreviewHandle,
} from '@main/services/preview/preview-handles'

function fileHandle(rootDir = '/var/www/app', entry = '/var/www/app/index.html'): PreviewHandle {
  return {
    token: 'tok',
    target: { kind: 'file', sessionId: 's1', path: entry },
    entryPath: entry,
    rootPrefix: `${rootDir}/`,
    lastUsedAt: 0,
  }
}

describe('confineToDir', () => {
  it('同目录子资源正常映射，多级子目录也认', () => {
    expect(confineToDir(fileHandle(), '/style.css')).toEqual({
      ok: true,
      remotePath: '/var/www/app/style.css',
    })
    expect(confineToDir(fileHandle(), '/assets/app.js')).toEqual({
      ok: true,
      remotePath: '/var/www/app/assets/app.js',
    })
  })

  it('根路径落到入口文件', () => {
    expect(confineToDir(fileHandle(), '/')).toEqual({
      ok: true,
      remotePath: '/var/www/app/index.html',
    })
  })

  it('点号段与编码点号段都出不去', () => {
    const h = fileHandle()
    for (const bad of [
      '/../secret.txt',
      '/assets/../../etc/passwd',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/assets/%2e%2e/%2e%2e/etc/passwd',
      '/..%2f..%2fetc/passwd',
    ]) {
      const r = confineToDir(h, bad)
      expect(r.ok, `${bad} 不该被放行，实际=${JSON.stringify(r)}`).toBe(false)
    }
  })

  it('阴性对照：三个点的目录名不是穿越（.%2e 解码后是 ...，普通文件名）', () => {
    // 判据不能宽到把合法路径也拒了，否则 CSS/JS 会莫名其妙 404
    const r = confineToDir(fileHandle(), '/.../x.css')
    expect(r).toEqual({ ok: true, remotePath: '/var/www/app/.../x.css' })
  })

  it('非路径请求一律拒', () => {
    const h = fileHandle()
    // 注意：'/etc/passwd' 在这里是合法的**相对**请求（落在预览根下），
    // 真正的越界靠上面那条点号段用例守
    expect(confineToDir(h, 'style.css').ok).toBe(false)
    expect(confineToDir(h, '/a\0b').ok).toBe(false)
    expect(confineToDir(h, '/%zz').ok).toBe(false)
  })

  it('端口句柄不走文件解析', () => {
    const port: PreviewHandle = {
      token: 'p',
      target: { kind: 'port', sessionId: 's1', port: 3000 },
      entryPath: null,
      rootPrefix: null,
      lastUsedAt: 0,
    }
    expect(confineToDir(port, '/index.html').ok).toBe(false)
  })

  it('量具自检：兄弟目录不许被顺手放过（前缀必须带分隔符）', () => {
    // 根是 /var/www/app/。这条请求规范化后落在 /var/www/apple/x——
    // 如果判前缀时把尾部 '/' 丢了（startsWith('/var/www/app')），它会被当成合法。
    const r = confineToDir(fileHandle(), '/../apple/x')
    expect(r.ok).toBe(false)
  })
})

describe('validateTarget', () => {
  it('端口必须是 1..65535 的整数', () => {
    for (const port of [0, -1, 65536, 3000.5, Number.NaN]) {
      expect(() => validateTarget({ kind: 'port', sessionId: 's', port })).toThrow(/端口/)
    }
    expect(() => validateTarget({ kind: 'port', sessionId: 's', port: 8080 })).not.toThrow()
  })

  it('文件必须是绝对路径且不是目录', () => {
    expect(() => validateTarget({ kind: 'file', sessionId: 's', path: 'a/b.html' })).toThrow(/绝对/)
    expect(() => validateTarget({ kind: 'file', sessionId: 's', path: '/var/www/' })).toThrow(/目录/)
  })
})

describe('PreviewHandleRegistry', () => {
  it('会话关闭只清它名下的句柄', () => {
    const reg = new PreviewHandleRegistry()
    const a = reg.mint({ kind: 'file', sessionId: 's1', path: '/var/www/a.html' })
    const b = reg.mint({ kind: 'file', sessionId: 's2', path: '/var/www/b.html' })
    expect(reg.revokeSession('s1')).toBe(1)
    expect(reg.resolve(a.token)).toBeNull()
    expect(reg.resolve(b.token)?.token).toBe(b.token)
  })

  it('闲置超时后取不到，且顺手从表里删掉', () => {
    let now = 1_000
    const reg = new PreviewHandleRegistry(() => now)
    const h = reg.mint({ kind: 'port', sessionId: 's1', port: 3000 })
    now += 29 * 60 * 1000
    expect(reg.resolve(h.token)).not.toBeNull()
    now += 31 * 60 * 1000
    expect(reg.resolve(h.token)).toBeNull()
    expect(reg.size).toBe(0)
  })

  it('句柄数量有上限，超了挤掉最久没用的', () => {
    // 时钟每次前进：不然"最久没用"靠的是 Map 插入顺序 + 排序稳定性，改一行实现就会假绿
    let tick = 0
    const reg = new PreviewHandleRegistry(() => ++tick)
    const first = reg.mint({ kind: 'port', sessionId: 's1', port: 3000 })
    for (let i = 1; i <= 64; i++) {
      reg.mint({ kind: 'port', sessionId: 's1', port: 3000 + i })
    }
    expect(reg.size).toBeLessThanOrEqual(64)
    expect(reg.resolve(first.token)).toBeNull()
  })

  it('token 是随机的：同一目标铸两次不共用', () => {
    const reg = new PreviewHandleRegistry()
    const t = { kind: 'file', sessionId: 's1', path: '/var/www/a.html' } as const
    expect(reg.mint(t).token).not.toBe(reg.mint(t).token)
  })
})
