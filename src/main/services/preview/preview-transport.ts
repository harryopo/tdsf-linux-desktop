/**
 * 预览取字节（W5）
 *
 * 两条来源，同一个出口形状：
 * - file：SFTP 读远端文件（限在句柄铸定时划的目录里）
 * - port：把 HTTP 请求塞进 SSH 的 direct-tcpip 隧道，打到远端那台机器的 127.0.0.1:port
 *
 * 端口这一路为什么不用本地起监听端口：`net.createServer` + 浏览器直连
 * http://127.0.0.1:随机端口 会把远端服务暴露在本机端口上（同机其他进程、
 * 本机浏览器都能连），而且页面里的相对跳转会跳出我们的 CSP。走自定义协议
 * 就没有这个问题：iframe 只能向 tdsf-preview://token 要东西。
 */
import * as http from 'node:http'
import type { Duplex } from 'node:stream'
import type { Client } from 'ssh2'
import { confineToDir, type PreviewHandle } from './preview-handles'
import { contentTypeForPath } from './preview-mime'

export interface PreviewAsset {
  status: number
  contentType: string
  body: Buffer
}

export interface PreviewTransportDeps {
  /** 读远端文件原始字节（真实现是 SftpManager.readFileBuffer） */
  readFile: (sessionId: string, remotePath: string) => Promise<Buffer>
  /** 经 SSH 隧道发一次 HTTP 请求（真实现见 forwardHttpRequest） */
  httpViaForward: (
    sessionId: string,
    port: number,
    method: string,
    path: string,
  ) => Promise<PreviewAsset>
}

const MAX_BODY_BYTES = 20 * 1024 * 1024

function text(status: number, message: string): PreviewAsset {
  return {
    status,
    contentType: 'text/plain; charset=utf-8',
    body: Buffer.from(message, 'utf-8'),
  }
}

export interface PreviewTransport {
  load(handle: PreviewHandle, method: string, urlPath: string): Promise<PreviewAsset>
}

export function createPreviewTransport(deps: PreviewTransportDeps): PreviewTransport {
  return {
    async load(handle, method, urlPath) {
      if (method !== 'GET' && method !== 'HEAD') {
        // 预览是只读的：能 GET 就能读文件，但 POST 出去的就是"替用户改远端状态"
        return text(405, `预览只支持 GET/HEAD，收到 ${method}`)
      }
      if (handle.target.kind === 'port') {
        const path = urlPath && urlPath.startsWith('/') ? urlPath : '/'
        if (/[\r\n\0]/.test(path)) return text(400, '请求路径含非法字符')
        try {
          const asset = await deps.httpViaForward(handle.target.sessionId, handle.target.port, method, path)
          return asset
        } catch (err) {
          return text(502, `远端端口 ${handle.target.port} 请求失败：${errMessage(err)}`)
        }
      }
      const confined = confineToDir(handle, stripQuery(urlPath) || '/')
      if (!confined.ok) return text(403, `预览越界：${confined.reason}`)
      try {
        const raw = await deps.readFile(handle.target.sessionId, confined.remotePath)
        if (raw.length > MAX_BODY_BYTES) return text(413, '预览文件过大')
        return {
          status: 200,
          contentType: contentTypeForPath(confined.remotePath),
          body: method === 'HEAD' ? Buffer.alloc(0) : raw,
        }
      } catch (err) {
        const msg = errMessage(err)
        // 找不到就是 404，别把 SSH 层的中文报错原样抛给页面
        return text(/不存在|no such|not found/i.test(msg) ? 404 : 502, `读不到 ${confined.remotePath}：${msg}`)
      }
    },
  }
}

/**
 * 去掉查询串。
 *
 * 浏览器给子资源加的 ?v=hash 是缓存指纹，不是文件名的一部分——
 * 不剥掉的话远端真实路径找不到，预览里的 CSS/JS 会莫名其妙全 404。
 */
