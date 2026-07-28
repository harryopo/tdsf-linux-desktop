/**
 * Skill 路由器单例（v2.4 P3：把 skill 接进主对话）
 *
 * 背景：SkillRegistry / SkillRouter / 5 个内置诊断 skill（.md）此前是**死代码**，
 * 从未被任何运行路径加载。本模块把它们接进来：应用内首次调用时懒加载一次，
 * 之后复用缓存的 Promise。
 *
 * 加载策略（不引入 Vite `?raw` / import.meta.glob，避免主进程 TS 缺 vite/client 类型）：
 * - 运行时用 fs 读 builtin/*.md（复用现有 loader.loadSkillsFromDir）。
 * - 路径多候选解析：打包走 process.resourcesPath；dev/E2E 走 app.getAppPath() 源码树；
 *   再加 __dirname / cwd 相对兜底。取第一个真实存在的目录。
 * - 加载失败（目录不存在等）→ 空注册表 → 路由一律返回 ai-only（等价于"无 skill"），
 *   绝不影响正常对话（优雅降级）。
 *
 * 打包提示：electron-builder 需把 builtin 目录作为 extraResources 拷到
 * resources/skills-builtin（见 electron-builder.json）。
 */
import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { SkillRegistry } from './registry'
import { SkillRouter } from './router'
import { loadSkillsFromDir } from './loader'
import { logger } from '../log/logger'

const log = logger.child('SKILL.ROUTER')

/** 已就绪的路由器（缓存 Promise，全进程只加载一次） */
let routerPromise: Promise<SkillRouter> | null = null

/**
 * 解析内置 skill 目录（多候选，取第一个真实存在的）
 */
function resolveBuiltinDir(): string {
  const candidates: string[] = []
  try {
    if (app?.isPackaged) {
      // 打包后：extraResources 拷贝到 resources/skills-builtin
      candidates.push(path.join(process.resourcesPath, 'skills-builtin'))
    } else if (typeof app?.getAppPath === 'function') {
      // dev / E2E（未打包）：源码树
      candidates.push(path.join(app.getAppPath(), 'src', 'main', 'services', 'skills', 'builtin'))
    }
  } catch {
    // app 不可用（极端情况）→ 走下方兜底
  }
  // __dirname 兜底：out/main → 项目根 → src/...
  candidates.push(path.join(__dirname, '..', '..', 'src', 'main', 'services', 'skills', 'builtin'))
  // cwd 兜底
  candidates.push(path.join(process.cwd(), 'src', 'main', 'services', 'skills', 'builtin'))

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      // ignore 并试下一个
    }
  }
  return candidates[0] ?? ''
}

/**
 * 获取 Skill 路由器（懒加载 + 缓存）
 *
 * @returns 已注册内置 skill 的 SkillRouter；加载失败时注册表为空（route 恒返回 ai-only）
 */
export function getSkillRouter(): Promise<SkillRouter> {
  if (!routerPromise) {
    routerPromise = (async () => {
      const registry = new SkillRegistry()
      try {
        const dir = resolveBuiltinDir()
        const skills = dir ? await loadSkillsFromDir(dir) : []
        for (const s of skills) registry.register(s)
        log.info(`Skill 路由器已就绪：从 ${dir || '(未找到目录)'} 加载 ${skills.length} 个内置 skill`)
      } catch (err) {
        log.warn('内置 skill 加载失败，路由降级为 ai-only', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return new SkillRouter(registry)
    })()
  }
  return routerPromise
}

/**
 * 仅供测试：重置缓存，强制下次重新加载。
 */
export function _resetSkillRouterForTest(): void {
  routerPromise = null
}
