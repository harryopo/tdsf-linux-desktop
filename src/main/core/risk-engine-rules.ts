/**
 * AST 风险评估引擎 - 规则定义与类型
 *
 * 从 risk-engine-ast.ts 拆分而来（v0.9.1 P1 警告修复：单文件 ≤ 500 行）。
 * 本文件集中管理：
 * - 类型定义：CommandRiskLevel / RiskAssessmentResult / HighRiskPattern / MediumRiskPattern
 * - 高危命令规则：HIGH_RISK_COMMANDS / HIGH_RISK_PATTERNS
 * - 中危命令规则：MEDIUM_RISK_COMMANDS / MEDIUM_RISK_PATTERNS
 *
 * 设计依据：docs/调研-Bash命令解析库选型-危险命令识别.md
 * 对标方案：Claude Code 的 AST + 正则 + ML 三层防御（规则层属于 AST + 正则两层）
 *
 * Hard Constraints 对齐：
 * - HC-6 沙箱命令始终审批：规则覆盖所有已知高危命令模式
 * - 质量绝对优先：规则与类型集中管理，便于审计与扩展
 */

// ============================================================================
// 类型定义
// ============================================================================

export type CommandRiskLevel = 'low' | 'medium' | 'high'

/**
 * 审批理由（用于 UI 展示，包含命令作用 + 风险等级 + 推荐操作）
 *
 * v0.9.4 新增：为审批弹窗提供教学属性的结构化解释，
 * 帮助用户理解命令危险性的原因，而非简单展示 reasons 列表。
 */
export interface ApprovalReason {
  /** 命令作用简述（如 "递归删除文件" / "包管理操作"） */
  action: string
  /** 风险等级说明（low/medium/high） */
  riskLevel: CommandRiskLevel
  /** 推荐操作（approve 自动批准 / deny 拒绝 / require-admin 需管理员审批） */
  recommendation: 'approve' | 'deny' | 'require-admin'
  /** 详细解释（教学属性：为什么这条命令危险，会带来什么后果） */
  explanation: string
}

export interface RiskAssessmentResult {
  /** 危险度评级 */
  risk: CommandRiskLevel
  /** 风险原因列表（high/medium 时非空，辅助 UI 展示） */
  reasons: string[]
  /** 命中规则的命令片段（用于审计日志） */
  matchedCommands: string[]
  /**
   * 审批理由（用于 UI 展示，包含命令作用 + 风险等级 + 推荐操作）
   *
   * - high/medium 风险时必须填充
   * - low 风险时可选填充（用于教学说明）
   * - 兼容性：旧调用方可忽略此字段
   */
  approvalReason?: ApprovalReason
}

// ============================================================================
// 危险命令规则定义
// ============================================================================

/**
 * 高危命令规则（CRITICAL）
 *
 * 命中即 high，无论参数如何。
 */
export const HIGH_RISK_COMMANDS = new Set<string>([
  'mkfs',
  'mkfs.ext2',
  'mkfs.ext3',
  'mkfs.ext4',
  'mkfs.xfs',
  'mkfs.btrfs',
  'mkfs.ntfs',
  'mkfs.vfat',
  'wipefs',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init',
  'telinit',
])

/**
 * 高危命令 + 参数组合规则
 *
 * 命令名 + 特定参数模式 → high
 */
export interface HighRiskPattern {
  /** 命令名（小写） */
  command: string
  /** 危险参数匹配函数（接收参数数组，返回是否危险 + 原因） */
  matchArgs: (args: string[]) => { dangerous: boolean; reason: string }
}

