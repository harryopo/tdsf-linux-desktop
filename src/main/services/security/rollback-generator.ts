/**
 * 命令回滚建议生成器（P1-8 修复）
 *
 * 基于命令解析生成动态回滚建议，替代 sandbox-approval.ts 中硬编码的
 * `cp /etc/xxx.bak /etc/xxx` 占位字符串。
 *
 * 设计原则（基于调研报告 docs/v2.5-research-backend-enhancement.md）：
 *   1. 备份优先策略：文件修改类命令建议操作前先备份
 *   2. 不可逆命令黑名单：mkfs/dd/rm -rf/shutdown 等明确返回 undefined
 *   3. 规则映射表：18 条常见运维命令的回滚映射，按优先级顺序匹配
 *   4. 路径解析：从命令中提取真实文件路径，生成可用回滚命令
 *
 * 论文/实践参考：
 *   - OpenSCAP：声明式收敛 + 幂等性，不生成反向命令
 *   - Ansible callback：靠 playbook 幂等性保证，不依赖回滚
 *   - TDSF 教学场景：需要明确回滚建议帮助学生学习运维安全
 *
 * 模块边界：
 *   - 输入：命令字符串 + 风险等级
 *   - 输出：回滚命令字符串（undefined 表示不可回滚或无需回滚）
 *   - 不依赖：数据库 / IPC / Electron API（纯函数，便于测试）
 */

// ============================================================================
// 类型定义
// ============================================================================

/** 风险等级（与 sandbox-approval.ts CommandRiskLevel 保持一致） */
export type RiskLevel = 'low' | 'medium' | 'high'

/** 回滚规则生成器函数签名 */
type RollbackGenerator = (match: RegExpMatchArray, command: string) => string | undefined

/** 回滚规则定义 */
interface RollbackRule {
  /** 规则名称（用于日志和测试） */
  name: string
  /** 匹配命令的正则 */
  pattern: RegExp
  /** 生成回滚命令的函数 */
  generator: RollbackGenerator
}

// ============================================================================
// 不可逆命令黑名单
// ============================================================================

/**
 * 不可逆命令黑名单（无法回滚）
 *
 * 这些命令执行后无法通过反向命令恢复，必须返回 undefined
 * 让 UI 明确告知用户"此命令不可回滚"。
 */
const IRREVERSIBLE_PATTERNS: readonly RegExp[] = [
  /\brm\s+-rf\b/i, // 递归强制删除
  /\bmkfs\b/i, // 格式化文件系统
  /\bdd\s+if=/i, // 磁盘级写入
  /\b(shutdown|reboot|halt|poweroff)\b/i, // 系统关机/重启
  />\s*\/dev\/(sd|nvme|hd)/i, // 直接写入块设备（> 前可能是空格，不要求单词边界）
]

/**
 * 检查命令是否不可逆
 *
 * @param command 待检查的命令
 * @returns true 表示不可逆，无法生成回滚命令
 */
export function isIrreversible(command: string): boolean {
  return IRREVERSIBLE_PATTERNS.some((p) => p.test(command))
}

// ============================================================================
// 18 条命令回滚规则表
// ============================================================================

/**
 * 命令回滚规则表（18 条，按优先级顺序匹配）
 *
 * 顺序原则：
 *   1. git 操作（最常用，回滚明确）
 *   2. 包管理操作（install/remove 互逆）
 *   3. 服务管理操作（start/stop 互逆）
 *   4. 文件修改操作（备份优先策略）
 *   5. 权限/所有者修改（记录原值）
 *   6. 文件操作（cp/mv 反向）
 *   7. 网络规则（iptables -D 删除）
 *   8. 用户管理（useradd/userdel 互逆）
 *   9. 容器管理（docker stop/rm）
 *   10. 定时任务（crontab 备份恢复）
 */
