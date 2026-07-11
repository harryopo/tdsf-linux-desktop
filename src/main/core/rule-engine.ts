/**
 * 规则引擎模块（LLM 降级备用）
 *
 * 当 LLM 不可用时，基于关键词匹配识别常见 Linux 故障场景，
 * 给出诊断假设和修复命令建议。
 *
 * 支持场景：
 *   - OOM（内存不足/进程被杀）
 *   - 磁盘满
 *   - CPU 负载高
 *   - 内存使用高
 *   - 502 Bad Gateway
 *   - 权限拒绝
 *   - 连接拒绝
 *   - 服务启动失败
 */

/** 规则分析结果 */
export interface RuleAnalysisResult {
  /** 问题根因假设 */
  hypothesis: string
  /** 修复命令 */
  fixCommand: string
  /** 置信度 [0, 1] */
  confidence: number
}

/** 规则定义 */
interface Rule {
  /** 规则名称 */
  name: string
  /** 匹配关键词（小写） */
  keywords: string[]
  /** 根因假设 */
  hypothesis: string
  /** 修复命令 */
  fixCommand: string
  /** 置信度 */
  confidence: number
}

/** 故障规则表（按优先级排序） */
const RULES: Rule[] = [
  {
    name: 'oom',
    keywords: ['out of memory', 'oom', 'killed process', '内存不足', 'oom-killer', 'oom killer'],
    hypothesis: '内存不足导致进程被 OOM Killer 杀死',
    fixCommand: 'free -m && ps aux --sort=-%mem | head -10',
    confidence: 0.7
  },
  {
    name: 'disk_full',
    keywords: ['no space left', 'disk full', '磁盘满', '空间不足', 'no space left on device'],
    hypothesis: '磁盘空间不足',
    fixCommand: 'df -h && du -sh /var/log/* 2>/dev/null | sort -rh | head -10',
    confidence: 0.7
  },
  {
    name: 'cpu_high',
    keywords: ['cpu', 'load average', '负载高', 'high cpu', 'cpu usage', 'cpu 高'],
    hypothesis: 'CPU 负载过高',
    fixCommand: 'ps aux --sort=-%cpu | head -10',
    confidence: 0.6
  },
  {
    name: 'memory_high',
    keywords: ['memory', '内存高', 'high memory', '内存泄漏', 'memory leak', '内存占用'],
    hypothesis: '内存使用率过高',
    fixCommand: 'free -m && ps aux --sort=-%mem | head -10',
    confidence: 0.6
  },
  {
    name: '502',
    keywords: ['502', 'bad gateway', '502 bad gateway'],
    hypothesis: '后端服务不可用导致 502 Bad Gateway',
    fixCommand: 'systemctl status nginx && systemctl status php-fpm',
    confidence: 0.65
  },
  {
    name: 'permission_denied',
    keywords: ['permission denied', '权限不足', 'access denied', 'operation not permitted'],
    hypothesis: '文件权限不足',
    fixCommand: 'ls -la',
    confidence: 0.55
  },
  {
    name: 'connection_refused',
    keywords: ['connection refused', '连接拒绝', 'port not listening', 'connection timed out'],
    hypothesis: '服务未运行或端口未监听',
    fixCommand: 'ss -tlnp',
    confidence: 0.6
  },
  {
    name: 'service_failed',
    keywords: ['failed to start', 'unit not found', 'service failed', 'active: failed'],
    hypothesis: '系统服务启动失败',
    fixCommand: 'systemctl status',
    confidence: 0.55
  }
]

/**
 * 基于规则分析问题
 *
 * 将用户问题和日志文本合并后，与故障规则表进行关键词匹配，
 * 返回第一个匹配的规则结果。
 *
 * @param problem - 用户问题描述
 * @param logs - 日志文本
 * @returns 分析结果，无匹配规则时返回 null
 */
export function analyzeByRules(problem: string, logs: string): RuleAnalysisResult | null {
  const combined = `${problem} ${logs}`.toLowerCase()

  for (const rule of RULES) {
    if (matchesRule(combined, rule)) {
      return {
        hypothesis: rule.hypothesis,
        fixCommand: rule.fixCommand,
        confidence: rule.confidence
      }
    }
  }

  return null
}

/**
 * 检查文本是否匹配规则（任一关键词命中即匹配）
 * @param text - 小写文本
 * @param rule - 规则
 * @returns true 表示匹配
 */
function matchesRule(text: string, rule: Rule): boolean {
  for (const keyword of rule.keywords) {
    if (text.includes(keyword.toLowerCase())) return true
  }
  return false
}
