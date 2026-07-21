/**
 * 日志分析器（v1.5 新增）
 *
 * 核心能力：基于规则匹配分析 Sidecar 日志，检测常见问题：
 * - 端口冲突（Address already in use）
 * - Python 依赖缺失（ModuleNotFoundError / ImportError）
 * - Uvicorn/FastAPI 启动错误
 * - Python 异常 traceback
 * - 健康检查失败
 * - LLM 配置错误
 *
 * 设计参考：
 * - Fail2Ban 日志模式匹配
 * - Sentry 错误指纹
 * - Elastic Logstash Grok 模式
 */

import type {
  LogEvent,
  DiagnosticRule,
  DiagnosticFinding,
  Severity,
  DiagnosticCategory,
  DiagnosticReport,
} from './types'

// ============================================================
// 内置检测规则库
// ============================================================

export const BUILTIN_RULES: DiagnosticRule[] = [
  // 端口冲突
  {
    id: 'port-conflict-001',
    category: 'port_conflict',
    severity: 'critical',
    description: '端口已被占用（Address already in use）',
    pattern: /address already in use|port \d+ is in use|EADDRINUSE|bind\(\) failed/i,
    remediation: '检查端口占用：netstat -ano | findstr :19000，结束占用进程或更换端口',
  },
  {
    id: 'port-conflict-002',
    category: 'port_conflict',
    severity: 'error',
    description: 'WinError 10048 端口占用（Windows）',
    pattern: /WinError 10048|通常套接字地址只能使用一次/i,
    remediation: 'Windows 端口占用：netstat -ano | findstr :19000，taskkill /PID <pid> /F',
  },

  // Python 依赖缺失
  {
    id: 'dep-missing-001',
    category: 'dependency_missing',
    severity: 'critical',
    description: 'ModuleNotFoundError：Python 依赖未安装',
    pattern: /ModuleNotFoundError:\s*No module named ['"]?([\w.]+)/i,
    remediation: '在对应 venv 中安装缺失依赖：.venv-sidecar-a\\Scripts\\pip install <module>',
  },
  {
    id: 'dep-missing-002',
    category: 'dependency_missing',
    severity: 'error',
    description: 'ImportError：模块导入失败',
    pattern: /ImportError:\s*(.+?)(?:\n|$)/i,
    remediation: '检查模块版本兼容性或重新安装：pip install --upgrade <module>',
  },

  // Uvicorn/FastAPI 错误
  {
    id: 'uvicorn-error-001',
    category: 'uvicorn_error',
    severity: 'critical',
    description: 'Uvicorn 启动失败',
    pattern: /uvicorn\.error|Traceback \(most recent call last\):.*uvicorn/is,
    remediation: '检查 main.py 语法和 FastAPI app 对象定义',
  },
  {
    id: 'uvicorn-error-002',
    category: 'uvicorn_error',
    severity: 'error',
    description: 'FastAPI 应用加载失败',
    pattern: /APPLICATION FAILED|Application startup failed/i,
    remediation: '检查 FastAPI app 实例化和路由定义',
  },

  // Python 异常
  {
    id: 'py-exc-001',
    category: 'python_exception',
    severity: 'error',
    description: 'Python 未捕获异常',
    pattern: /Traceback \(most recent call last\):/i,
    remediation: '查看完整 traceback 定位异常源',
  },
  {
    id: 'py-exc-002',
    category: 'python_exception',
    severity: 'critical',
    description: 'NameError：变量未定义',
    pattern: /NameError:\s*name ['"]?([\w.]+)['"]?\s*is not defined/i,
    remediation: '检查变量是否正确导入或声明',
  },
  {
    id: 'py-exc-003',
    category: 'python_exception',
    severity: 'error',
    description: 'AttributeError：属性不存在',
    pattern: /AttributeError:\s*(.+?)(?:\n|$)/i,
    remediation: '检查对象类型和方法是否存在',
  },
  {
    id: 'py-exc-004',
    category: 'python_exception',
    severity: 'error',
    description: 'TypeError：类型错误',
    pattern: /TypeError:\s*(.+?)(?:\n|$)/i,
    remediation: '检查函数参数类型和数量',
  },

  // 模块找不到
  {
    id: 'module-not-found-001',
    category: 'module_not_found',
    severity: 'critical',
    description: 'No module named（uvicorn/fastapi）',
    pattern: /No module named ['"]?(uvicorn|fastapi|pydantic)['"]?/i,
    remediation: '安装核心依赖：pip install fastapi uvicorn pydantic',
  },

  // 健康检查失败
  {
    id: 'health-fail-001',
    category: 'health_check_fail',
    severity: 'warning',
    description: 'Sidecar 健康检查超时',
    pattern: /Sidecar 启动超时|health check timeout|waitForReady timeout/i,
    remediation: '检查 Sidecar 启动耗时是否过长，或增加 startupTimeoutMs',
  },

  // Sidecar 崩溃
  {
    id: 'sidecar-crash-001',
    category: 'sidecar_crash',
    severity: 'critical',
    description: 'Sidecar 进程退出（非零退出码）',
    pattern: /Sidecar \w+ 退出.*code=(\d+)/i,
    remediation: '根据退出码排查原因，常见：1=Python 异常，127=命令未找到，139=段错误',
  },

  // LLM 配置错误
  {
    id: 'llm-config-001',
    category: 'llm_config_error',
    severity: 'warning',
    description: 'LLM API Key 未配置',
    pattern: /API Key 未配置|OPENAI_API_KEY not set|llm_config\.apiKey is empty/i,
    remediation: '在设置中配置 LLM API Key（支持火山方舟/DeepSeek/OpenAI 兼容 API）',
  },
  {
    id: 'llm-config-002',
    category: 'llm_config_error',
    severity: 'error',
    description: 'LLM 调用失败',
    pattern: /LLM 调用失败|openai\.AuthenticationError|ConnectionError.*openai/i,
    remediation: '检查 API Key 有效性、网络代理、baseUrl 是否可达',
  },

  // 超时
  {
    id: 'timeout-001',
    category: 'timeout',
    severity: 'warning',
    description: '请求超时',
    pattern: /TimeoutError|Request timed out|aborted due to timeout/i,
    remediation: '检查网络连通性，增加 timeout 配置',
  },
]

// ============================================================
// 日志分析器
// ============================================================

/**
 * LogAnalyzer - 日志分析器
 *
 * 对每条日志应用所有规则，返回命中的检测结果。
 * 支持批量分析以提升性能。
 */
export class LogAnalyzer {
  private rules: DiagnosticRule[]

  constructor(rules: DiagnosticRule[] = BUILTIN_RULES) {
    this.rules = rules
  }

  /**
   * 添加自定义规则
   */
  addRule(rule: DiagnosticRule): void {
    this.rules.push(rule)
  }

  /**
   * 分析单条日志
   *
   * @returns 命中的检测结果数组（一条日志可能命中多个规则）
   */
  analyze(event: LogEvent): DiagnosticFinding[] {
    const findings: DiagnosticFinding[] = []

    for (const rule of this.rules) {
      const match = event.raw.match(rule.pattern)
      if (match) {
        findings.push({
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          matchedLine: event.raw,
          source: event.source,
          timestamp: event.timestamp,
          remediation: rule.remediation,
          description: rule.description,
        })
      }
    }

    return findings
  }

  /**
   * 批量分析日志
   */
  analyzeBatch(events: LogEvent[]): { findings: DiagnosticFinding[]; byEvent: Map<LogEvent, DiagnosticFinding[]> } {
    const allFindings: DiagnosticFinding[] = []
    const byEvent = new Map<LogEvent, DiagnosticFinding[]>()

    for (const event of events) {
      const f = this.analyze(event)
      if (f.length > 0) {
        allFindings.push(...f)
        byEvent.set(event, f)
      }
    }

    return { findings: allFindings, byEvent }
  }

  /**
   * 生成诊断报告
   */
  generateReport(events: LogEvent[], findings: DiagnosticFinding[]): DiagnosticReport {
    const bySeverity: Record<Severity, number> = {
      info: 0,
      warning: 0,
      error: 0,
      critical: 0,
    }
    const byCategory: Record<DiagnosticCategory, number> = {
      port_conflict: 0,
      dependency_missing: 0,
      python_exception: 0,
      import_error: 0,
      uvicorn_error: 0,
      sidecar_crash: 0,
      health_check_fail: 0,
      llm_config_error: 0,
      module_not_found: 0,
      timeout: 0,
      unknown: 0,
    }
    const bySource: Record<string, number> = {
      sre: 0,
      analytics: 0,
      agent: 0,
      main: 0,
      renderer: 0,
    }

    for (const f of findings) {
      bySeverity[f.severity]++
      byCategory[f.category]++
      bySource[f.source] = (bySource[f.source] || 0) + 1
    }

    const healthy = bySeverity.critical === 0 && bySeverity.error === 0

    return {
      generatedAt: new Date().toISOString(),
      totalLogs: events.length,
      totalFindings: findings.length,
      bySeverity,
      byCategory,
      bySource: bySource as Record<LogEvent['source'], number>,
      findings,
      summary: this.generateSummary(healthy, findings.length, bySeverity),
      healthy,
    }
  }

  private generateSummary(
    healthy: boolean,
    totalFindings: number,
    bySeverity: Record<Severity, number>
  ): string {
    if (healthy && totalFindings === 0) {
      return '✅ 日志检测健康：未发现任何问题'
    }
    if (healthy) {
      return `⚠️ 检测到 ${totalFindings} 个非严重问题（warning/info）`
    }
    const parts: string[] = []
    if (bySeverity.critical > 0) parts.push(`${bySeverity.critical} 个严重问题`)
    if (bySeverity.error > 0) parts.push(`${bySeverity.error} 个错误`)
    if (bySeverity.warning > 0) parts.push(`${bySeverity.warning} 个警告`)
    return `❌ 检测到问题：${parts.join('，')}（共 ${totalFindings} 项）`
  }
}
