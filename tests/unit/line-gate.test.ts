/**
 * PTY 逐键写入的行缓冲闸（P0-2）
 *
 * 纯逻辑单测，不需要 PTY。除判定本身，重点钉三件容易做错的事：
 * 1. 键入中（未回车）一律放行 —— 逐字符判会灾难性误拦
 * 2. 删除类控制键要同步缩缓冲 —— 否则拿用户已经删掉的字符判
 * 3. 全屏程序期间必须暂停 —— vim 插入模式里打一行 `rm -rf /` 不该被当 shell 命令拦
 */
import { describe, expect, it } from 'vitest'
import { LineGate } from '../../src/main/core/command-gate'

describe('LineGate · 键入与回车', () => {
  it('未回车不判，回车才判', () => {
    const g = new LineGate()
    expect(g.feed('rm -rf /').allow).toBe(true)
    const r = g.feed('\r')
    expect(r.allow).toBe(false)
    expect(r.notice).toContain('已拦截高危命令')
    expect(r.reason).toBeTruthy()
  })

  it('三种行分隔符都在同一次 feed 里触发判定', () => {
    for (const term of ['\n', '\r\n', '\r']) {
      const g = new LineGate()
      const r = g.feed(`rm -rf /${term}`)
      expect(r.allow, JSON.stringify(term)).toBe(false)
      expect(r.line, JSON.stringify(term)).toBe('rm -rf /')
    }
  })

  it('安全命令放行', () => {
    const g = new LineGate()
    expect(g.feed('ls -la').allow).toBe(true)
    expect(g.feed('\r').allow).toBe(true)
  })

  it('空回车放行', () => {
    const g = new LineGate()
    expect(g.feed('\r').allow).toBe(true)
  })

  it('拦下之后不留残余：下一次回车不会因为旧缓冲重复拦', () => {
    const g = new LineGate()
    g.feed('rm -rf /')
    expect(g.feed('\r').allow).toBe(false)
    expect(g.feed('ls').allow).toBe(true)
    expect(g.feed('\r').allow).toBe(true)
  })
})

describe('LineGate · 粘贴多行', () => {
  it('任一行危险就把整段写入拦掉', () => {
    const g = new LineGate()
    const r = g.feed('ls -la\nrm -rf /\ncat /etc/hosts\n')
    expect(r.allow).toBe(false)
    expect(r.line).toBe('rm -rf /')
  })

  it('全是安全行则放行，且最后一行的开头留在缓冲里', () => {
    const g = new LineGate()
    expect(g.feed('ls -la\ndf -h\npm').allow).toBe(true)
    // 'pm' 是下一行未完成的开头，跟着后面的字符一起判
    expect(g.feed('s -l\r').allow).toBe(true)
  })

  it('粘贴里第一条就危险时，后面的内容一并丢弃', () => {
    const g = new LineGate()
    expect(g.feed('echo hi\nrm -rf /\n').allow).toBe(false)
    // 缓冲已清空：后面的按键不会被上一条危险行连坐
    expect(g.feed('\r').allow).toBe(true)
  })
})