function stripQuery(urlPath: string): string {
  const q = urlPath.indexOf('?')
  return q < 0 ? urlPath : urlPath.slice(0, q)
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 把 ssh2 的通道伪装成 http 客户端要的 net.Socket。
 *
 * 实测（scripts 探针，对假靶子跑真隧道）：`http.request({createConnection: () => channel})`
 * 这条路本身是通的，但 Node 会调 `setNoDelay/setKeepAlive/ref/unref/setTimeout`，
 * 而 ssh2 的 Channel 上没有这几个方法——缺一个就整条请求报错，界面只看到一个 502。
 * setTimeout 给的是**真**定时器：只是把空闲超时接回 destroy，不然预览会永远挂着。
 */
/** Node 的 http 客户端会在这五个方法上各调一次，ssh2 的 Channel 一个都没有 */
interface HttpSocketExtras {
  setNoDelay: () => unknown
  setKeepAlive: () => unknown
  ref: () => unknown
  unref: () => unknown
  setTimeout: (ms: number, cb?: () => void) => unknown
}

function asHttpSocket<T extends Duplex>(stream: T): T & HttpSocketExtras {
  const target = stream as T & Partial<HttpSocketExtras>
  const self = target as T & HttpSocketExtras
  if (typeof target.setNoDelay !== 'function') target.setNoDelay = () => self
  if (typeof target.setKeepAlive !== 'function') target.setKeepAlive = () => self
  if (typeof target.ref !== 'function') target.ref = () => self
  if (typeof target.unref !== 'function') target.unref = () => self
  if (typeof target.setTimeout !== 'function') {
    target.setTimeout = (ms: number) => {
      const timer = setTimeout(() => self.destroy?.(new Error(`隧道空闲超时（${ms}ms）`)), ms)
      timer.unref?.()
      return self
    }
  }
  return self
}

/**
 * 通过 SSH 的 forwardOut 发一次 HTTP 请求。
 *
 * 每次请求开一条新通道（agent:false + Connection: close）：复用隧道里的连接
 * 要自己管 keep-alive 与半关闭，而预览的请求量本来就小，换一条干净通道最省心。
 */
export function forwardHttpRequest(
  openForward: (sessionId: string, port: number) => Promise<Duplex>,
  timeoutMs = 10_000,
): PreviewTransportDeps['httpViaForward'] {
  return async (sessionId, port, method, path) => {
    const stream = asHttpSocket(await openForward(sessionId, port))
    return await new Promise<PreviewAsset>((resolve, reject) => {
      const req = http.request(
        {
          method,
          path,
          // host/port 只是给 http 模块看的样子值：真正的字节走 createConnection 给的流。
          // 这里**不能**写 agent:false —— 那样 Node 会绕开 createConnection 去真连 TCP
          // （实测报 connect ECONNREFUSED 127.0.0.1:1），隧道直接被跳过。
          host: '127.0.0.1',
          port,
          createConnection: () => stream,
          headers: { host: `127.0.0.1:${port}`, connection: 'close', accept: '*/*' },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = []
          let len = 0
          res.on('data', (c: Buffer) => {
            len += c.length
            if (len > MAX_BODY_BYTES) {
              req.destroy(new Error(`响应超过 ${MAX_BODY_BYTES} 字节上限`))
              return
            }
            chunks.push(c)
          })
          res.on('error', (err: Error) => reject(err))
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 502,
              contentType: res.headers['content-type'] ?? 'application/octet-stream',
              body: Buffer.concat(chunks),
            })
          })
        },
      )
      req.on('error', (err: Error) => {
        stream.destroy()
        reject(err)
      })
      req.on('timeout', () => {
        req.destroy(new Error(`远端端口 ${port} 响应超时（${timeoutMs}ms）`))
      })
      req.end()
    })
  }
}

/**
 * 隧道被拒时说人话。
 *
 * "Channel open failure: open failed" 是 ssh2 的原文，用户读不出下一步该干什么。
 * 真机实测到两种成因，报错文本不一样：
 *   - 服务端关了端口转发（sshd_config 里 AllowTcpForwarding no）→ 直接拒开 channel
 *   - 远端那个端口没人监听 → 也是 open failed（服务端代连失败）
 * 所以两种都提，让人按顺序排，而不是只猜一种。
 */
function tunnelFailureHint(port: number, reason: string): string {
  return (
    `隧道打不开 127.0.0.1:${port}：${reason}。` +
    '两种可能：① 这台服务器关着端口转发（sshd_config 里 AllowTcpForwarding no）；' +
    `② 远端 127.0.0.1:${port} 上没有程序在监听。`
  )
}

/** 真环境用的开隧道函数：只允许打到远端机器的回环，端口由句柄定死 */
export function openForwardOut(getClient: (sessionId: string) => Client) {
  return (sessionId: string, port: number): Promise<Duplex> =>
    new Promise<Duplex>((resolve, reject) => {
      let client: Client
      try {
        client = getClient(sessionId)
      } catch (err) {
        reject(err)
        return
      }
      client.forwardOut('127.0.0.1', 0, '127.0.0.1', port, (err, stream) => {
        if (err) {
          reject(new Error(tunnelFailureHint(port, errMessage(err))))
          return
        }
        resolve(stream as unknown as Duplex)
      })
    })
}
