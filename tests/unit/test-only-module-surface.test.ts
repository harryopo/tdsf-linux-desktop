/**
 * 测试独占模块的常驻判据（2026-10-25 #225）
 *
 * 判决形状：实现有、单测有、生产链路零调用者。这类东西最贵，因为下一个人读到
 * `edit-formats/editblock.ts` 里那套三级模糊匹配会以为"AI 改文件"能做，实际上没有任何入口调它。
 * 处置口径与本仓 #216/#218/#222 一致：整删，代码只留在 git 历史。
 *
 * 本批判掉两个模块：
 * - `src/main/core/agent/edit-formats/`（dirty-commit / editblock / strategy-selector，838 行）
 *   12 个导出在 src 外部引用 0 处；它的 `strategy-selector.ts` 自己写着"patch 格式（V4A）暂未实现"。
 *   "改文件"这件事本来由谁做：界面上的编辑器保存走 `sftpWriteFile` 整文件写回（EditorArea.tsx），
 *   AI 侧压根没有写本地文件的工具（`core/agent/tools/` 只有 chat-tool-router / external-mcp-tools / output-limit）。
 * - `src/main/core/agent/providers/ollama-autodetect.ts`（160 行）
 *   只有 `tests/unit/provider-factory-enhanced.test.ts` 用动态 import 引它。界面选 Ollama 时拿的是
 *   `provider-templates.ts` 里的默认 baseURL，模型名由用户自己填；没有任何界面承诺"自动探测本地模型"。
 *
 * 判据怎么才不会自己变哑：第 2 条先证明扫描面非空，第 5 条把"必须抽得到"与"不许误伤"两向都喂进
 * 同一个扫描函数，第 4 条顺手把豁免名单的死引用也钉住（名单指向已删文件 = 下一轮没人知道自己免了什么）。
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..', '..')

const GONE_FILES = [
  'src/main/core/agent/edit-formats/dirty-commit.ts',
  'src/main/core/agent/edit-formats/editblock.ts',
  'src/main/core/agent/edit-formats/strategy-selector.ts',
  'src/main/core/agent/providers/ollama-autodetect.ts',
]

/** 按形状禁，不按文件名单禁：这些名字在 src 里再出现就说明模块被悄悄搬回来了 */
const BANNED_SHAPES = [
  'edit-formats',
  'ollama-autodetect',
  'autodetectOllamaModels',
  'DEFAULT_OLLAMA_BASE_URL',
  'applyEditBlock',
  'parseEditBlocks',
  'EditBlock',
  'checkDirtyCommit',
  'DirtyCommitCheck',
  'selectStrategy',
  'EditStrategy',
]

/** 递归收集 src 下 .ts/.tsx 正文，跳过被禁模块自己（判据要能在删除前后都跑） */
function collectSourceText(dir: string): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const abs = join(current, entry)
      if (statSync(abs).isDirectory()) {
        walk(abs)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue
      out.push({ file: relative(ROOT, abs).replace(/\\/g, '/'), text: readFileSync(abs, 'utf8') })
    }
  }
  walk(dir)
  return out
}

/** 在给定正文里找禁用形状，返回命中的形状名（去重） */
function bannedHits(text: string): string[] {
  return BANNED_SHAPES.filter((shape) => text.includes(shape))
}

