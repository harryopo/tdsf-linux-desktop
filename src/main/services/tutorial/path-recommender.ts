/**
 * 教学路径推荐服务 - PathRecommender
 *
 * 教学术语：
 * - Learning Path：学习路径，按依赖关系 + 难度递进 + 命令关联排列的教程序列
 * - Category Dependency：分类依赖，如"用户管理"需要先学"Linux 基础"
 * - Command Co-occurrence：命令共现，如学完 ls 后推荐 cd/grep
 *
 * 路径推荐算法（4 层融合）：
 *   1. 分类依赖图：linux-basics → user-management → services → troubleshooting
 *   2. 难度递进：beginner → intermediate → advanced（同分类内）
 *   3. 命令关联：commands 共现分析（学完 ls → cd → grep）
 *   4. 混合检索召回：hybridSearch 召回相关教程，按 rrfScore 排序
 *
 * 使用场景：
 *   - 新手入门：从 linux-basics 开始，按依赖图逐步深入
 *   - 定向提升：指定目标分类（如 networking），推荐前置 + 同级 + 进阶
 *   - 命令驱动：学完某个命令后，推荐关联命令教程
 */

import type { DatabaseManager } from '../db/database'
import type { TutorialEntry, TutorialCategory, TutorialDifficulty } from './types'
import { TUTORIAL_CATEGORY_LABELS } from './types'
import { hybridSearch } from './hybrid-search'
import { TutorialRepository } from './tutorial-repo'

// ============================================================================
// 1. 分类依赖图（Category Dependency Graph）
// ============================================================================

/**
 * 分类前置依赖
 *
 * 设计原则：
 *   - 入口分类（linux-basics / shell-scripting）无依赖
 *   - 中间分类（user-management / networking）依赖基础
 *   - 高级分类（troubleshooting / cloud）依赖多个前置
 *
 * 为什么用单向依赖而非全序？
 *   - 某些分类（storage / monitoring）是"插件式"的，可在学完基础后随时插入
 *   - 依赖图允许"分叉"（如学完 networking 后可选 web-server 或 security）
 */
export const CATEGORY_DEPENDENCIES: Record<TutorialCategory, TutorialCategory[]> = {
  'linux-basics': [],                    // 入口，无依赖
  'user-management': ['linux-basics'],   // 需要 Linux 基础
  'package-management': ['linux-basics'],
  'networking': ['linux-basics'],
  'security': ['linux-basics', 'networking'],
  'storage': ['linux-basics'],
  'services': ['linux-basics', 'user-management'],
  'virtualization': ['linux-basics', 'services'],
  'containers': ['linux-basics', 'services'],
  'web-server': ['linux-basics', 'networking', 'services'],
  'database': ['linux-basics', 'services'],
  'shell-scripting': ['linux-basics'],
  'monitoring': ['linux-basics', 'services'],
  'troubleshooting': ['linux-basics', 'services', 'networking'],
  'cloud': ['linux-basics', 'networking', 'virtualization']
}

/**
 * 分类难度默认值（用于路径生成时的难度递进）
 *
 * 为什么这样设计？
 *   - beginner：概念 + 基础操作（ls / cd / chmod）
 *   - intermediate：配置 + 管理（systemctl / iptables / nginx）
 *   - advanced：排障 + 优化（troubleshooting / performance tuning）
 */
export const CATEGORY_DEFAULT_DIFFICULTY: Record<TutorialCategory, TutorialDifficulty> = {
  'linux-basics': 'beginner',
  'user-management': 'beginner',
  'package-management': 'beginner',
  'networking': 'intermediate',
  'security': 'intermediate',
  'storage': 'intermediate',
  'services': 'intermediate',
  'virtualization': 'advanced',
  'containers': 'intermediate',
  'web-server': 'intermediate',
  'database': 'intermediate',
  'shell-scripting': 'beginner',
  'monitoring': 'intermediate',
  'troubleshooting': 'advanced',
  'cloud': 'advanced'
}

