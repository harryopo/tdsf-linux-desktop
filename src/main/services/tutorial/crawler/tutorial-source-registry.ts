/**
 * 教程爬虫源注册表
 *
 * 教学术语：
 * - Registry (注册表)：集中管理可扩展资源的容器模式
 * - Singleton (单例)：整个应用生命周期内只有一个实例
 *
 * 所有可抓取的官方源在此集中注册。
 * UI 通过 getAll() 获取列表，用户可在 Settings/教程页勾选启停。
 * 持久化：用户启停配置存到 electron-store (key: tutorial.sources)
 */

import type { TutorialSourceSpec } from '@shared/crawler-types'

/**
 * 内置源列表（按优先级排序）
 *
 * 来源规范（详见 方案书-v0.6.0-教程爬虫与权威源同步.md §2）：
 * 1. Arch Wiki：CC BY-SA 4.0，月度 tar.gz 官方提供
 * 2. LDP (tldp.org)：Free Documentation License，离线 tar.gz
 * 3. tldr-pages：CC BY 4.0（已升级，从 CC BY-SA 4.0 改为 CC BY 4.0），GitHub 克隆
 * 4. The Art of Command Line：CC BY-SA 4.0，GitHub 克隆
 * 5. Ubuntu Help：CC BY-SA 4.0，Crawl-delay 5s
 * 6. Microsoft Learn：CC BY 4.0，无 delay
 * 7. Red Hat Docs：CC BY-SA 4.0，Crawl-delay 10s
 * 8. DigitalOcean Tutorials：CC BY-SA 4.0，无 delay
 * 9. Linuxize / Tecmint：CC BY-SA 4.0，无 delay
 *
 * ❌ 不可用源（robots.txt 禁止或太慢）：
 * - linux.die.net（Disallow: /）
 * - Debian Wiki（Crawl-delay: 20s）
 */
