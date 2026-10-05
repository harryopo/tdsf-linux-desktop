/**
 * 终端命令块模型（纯函数层）
 *
 * 把"一段滚动的字符流"切成【命令 → 输出 → 退出码】的结构化块，
 * 供 AI 上下文与审计消费：AI 说"上一条命令报错了"，依据必须是这里，
 * 而不是让模型去猜终端里肉眼可见的几行字。
 *
 * 两种来源都吃，优先级 OSC > 启发式：
 * - OSC 133 A/B/C/D（shell integration 的提示符/命令/输出/结束）
 * - OSC 633 E/P（VS Code 系的命令原文与属性，带得更多）
 * 远端没装 shell integration 时这里就是空的——不伪造块，也不靠正则猜命令，
 * 那是另一件事（要动用户远端 shell，得单独拿授权）。
 *
 * 本文件不许 import xterm：所有函数只吃 (model, 参数)，方便单测逐条钉。
 */

/** 块的状态：open=提示符已出现还没敲命令，running=命令在跑，done=已退出 */
export type BlockState = 'open' | 'running' | 'done'

export interface CommandBlock {
  id: number
  command: string | null
  /** 提示符所在 buffer 行 */
  promptRow: number | null
  /** 输出起始行 */
  outputRow: number | null
  /** 命令结束行 */
  endRow: number | null
  /** null = 尚未拿到退出码 */
  exitCode: number | null
  state: BlockState
  /** 633;P 附带的 cwd 等属性 */
  cwd?: string
}

export interface BlockModel {
  blocks: CommandBlock[]
  nextId: number
}

/** 上限：500 条命令块足够覆盖一次排障会话，再多就丢最旧的（终端 scrollback 也有限） */
export const MAX_BLOCKS = 500

export function createBlockModel(): BlockModel {
  return { blocks: [], nextId: 1 }
}

function push(m: BlockModel, block: CommandBlock): CommandBlock {
  m.blocks.push(block)
  if (m.blocks.length > MAX_BLOCKS) m.blocks.splice(0, m.blocks.length - MAX_BLOCKS)
  m.nextId += 1
  return block
}

/** 当前未结束的块（open 或 running）；没有则 null */
export function activeBlock(m: BlockModel): CommandBlock | null {
  for (let i = m.blocks.length - 1; i >= 0; i--) {
    if (m.blocks[i].state !== 'done') return m.blocks[i]
  }
  return null
}

export function lastBlock(m: BlockModel): CommandBlock | null {
  return m.blocks[m.blocks.length - 1] ?? null
}

/** OSC 133;A —— 提示符开始。连续两次提示符不该造出两个空块 */
export function markPrompt(m: BlockModel, row: number): void {
  const cur = activeBlock(m)
  // 上一个块还开着但没有命令文本：说明只是回车/补全，复用同一个块
  if (cur && cur.command === null && cur.state === 'open') {
    cur.promptRow = row
    return
  }
  push(m, { id: m.nextId, command: null, promptRow: row, outputRow: null, endRow: null, exitCode: null, state: 'open' })
}

/** OSC 133;B —— 命令开始（用户在提示符后开始输入） */
export function markCommandStart(m: BlockModel, row: number): void {
  const cur = activeBlock(m)
  if (cur && cur.state === 'open') {
    cur.promptRow = cur.promptRow ?? row
    return
  }
  // 没有开着的块（远端只发了 B）：补一个，别丢事件
  push(m, { id: m.nextId, command: null, promptRow: row, outputRow: null, endRow: null, exitCode: null, state: 'open' })
}

/** OSC 133;C —— 命令交给远端执行，输出从这里开始 */
export function markOutput(m: BlockModel, row: number): void {
  const cur = activeBlock(m)
  if (!cur) return
  cur.state = 'running'
  cur.outputRow = row
}

/**
 * OSC 133;D;<exit> —— 命令结束。
 * 找不到未结束的块就忽略：凭空造一个块会让"上一条命令"变成假的。
 */
export function markCommandEnd(m: BlockModel, row: number, exitCode: number | null): void {
  const cur = activeBlock(m)
  if (!cur) return
  cur.state = 'done'
  cur.endRow = row
  cur.exitCode = exitCode
}

/** OSC 633;E —— 命令原文。若当前块已经在跑（漏了 A/B），另起一块，避免把命令挂到别的块上 */
export function setCommandLine(m: BlockModel, text: string, row?: number): void {
  const cur = activeBlock(m)
  if (cur && cur.state === 'open') {
    cur.command = text
    if (typeof row === 'number') cur.promptRow = cur.promptRow ?? row
    return
  }
  const block = push(m, {
    id: m.nextId,
    command: text,
    promptRow: typeof row === 'number' ? row : null,
    outputRow: null,
    endRow: null,
    exitCode: null,
    state: 'open',
  })
  void block
}

/** OSC 633;P —— 属性（VS Code 用 Cmlntr/Cwd 等前缀，这里只收对上下文有用的） */
export function setProperty(m: BlockModel, raw: string): void {
  const cur = activeBlock(m) ?? lastBlock(m)
  if (!cur) return
  const eq = raw.indexOf('=')
  const key = eq === -1 ? raw : raw.slice(0, eq)
  const value = eq === -1 ? '' : raw.slice(eq + 1)
  if (key === 'Cwd' && value) cur.cwd = value
}

/** 已完成且有命令原文的块，按时间正序（喂给 AI 的就是这个视图） */
export function finishedBlocks(m: BlockModel): CommandBlock[] {
  return m.blocks.filter((b) => b.state === 'done' && b.command !== null)
}

/**
 * 给 AI 的上下文摘要：最近 limit 条命令 + 退出码 + 成败。
 * 输出正文不进摘要（体积与脱敏都不合适），只给行范围，需要时再去 buffer 取。
 */
export function toAiContext(m: BlockModel, limit = 10): string {
  const done = finishedBlocks(m).slice(-limit)
  if (!done.length) return ''
  return done
    .map((b) => {
      const verdict = b.exitCode === 0 ? 'ok' : b.exitCode === null ? 'unknown' : `exit=${b.exitCode}`
      const span = b.outputRow !== null && b.endRow !== null ? ` 行 ${b.outputRow}-${b.endRow}` : ''
      return `$ ${b.command} [${verdict}]${span}`
    })
    .join('\n')
}