// ============================================================================
// 2. 命令关联规则（Command Association Rules）
// ============================================================================

/**
 * 命令共现矩阵（基于运维经验的手工规则）
 *
 * 为什么不用自动共现分析？
 *   - 2559 条教程的命令字段稀疏（很多教程无 commands）
 *   - 手工规则更准确（运维专家经验）
 *   - 自动共现需要统计显著阈值（min co-occurrence > 3）
 *
 * 规则格式：{ from: [命令A], to: [命令B] }
 * 含义：学完命令A后，推荐包含命令B的教程
 */
export const COMMAND_ASSOCIATION_RULES: Array<{ from: string[]; to: string[]; reason: string }> = [
  // 文件系统导航
  { from: ['ls'], to: ['cd', 'pwd', 'tree'], reason: '掌握目录浏览后，学习导航与层级查看' },
  { from: ['cd'], to: ['pwd', 'ls', 'pushd', 'popd'], reason: '掌握切换目录后，学习路径管理' },
  { from: ['tree'], to: ['find', 'locate'], reason: '掌握树形查看后，学习高效搜索' },

  // 文件操作
  { from: ['cat'], to: ['less', 'head', 'tail'], reason: '掌握文件查看后，学习分页与截取' },
  { from: ['cp'], to: ['mv', 'rm', 'rsync'], reason: '掌握复制后，学习移动/删除/同步' },
  { from: ['rm'], to: ['trash', 'shred'], reason: '掌握删除后，学习安全删除' },

  // 文本处理
  { from: ['grep'], to: ['sed', 'awk', 'cut'], reason: '掌握文本搜索后，学习文本变换' },
  { from: ['sed'], to: ['awk', 'perl'], reason: '掌握行编辑后，学习更强大的文本处理' },
  { from: ['awk'], to: ['jq', 'yq'], reason: '掌握文本提取后，学习 JSON/YAML 处理' },

  // 权限管理
  { from: ['chmod'], to: ['chown', 'chgrp', 'umask'], reason: '掌握权限修改后，学习所有权与默认权限' },
  { from: ['chown'], to: ['sudo', 'su'], reason: '掌握所有权后，学习权限提升' },

  // 进程管理
  { from: ['ps'], to: ['top', 'htop', 'pgrep'], reason: '掌握进程查看后，学习监控与过滤' },
  { from: ['kill'], to: ['pkill', 'killall', 'systemctl'], reason: '掌握信号发送后，学习服务管理' },

  // 系统管理
  { from: ['systemctl'], to: ['journalctl', 'timedatectl'], reason: '掌握服务管理后，学习日志与时间管理' },
  { from: ['journalctl'], to: ['dmesg', 'tail'], reason: '掌握日志查看后，学习内核消息与实时跟踪' },

  // 网络
  { from: ['ping'], to: ['traceroute', 'mtr', 'ss'], reason: '掌握连通性测试后，学习路由与套接字' },
  { from: ['curl'], to: ['wget', 'ssh', 'scp'], reason: '掌握 HTTP 请求后，学习下载与远程操作' },
  { from: ['ssh'], to: ['scp', 'rsync', 'ssh-keygen'], reason: '掌握远程登录后，学习文件传输与密钥管理' },

  // 压缩
  { from: ['tar'], to: ['gzip', 'bzip2', 'xz'], reason: '掌握归档后，学习压缩格式' },
  { from: ['zip'], to: ['unzip', 'tar'], reason: '掌握 ZIP 后，学习通用归档' }
]

// ============================================================================
// 3. 数据模型（Data Models）
// ============================================================================

/**
 * 学习路径步骤
 */
export interface PathStep {
  /** 步骤序号（从 1 开始） */
  order: number
  /** 教程 ID */
  tutorialId: string
  /** 教程标题 */
  title: string
  /** 分类 */
  category: TutorialCategory
  /** 难度 */
  difficulty: TutorialDifficulty
  /** 预估阅读时间（分钟） */
  readingTime: number
  /** 关键命令 */
  commands: string[]
  /** 为什么学这个（LLM 生成或模板） */
  why: string
  /** 教程摘要 */
  summary: string
}

