/**
 * 远端 Shell 集成片段判据（#61）
 *
 * 片段正文本身已在真机验过：WSL Ubuntu 24.04 的 bash 5.2 与 zsh 各起一个交互式 shell，
 * 敲 echo/false/ls 三条，输出里依次出现 ]133;A、]633;P;Cwd=、]133;B、]633;E;<原文>、]133;C、]133;D;<退出码>，
 * 退出码与命令原文都对得上。这里钉的是**结构与可撤销性**——
 * 装上去能拆干净、重复装不会把 rc 写长、不可用的 shell 上一个字节都不写。
 */
import { describe, it, expect, vi } from 'vitest'
import { assertCommandAllowed } from '@main/core/command-gate'
import {
  MARKER_BEGIN,
  MARKER_END,
  PROBE_COMMAND,
  SNIPPET_FILE,
  ShellIntegrationService,
  buildRcBlock,
  buildSnippet,
  hasRcBlock,
  kindOfShell,
  parseProbe,
  rcFileFor,
  stripRcBlock,
  withRcBlock,
  type RemoteFs,
} from '@main/services/ssh/shell-integration'
import type { ShellIntegrationStatus } from '@shared/models'

describe('shell 类型识别', () => {
  it('登录 shell 按文件名判定，路径前缀不算', () => {
    expect(kindOfShell('/bin/bash')).toBe('bash')
    expect(kindOfShell('/usr/local/bin/zsh')).toBe('zsh')
    expect(kindOfShell('/usr/bin/fish')).toBe('other')
    expect(kindOfShell('')).toBe('other')
  })

  it('只支持 bash 与 zsh，其他 shell 没有 rc 目标', () => {
    expect(rcFileFor('bash')).toBe('.bashrc')
    expect(rcFileFor('zsh')).toBe('.zshrc')
    expect(rcFileFor('other')).toBeNull()
  })
})

describe('探测命令', () => {
  it('风险闸判它不是高危命令（安装路径唯一一次 exec 必须能过闸）', () => {
    expect(() => assertCommandAllowed(PROBE_COMMAND)).not.toThrow()
  })

  it('一次回显拿回家目录与登录 shell', () => {
    expect(parseProbe('/home/op|/bin/bash\n')).toEqual({ home: '/home/op', shell: '/bin/bash' })
  })

  it('没有分隔符时不猜家目录，只把整行当 shell', () => {
    expect(parseProbe('/bin/bash\n')).toEqual({ home: '', shell: '/bin/bash' })
  })

  it('空输出退化成空字符串，不抛', () => {
    expect(parseProbe('')).toEqual({ home: '', shell: '' })
  })
})

describe('rc 标记块', () => {
  it('块的第一行是 BEGIN、最后一行是 END', () => {
    const lines = buildRcBlock().split('\n')
    expect(lines[0]).toBe(MARKER_BEGIN)
    expect(lines[lines.length - 1]).toBe(MARKER_END)
  })

  it('普通 rc 判不出块，注释里提到这个词也不算', () => {
    expect(hasRcBlock('export PS1="\\u\\h$ "\n')).toBe(false)
    expect(hasRcBlock(`# 我用过 ${MARKER_BEGIN.slice(2)} 这个标记\n`)).toBe(false)
    expect(hasRcBlock(withRcBlock('export PS1="x"\n'))).toBe(true)
  })

  it('重复安装只留一块，原有内容一字不动', () => {
    const original = 'alias ll="ls -al"\nexport EDITOR=vim\n'
    let rc = withRcBlock(original)
    rc = withRcBlock(rc)
    rc = withRcBlock(rc)
    expect(rc.split(MARKER_BEGIN).length - 1).toBe(1)
    expect(rc.startsWith(original)).toBe(true)
  })

  it('剥块能还原成原样，包括本来就没有块的情况', () => {
    const original = 'alias ll="ls -al"\n'
    expect(stripRcBlock(withRcBlock(original))).toBe(original)
    expect(stripRcBlock(original)).toBe(original)
    expect(stripRcBlock('')).toBe('')
  })

  it('见到 BEGIN 找不到 END 时删到文件尾，不再叠第二块', () => {
    const broken = `export A=1\n${MARKER_BEGIN}\nif [ -f x ]; then\n`
    expect(stripRcBlock(broken)).toBe('export A=1\n')
  })

  it('块里被用户手插的行也一起删（这块本来就是自动生成的）', () => {
    const rc = `export A=1\n${MARKER_BEGIN}\n  echo 我加的\n${MARKER_END}\nexport B=2\n`
    expect(stripRcBlock(rc)).toBe('export A=1\nexport B=2\n')
  })
})