export const HIGH_RISK_PATTERNS: HighRiskPattern[] = [
  // rm -rf 根目录 / 家目录 / 通配符
  {
    command: 'rm',
    matchArgs: (args) => {
      const hasRecursiveForce =
        args.some((a) => /^-[a-z]*r[a-z]*f[a-z]*$/i.test(a) || /^-[a-z]*f[a-z]*r[a-z]*$/i.test(a))
      if (!hasRecursiveForce) return { dangerous: false, reason: '' }
      // 检查目标参数：根目录 / 家目录 / 通配符
      // P2-2 清理：删除 v0.9.0 历史遗留的重复 `arg === '/'` 条件
      for (const arg of args) {
        if (arg === '/' || arg === '/*' || arg === '~' || arg === '~/*') {
          return { dangerous: true, reason: `rm -rf ${arg} 递归删除关键目录` }
        }
        // 匹配 /root /home /etc /var /usr /boot 等系统目录
        if (/^\/(root|home|etc|var|usr|boot|lib|lib64|bin|sbin|opt|proc|sys|dev)(\/|$|\*)/.test(arg)) {
          return { dangerous: true, reason: `rm -rf ${arg} 递归删除系统目录` }
        }
      }
      // rm -rf 其他目标仍判为 high（保守策略）
      return { dangerous: true, reason: 'rm -rf 递归强制删除' }
    },
  },
  // chmod 777
  {
    command: 'chmod',
    matchArgs: (args) => {
      // chmod 777 / chmod a+rwx / chmod -R 777
      const has777 = args.some((a) => /^-?[a-z]*777$/i.test(a) || /^a\+rwx$/i.test(a))
      if (!has777) return { dangerous: false, reason: '' }
      return { dangerous: true, reason: 'chmod 777 / a+rwx 全权限开放' }
    },
  },
  // dd if=...of=/dev/...
  {
    command: 'dd',
    matchArgs: (args) => {
      const hasOfDev = args.some((a) => /of=\/dev\//i.test(a))
      if (!hasOfDev) return { dangerous: false, reason: '' }
      return { dangerous: true, reason: 'dd 写入块设备（直接写入磁盘）' }
    },
  },
  // iptables -F / iptables -X / iptables -t nat -F
  {
    command: 'iptables',
    matchArgs: (args) => {
      const hasFlush = args.some((a) => a === '-F' || a === '--flush' || a === '-X')
      if (!hasFlush) return { dangerous: false, reason: '' }
      return { dangerous: true, reason: 'iptables -F/-X 清空防火墙规则' }
    },
  },
  // killall
  {
    command: 'killall',
    matchArgs: () => ({ dangerous: true, reason: 'killall 批量终止进程' }),
  },
  // fork bomb（经典形式 :(){:|:&};:）
  // 这里通过 AST 无法直接识别 fork bomb，因为它是 shell 函数定义
  // 保留正则兜底识别
]

/**
 * 中危命令规则
 */
export const MEDIUM_RISK_COMMANDS = new Set<string>([
  // 包管理
  'yum',
  'apt',
  'apt-get',
  'dnf',
  'pip',
  'pip3',
  'npm',
  'pnpm',
  'yarn',
  // 用户管理
  'useradd',
  'userdel',
  'usermod',
  'groupadd',
  'groupdel',
  'groupmod',
  'passwd',
  'chpasswd',
  // 服务管理
  'systemctl',
  'service',
  // 提权
  'sudo',
  'su',
  // 定时任务
  'crontab',
  // 网络
  'iptables',
  'firewall-cmd',
  'ufw',
  // SELinux
  'setenforce',
  'setsebool',
  'semanage',
])

/**
 * 中危命令 + 参数组合规则
 */
export interface MediumRiskPattern {
  command: string
  matchArgs: (args: string[]) => { dangerous: boolean; reason: string }
}

export const MEDIUM_RISK_PATTERNS: MediumRiskPattern[] = [
  // 包管理 install/remove/upgrade
  {
    command: 'yum',
    matchArgs: (args) =>
      args.some((a) => ['install', 'remove', 'upgrade', 'reinstall'].includes(a))
        ? { dangerous: true, reason: 'yum 包管理操作' }
        : { dangerous: false, reason: '' },
  },
  {
    command: 'apt',
    matchArgs: (args) =>
      args.some((a) => ['install', 'remove', 'purge', 'upgrade', 'dist-upgrade'].includes(a))
        ? { dangerous: true, reason: 'apt 包管理操作' }
        : { dangerous: false, reason: '' },
  },
  {
    command: 'apt-get',
    matchArgs: (args) =>
      args.some((a) => ['install', 'remove', 'purge', 'upgrade', 'dist-upgrade'].includes(a))
        ? { dangerous: true, reason: 'apt-get 包管理操作' }
        : { dangerous: false, reason: '' },
  },
  {
    command: 'dnf',
    matchArgs: (args) =>
      args.some((a) => ['install', 'remove', 'upgrade', 'reinstall'].includes(a))
        ? { dangerous: true, reason: 'dnf 包管理操作' }
        : { dangerous: false, reason: '' },
  },
  // systemctl start/stop/restart/enable/disable
  {
    command: 'systemctl',
    matchArgs: (args) =>
      args.some((a) => ['start', 'stop', 'restart', 'enable', 'disable', 'mask', 'unmask'].includes(a))
        ? { dangerous: true, reason: 'systemctl 服务管理' }
        : { dangerous: false, reason: '' },
  },
  // service xxx start/stop
  {
    command: 'service',
    matchArgs: (args) =>
      args.some((a) => ['start', 'stop', 'restart'].includes(a))
        ? { dangerous: true, reason: 'service 服务管理' }
        : { dangerous: false, reason: '' },
  },
  // sudo（任何 sudo 命令都是中危）
  {
    command: 'sudo',
    matchArgs: () => ({ dangerous: true, reason: 'sudo 提权' }),
  },
  // crontab -e/-r
  {
    command: 'crontab',
    matchArgs: (args) =>
      args.some((a) => a === '-e' || a === '-r' || a === '--edit' || a === '--remove')
        ? { dangerous: true, reason: 'crontab 定时任务修改' }
        : { dangerous: false, reason: '' },
  },
  // 用户管理（useradd/userdel/usermod）— 任何参数都中危
  {
    command: 'useradd',
    matchArgs: () => ({ dangerous: true, reason: '用户管理' }),
  },
  {
    command: 'userdel',
    matchArgs: () => ({ dangerous: true, reason: '用户管理' }),
  },
  {
    command: 'usermod',
    matchArgs: () => ({ dangerous: true, reason: '用户管理' }),
  },
  // 用户组管理（groupadd/groupdel/groupmod）
  {
    command: 'groupadd',
    matchArgs: () => ({ dangerous: true, reason: '用户组管理' }),
  },
  {
    command: 'groupdel',
    matchArgs: () => ({ dangerous: true, reason: '用户组管理' }),
  },
  {
    command: 'groupmod',
    matchArgs: () => ({ dangerous: true, reason: '用户组管理' }),
  },
  // 密码修改（passwd/chpasswd）
  {
    command: 'passwd',
    matchArgs: () => ({ dangerous: true, reason: '密码修改' }),
  },
  {
    command: 'chpasswd',
    matchArgs: () => ({ dangerous: true, reason: '密码修改' }),
  },
  // 注：原 `command: '*'` 兜底规则（检查 args 是否以 /etc/ 开头）已删除
  // 原因：tree-sitter-bash 把重定向（> /etc/passwd）解析为单独 redirect 节点，
  //       不会出现在 args 中，因此该规则检测不到真正的 /etc/ 写入操作；
  //       反而会误报 `cat /etc/hosts`、`ls /etc/` 等只读命令为中危。
  //       真正的 /etc/ 写入检测应通过 redirect 节点遍历实现（后续待办）。
]