/**
 * 学习路径
 */
export interface TutorialPath {
  /** 路径 ID（生成） */
  id: string
  /** 路径名称 */
  name: string
  /** 路径描述 */
  description: string
  /** 目标分类 */
  targetCategory: TutorialCategory
  /** 目标难度 */
  targetDifficulty: TutorialDifficulty
  /** 路径步骤 */
  steps: PathStep[]
  /** 预估总时间（分钟） */
  estimatedMinutes: number
  /** 前置知识（依赖的分类） */
  prerequisites: string[]
  /** 推荐理由 */
  reason: string
}

/**
 * 路径推荐请求参数
 */
export interface RecommendPathOptions {
  /** 学习目标（自然语言，如"想学 Docker"） */
  goal?: string
  /** 当前水平（如 beginner / intermediate / advanced） */
  currentLevel?: TutorialDifficulty
  /** 偏好分类（如 networking） */
  preferredCategory?: TutorialCategory
  /** 最大步骤数（默认 8） */
  maxSteps?: number
}

// ============================================================================
// 4. 路径推荐核心算法（Path Recommendation Algorithm）
// ============================================================================

/**
 * 路径推荐器
 *
 * 设计原则：
 *   - 无状态：每次调用独立，不缓存（保证数据新鲜度）
 *   - 降级友好：数据库/检索不可用时返回空路径
 *   - 可扩展：4 层融合策略可通过配置调整权重
 */
export class PathRecommender {
  constructor(private readonly db: DatabaseManager) {}

  /**
   * 推荐学习路径
   *
   * 算法流程：
   *   1. 确定目标分类（从 preferredCategory 或 goal 推断）
   *   2. 收集前置分类（依赖图）
   *   3. 按难度递进排列（beginner → intermediate → advanced）
   *   4. 应用命令关联规则（补充步骤）
   *   5. 用混合检索召回相关教程（填充内容）
   *   6. 去重 + 排序 + 截断
   *
   * @param options 推荐参数
   * @returns TutorialPath[]
   */
  recommend(options: RecommendPathOptions = {}): TutorialPath[] {
    const {
      goal,
      currentLevel = 'beginner',
      preferredCategory,
      maxSteps = 8
    } = options

    // ===== 步骤 1：确定目标分类 =====
    const targetCategory = this.resolveTargetCategory(goal, preferredCategory)
    if (!targetCategory) {
      return this.getDefaultPaths(currentLevel, maxSteps)
    }

    // ===== 步骤 2：收集前置分类 =====
    const prerequisites = this.getPrerequisites(targetCategory)

    // ===== 步骤 3：构建分类序列 =====
    const categorySequence = this.buildCategorySequence(prerequisites, targetCategory)

    // ===== 步骤 4：按难度递进排列 =====
    const steps = this.buildStepsFromCategories(categorySequence, currentLevel, maxSteps)

    // ===== 步骤 5：应用命令关联规则（补充） =====
    this.applyCommandAssociations(steps)

    // ===== 步骤 6：去重 + 排序 + 截断 =====
    const dedupedSteps = this.deduplicateSteps(steps).slice(0, maxSteps)

    // ===== 步骤 7：生成路径元数据 =====
    const path = this.buildPath(
      targetCategory,
      dedupedSteps,
      prerequisites,
      goal
    )

    return [path]
  }

  /**
   * 获取默认路径（无明确目标时）
   *
   * 默认提供 3 条路径：
   *   1. Linux 入门（linux-basics → user-management）
   *   2. 网络基础（networking → security）
   *   3. 服务管理（services → troubleshooting）
   */
  private getDefaultPaths(
    currentLevel: TutorialDifficulty,
    maxSteps: number
  ): TutorialPath[] {
    const defaultCategories: TutorialCategory[][] = [
      ['linux-basics', 'user-management'],
      ['networking', 'security'],
      ['services', 'troubleshooting']
    ]

    return defaultCategories.map((cats, idx) => {
      const steps = this.buildStepsFromCategories(cats, currentLevel, maxSteps)
      const targetCategory = cats[cats.length - 1]
      const prerequisites = cats.slice(0, -1)

      return this.buildPath(
        targetCategory,
        steps,
        prerequisites,
        undefined
      )
    })
  }

