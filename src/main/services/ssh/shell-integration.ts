/**
 * 远端 Shell 集成片段（#61）
 *
 * 干什么：往那台服务器上装一小段 shell 钩子，让它发 OSC 133/633 序列。
 * 消费端早就在了（renderer/src/terminal/block-collector.ts + block-model.ts），
 * 缺的是产端——没装集成的话连上普通服务器命令块永远是 0，
 * AI 拿到的「上一条命令」上下文也就是空的。
 *
 * 三条不许让步的规矩：
 * 1. **逐台确认**：主进程没有「顺手给所有会话都装上」的入口。
 *    渲染层必须对某个 sessionId 明确调 install，且界面要先展示将要写入的原文。
 * 2. **只走 SFTP，不代发 shell 命令**：安装/卸载都是读写两个固定文件
 *    （家目录下的集成脚本 + rc 文件里的标记块），于是既不用把 heredoc 塞进 exec
 *    去撞风险闸，也不会因为转义出错写坏用户的 rc。
 *    唯一走 exec 的是探测 `$HOME`/`$SHELL`，那是 echo，风险闸判 safe。
 * 3. **可撤销且幂等**：标记块有 BEGIN/END 两行注释包着，卸载只删这一段；
 *    重复安装先剥旧块再追加，不会把 rc 越写越长。
 *
 * 已知代价（确认框里明说，不藏）：bash 侧要占一个 DEBUG trap。
 * 如果那台机器自己装了 DEBUG 钩子（starship、bash-preexec 一类），集成会接管它；
 * 卸载后新开终端就恢复。
 */
import type {
  CommandResult,
  RemoteShellKind,
  ShellIntegrationResult,
  ShellIntegrationStatus,
} from '@shared/models'

/** 集成脚本的家目录相对文件名（路径由主进程定死，渲染层碰不到） */
export const SNIPPET_FILE = '.tdsf-shell-integration.sh'

/** rc 文件里标记块的两行注释界 */
export const MARKER_BEGIN = '# TDSF-SHELL-INTEGRATION-BEGIN'
export const MARKER_END = '# TDSF-SHELL-INTEGRATION-END'

/** 探测命令：一次拿回家目录与登录 shell；argv0 是 echo，风险闸判 safe */
export const PROBE_COMMAND = 'echo "$HOME|$SHELL"'

/**
 * bash 侧片段：PROMPT_COMMAND 收尾上一条并开新提示符，DEBUG trap 起手当前命令。
 * 正文用 String.raw 保住 \033 这类转义；shell 的 ${...} 会被 JS 当成插值，
 * 所以这里刻意只用不带花括号的写法（变量都在本文件里先赋过值，nounset 也安全）。
 */
const BASH_SNIPPET = String.raw`# TDSF 命令块集成（自动生成，请勿手改；界面上点「移除集成」会删掉本文件）
# 序列含义：OSC 133 A=提示符 B=命令开始 C=输出开始 D=结束（带退出码）；OSC 633 E=命令原文 P=属性
case "$-" in
  *i*) ;;
  *) return 0 ;;
esac
# 已经装过就退出：用函数是否存在判断，比查自定义变量更安全（用户的 rc 里可能开着 set -u）
if typeset -f __tdsf_prompt_cmd >/dev/null 2>&1; then return 0; fi
__tdsf_open=
__tdsf_armed=
__tdsf_prompt_orig=$PROMPT_COMMAND

__tdsf_osc() { printf '\033]%s;%s\007' "$1" "$2"; }

# 命令原文里的 ESC/BEL 会截断序列，换行与回车折成空格
__tdsf_clean() {
  printf '%s' "$1" | tr -d '\033\007' | tr '\n\r' '  '
}

__tdsf_prompt_cmd() {
  __tdsf_code=$?
  if [ -n "$__tdsf_prompt_orig" ]; then
    eval "$__tdsf_prompt_orig"
  fi
  if [ -n "$__tdsf_open" ]; then
    __tdsf_osc 133 "D;$__tdsf_code"
    __tdsf_open=
  fi
  __tdsf_osc 133 A
  __tdsf_osc 633 "P;Cwd=$PWD"
  # 第一次画提示符才起手：rc 还在往下执行的那些行（Ubuntu 默认 .bashrc 里的 [ -d ... ]）
  # 不是用户敲的命令，不该被切成命令块
  __tdsf_armed=1
}

__tdsf_preexec() {
  [ -n "$__tdsf_armed" ] || return
  case "$BASH_COMMAND" in
    __tdsf_*) return ;;
  esac
  [ -n "$__tdsf_open" ] && return
  __tdsf_open=1
  # history 1 给的是整行原文；$BASH_COMMAND 对复合命令只会给第一段
  __tdsf_line=$(HISTTIMEFORMAT= history 1 2>/dev/null | sed -e 's/^[[:space:]]*[0-9]*[[:space:]]*//')
  [ -n "$__tdsf_line" ] || __tdsf_line=$BASH_COMMAND
  __tdsf_osc 133 B
  __tdsf_osc 633 "E;$(__tdsf_clean "$__tdsf_line")"
  __tdsf_osc 133 C
}

PROMPT_COMMAND=__tdsf_prompt_cmd
trap __tdsf_preexec DEBUG
`