const BUILTIN_SOURCES: TutorialSourceSpec[] = [
  // ========== P0 离线包（零爬虫礼仪风险） ==========
  {
    id: 'arch-wiki',
    label: 'Arch Wiki（官方月度快照）',
    name: 'Arch Wiki',
    kind: 'offline-dump',
    baseUrl: 'https://wiki.archlinux.org/static/archwiki-latest.tar.gz',
    crawlDelayMs: 0,
    license: 'CC BY-SA 4.0',
    enabledByDefault: true,
    description: 'Arch Linux Wiki 月度 HTML 快照，~500MB，覆盖 Linux 全栈教程（最权威金标准）',
    priority: 'P0'
  },
  {
    id: 'ldp-howtos',
    label: 'LDP HOWTOs（Linux 文档项目）',
    name: 'The Linux Documentation Project',
    kind: 'offline-dump',
    baseUrl: 'https://www.tldp.org/HOWTO/text/HOWTO-INDEX',
    crawlDelayMs: 0,
    license: 'GNU Free Documentation License',
    enabledByDefault: true,
    description: 'LDP 经典 HOWTO 合集（~50MB），涵盖 Bash/Networking/Security 等基础主题',
    priority: 'P0'
  },

  // ========== P0 GitHub 克隆（零爬虫礼仪风险，git 协议） ==========
  {
    id: 'tldr-pages',
    label: 'tldr-pages（命令速查）',
    name: 'tldr-pages',
    kind: 'github-clone',
    baseUrl: 'https://github.com/tldr-pages/tldr.git',
    crawlDelayMs: 0,
    license: 'CC BY 4.0',
    enabledByDefault: true,
    description: 'GitHub 仓库 clone，~1500+ Linux 命令速查（每个命令 1 页，man 简化版）',
    priority: 'P0'
  },
  {
    id: 'art-of-command-line',
    label: '命令行艺术（The Art of Command Line）',
    name: 'The Art of Command Line',
    kind: 'github-clone',
    baseUrl: 'https://github.com/jlevy/the-art-of-command-line.git',
    crawlDelayMs: 0,
    license: 'CC BY-SA 4.0',
    enabledByDefault: true,
    description: 'GitHub 仓库 clone，中英双语命令行使用精华（README.md + README-zh.md）',
    priority: 'P0'
  },
  {
    id: 'linux-command',
    label: 'jaywcjlove/linux-command（中文命令速查）',
    name: 'jaywcjlove/linux-command',
    kind: 'github-clone',
    baseUrl: 'https://github.com/jaywcjlove/linux-command.git',
    crawlDelayMs: 0,
    license: 'MIT',
    enabledByDefault: true,
    description: 'GitHub 仓库 clone，36k+ stars，500+ Linux 命令中文详解（与 tldr-pages 极简风互补）',
    priority: 'P0'
  },
  {
    id: 'linux-journey',
    label: 'Linux Journey（结构化课程）',
    name: 'Linux Journey (via labex-labs)',
    kind: 'github-clone',
    baseUrl: 'https://github.com/labex-labs/linuxjourney.git',
    crawlDelayMs: 0,
    license: 'CC BY-SA 4.0',
    enabledByDefault: true,
    description: 'GitHub 仓库 clone，80+ 结构化课程（Grasshopper/Journeyman/Networking Nomad）。注：原 CC BY-SA 4.0 含品牌限制条款',
    priority: 'P0'
  },

  // ========== P1 在线爬（kernel.org：无 robots，保守 2s 限流） ==========
  {
    id: 'kernel-org',
    label: 'Linux Kernel Documentation',
    name: 'Linux Kernel Documentation',
    kind: 'online-crawl',
    baseUrl: 'https://www.kernel.org/doc/html/latest/',
    crawlDelayMs: 2000,
    license: 'GPL-2.0',
    enabledByDefault: false, // Phase 2-d 暂不默认启用（避免对 kernel.org 造成大流量）
    description: 'Linux 内核官方文档（admin-guide/userspace-api/process 等核心子目录），无 robots.txt，按 2s 保守限流',
    priority: 'P1'
  },
  {
    id: 'wiki-debian',
    label: 'Debian Wiki（精选 30 页）',
    name: 'Debian Wiki',
    kind: 'online-crawl',
    baseUrl: 'https://wiki.debian.org/',
    crawlDelayMs: 20000, // robots.txt 严格要求 20s delay
    license: 'CC BY-SA 3.0',
    enabledByDefault: false, // Phase 2-e 暂不默认启用（避免误触发 20s 长延迟）
    description: 'Debian Wiki 精选 30 个运维核心页（PackageManagement/Network/SSH/Systemd 等），通过 MediaWiki API 抓取',
    priority: 'P1'
  },

  // ========== P1 在线爬（有限流） ==========
  {
    id: 'ubuntu-help',
    label: 'Ubuntu Help（官方文档）',
    name: 'Ubuntu Help',
    kind: 'online-crawl',
    baseUrl: 'https://help.ubuntu.com/',
    crawlDelayMs: 5000,
    license: 'CC BY-SA 4.0',
    enabledByDefault: false, // Phase 1 暂不启用（避免大流量），Phase 2 实施
    description: 'Ubuntu Server Guide（最新 LTS），Crawl-delay 5s',
    priority: 'P1'
  },
  {
    id: 'ms-learn',
    label: 'Microsoft Learn（Linux/Azure 文档）',
    name: 'Microsoft Learn',
    kind: 'online-crawl',
    baseUrl: 'https://learn.microsoft.com/en-us/linux/',
    crawlDelayMs: 2000,
    license: 'CC BY 4.0',
    enabledByDefault: false,
    description: 'MS 官方 Linux/云原生文档，无 Crawl-delay 限制',
    priority: 'P1'
  },

  // ========== P2 在线爬（限流严格） ==========
  {
    id: 'redhat-docs',
    label: 'Red Hat 官方文档（中文）',
    name: 'Red Hat Customer Portal',
    kind: 'online-crawl',
    baseUrl: 'https://access.redhat.com/documentation/zh-cn/red_hat_enterprise_linux/',
    crawlDelayMs: 10000,
    license: 'CC BY-SA 4.0',
    enabledByDefault: false,
    description: 'Red Hat 官方 RHEL 文档，Crawl-delay 10s（最权威但慢）',
    priority: 'P2'
  },
  {
    id: 'digitalocean',
    label: 'DigitalOcean Tutorials',
    name: 'DigitalOcean',
    kind: 'online-crawl',
    baseUrl: 'https://www.digitalocean.com/community/tutorials',
    crawlDelayMs: 2000,
    license: 'CC BY-SA 4.0',
    enabledByDefault: false,
    description: '高质量 step-by-step 教程，Ubuntu/Nginx/Docker 等',
    priority: 'P2'
  },

  // ========== P3 在线爬（辅助源） ==========
  {
    id: 'linuxize',
    label: 'Linuxize',
    name: 'Linuxize',
    kind: 'online-crawl',
    baseUrl: 'https://linuxize.com/',
    crawlDelayMs: 2000,
    license: 'CC BY-SA 4.0',
    enabledByDefault: false,
    description: 'Linux 教程合集（中等质量）',
    priority: 'P3'
  },
  {
    id: 'tecmint',
    label: 'Tecmint',
    name: 'Tecmint',
    kind: 'online-crawl',
    baseUrl: 'https://www.tecmint.com/',
    crawlDelayMs: 2000,
    license: 'CC BY-SA 4.0',
    enabledByDefault: false,
    description: 'Linux 教程与新闻（中等质量）',
    priority: 'P3'
  }
]

/**
 * 源注册表（单例）
 */
export class TutorialSourceRegistry {
  private static instance: TutorialSourceRegistry | null = null
  private sources: Map<string, TutorialSourceSpec>

  private constructor() {
    this.sources = new Map()
    for (const s of BUILTIN_SOURCES) {
      this.sources.set(s.id, s)
    }
  }

  static getInstance(): TutorialSourceRegistry {
    if (!TutorialSourceRegistry.instance) {
      TutorialSourceRegistry.instance = new TutorialSourceRegistry()
    }
    return TutorialSourceRegistry.instance
  }

  /** 获取所有源（按优先级排序） */
  getAll(): TutorialSourceSpec[] {
    return Array.from(this.sources.values()).sort((a, b) => {
      const order = { P0: 0, P1: 1, P2: 2, P3: 3 }
      return order[a.priority] - order[b.priority]
    })
  }

  /** 按 ID 获取 */
  get(id: string): TutorialSourceSpec | undefined {
    return this.sources.get(id)
  }

  /** 获取离线包源（Phase 1） */
  getOfflineSources(): TutorialSourceSpec[] {
    return this.getAll().filter((s) => s.kind === 'offline-dump')
  }

  /** 获取 GitHub 克隆源（Phase 1-d 补充） */
  getGithubCloneSources(): TutorialSourceSpec[] {
    return this.getAll().filter((s) => s.kind === 'github-clone')
  }

  /** 获取在线爬源（Phase 2） */
  getOnlineSources(): TutorialSourceSpec[] {
    return this.getAll().filter((s) => s.kind === 'online-crawl')
  }

  /** 获取所有 Phase 1 默认启用的源（offline-dump + github-clone） */
  getPhase1DefaultSources(): TutorialSourceSpec[] {
    return this.getAll().filter((s) => s.enabledByDefault)
  }
}
