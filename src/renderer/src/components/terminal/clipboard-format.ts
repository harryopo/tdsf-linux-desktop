/**
 * 终端选区复制到剪贴板前的文本清洗
 *
 * 两个开关来自终端设置页：
 * - terminal.stripControlChars（默认开）：去掉 C0/C1 与 DEL 控制字符，
 *   但保留制表符 \t —— 终端里复制表格/对齐输出时制表符是要留着的
 * - terminal.stripNewline（默认关）：把换行去掉，用于复制被折行的长命令
 *
 * 单独一个模块是因为复制有两条链路都要它：选区浮层的「复制」按钮
 * 和 terminal.autoCopy（选中即复制）。写两份迟早会漂。
 */
export interface ClipboardPrefs {
  stripNewline: boolean
  stripControlChars: boolean
}

/** 控制字符：C0 里除 \t 外的全部 + DEL + C1 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g

export function formatTerminalClipboard(text: string, prefs: ClipboardPrefs): string {
  let out = text
  if (prefs.stripControlChars) out = out.replace(CONTROL_CHARS, '')
  if (prefs.stripNewline) out = out.replace(/\r?\n/g, '')
  return out
}