/** zsh 侧片段：precmd/preexec 是 zsh 原生钩子，命令原文就是 preexec 的第一个参数 */
const ZSH_SNIPPET = String.raw`# TDSF 命令块集成（自动生成，请勿手改；界面上点「移除集成」会删掉本文件）
# 序列含义：OSC 133 A=提示符 B=命令开始 C=输出开始 D=结束（带退出码）；OSC 633 E=命令原文 P=属性
[[ -o interactive ]] || return 0
if typeset -f __tdsf_precmd >/dev/null 2>&1; then return 0; fi
__tdsf_open=

__tdsf_osc() { printf '\033]%s;%s\007' "$1" "$2"; }

__tdsf_clean() {
  printf '%s' "$1" | tr -d '\033\007' | tr '\n\r' '  '
}

__tdsf_precmd() {
  __tdsf_code=$?
  if [ -n "$__tdsf_open" ]; then
    __tdsf_osc 133 "D;$__tdsf_code"
    __tdsf_open=
  fi
  __tdsf_osc 133 A
  __tdsf_osc 633 "P;Cwd=$PWD"
}

__tdsf_preexec() {
  __tdsf_open=1
  __tdsf_osc 133 B
  __tdsf_osc 633 "E;$(__tdsf_clean "$1")"
  __tdsf_osc 133 C
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd __tdsf_precmd
add-zsh-hook preexec __tdsf_preexec
`

/** 按登录 shell 的路径判断能装哪种集成 */
export function kindOfShell(shellPath: string): RemoteShellKind {
  const base = (shellPath ?? '').trim().split('/').pop() ?? ''
  if (base === 'bash') return 'bash'
  if (base === 'zsh') return 'zsh'
  return 'other'
}

/** 集成脚本要由哪个 rc 读进来（家目录相对名） */
export function rcFileFor(kind: RemoteShellKind): string | null {
  if (kind === 'bash') return '.bashrc'
  if (kind === 'zsh') return '.zshrc'
  return null
}

/** 给定 shell 类型返回集成脚本正文 */
export function buildSnippet(kind: RemoteShellKind): string {
  if (kind === 'bash') return BASH_SNIPPET
  if (kind === 'zsh') return ZSH_SNIPPET
  return ''
}

/** rc 文件里那一块的样子（确认框逐字展示的就是它；rc 由 shell 读，用 ~ 更短） */
export function buildRcBlock(): string {
  return `${MARKER_BEGIN}
if [ -f "$HOME/${SNIPPET_FILE}" ]; then
  . "$HOME/${SNIPPET_FILE}"
fi
${MARKER_END}`
}

/** rc 里有没有我们的标记块（只看行首，注释里提到这个词不算） */
export function hasRcBlock(rc: string): boolean {
  return rc.split('\n').some((line) => line.trimEnd().startsWith(MARKER_BEGIN))
}

/**
 * 剥掉标记块。
 * 见到 BEGIN 却找不到 END（上次写坏 / 用户手删半截）时删到文件尾——
 * 留着一段没有 END 的块会让下次安装再叠一块，rc 里出现两个钩子。
 */
export function stripRcBlock(rc: string): string {
  const lines = rc.split('\n')
  const out: string[] = []
  let skipping = false
  for (const line of lines) {
    const trimmed = line.trimEnd()
    if (!skipping && trimmed.startsWith(MARKER_BEGIN)) {
      skipping = true
      continue
    }
    if (skipping) {
      if (trimmed.startsWith(MARKER_END)) skipping = false
      continue
    }
    out.push(line)
  }
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
  return text === '' ? '' : `${text}\n`
}

/** 幂等地把标记块放到 rc 末尾（先剥旧的再追加） */
export function withRcBlock(rc: string): string {
  const base = stripRcBlock(rc)
  const block = buildRcBlock()
  if (base === '') return `${block}\n`
  return `${base}\n${block}\n`
}

/** 探测命令的输出解析：`echo "$HOME|$SHELL"` → { home, shell } */
export function parseProbe(stdout: string): { home: string; shell: string } {
  const firstLine = (stdout ?? '').split('\n')[0] ?? ''
  const sep = firstLine.indexOf('|')
  if (sep === -1) return { home: '', shell: firstLine.trim() }
  return { home: firstLine.slice(0, sep).trim(), shell: firstLine.slice(sep + 1).trim() }
}

