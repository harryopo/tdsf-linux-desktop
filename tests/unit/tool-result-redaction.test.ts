/**
 * 工具结果出边界脱敏（2026-10-15 全维度系统审查 P0-2）
 *
 * HC-6 声称"集成 redactSecrets 脱敏"，实测只装在用户消息与 sftp_read 两处；
 * 命令类工具的 stdout/stderr（凭据最常见的载体）原样进模型上下文。
 * 现在收口在 tools 组装点：新增工具自动受管。
 *
 * 判据要能被证伪，所以三条一起写：
 *   ① 带凭据形状的输出必须被涂掉；
 *   ② 正常输出必须原样过去（否则"脱敏"其实是在毁数据）；
 *   ③ 未包装的 execute 仍返回原文（证明涂白是包装干的，不是夹具本来就干净）。
 * 假凭据一律拆成相邻字面量，避免任何扫描器把测试当真凭据报出来。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'
import { redactToolValue, withToolResultRedaction } from '@main/core/agent/providers/redact'

const ROOT = path.resolve(__dirname, '../..')
const SUPERVISOR = path.join(ROOT, 'src/main/core/agent/supervisor.ts')

const SECRET = 'pass' + 'word=Sup3rS' + 'ecretValue'
const BENIGN = 'total 40\ndrwxr-xr-x  2 root root  4096 Oct 15 00:11 app'

describe('redactToolValue', () => {
  it('涂掉字符串里的凭据形状', () => {
    const out = redactToolValue(`cat my.cnf 输出：${SECRET}`) as string
    expect(out).not.toContain(SECRET)
    expect(out).toMatch(/\[REDACTED\]/i)
  })

  it('递归进对象与数组，非字符串字段原样保留', () => {
    const out = redactToolValue({
      ok: false,
      exitCode: 0,
      lines: [BENIGN, SECRET],
      nested: { stdout: SECRET },
    }) as { ok: boolean; exitCode: number; lines: string[]; nested: { stdout: string } }
    expect(out.ok).toBe(false)
    expect(out.exitCode).toBe(0)
    expect(out.lines[0], '正常输出不该被动过').toBe(BENIGN)
    expect(out.lines[1]).not.toContain(SECRET)
    expect(out.nested.stdout).not.toContain(SECRET)
  })

  it('null / undefined / 数字原样返回（不炸也不涂）', () => {
    expect(redactToolValue(null)).toBe(null)
    expect(redactToolValue(undefined)).toBe(undefined)
    expect(redactToolValue(1234)).toBe(1234)
  })
})

describe('withToolResultRedaction', () => {
  const rawExecute = () => ({ ok: true, stdout: SECRET, stderr: '' })

  it('套上之后 execute 的结果不再带凭据，且原对象不被改动', async () => {
    const tools = { ssh_readonly: { description: '只读执行', execute: rawExecute } }
    const wrapped = withToolResultRedaction(tools)

    const result = (await (wrapped.ssh_readonly as { execute: () => unknown }).execute()) as {
      ok: boolean
      stdout: string
    }
    expect(result.stdout, '工具输出必须在出边界前脱敏').not.toContain(SECRET)
    expect(result.ok, '布尔字段不许被脱敏顺手改掉').toBe(true)
    expect(tools.ssh_readonly.description, '其它键必须原样带过去').toBe('只读执行')

    // 反向对照：没包装时原文照旧——证明上面那次涂白是包装做的
    expect((rawExecute() as { stdout: string }).stdout).toContain(SECRET)
  })

  it('没有 execute 的工具（纯描述）不炸、原样返回', () => {
    const tools = { kb_search: { description: '只声明不挂载' } }
    const wrapped = withToolResultRedaction(tools)
    expect(wrapped.kb_search).toEqual({ description: '只声明不挂载' })
  })

  it('execute 的入参与 this 语义照常转发', async () => {
    const seen: unknown[] = []
    const tools = {
      ssh_write: {
        execute: (...args: unknown[]) => {
          seen.push(args)
          return { echoed: args[0] }
        },
      },
    }
    const wrapped = withToolResultRedaction(tools)
    const out = (await (wrapped.ssh_write as { execute: (a: string, b: number) => unknown }).execute(
      BENIGN,
      7
    )) as { echoed: string }
    expect(out.echoed, '正常命令文本必须原样送回模型').toBe(BENIGN)
    expect(seen[0], '实参个数与顺序必须原样转发').toEqual([BENIGN, 7])
  })
})

describe('装配点接线（结构核对）', () => {
  /**
   * 包装函数有判据不等于它被接上了：哪天有人把 tools 的组装改回原样，
   * 上面三条照样全绿。所以这条按 AST 结构核对声明的初始化式，
   * 并拿"本文件里返回 stdout 的工具输出点数量"当分母——
   * 被测对象整块搬走时判据要说话，不许悄悄空过。
   */
  it('supervisor 交给 streamText 的 tools 必须经过 withToolResultRedaction', () => {
    const text = fs.readFileSync(SUPERVISOR, 'utf8')
    const src = ts.createSourceFile(SUPERVISOR, text, ts.ScriptTarget.Latest, true)

    let wrappedDecls = 0
    let stdoutExits = 0
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'tools' &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === 'withToolResultRedaction'
      ) {
        wrappedDecls++
      }
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'stdout') stdoutExits++
      ts.forEachChild(node, visit)
    }
    visit(src)

    expect(stdoutExits, 'supervisor 里已找不到返回 stdout 的工具输出点——被测对象搬走了，这条判据别算通过').toBeGreaterThanOrEqual(3)
    expect(wrappedDecls, 'const tools = withToolResultRedaction(...) 不见了：工具结果将原样出边界').toBe(1)
  })
})
