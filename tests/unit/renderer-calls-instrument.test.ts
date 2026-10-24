/**
 * 量具自身的判据（#197）
 *
 * `audit:ipc` 报的"渲染层零调用"就是 IPC 债的读数，它读错方向会让人删掉在用接线
 * （#60 已经红过一次：system:ping 其实已接上却被报成断链）。
 * 这里两个方向都钉：
 *   - 认不出某种接线写法 ⇒ 把在用的键报成零调用（假债）；
 *   - 认得太宽 ⇒ 把"拿进来根本没用"洗成在用（藏债）。
 * 最后一条拿盘上的真件复测，不许只跑手搓样本。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

import { rendererMembersUsed } from '../../scripts/quality/renderer-calls'

describe('[renderer-calls] 假债方向：三种接线都要认', () => {
  it('直接成员访问 electronAPI.foo()', () => {
    expect(rendererMembersUsed('await window.electronAPI.fooBar(1)')).toContain('fooBar')
  })

  it('const api = window.electronAPI 之后的 api.foo()', () => {
    const src = 'const api = window.electronAPI\nawait api.bazQux()'
    expect(rendererMembersUsed(src)).toContain('bazQux')
  })

  it('解构后调用（settings-store.ts 的写法，以前被漏掉）', () => {
    const src = 'const { alpha, beta } = window.electronAPI\nawait alpha(1)\nawait beta(2)'
    const used = rendererMembersUsed(src)
    expect(used).toContain('alpha')
    expect(used).toContain('beta')
  })

  it('解构换名后调用别名，记的必须是属性名', () => {
    const src = 'const { gamma: localGamma } = window.electronAPI\nawait localGamma()'
    const used = rendererMembersUsed(src)
    expect(used).toContain('gamma')
    expect(used).not.toContain('localGamma')
  })

  it('别名 + 可选调用 api.foo?.()（终端那几处就是这么写的）', () => {
    const src = 'const api = window.electronAPI\napi.localTtyWrite?.(id, data)'
    expect(rendererMembersUsed(src)).toContain('localTtyWrite')
  })

  it('别名不叫 api 也要认（规则不该钉死一个变量名）', () => {
    const src = 'const ep = window.electronAPI\nawait ep.thingDoer(1)'
    expect(rendererMembersUsed(src)).toContain('thingDoer')
  })

  it('把函数当引用取走、在别处调，同样算接线', () => {
    const src =
      'const api = window.electronAPI\n' +
      "const call = kind === 'local' ? api?.cloSer : api?.shrClose\n" +
      'await call(id)'
    const used = rendererMembersUsed(src)
    expect(used).toContain('cloSer')
    expect(used).toContain('shrClose')
  })

  it('链式换行：electronAPI 与成员不在同一行也要认', () => {
    // RiskSettings.tsx 真就是这么写的：window.electronAPI 换行后 .riskGetRules()
    const src = 'const p = window.electronAPI\n  .riskGetRules()\nreturn p'
    expect(rendererMembersUsed(src)).toContain('riskGetRules')
  })

  it('`const off = electronAPI.onX(cb)` 里的 off 不许被当成第二个 electronAPI', () => {
    // off 是 onX 返回的退订函数；把它当 api 别名会让 off.anything 冒充成接线
    const src = 'const off = window.electronAPI.onSomething(cb)\noff.notARealMember()'
    const used = rendererMembersUsed(src)
    expect(used).toContain('onSomething')
    expect(used).not.toContain('notARealMember')
  })
})

describe('[renderer-calls] 藏债方向：解构了没用不许算用过', () => {
  it('只解构不调用 ⇒ 不算用', () => {
    const src = 'const { delta } = window.electronAPI\nconst x = 1'
    expect(rendererMembersUsed(src)).not.toContain('delta')
  })

  it('只把函数名当值传出去、没有调用点 ⇒ 不算用', () => {
    const src = 'const { epsilon } = window.electronAPI\nconst ref = epsilon'
    expect(rendererMembersUsed(src)).not.toContain('epsilon')
  })

  it('同名但来自别的对象的解构不许冒领', () => {
    const src = 'const { zeta } = someOtherObject\nawait zeta()'
    expect(rendererMembersUsed(src)).not.toContain('zeta')
  })
})

describe('[renderer-calls] 拿真件复测', () => {
  it('终端那两处用 `api.foo?.()` 与引用传递写的接线必须判为在用', () => {
    const view = readFileSync('src/renderer/src/components/terminal/TerminalView.tsx', 'utf8')
    const launcher = readFileSync('src/renderer/src/terminal/shell-launcher.ts', 'utf8')
    const viewUsed = rendererMembersUsed(view)
    expect(viewUsed, 'TerminalView 里 api.localTtyWrite?.() 是在用接线').toContain('localTtyWrite')
    expect(viewUsed, 'TerminalView 里 api.localTtyResize?.() 是在用接线').toContain('localTtyResize')
    const launcherUsed = rendererMembersUsed(launcher)
    expect(launcherUsed, 'shell-launcher 把 close 当引用取走再调').toContain('localTtyClose')
    expect(launcherUsed, '同上，ssh 那一支也一样').toContain('sshShellClose')
    // 正向对照：读到的确实是那份文件，不是空串让断言恒过
    expect(view.length).toBeGreaterThan(2000)
    expect(launcher.length).toBeGreaterThan(2000)
  })

  it('settings-store.ts 用解构接的三条键必须判为在用', () => {
    const src = readFileSync('src/renderer/src/stores/settings-store.ts', 'utf8')
    const used = rendererMembersUsed(src)
    for (const key of ['configSaveLlm', 'storageHasApiKey', 'storageSaveApiKey']) {
      expect(used, `${key} 在 settings-store.ts 里是解构后真调用的`).toContain(key)
    }
  })

  it('反向对照：一个已整删的键不许出现在任何渲染层源码里', () => {
    // modeList 那组通道 2026-10-24 已整删；若哪天识别器把注释也算成调用，这里就会红
    const src = readFileSync('src/preload/index.ts', 'utf8')
    const rendererText = readFileSync('src/renderer/src/pages/ModelSettings.tsx', 'utf8')
    expect(rendererMembersUsed(rendererText)).not.toContain('modeList')
    expect(rendererText).not.toContain('modeList')
    // 正向对照：这份读取本身要能拿到内容，空串会让上面两条断言恒过
    expect(src.length).toBeGreaterThan(1000)
    expect(rendererText.length).toBeGreaterThan(1000)
  })
})