const ROLLBACK_RULES: readonly RollbackRule[] = [
  // ─── 1-3. Git 操作 ──────────────────────────────────────────────
  {
    name: 'git-add-commit',
    pattern: /\bgit\s+(add|commit)\b/i,
    generator: () => 'git reset --hard HEAD~1',
  },
  {
    name: 'git-checkout',
    pattern: /\bgit\s+checkout\b/i,
    generator: () => 'git checkout -（恢复到上一个分支）',
  },
  {
    name: 'git-reset',
    pattern: /\bgit\s+reset\b/i,
    generator: () => 'git reflog + git reset --hard <旧 commit>',
  },

  // ─── 4-5. 包管理 ────────────────────────────────────────────────
  {
    name: 'yum-dnf-install',
    pattern: /\b(yum|dnf)\s+install\s+(\S+)/i,
    generator: (m) => `${m[1].toLowerCase()} remove ${m[2]}`,
  },
  {
    name: 'apt-install',
    pattern: /\bapt(-get)?\s+install\s+(\S+)/i,
    generator: (m) => `apt remove ${m[2]}`,
  },

  // ─── 6-7. 服务管理 ──────────────────────────────────────────────
  {
    name: 'systemctl-start-stop-restart',
    pattern: /\bsystemctl\s+(start|stop|restart)\s+(\S+)/i,
    generator: (m) => {
      const action = m[1].toLowerCase()
      const svc = m[2]
      const reverse = action === 'stop' ? 'start' : 'stop'
      return `systemctl ${reverse} ${svc}`
    },
  },
  {
    name: 'systemctl-enable-disable',
    pattern: /\bsystemctl\s+(enable|disable)\s+(\S+)/i,
    generator: (m) => {
      const action = m[1].toLowerCase()
      const svc = m[2]
      const reverse = action === 'enable' ? 'disable' : 'enable'
      return `systemctl ${reverse} ${svc}`
    },
  },

  // ─── 8-10. 文件修改（备份优先策略）──────────────────────────────
  {
    name: 'file-redirect-etc',
    pattern: />\s*(\/etc\/[^\s|&;]+)/i,
    generator: (m) => {
      const file = m[1]
      return `从备份恢复：cp ${file}.bak ${file}（建议操作前先执行 cp ${file} ${file}.bak 备份）`
    },
  },
  {
    name: 'file-redirect-other',
    pattern: />\s*(\/[^\s|&;]+)/i,
    generator: (m) => {
      const file = m[1]
      return `从备份恢复：cp ${file}.bak ${file}（建议操作前先执行 cp ${file} ${file}.bak 备份）`
    },
  },
  {
    name: 'sed-inplace',
    pattern: /\bsed\s+-i\b/i,
    generator: (_m, cmd) => {
      // sed -i 's/old/new/g' /path/to/file → 提取最后的文件路径
      const fileMatch = cmd.match(/\s+(\/[^\s']+)\s*$/)
      const file = fileMatch?.[1] ?? '<目标文件>'
      return `从备份恢复：cp ${file}.bak ${file}（建议操作前先执行 cp ${file} ${file}.bak 备份）`
    },
  },

  // ─── 11-12. 权限/所有者修改 ────────────────────────────────────
  {
    name: 'chmod',
    pattern: /\bchmod\s+(\d+)\s+(\S+)/i,
    generator: (m) => {
      const file = m[2]
      return `恢复原权限：chmod <原权限> ${file}（执行前建议先执行 stat -c %a ${file} 记录原权限）`
    },
  },
  {
    name: 'chown',
    pattern: /\bchown\s+(\S+)\s+(\S+)/i,
    generator: (m) => {
      const file = m[2]
      return `恢复原所有者：chown <原所有者> ${file}（执行前建议先执行 stat -c %U:%G ${file} 记录原所有者）`
    },
  },

  // ─── 13-14. 文件操作 ───────────────────────────────────────────
  {
    name: 'cp',
    pattern: /\bcp\s+(\S+)\s+(\S+)/i,
    generator: (m) => {
      const src = m[1]
      const dst = m[2]
      return `删除复制副本：rm -f ${dst}（原文件 ${src} 不受影响）`
    },
  },
  {
    name: 'mv',
    pattern: /\bmv\s+(\S+)\s+(\S+)/i,
    generator: (m) => {
      const src = m[1]
      const dst = m[2]
      return `移回原位置：mv ${dst} ${src}`
    },
  },

  // ─── 15. 网络规则 ──────────────────────────────────────────────
  {
    name: 'iptables-append',
    pattern: /\biptables\s+(-A|--append)\b/i,
    generator: (_m, cmd) => {
      // iptables -A INPUT -p tcp --dport 80 -j ACCEPT → iptables -D INPUT -p tcp --dport 80 -j ACCEPT
      const ruleContent = cmd.replace(/\biptables\s+(-A|--append)\b/i, 'iptables -D')
      return `删除规则：${ruleContent}`
    },
  },

  // ─── 16-17. 用户管理 ───────────────────────────────────────────
  {
    name: 'useradd',
    pattern: /\buseradd\s+(\S+)/i,
    generator: (m) => {
      const user = m[1]
      return `删除用户：userdel -r ${user}`
    },
  },
  {
    name: 'userdel',
    pattern: /\buserdel\s+(\S+)/i,
    generator: (m) => {
      const user = m[1]
      return `恢复用户：useradd ${user}（需从备份恢复 home 目录）`
    },
  },

  // ─── 18. 容器管理 ──────────────────────────────────────────────
  {
    name: 'docker-run',
    pattern: /\bdocker\s+run\b/i,
    generator: (_m, cmd) => {
      const nameMatch = cmd.match(/--name\s+(\S+)/i)
      const name = nameMatch?.[1] ?? '<容器ID>'
      return `停止并删除容器：docker stop ${name} && docker rm ${name}`
    },
  },
]

// ============================================================================
// 主函数
// ============================================================================

/**
 * 生成回滚命令建议
 *
 * 根据命令类型给出回滚建议。无法回滚的命令返回 undefined。
 *
 * @param command 待执行的命令
 * @param risk 风险等级（high 风险命令会额外检查不可逆黑名单）
 * @returns 回滚命令字符串（undefined 表示无法回滚或无需回滚）
 *
 * @example
 * generateRollbackCommand('systemctl stop nginx', 'medium')
 * // → 'systemctl start nginx'
 *
 * generateRollbackCommand('echo "new" > /etc/sysctl.conf', 'high')
 * // → '从备份恢复：cp /etc/sysctl.conf.bak /etc/sysctl.conf（建议操作前先执行 cp /etc/sysctl.conf /etc/sysctl.conf.bak 备份）'
 *
 * generateRollbackCommand('rm -rf /var/log', 'high')
 * // → undefined（不可逆）
 */
export function generateRollbackCommand(
  command: string,
  risk: RiskLevel = 'medium',
): string | undefined {
  // 1. 不可逆命令直接返回 undefined
  if (isIrreversible(command)) {
    return undefined
  }

  // 2. 按规则表顺序匹配
  for (const rule of ROLLBACK_RULES) {
    const match = command.match(rule.pattern)
    if (match) {
      try {
        return rule.generator(match, command)
      } catch (err) {
        // 规则生成器异常时降级到 undefined，不阻塞主流程
        // （避免回滚建议生成失败导致整个审批流程失败）
        console.warn(
          `[rollback-generator] 规则 "${rule.name}" 生成器异常:`,
          err instanceof Error ? err.message : String(err),
        )
        return undefined
      }
    }
  }

  // 3. high 风险命令未匹配到规则时返回 undefined（保守策略）
  if (risk === 'high') {
    return undefined
  }

  // 4. low/medium 风险命令未匹配到规则时返回 undefined
  return undefined
}

// ============================================================================
// 辅助函数（供测试和外部调用）
// ============================================================================

/**
 * 获取所有回滚规则名称（用于测试覆盖度验证）
 *
 * @returns 规则名称数组
 */
export function listRollbackRuleNames(): string[] {
  return ROLLBACK_RULES.map((r) => r.name)
}

/**
 * 获取不可逆命令模式数量（用于测试覆盖度验证）
 *
 * @returns 不可逆命令模式数量
 */
export function countIrreversiblePatterns(): number {
  return IRREVERSIBLE_PATTERNS.length
}
