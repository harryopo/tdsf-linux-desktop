/**
 * Markdown 链接的协议白名单
 *
 * 链接文本来自 LLM 回复、知识库条目、爬虫结果——都是"别人写的字"。
 * 直接把 `href` 交给 `<a>`，`javascript:` / `data:` 就是点击即执行；
 * 现在没出事靠的是 CSP 和 window-open 白名单，那是别人的防线，不是这里的。
 *
 * 判据用 `new URL()` 解析后比 protocol，而不是字符串前缀匹配：
 * 浏览器在解析 href 前会剥掉前导空白与控制字符，`java\nscript:` 这类写法
 * 用前缀黑名单正好漏在我们最想要的那条上。
 */

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * @returns 可渲染成 `<a>` 的地址；不在白名单内返回 null（调用方降级成纯文本）
 */
export function safeMarkdownHref(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (!ALLOWED_LINK_PROTOCOLS.has(url.protocol)) return null
  // 内嵌凭据的地址（https://user:pass@host）不给：浏览器会把它当认证信息发出去，
  // 而这段文字是模型或知识库写来的，不是用户自己填的
  if (url.username || url.password) return null
  return url.href
}