describe('LineGate · 控制键', () => {
  it('Ctrl-C 清缓冲，之后的回车没有内容', () => {
    const g = new LineGate()
    g.feed('rm -rf /')
    expect(g.feed('\x03').allow).toBe(true)
    expect(g.feed('\r').allow).toBe(true)
  })

  it('Ctrl-C 与后续文本同段到达时，后续文本仍要判（不能整段放行）', () => {
    const g = new LineGate()
    const r = g.feed('\x03rm -rf /\r')
    expect(r.allow).toBe(false)
    expect(r.line).toBe('rm -rf /')
  })

  it('Ctrl-D 同理：中断符之后的部分仍进判定', () => {
    const g = new LineGate()
    expect(g.feed('\x04rm -rf /\r').allow).toBe(false)
  })

  it('Ctrl-U 清行', () => {
    const g = new LineGate()
    g.feed('rm -rf /')
    expect(g.feed('\x15').allow).toBe(true)
    expect(g.feed('\r').allow).toBe(true)
  })

  it('Ctrl-W 回退一个词：把结尾的 `/` 删掉后就不再是 block', () => {
    // 配对对照：同一段按键不带 Ctrl-W 必须被拦，带了才放行 —— 否则这条判据证明不了 Ctrl-W 生效
    const without = new LineGate()
    without.feed('rm -rf /')
    expect(without.feed('\r').allow).toBe(false)

    const withCtrlW = new LineGate()
    withCtrlW.feed('rm -rf /')
    expect(withCtrlW.feed('\x17').allow).toBe(true)
    expect(withCtrlW.feed('\r').allow).toBe(true)
  })

  it('退格要同步缩缓冲：敲错再删掉的不该被当成命令', () => {
    const g = new LineGate()
    g.feed('rm -rf /')
    g.feed('\x7f\x7f\x7f\x7f\x7f\x7f\x7f\x7f\x7f') // 删光 9 个字符
    expect(g.feed('\r').allow).toBe(true)
  })

  it('reset() 清半行', () => {
    const g = new LineGate()
    g.feed('rm -rf /')
    g.reset()
    expect(g.feed('\r').allow).toBe(true)
  })

  it('绕过面：Ctrl-U 之后重打同一条命令，仍必须拦', () => {
    // 曾经的真漏洞：\x15 留在缓冲里，判定看到的首词是 `\x15rm` 而不是 `rm`，
    // 所有按命令名匹配的探测器一起落空 —— 命令照样被 shell 执行
    const g = new LineGate()
    g.feed('rm -rf /')
    g.feed('\x15')
    g.feed('rm -rf /')
    expect(g.feed('\r').allow).toBe(false)
  })

  it('任何控制字符都不许藏进首词', () => {
    for (const junk of ['\x00', '\x0c', '\x1b', '\x07', '\x01']) {
      const g = new LineGate()
      g.feed(`${junk}rm -rf /`)
      expect(g.feed('\r').allow, JSON.stringify(junk)).toBe(false)
    }
  })
})

describe('LineGate · 输入侧的转义序列', () => {
  it('方向键等 CSI 不进缓冲，不会拼出假命令', () => {
    const g = new LineGate()
    g.feed('\x1b[A\x1b[B\x1b[C\x1b[D')
    expect(g.feed('\r').allow).toBe(true)
  })

  it('括号粘贴标记会被抹掉，里面的命令照常判', () => {
    const g = new LineGate()
    const r = g.feed('\x1b[200~rm -rf /\x1b[201~\r')
    expect(r.allow).toBe(false)
    expect(r.line).toBe('rm -rf /')
  })
})

describe('LineGate · 全屏程序（vim/less/nano/htop）', () => {
  it('进入备用屏后暂停判定，退出后恢复', () => {
    const g = new LineGate()
    // shell 起 vim：vim 向终端写备用屏进入指令
    g.observeOutput('\x1b[?1049h\x1b[1;1H')
    expect(g.paused).toBe(true)
    // 插入模式里敲一行危险文本 + 回车：不能拦，也不能把提示写进文件
    expect(g.feed('rm -rf /\r').allow).toBe(true)
    // vim 退出
    g.observeOutput('\x1b[?1049l')
    expect(g.paused).toBe(false)
    expect(g.feed('\r').allow).toBe(true)
  })

  it('备用屏期间累积的内容在退出时被丢弃，不会隔屏连坐', () => {
    const g = new LineGate()
    g.observeOutput('\x1b[?1049h')
    g.feed('rm -rf /')
    g.observeOutput('\x1b[?1049l')
    expect(g.feed('\r').allow).toBe(true)
  })

  it('less 用的 ?47h/?47l 同样识别', () => {
    const g = new LineGate()
    g.observeOutput('\x1b[?47h')
    expect(g.paused).toBe(true)
    g.observeOutput('\x1b[?47l')
    expect(g.paused).toBe(false)
  })
})

describe('LineGate · 覆盖范围的诚实边界', () => {
  it('↑ 历史回溯拦不住：命令文本走输出侧回显，输入通道只有 ESC [ A', () => {
    const g = new LineGate()
    // 用户按 ↑ 调出昨天的 `rm -rf /`，再按回车
    expect(g.feed('\x1b[A').allow).toBe(true)
    expect(g.feed('\r').allow).toBe(true)
    // 这条断言是在声明"本闸不覆盖该路径"，不是放行得对：
    // 想覆盖只能靠 shell 集成的 OSC 633;E，而那时命令已在执行路上，只能审计不能阻止。
  })
})