describe('集成片段正文', () => {
  for (const kind of ['bash', 'zsh'] as const) {
    it(`${kind} 片段发全消费端要的那六个序列`, () => {
      const text = buildSnippet(kind)
      expect(text).toContain(String.raw`printf '\033]%s;%s\007'`)
      expect(text).toContain(String.raw`__tdsf_osc 133 A`)
      expect(text).toContain(String.raw`__tdsf_osc 133 B`)
      expect(text).toContain(String.raw`__tdsf_osc 133 C`)
      expect(text).toContain(String.raw`__tdsf_osc 133 "D;$__tdsf_code"`)
      expect(text).toContain(String.raw`__tdsf_osc 633 "E;`)
      expect(text).toContain(String.raw`__tdsf_osc 633 "P;Cwd=`)
    })

    it(`${kind} 片段里的花括号展开没被 JS 模板插值吃掉`, () => {
      // String.raw 只保反斜杠、不保 ${：正文若出现半个 ${ 说明改写时把插值丢了。
      // 现在两份正文刻意不用 ${...}（花括号在 nounset 下更安全），所以这里查的是「不该有」。
      expect(buildSnippet(kind)).not.toContain('${')
      expect(buildSnippet(kind)).toContain('# TDSF 命令块集成')
    })
  }

  it('bash 片段自己声明它占了 DEBUG trap', () => {
    expect(buildSnippet('bash')).toContain('trap __tdsf_preexec DEBUG')
  })

  it('bash 片段要等第一次画提示符才起手（真靶子上 rc 剩余行会被当成命令，产出假块）', () => {
    const bash = buildSnippet('bash')
    expect(bash).toContain('__tdsf_armed=1')
    expect(bash).toContain('[ -n "$__tdsf_armed" ] || return')
  })

  it('other 类型没有正文', () => {
    expect(buildSnippet('other')).toBe('')
  })
})

/**
 * 假远端：内存文件系统 + 可编排的探测回显。
 * 形状与真实现一致（SshConnectionManager.exec 返回 CommandResult，
 * ElectermSftpManager.stat 返回对象或 null，readFile 缺文件时抛）。
 */
function makeRemote(probeStdout = '/home/teach|/bin/bash\n', probeExitCode = 0) {
  const files = new Map<string, string>()
  const remote: RemoteFs = {
    exec: vi.fn(async () => ({
      exitCode: probeExitCode,
      stdout: probeStdout,
      stderr: probeExitCode === 0 ? '' : 'bash: echo: not found',
      duration: 1,
    })),
    stat: vi.fn(async (_sessionId: string, p: string) => (files.has(p) ? { name: p } : null)),
    readFile: vi.fn(async (_sessionId: string, p: string) => {
      const v = files.get(p)
      if (v === undefined) throw new Error(`远程文件不存在: ${p}`)
      return v
    }),
    writeFile: vi.fn(async (_sessionId: string, p: string, content: string) => {
      files.set(p, content)
      return true
    }),
    unlink: vi.fn(async (_sessionId: string, p: string) => files.delete(p)),
  }
  const calls = (m: RemoteFs[keyof RemoteFs]) => (m as ReturnType<typeof vi.fn>).mock.calls
  return { remote, files, calls }
}