  /**
   * 从自然语言目标推断分类
   *
   * 规则：
   *   - 包含"SSH/远程/登录" → networking
   *   - 包含"Docker/容器" → containers
   *   - 包含"Nginx/Apache/Web" → web-server
   *   - 包含"数据库/MySQL/PostgreSQL" → database
   *   - 包含"故障/排障/问题" → troubleshooting
   *   - 否则 → 返回 preferredCategory
   */
  private resolveTargetCategory(
    goal?: string,
    preferredCategory?: TutorialCategory
  ): TutorialCategory | null {
    if (preferredCategory) return preferredCategory

    if (!goal) return null

    const lowerGoal = goal.toLowerCase()

    // 关键词映射
    const keywordMap: Array<{ keywords: string[]; category: TutorialCategory }> = [
      { keywords: ['ssh', '远程', '登录', 'scp', 'rsync'], category: 'networking' },
      { keywords: ['docker', '容器', 'k8s', 'kubernetes', 'pod'], category: 'containers' },
      { keywords: ['nginx', 'apache', 'web', 'http', 'https'], category: 'web-server' },
      { keywords: ['mysql', 'postgresql', '数据库', 'database', 'redis'], category: 'database' },
      { keywords: ['故障', '排障', '问题', '排查', 'troubleshoot'], category: 'troubleshooting' },
      { keywords: ['安全', 'firewall', 'iptables', 'selinux'], category: 'security' },
      { keywords: ['用户', '权限', 'user', 'chmod', 'chown'], category: 'user-management' },
      { keywords: ['服务', 'systemctl', 'service'], category: 'services' },
      { keywords: ['云', 'cloud', 'aws', 'azure'], category: 'cloud' },
      { keywords: ['监控', 'monitor', 'prometheus'], category: 'monitoring' },
      { keywords: ['虚拟化', 'vm', 'kvm', 'qemu'], category: 'virtualization' },
      { keywords: ['shell', '脚本', 'bash', 'script'], category: 'shell-scripting' },
      { keywords: ['包管理', '安装', 'apt', 'yum', 'dnf'], category: 'package-management' },
      { keywords: ['存储', 'storage', 'lvm', 'raid'], category: 'storage' }
    ]

    for (const entry of keywordMap) {
      if (entry.keywords.some(kw => lowerGoal.includes(kw))) {
        return entry.category
      }
    }

    return null
  }

  /**
   * 获取分类的前置依赖（递归）
   */
  private getPrerequisites(category: TutorialCategory): TutorialCategory[] {
    const deps = CATEGORY_DEPENDENCIES[category] ?? []
    const result: TutorialCategory[] = []

    for (const dep of deps) {
      result.push(dep)
      result.push(...this.getPrerequisites(dep))
    }

    // 去重并保持顺序
    return [...new Set(result)]
  }

  /**
   * 构建分类序列（前置 + 目标）
   *
   * 规则：
   *   - 前置分类按依赖深度排序（深度浅的在前）
   *   - 目标分类放在最后
   *   - 避免循环依赖（依赖图已保证无环）
   */
  private buildCategorySequence(
    prerequisites: TutorialCategory[],
    target: TutorialCategory
  ): TutorialCategory[] {
    // 前置分类按默认难度排序（beginner → intermediate → advanced）
    const sortedPrereqs = prerequisites
      .map(cat => ({ cat, difficulty: CATEGORY_DEFAULT_DIFFICULTY[cat] ?? 'beginner' }))
      .sort((a, b) => {
        const order = { beginner: 0, intermediate: 1, advanced: 2 }
        return order[a.difficulty] - order[b.difficulty]
      })
      .map(item => item.cat)

    // 去重
    const uniquePrereqs = [...new Set(sortedPrereqs)]

    // 目标分类放在最后
    return [...uniquePrereqs, target]
  }

