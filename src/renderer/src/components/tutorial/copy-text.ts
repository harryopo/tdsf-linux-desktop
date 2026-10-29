/**
 * 教程页的剪贴板写入
 *
 * 这里只认"真的写进去了"：`writeText` reject 或环境没有 clipboard 都返回失败，
 * 调用方据此显示"复制失败"，不许在失败路径上仍然切成"已复制"。
 */
export type CopyResult = { ok: true } | { ok: false; error: string }

export async function copyText(text: string): Promise<CopyResult> {
  if (!text) return { ok: false, error: '没有可复制的内容' }
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return { ok: false, error: '当前环境不支持剪贴板' }
  }
  try {
    await navigator.clipboard.writeText(text)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
