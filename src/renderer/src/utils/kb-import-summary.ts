/**
 * 知识文件导入说完之后该怎么报（#259）
 *
 * 判定口径只有一条：**有没有条目真的写进库**。
 * `files` 只表示"处理过几个文件"，空文件也会被算进去——拿它当成功的依据，
 * 就会出现"导入完成：新增 0 条"这种绿色假成功。
 *
 * 对话框是系统原生的，e2e 点不到；把"该说什么"抽成纯函数，判据才落得下来。
 */

/** 主进程 kb:import-file 的返回形状（与 preload 的签名同源） */
export interface KbImportResultLike {
  ok: boolean
  canceled?: boolean
  files?: number
  inserted?: number
  updated?: number
  unchanged?: number
  embedded?: number
  rejected?: { file: string; source: string; reason: string }[]
  note?: string
  error?: string
}

export type KbImportOutcome =
  | { kind: 'canceled' }
  | { kind: 'failed'; message: string }
  | { kind: 'empty'; message: string }
  | { kind: 'done'; message: string; warnings: string[] }

/** 拒绝列表摘要：最多点三处，剩下的说到条数 */
function rejectSummary(rejected: { file: string; source: string; reason: string }[]): string {
  const head = rejected
    .slice(0, 3)
    .map((r) => `${r.file}·${r.source}：${r.reason}`)
    .join('；')
  return rejected.length > 3 ? `${head}…` : head
}

export function summarizeKbImport(result: KbImportResultLike): KbImportOutcome {
  if (result.canceled) return { kind: 'canceled' }
  if (!result.ok) {
    return { kind: 'failed', message: `导入失败：${result.error ?? '没有说明原因'}` }
  }

  const files = result.files ?? 0
  const inserted = result.inserted ?? 0
  const updated = result.updated ?? 0
  const unchanged = result.unchanged ?? 0
  const embedded = result.embedded ?? 0
  const rejected = result.rejected ?? []
  const imported = inserted + updated

  if (files === 0) {
    const first = rejected[0]
    return {
      kind: 'empty',
      message: first
        ? `没有可导入的内容：${first.file} — ${first.reason}`
        : '选中的文件里没有可导入的内容',
    }
  }

  if (imported === 0 && unchanged === 0) {
    // 处理过文件、但一条都没写进库：这不是成功，只是把失败包装得更像成功
    return {
      kind: 'failed',
      message: rejected.length
        ? `一条都没导进来：${rejectSummary(rejected)}`
        : '一条都没导进来：文件里的内容都没能写入知识库',
    }
  }

  if (imported === 0) {
    return {
      kind: 'done',
      message: `导入完成：没有新增或更新，没变化 ${unchanged} 条`,
      warnings: buildWarnings(result, rejected),
    }
  }

  const parts = [`新增 ${inserted} 条`, `更新 ${updated} 条`]
  if (unchanged > 0) parts.push(`没变化 ${unchanged} 条`)
  if (embedded > 0) parts.push(`已建语义索引 ${embedded} 条`)
  return { kind: 'done', message: `导入完成：${parts.join('，')}`, warnings: buildWarnings(result, rejected) }
}

/** 成功之后仍要提醒的两类：向量没建上、部分条目被拒 */
function buildWarnings(
  result: KbImportResultLike,
  rejected: { file: string; source: string; reason: string }[]
): string[] {
  const warnings: string[] = []
  if (result.note) warnings.push(result.note)
  if (rejected.length > 0) {
    warnings.push(
      rejected.length > 3
        ? `有 ${rejected.length} 处没导进来：${rejectSummary(rejected)}`
        : `有内容没导进来：${rejectSummary(rejected)}`
    )
  }
  return warnings
}