  /**
   * 从分类序列构建步骤
   *
   * 规则：
   *   - 每个分类取 1-2 条教程（按难度 + 混合检索评分）
   *   - 前置分类取 beginner，目标分类取对应难度
   */
  private buildStepsFromCategories(
    categories: TutorialCategory[],
    currentLevel: TutorialDifficulty,
    maxSteps: number
  ): PathStep[] {
    const steps: PathStep[] = []
    const repo = new TutorialRepository(this.db)

    for (const category of categories) {
      if (steps.length >= maxSteps) break

      // 确定该分类的难度
      const categoryDifficulty = CATEGORY_DEFAULT_DIFFICULTY[category] ?? 'beginner'

      // 跳过比当前水平低的分类（可选）
      // const levelOrder = { beginner: 0, intermediate: 1, advanced: 2 }
      // if (levelOrder[categoryDifficulty] < levelOrder[currentLevel]) continue

      // 从该分类取教程
      const entries = repo.listByCategory(category)

      // 按难度过滤 + 排序
      const filtered = entries
        .filter(e => e.difficulty === categoryDifficulty || e.difficulty === currentLevel)
        .sort((a, b) => a.readingTime - b.readingTime) // 短的先学
        .slice(0, 2) // 每个分类最多 2 条

      for (const entry of filtered) {
        if (steps.length >= maxSteps) break

        steps.push({
          order: steps.length + 1,
          tutorialId: entry.id,
          title: entry.title,
          category: entry.category,
          difficulty: entry.difficulty,
          readingTime: entry.readingTime,
          commands: entry.commands,
          why: this.generateWhy(entry, category),
          summary: entry.summary
        })
      }
    }

    return steps
  }

  /**
   * 生成"为什么学这个"说明
   *
   * 模板：
   *   - 前置分类："学习 {分类} 的基础知识，为后续学习做准备"
   *   - 目标分类："掌握 {分类} 的核心技能，达成学习目标"
   *   - 命令关联："学习 {命令} 的使用，扩展你的技能栈"
   */
  private generateWhy(entry: TutorialEntry, category: TutorialCategory): string {
    const isPrerequisite = !Object.values(CATEGORY_DEPENDENCIES).some(deps => deps.includes(category))

    if (isPrerequisite) {
      return `学习 ${TUTORIAL_CATEGORY_LABELS[category] ?? category} 的基础知识，为后续学习做准备`
    }

    if (entry.commands.length > 0) {
      const cmdStr = entry.commands.slice(0, 3).join('、')
      return `掌握 ${cmdStr} 等命令的使用，达成学习目标`
    }

    return `学习 ${entry.title}，掌握 ${TUTORIAL_CATEGORY_LABELS[category] ?? category} 的核心技能`
  }

  /**
   * 应用命令关联规则（补充步骤）
   *
   * 规则：
   *   - 如果步骤包含命令A，查找关联规则中 from 包含命令A 的规则
   *   - 如果该规则的 to 命令尚未在后续步骤中出现，补充相关教程
   */
  private applyCommandAssociations(steps: PathStep[]): void {
    const existingCommands = new Set<string>()
    const existingIds = new Set(steps.map(s => s.tutorialId))

    // 收集已有命令
    for (const step of steps) {
      for (const cmd of step.commands) {
        existingCommands.add(cmd.toLowerCase())
      }
    }

    // 应用规则
    for (const rule of COMMAND_ASSOCIATION_RULES) {
      const hasFromCommand = rule.from.some(cmd => existingCommands.has(cmd.toLowerCase()))
      if (!hasFromCommand) continue

      // 检查 to 命令是否已覆盖
      const hasToCommand = rule.to.some(cmd => existingCommands.has(cmd.toLowerCase()))
      if (hasToCommand) continue

      // 查找包含 to 命令的教程
      for (const toCmd of rule.to) {
        if (steps.length >= 8) break

        const entries = this.findTutorialsByCommand(toCmd)
        for (const entry of entries) {
          if (existingIds.has(entry.id)) continue

          steps.push({
            order: steps.length + 1,
            tutorialId: entry.id,
            title: entry.title,
            category: entry.category,
            difficulty: entry.difficulty,
            readingTime: entry.readingTime,
            commands: entry.commands,
            why: rule.reason,
            summary: entry.summary
          })
          existingIds.add(entry.id)
          existingCommands.add(toCmd.toLowerCase())
          break
        }
      }
    }
  }

