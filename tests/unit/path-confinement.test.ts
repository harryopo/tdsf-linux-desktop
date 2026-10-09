/**
 * 本地路径 confinement 判据（2026-10-09 安全审查 S3 / P0-4）
 *
 * 钉四件事，每条都跑真判定而不是读源码字符串：
 * 1. Windows 形态的攻击串在**任何主机**上都被拒（注入 win32 路径语义，Linux CI 也测得到）；
 * 2. 前缀陷阱：`tdsf-desktop` 是根时，`tdsf-desktop-evil` 不能算在里面（少了补分隔符这一步就会漏）；
 * 3. 两条合法来源各自成立：受管根之内、对话框授权之内（阴性对照——该放的必须放）；
 * 4. 受管根是配置进来的：没配 → 全拒；配了 → 才放（证明这道闸真有执行体）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import * as nodePath from 'node:path'
import {
  approveDialogPath,
  assertWithinConfinement,
  checkLocalPath,
  configurePathConfinement,
  resetDialogApprovalsForTest,
} from '../../src/main/services/security/path-confinement'

const WIN = nodePath.win32
const POSIX = nodePath.posix
const WIN_ROOT = 'C:\\Users\\op\\AppData\\Roaming\\tdsf-desktop'
const POSIX_ROOT = '/home/op/.config/tdsf'

function winOpts(extra: Record<string, unknown> = {}): Parameters<typeof checkLocalPath>[2] {
  return { roots: [WIN_ROOT], caseInsensitive: true, pathApi: WIN, ...extra }
}

describe('confinement · Windows 形态攻击串', () => {
  it('系统目录必拒', () => {
    const v = checkLocalPath('C:\\Windows\\System32\\drivers\\etc\\hosts', 'write', winOpts())
    expect(v.ok, v.reason).toBe(false)
  })

  it('大小写变体也必拒（比较不分大小写时才算真挡住）', () => {
    expect(checkLocalPath('c:\\windows\\system32\\x.dll', 'write', winOpts()).ok).toBe(false)
  })

  it('用 .. 从受管目录往外爬必拒', () => {
    const escape = `${WIN_ROOT}\\..\\..\\..\\Windows\\evil.exe`
    expect(checkLocalPath(escape, 'write', winOpts()).ok).toBe(false)
  })

  it('相对路径不接受（它意味着"相对于主进程 cwd"，而 cwd 不由用户挑）', () => {
    expect(checkLocalPath('uploads/../../x', 'write', winOpts()).ok).toBe(false)
    expect(checkLocalPath('C:x.txt', 'write', winOpts()).ok).toBe(false)
  })

  it('UNC 不接受：Windows 会按 SMB 发起连接，把当前用户凭据送出去', () => {
    expect(checkLocalPath('\\\\fileserver\\share\\x.docx', 'write', winOpts()).ok).toBe(false)
  })

  it('NUL 截断不接受', () => {
    expect(checkLocalPath(`${WIN_ROOT}\\ok.txt\0.lnk`, 'write', winOpts()).ok).toBe(false)
  })

  it('非字符串一律不接受（渲染层能传任何值）', () => {
    for (const bad of [undefined, null, 42, {}, [], true, '']) {
      expect(checkLocalPath(bad, 'write', winOpts()).ok, String(bad)).toBe(false)
    }
  })

  it('前缀陷阱：根是 tdsf-desktop 时 tdsf-desktop-evil 不算在里面', () => {
    const v = checkLocalPath(`${WIN_ROOT}-evil\\start.txt`, 'write', winOpts())
    expect(v.ok, '只在末尾补分隔符才不会漏这一条').toBe(false)
  })

  it('阴性对照：受管目录内的路径确实放行了（否则上面的红是量具坏了）', () => {
    const v = checkLocalPath(`${WIN_ROOT}\\exports\\report.pdf`, 'write', winOpts())
    expect(v.ok, v.reason).toBe(true)
    expect(v.resolved).toBe(WIN.resolve(`${WIN_ROOT}\\exports\\report.pdf`))
  })

  it('阴性对照：大小写不同的受管目录内路径也放行', () => {
    expect(checkLocalPath(`${WIN_ROOT.toLowerCase()}\\exports\\a.md`, 'read', winOpts()).ok).toBe(true)
  })
})

describe('confinement · POSIX 形态', () => {
  const opts = { roots: [POSIX_ROOT], caseInsensitive: false, pathApi: POSIX }
  it('/etc/passwd 必拒', () => {
    expect(checkLocalPath('/etc/passwd', 'read', opts).ok).toBe(false)
  })
  it('兄弟目录前缀陷阱必拒', () => {
    expect(checkLocalPath('/home/op/.config/tdsf_evil/x', 'read', opts).ok).toBe(false)
  })
  it('双斜杠开头必拒', () => {
    expect(checkLocalPath('//attacker/share/x', 'read', opts).ok).toBe(false)
  })
  it('受管目录内放行', () => {
    expect(checkLocalPath(`${POSIX_ROOT}/exports/a.md`, 'write', opts).ok).toBe(true)
  })
})

describe('confinement · 对话框授权', () => {
  beforeEach(() => resetDialogApprovalsForTest())

  it('没授权过的目录外路径被拒，授权过的同一路径被放', () => {
    const picked = nodePath.resolve('outside-picked-by-user.txt')
    expect(checkLocalPath(picked, 'read', { roots: [] }).ok).toBe(false)
    approveDialogPath(picked)
    expect(checkLocalPath(picked, 'read', { roots: [] }).ok).toBe(true)
  })

  it('授权是按精确路径给的，不是"选了目录就能写整棵子树"', () => {
    const picked = nodePath.resolve('picked-one.txt')
    approveDialogPath(picked)
    const sibling = nodePath.resolve('picked-two.txt')
    expect(checkLocalPath(sibling, 'write', { roots: [] }).ok).toBe(false)
  })

  it('授权集有上限：超过 200 条后最早那条失效（长会话不无界增长）', () => {
    const first = nodePath.resolve('first.txt')
    approveDialogPath(first)
    for (let i = 0; i < 201; i++) approveDialogPath(nodePath.resolve(`filler-${i}.txt`))
    expect(checkLocalPath(first, 'read', { roots: [] }).ok).toBe(false)
  })
})

describe('confinement · 受管根是配置进来的', () => {
  it('不配根 → 什么路径都进不去；配了才认（这道闸真有执行体）', () => {
    resetDialogApprovalsForTest()
    configurePathConfinement(() => [])
    const inside = nodePath.resolve('report.pdf')
    expect(checkLocalPath(inside, 'write').ok).toBe(false)

    configurePathConfinement(() => [nodePath.parse(inside).dir])
    expect(checkLocalPath(inside, 'write').ok).toBe(true)

    // 还原成"没有根"，避免污染同批次其它用例
    configurePathConfinement(() => [])
  })
})

describe('confinement · assertWithinConfinement', () => {
  it('被拒时抛出的是拒因，不是 undefined', () => {
    expect(() => assertWithinConfinement('C:\\Windows\\x', 'write', winOpts())).toThrow(/受管目录|绝对路径|不允许|不在/)
  })
  it('放行时返回规范化绝对路径（调用方直接用返回值，不再信任原串）', () => {
    const out = assertWithinConfinement(`${WIN_ROOT}\\exports\\a.md`, 'write', winOpts())
    expect(out).toBe(WIN.resolve(`${WIN_ROOT}\\exports\\a.md`))
  })
})