describe('测试独占模块整删后的常驻形状判据（#225）', () => {
  it('1. 四个文件与那个目录都不在盘上', () => {
    for (const rel of GONE_FILES) {
      expect(existsSync(join(ROOT, rel)), `还在盘上：${rel}`).toBe(false)
    }
    expect(existsSync(join(ROOT, 'src/main/core/agent/edit-formats'))).toBe(false)
    // 专属测试与它一起走：留着就是在供一个没人调用的模块
    expect(existsSync(join(ROOT, 'tests/unit/edit-formats.test.ts'))).toBe(false)
  })

  it('2. src 全树按形状抽不到任何一个禁用名（且扫描面不是空的）', () => {
    const files = collectSourceText(join(ROOT, 'src'))
    // 先证明扫得到东西：面为空时"0 命中"没有意义
    expect(files.length).toBeGreaterThanOrEqual(400)
    const bytes = files.reduce((sum, f) => sum + f.text.length, 0)
    expect(bytes).toBeGreaterThan(200_000)

    const hits = files
      .map((f) => ({ file: f.file, shapes: bannedHits(f.text) }))
      .filter((f) => f.shapes.length > 0)
    expect(hits, `这些文件还留着已判掉的形状：${JSON.stringify(hits)}`).toEqual([])
  })

  it('3. 反过度砍：真正在跑的"改文件"与 provider 路必须还在', () => {
    const editor = readFileSync(join(ROOT, 'src/renderer/src/components/workbench/EditorArea.tsx'), 'utf8')
    expect(editor).toContain('sftpWriteFile')

    const templates = readFileSync(join(ROOT, 'src/main/core/agent/providers/provider-templates.ts'), 'utf8')
    expect(templates, '模板表还在、还在给默认 baseURL').toContain('https://api.deepseek.com/v1')

    // ProviderType 联合与工厂还在（删的是本地模型这一档，不是整个 provider 抽象）
    expect(existsSync(join(ROOT, 'src/main/core/agent/providers/provider-factory.ts'))).toBe(true)
    const types = readFileSync(join(ROOT, 'src/shared/agent-types.ts'), 'utf8')
    expect(types).toContain("'anthropic'")
  })

  it('4. 外部命令豁免名单不许留死引用', () => {
    const text = readFileSync(join(ROOT, 'tests/unit/run-command.test.ts'), 'utf8')
    const block = text.slice(text.indexOf('const EXEMPT'), text.indexOf('/** 找出一个文件里'))
    expect(block.length).toBeGreaterThan(0)
    const keys = [...block.matchAll(/'(src\/[^']+\.ts)':/g)].map((m) => m[1])
    expect(keys.length).toBeGreaterThanOrEqual(3)
    for (const key of keys) {
      expect(existsSync(join(ROOT, key)), `豁免名单指向了不存在的文件：${key}`).toBe(true)
    }
  })

  it('5. 量具自证：坏形状必须抽得到，活代码不许误伤', () => {
    // 注入正样本——这两行就是被删模块的调用形状
    expect(bannedHits('const r = applyEditBlock(content, blocks)')).toContain('applyEditBlock')
    expect(bannedHits("await import('./ollama-autodetect')")).toContain('ollama-autodetect')

    // 不误伤：provider 侧真在跑的正文（模板表）不含任何被禁形状
    const templates = readFileSync(join(ROOT, 'src/main/core/agent/providers/provider-templates.ts'), 'utf8')
    expect(templates).toContain('api.deepseek.com')
    expect(bannedHits(templates)).toEqual([])
  })

  it('6. 文档按"那一节讲的是什么"禁：能力面不许提，判决面必须留痕', () => {
    // 一刀切 grep 会把自己的记账文字也算成违规，所以按节取数：
    // A/B 组与 README 的功能面 = "现在能用/有条件能用"，这两个名字出现在那里就是谎报；
    // C 组 = 判决台账，必须点得出被删的东西，否则等于假装没发生过。
    const ledger = readFileSync(join(ROOT, 'docs/功能实景清单.md'), 'utf8')
    const ab = slice(ledger, '## A 组', '## C 组', '实景清单 A/B 面')
    expect(ab.includes('edit-formats'), 'A/B 面把已删模块写成可用能力').toBe(false)
    expect(ab.includes('ollama-autodetect'), 'A/B 面把已删模块写成可用能力').toBe(false)

    const cGroup = slice(ledger, '## C 组', '## D 组', '实景清单 C 组')
    expect(cGroup).toContain('edit-formats')
    expect(cGroup).toContain('ollama-autodetect')
    expect(cGroup).toContain('#225')

    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
    const features = slice(readme, '## 功能', '## 快速开始', 'README 功能面')
    expect(features.includes('edit-formats')).toBe(false)
    expect(features.includes('ollama-autodetect')).toBe(false)
    const limits = slice(readme, '## 已知边界', '## 贡献', 'README 已知边界')
    expect(limits.includes('edit-formats')).toBe(false)
    expect(limits.includes('ollama-autodetect')).toBe(false)
  })
})

/** 取两个标题之间的那一段；锚点找不到就当场红（不许静默返回空串把判据变成永真） */
function slice(text: string, from: string, to: string, label: string): string {
  const i = text.indexOf(from)
  const j = text.indexOf(to)
  expect(i, `锚点找不到：${label} 的起点 ${from}`).toBeGreaterThan(-1)
  expect(j, `锚点找不到：${label} 的终点 ${to}`).toBeGreaterThan(i)
  return text.slice(i, j)
}