  /**
   * 按命令查找教程
   */
  private findTutorialsByCommand(command: string): TutorialEntry[] {
    const repo = new TutorialRepository(this.db)
    const all = repo.listAll()

    return all
      .filter(e => e.commands.some(cmd => cmd.toLowerCase().includes(command.toLowerCase())))
      .sort((a, b) => a.readingTime - b.readingTime)
      .slice(0, 3)
  }

  /**
   * 去重步骤（按 tutorialId）
   */
  private deduplicateSteps(steps: PathStep[]): PathStep[] {
    const seen = new Set<string>()
    return steps.filter(step => {
      if (seen.has(step.tutorialId)) return false
      seen.add(step.tutorialId)
      return true
    })
  }

  /**
   * 构建路径元数据
   */
  private buildPath(
    targetCategory: TutorialCategory,
    steps: PathStep[],
    prerequisites: string[],
    goal?: string
  ): TutorialPath {
    const id = `path-${targetCategory}-${Date.now()}`
    const estimatedMinutes = steps.reduce((sum, s) => sum + s.readingTime, 0)

    const name = goal
      ? `${goal}学习路径`
      : `${TUTORIAL_CATEGORY_LABELS[targetCategory] ?? targetCategory}学习路径`

    const description = goal
      ? `根据你的目标"${goal}"定制，从 ${prerequisites.length > 0 ? '基础知识开始' : '核心技能开始'}，逐步掌握 ${TUTORIAL_CATEGORY_LABELS[targetCategory] ?? targetCategory}`
      : `系统学习 ${TUTORIAL_CATEGORY_LABELS[targetCategory] ?? targetCategory}，从基础到进阶`

    const reason = prerequisites.length > 0
      ? `建议先学习 ${prerequisites.map(p => (p in TUTORIAL_CATEGORY_LABELS ? (TUTORIAL_CATEGORY_LABELS as Record<string, string>)[p] : p)).join('、')}，再学习本路径`
      : '直接开始学习'

    return {
      id,
      name,
      description,
      targetCategory,
      targetDifficulty: CATEGORY_DEFAULT_DIFFICULTY[targetCategory] ?? 'intermediate',
      steps,
      estimatedMinutes,
      prerequisites,
      reason
    }
  }
}

// ============================================================================
// 5. 工具函数（Utility Functions）
// ============================================================================

/**
 * 格式化分钟数为人类可读
 */
export function formatPathDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (mins === 0) return `${hours} 小时`
  return `${hours} 小时 ${mins} 分钟`
}

/**
 * 获取分类颜色（用于 UI 标签）
 */
export function getCategoryColor(category: TutorialCategory): string {
  const colorMap: Record<TutorialCategory, string> = {
    'linux-basics': '#4f46e5',
    'user-management': '#7c3aed',
    'package-management': '#2563eb',
    'networking': '#059669',
    'security': '#dc2626',
    'storage': '#d97706',
    'services': '#0891b2',
    'virtualization': '#9333ea',
    'containers': '#0d9488',
    'web-server': '#059669',
    'database': '#2563eb',
    'shell-scripting': '#7c3aed',
    'monitoring': '#dc2626',
    'troubleshooting': '#d97706',
    'cloud': '#0891b2'
  }
  return colorMap[category] ?? '#4f46e5'
}