/**
 * 主进程侧用到的远端能力，全部按 sessionId 定位。
 * 单独声明成接口是为了让单测塞一个假会话进来，
 * 不必真连一台机器也能钉住「写了哪两个文件、卸载剩什么」。
 * 状态与结果的形状是 IPC 载荷，定义在 @shared/models（那里是单一来源）。
 */
export interface RemoteFs {
  exec(sessionId: string, command: string): Promise<CommandResult>
  stat(sessionId: string, remotePath: string): Promise<unknown | null>
  readFile(sessionId: string, remotePath: string): Promise<string>
  writeFile(sessionId: string, remotePath: string, content: string): Promise<boolean>
  unlink(sessionId: string, remotePath: string): Promise<boolean>
}

/** 集成服务：状态 / 安装 / 卸载，路径一律家目录相对且由本模块定死 */
export class ShellIntegrationService {
  constructor(private readonly remote: RemoteFs) {}

  async status(sessionId: string): Promise<ShellIntegrationStatus> {
    const probe = await this.remote.exec(sessionId, PROBE_COMMAND)
    if (probe.exitCode !== 0) {
      throw new Error(
        `探测远端 shell 失败（退出码 ${probe.exitCode}）：${(probe.stderr || probe.stdout).trim() || '无输出'}`,
      )
    }
    const { shell } = parseProbe(probe.stdout)
    const kind = kindOfShell(shell)
    const rcFile = rcFileFor(kind)

    if (kind === 'other' || !rcFile) {
      return {
        shellPath: shell,
        kind,
        rcFile: null,
        snippetFile: SNIPPET_FILE,
        installed: false,
        snippetMissing: false,
        snippetText: '',
        rcBlockText: '',
        message: `登录 shell 是 ${shell || '未知'}，命令块集成只支持 bash 与 zsh`,
      }
    }

    const rc = await this.readRc(sessionId, rcFile)
    const rcHasBlock = hasRcBlock(rc)
    const snippetExists = (await this.remote.stat(sessionId, SNIPPET_FILE)) !== null
    return {
      shellPath: shell,
      kind,
      rcFile,
      snippetFile: SNIPPET_FILE,
      installed: rcHasBlock && snippetExists,
      snippetMissing: rcHasBlock && !snippetExists,
      snippetText: buildSnippet(kind),
      rcBlockText: buildRcBlock(),
      message: rcHasBlock
        ? snippetExists
          ? `已安装：~/${rcFile} 会读入 ~/${SNIPPET_FILE}`
          : `rc 里有集成块，但 ~/${SNIPPET_FILE} 不见了，重新写入即可`
        : `未安装：会往 ~/${rcFile} 追加 5 行，并创建 ~/${SNIPPET_FILE}`,
    }
  }

  /**
   * 写入集成。
   * 顺序是「先脚本后 rc」：中途失败最坏是家目录多一个没人读的文件，
   * 反过来（先改 rc）会留下一个指向不存在脚本的 rc，那种状态更难解释。
   */
  async install(sessionId: string): Promise<ShellIntegrationResult> {
    const st = await this.status(sessionId)
    if (st.kind === 'other' || !st.rcFile) return { ok: false, message: st.message }
    await this.remote.writeFile(sessionId, st.snippetFile, st.snippetText)
    const rc = await this.readRc(sessionId, st.rcFile)
    await this.remote.writeFile(sessionId, st.rcFile, withRcBlock(rc))
    return {
      ok: true,
      message: `已写入 ~/${st.rcFile} 与 ~/${st.snippetFile}，新开一个终端才会生效`,
    }
  }

  /** 卸载：rc 还原成没有标记块的样子，脚本删掉；两处都容错「本来就没有」 */
  async uninstall(sessionId: string): Promise<ShellIntegrationResult> {
    const st = await this.status(sessionId)
    if (st.kind === 'other' || !st.rcFile) return { ok: false, message: st.message }
    const rc = await this.readRc(sessionId, st.rcFile)
    await this.remote.writeFile(sessionId, st.rcFile, stripRcBlock(rc))
    let removed = false
    try {
      if (await this.remote.stat(sessionId, st.snippetFile)) {
        removed = await this.remote.unlink(sessionId, st.snippetFile)
      }
    } catch {
      // 删不掉也不谎报「已移除」：rc 已经干净，脚本留着不会再被读到
      removed = false
    }
    return {
      ok: true,
      message: removed
        ? `已从 ~/${st.rcFile} 移除集成块，并删掉 ~/${st.snippetFile}`
        : `已从 ~/${st.rcFile} 移除集成块（~/${st.snippetFile} 本来就不在或没删掉，它不会再被读到）`,
    }
  }

  /** rc 不存在按空串处理：安装时会创建，内容只有我们的块 */
  private async readRc(sessionId: string, rcFile: string): Promise<string> {
    try {
      if ((await this.remote.stat(sessionId, rcFile)) === null) return ''
      return await this.remote.readFile(sessionId, rcFile)
    } catch {
      return ''
    }
  }
}
