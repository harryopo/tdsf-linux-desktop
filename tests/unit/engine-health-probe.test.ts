/**
 * tests/unit/engine-health-probe.test.ts — 发布包里最容易静默降级的三项，实测口要能自证（#77）
 *
 * 为什么要有这张表：这三项失败时以前界面上什么都不会说 ——
 * - Python 分析引擎不在 → AI 日志分析退回内置规则，只在日志文件里留一行；
 * - tree-sitter wasm 路径按 NODE_ENV 猜 → 猜错就把命令风险判定退回正则；
 * - Drain3 桥从没被启动过 → 模板挖掘一直是内置正则（连日志都没有）。
 * 现在关于页要显示实测结果，所以"实测"本身必须有判据：
 * 说 ok 的时候得真找得到东西，说 not-ok 的时候必须带上能行动的原因。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { astWasmCandidates } from '../../src/main/core/risk-engine-ast'
import { sidecarEngineHealth } from '../../src/main/core/sidecar/sidecar-manager'
import { drain3BridgeHealth } from '../../src/main/services/log/drain3-bridge'

describe('tree-sitter wasm 路径解析', () => {
  it('资源目录里没有 wasm 时也给出 node_modules 候选（不再因为"像生产"就只认一条路径）', () => {
    const savedResources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    const savedEnv = process.env.NODE_ENV
    // 模拟打包环境：resourcesPath 存在，但那个位置根本没有 wasm（本仓的 wasm 实际随
    // asar.unpacked 的 node_modules 发布）。旧实现到这里就直接失败并静默退回正则。
    // process.resourcesPath 在 Node 类型里是只读属性，直接赋值过不了检查——
    // 用 defineProperty 改，收尾按原描述符装回去，运行期效果一样但不再靠运气。
    Object.defineProperty(process, 'resourcesPath', {
      value: path.join(os.tmpdir(), 'tdsf-no-such-resources'),
      configurable: true,
      writable: true,
    })
    process.env.NODE_ENV = 'production'
    try {
      const candidates = astWasmCandidates()
      expect(candidates[0]).toContain('tree-sitter-bash.wasm')
      const found = candidates.filter((p) => fs.existsSync(p))
      expect(found.length, `一个候选都不存在：${candidates.join(' | ')}`).toBeGreaterThan(0)
    } finally {
      if (savedResources) {
        Object.defineProperty(process, 'resourcesPath', savedResources)
      } else {
        delete (process as unknown as { resourcesPath?: string }).resourcesPath
      }
      if (savedEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = savedEnv
    }
  })
})

describe('Python 分析引擎可用性', () => {
  it('引擎不在时报"找不到哪条路径"，并说清现在用什么替代', () => {
    const missing = path.join(os.tmpdir(), 'tdsf-no-such-venv', 'python')
    const h = sidecarEngineHealth({ pythonPath: missing, workingDir: os.tmpdir(), entry: 'main.py' })
    expect(h.ok).toBe(false)
    expect(h.reason).toContain(missing)
    expect(h.reason).toContain('内置规则')
  })

  it('装齐了才允许报就绪（正反两向都要能判，不然这盏灯只会亮不会灭）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdsf-engine-'))
    const python = path.join(dir, 'python')
    fs.writeFileSync(python, '')
    fs.writeFileSync(path.join(dir, 'main.py'), '')
    try {
      const h = sidecarEngineHealth({ pythonPath: python, workingDir: dir, entry: 'main.py' })
      expect(h.ok).toBe(true)
      expect(h.reason).toContain('就绪')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('真实配置在开发机上给出一个明确答案（ok 与否都带原因）', () => {
    const h = sidecarEngineHealth()
    expect(typeof h.ok).toBe('boolean')
    expect(h.reason.length).toBeGreaterThan(8)
  })
})

describe('Drain3 模板挖掘', () => {
  it('桥从未启动时如实报"用的是内置正则"，不再一声不响', () => {
    const h = drain3BridgeHealth()
    expect(h.ok).toBe(false)
    // 脚本在仓库里有、只是没随包发布/没被启动 —— 两种情况都要把人话说明白
    expect(h.reason).toMatch(/内置正则|未随包发布/)
  })
})