describe('安装 / 卸载流程', () => {
  it('安装先写脚本再改 rc，且只发一条探测命令', async () => {
    const { remote, files, calls } = makeRemote()
    files.set('.bashrc', 'alias ll="ls -al"\n')
    const svc = new ShellIntegrationService(remote)
    const res = await svc.install('s')
    expect(res.ok).toBe(true)
    expect(calls(remote.exec)).toHaveLength(1)
    expect(calls(remote.writeFile).map((c) => c[1])).toEqual([SNIPPET_FILE, '.bashrc'])
    expect(files.get(SNIPPET_FILE)).toBe(buildSnippet('bash'))
    expect(files.get('.bashrc')).toContain('alias ll="ls -al"')
    expect(hasRcBlock(files.get('.bashrc') ?? '')).toBe(true)
  })

  it('rc 原本不存在时创建出来，内容只有标记块', async () => {
    const { remote, files } = makeRemote()
    const svc = new ShellIntegrationService(remote)
    await svc.install('s')
    expect(files.get('.bashrc')).toBe(`${buildRcBlock()}\n`)
  })

  it('重复安装不再增长，脚本正文一致', async () => {
    const { remote, files } = makeRemote()
    files.set('.bashrc', 'export A=1\n')
    const svc = new ShellIntegrationService(remote)
    await svc.install('s')
    const afterFirst = files.get('.bashrc')
    await svc.install('s')
    expect(files.get('.bashrc')).toBe(afterFirst)
  })

  it('卸载后 rc 回到原样、脚本消失；再卸一次也不报错且不重复删', async () => {
    const { remote, files, calls } = makeRemote()
    const original = 'export A=1\nexport B=2\n'
    files.set('.bashrc', original)
    const svc = new ShellIntegrationService(remote)
    await svc.install('s')
    expect((await svc.uninstall('s')).ok).toBe(true)
    expect(files.get('.bashrc')).toBe(original)
    expect(files.has(SNIPPET_FILE)).toBe(false)
    expect((await svc.uninstall('s')).ok).toBe(true)
    expect(calls(remote.unlink)).toHaveLength(1)
    expect(files.get('.bashrc')).toBe(original)
  })

  it('登录 shell 不支持时一个字节都不写', async () => {
    const { remote, files, calls } = makeRemote('/home/teach|/usr/bin/fish\n')
    const svc = new ShellIntegrationService(remote)
    const res = await svc.install('s')
    expect(res.ok).toBe(false)
    expect(res.message).toContain('只支持 bash 与 zsh')
    expect(files.size).toBe(0)
    expect(calls(remote.exec)).toHaveLength(1)
  })

  it('探测失败（退出码非 0）时抛出真实原因，不静默当成未安装', async () => {
    const { remote } = makeRemote('', 127)
    const svc = new ShellIntegrationService(remote)
    await expect(svc.status('s')).rejects.toThrow(/退出码 127[\s\S]*not found/)
  })

  it('zsh 用户写的是 .zshrc，不碰 .bashrc', async () => {
    const { remote, files } = makeRemote('/home/teach|/bin/zsh\n')
    files.set('.bashrc', 'export A=1\n')
    const svc = new ShellIntegrationService(remote)
    await svc.install('s')
    expect(files.get('.bashrc')).toBe('export A=1\n')
    expect(hasRcBlock(files.get('.zshrc') ?? '')).toBe(true)
    expect(files.get(SNIPPET_FILE)).toBe(buildSnippet('zsh'))
  })

  it('状态：装齐了算已安装，脚本被手删算 snippetMissing', async () => {
    const { remote, files } = makeRemote()
    const svc = new ShellIntegrationService(remote)
    const before: ShellIntegrationStatus = await svc.status('s')
    expect(before.installed).toBe(false)
    await svc.install('s')
    expect((await svc.status('s')).installed).toBe(true)
    files.delete(SNIPPET_FILE)
    const st = await svc.status('s')
    expect(st.installed).toBe(false)
    expect(st.snippetMissing).toBe(true)
    expect(st.message).toContain('不见了')
  })

  it('状态把要写入的两处原文都带出来（确认框逐字展示的就是它）', async () => {
    const { remote } = makeRemote()
    const svc = new ShellIntegrationService(remote)
    const st = await svc.status('s')
    expect(st.snippetText).toBe(buildSnippet('bash'))
    expect(st.rcBlockText).toBe(buildRcBlock())
    expect(st.rcFile).toBe('.bashrc')
    expect(st.snippetFile).toBe(SNIPPET_FILE)
    expect(st.shellPath).toBe('/bin/bash')
  })
})
