/**
 * 方法论 Subagent（Methodology Subagent）
 *
 * 职责：
 * - 应用运维方法论（故障排查方法论 / SH 安全指南 / 最佳实践库）
 * - 推荐系统化的排查方法论（USE方法/RED方法/故障树等）
 * - 给出结构化排查路径
 *
 * 主要工具：LLM（方法论推理）+ 内置方法论模板
 *
 * 实现策略：
 * - 主路径：调用 LLM 生成方法论导向的排查框架
 * - 降级路径：LLM 不可用时返回通用 USE/RED 方法论模板
 *
 * 方案书依据：v0.9 §3.1 表格第 6 行
 */
import type { ModelMessage } from 'ai'
import { BaseSubagent, type SubagentTask, type SubagentResult } from './base'
import { getSupervisor } from '../supervisor'

/** 方法论 Subagent 系统提示词 */
const METHODOLOGY_SYSTEM_PROMPT = `你是 Linux 故障诊断方法论专家。根据用户描述的故障，推荐系统化的排查方法论（USE方法/RED方法/故障树等），给出结构化排查路径。`

/**
 * 方法论 Subagent 输入
 */
export interface MethodologySubagentInput {
  /** 故障描述（自然语言） */
  faultDescription: string
  /** 可选：故障分类（如 "性能"、"网络"、"存储"、"进程"） */
  faultCategory?: string
  /** 可选：目标系统信息 */
  systemInfo?: string
}

/**
 * 方法论框架结构
 */
interface MethodologyFramework {
  /** 推荐的方法论名称 */
  methodology: string
  /** 方法论说明 */
  description: string
  /** 结构化排查路径（Markdown 格式） */
  troubleshootingPath: string
  /** 推荐使用的诊断命令 */
  diagnosticCommands: string[]
  /** 排查优先级建议 */
  priorities: string[]
  /** 来源：llm / template */
  source: 'llm' | 'template'
}

/** USE 方法论模板 */
const USE_METHOD_TEMPLATE = `## USE 方法论排查路径

USE 方法（Utilization / Saturation / Errors）适用于资源类故障排查。

### 1. Utilization（利用率）
检查资源使用率是否达到瓶颈：
\`\`\`bash
# CPU 利用率
top -bn1 | head -5
mpstat -P ALL 1 3

# 内存利用率
free -h
vmstat 1 5

# 磁盘 I/O 利用率
iostat -xz 1 3
df -h

# 网络利用率
ss -s
iftop -n
\`\`\`

### 2. Saturation（饱和度）
检查资源队列是否溢出：
\`\`\`bash
# CPU 运行队列
vmstat 1 5  # 关注 r 列（run queue）

# 内存交换
vmstat 1 5  # 关注 si/so 列（swap in/out）
swapon --show

# 磁盘队列
iostat -xz 1 3  # 关注 avgqu-sz 和 await

# 网络丢包
netstat -s | grep -i drop
\`\`\`

### 3. Errors（错误）
检查是否存在错误事件：
\`\`\`bash
# 系统日志错误
journalctl -p err --since "1 hour ago"
dmesg | grep -i error

# 网络错误
ip -s link show
netstat -s | grep -i error

# 磁盘错误
dmesg | grep -i "i/o error"
smartctl -a /dev/sda
\`\`\``

/** RED 方法论模板 */
const RED_METHOD_TEMPLATE = `## RED 方法论排查路径

RED 方法（Rate / Errors / Duration）适用于服务类故障排查。

### 1. Rate（请求速率）
确认服务的请求量是否正常：
\`\`\`bash
# 服务连接数
ss -tnp | grep :<端口> | wc -l
netstat -an | grep ESTABLISHED | wc -l

# HTTP 请求速率（如有访问日志）
tail -1000 /var/log/nginx/access.log | awk '{print $4}' | cut -d: -f2-3 | sort | uniq -c

# 服务状态
systemctl status <服务名>
\`\`\`

### 2. Errors（错误率）
检查服务的错误比例：
\`\`\`bash
# 服务错误日志
journalctl -u <服务名> --since "10 min ago" | grep -i error
tail -100 /var/log/<服务名>/error.log

# HTTP 错误码统计
tail -1000 /var/log/nginx/access.log | awk '$9 >= 500' | wc -l

# 系统级错误
dmesg | tail -50
\`\`\`

### 3. Duration（响应时间）
检查服务的响应延迟：
\`\`\`bash
# 网络延迟
ping -c 10 <目标IP>
traceroute <目标IP>

# 服务响应时间
curl -o /dev/null -s -w "DNS: %{time_namelookup}s\\nConnect: %{time_connect}s\\nTTFB: %{time_starttransfer}s\\nTotal: %{time_total}s\\n" http://localhost:<端口>/

# 系统负载
uptime
cat /proc/loadavg
\`\`\``

/** 故障树方法论模板 */
const FAULT_TREE_TEMPLATE = `## 故障树排查路径

故障树分析（FTA）适用于复杂故障的系统化定位。

### 排查流程

1. **定义顶事件**：明确故障现象（如"服务不可用"、"响应超时"）
2. **逐层分解**：将顶事件分解为中间事件和底事件
3. **逐层验证**：从底事件开始逐一排查

### 通用故障树结构

\`\`\`
顶事件：服务异常
├── 中间事件 1：资源不足
│   ├── 底事件：CPU 满载 → top/mpstat
│   ├── 底事件：内存耗尽 → free/vmstat
│   ├── 底事件：磁盘满 → df -h
│   └── 底事件：文件描述符耗尽 → ulimit -n / ls /proc/PID/fd
├── 中间事件 2：网络异常
│   ├── 底事件：链路不通 → ping/traceroute
│   ├── 底事件：DNS 解析失败 → nslookup/dig
│   ├── 底事件：端口未监听 → ss -tlnp
│   └── 底事件：防火墙拦截 → iptables -L / firewall-cmd --list-all
├── 中间事件 3：服务自身问题
│   ├── 底事件：进程未运行 → systemctl status / ps aux
│   ├── 底事件：配置错误 → 检查配置文件语法
│   ├── 底事件：依赖服务异常 → 检查上下游服务
│   └── 底事件：代码 Bug → 查看应用日志
└── 中间事件 4：系统级问题
    ├── 底事件：内核异常 → dmesg
    ├── 底事件：文件系统损坏 → fsck
    └── 底事件：时间不同步 → chronyc tracking
\`\`\`

### 排查原则

- **先外后内**：先检查网络/电源等外部因素
- **先简后繁**：先排除简单原因（如服务未启动）
- **先近后远**：先检查本机，再检查远端
- **变更优先**：优先排查最近的变更（配置/部署/更新）`

export class MethodologySubagent extends BaseSubagent {
  readonly name = 'methodology' as const
  readonly displayName = '方法论 Subagent'
  readonly description = '运维方法论应用（故障排查方法论 + SH 安全指南 + 最佳实践库）'

  protected async doExecute(task: SubagentTask): Promise<SubagentResult> {
    const startTime = Date.now()
    const input = this.parseInput(task)

    if (!input.faultDescription) {
      return {
        taskId: task.id,
        success: false,
        output: null,
        error: '缺少必需字段：faultDescription（故障描述）',
        durationMs: Date.now() - startTime,
      }
    }

    this.log.info(`[${this.name}] 开始方法论分析`, {
      taskId: task.id,
      faultDescription: input.faultDescription.slice(0, 100),
      faultCategory: input.faultCategory,
    })

    // 主路径：调用 LLM 生成方法论框架
    try {
      const framework = await this.generateWithLlm(input, task)
      return {
        taskId: task.id,
        success: true,
        output: framework,
        confidence: 0.85,
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.log.warn(`[${this.name}] LLM 调用失败，降级到方法论模板`, {
        taskId: task.id,
        error: errorMsg,
      })
    }

    // 降级路径：返回通用方法论模板
    try {
      const framework = this.buildTemplateFramework(input)
      return {
        taskId: task.id,
        success: true,
        output: framework,
        confidence: 0.5,
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      this.log.warn(`[${this.name}] 模板生成也失败`, {
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 全部失败
    return {
      taskId: task.id,
      success: false,
      output: null,
      error: '方法论分析失败：LLM 不可用且模板生成异常。请配置 LLM Provider 后重试。',
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * 通过 Supervisor.chat 调用 LLM 生成方法论框架
   */
  private async generateWithLlm(input: MethodologySubagentInput, task: SubagentTask): Promise<MethodologyFramework> {
    const supervisor = getSupervisor()

    // 构造用户消息
    let userContent = `故障描述：${input.faultDescription}`
    if (input.faultCategory) {
      userContent += `\n故障分类：${input.faultCategory}`
    }
    if (input.systemInfo) {
      userContent += `\n系统信息：${input.systemInfo}`
    }
    userContent += `\n\n请根据以上故障描述：\n1. 推荐最适合的排查方法论（USE方法/RED方法/故障树/其他）并说明选择理由\n2. 给出结构化的排查路径（按优先级排序）\n3. 列出每个排查步骤对应的诊断命令\n4. 给出排查优先级建议和注意事项\n回答使用中文，命令使用代码块格式。`

    const messages: ModelMessage[] = [
      { role: 'system', content: METHODOLOGY_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ]

    let fullText = ''
    await new Promise<void>((resolve, reject) => {
      void supervisor.chat({
        messages,
        providerId: task.providerId,
        strength: task.strength ?? 'standard',
        correlationId: `${task.id}_methodology`,
        onToken: (delta) => {
          fullText += delta
        },
        onDone: () => resolve(),
        onError: (err) => reject(err),
      })
    })

    if (!fullText.trim()) {
      throw new Error('LLM 返回空内容')
    }

    // 推断推荐的方法论名称
    const methodology = this.inferMethodology(input.faultCategory, fullText)

    return {
      methodology,
      description: `基于故障描述「${input.faultDescription.slice(0, 50)}」推荐的排查方法论`,
      troubleshootingPath: fullText.trim(),
      diagnosticCommands: this.extractCommandsFromText(fullText),
      priorities: this.extractPriorities(input.faultCategory),
      source: 'llm',
    }
  }

  /**
   * 降级：构建模板方法论框架
   */
  private buildTemplateFramework(input: MethodologySubagentInput): MethodologyFramework {
    const category = input.faultCategory ?? this.inferCategory(input.faultDescription)
    const template = this.selectTemplate(category)
    const commands = this.extractCommandsFromText(template.content)

    return {
      methodology: template.methodology,
      description: `基于故障分类「${category}」推荐的通用排查方法论（LLM 不可用，使用内置模板）`,
      troubleshootingPath: template.content,
      diagnosticCommands: commands,
      priorities: this.extractPriorities(category),
      source: 'template',
    }
  }

  /**
   * 根据故障分类选择方法论模板
   */
  private selectTemplate(category: string): { methodology: string; content: string } {
    switch (category) {
      case '性能':
      case '资源':
      case 'CPU':
      case '内存':
      case '磁盘':
        return { methodology: 'USE 方法', content: USE_METHOD_TEMPLATE }
      case '服务':
      case '应用':
      case '网络':
      case 'API':
        return { methodology: 'RED 方法', content: RED_METHOD_TEMPLATE }
      default:
        return { methodology: '故障树分析（FTA）', content: FAULT_TREE_TEMPLATE }
    }
  }

  /**
   * 从文本中提取 bash 命令
   */
  private extractCommandsFromText(text: string): string[] {
    const commands: string[] = []
    // 匹配 ```bash ... ``` 代码块中的命令
    const codeBlockRegex = /```(?:bash|shell|sh)?\n([\s\S]*?)```/g
    let match: RegExpExecArray | null
    while ((match = codeBlockRegex.exec(text)) !== null) {
      const lines = match[1].split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        // 跳过注释和空行
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
          commands.push(trimmed)
        }
      }
    }
    return commands.slice(0, 15)
  }

  /**
   * 推断方法论名称
   */
  private inferMethodology(category: string | undefined, text: string): string {
    if (text.includes('USE') || category === '性能' || category === '资源') {
      return 'USE 方法（Utilization/Saturation/Errors）'
    }
    if (text.includes('RED') || category === '服务' || category === '应用') {
      return 'RED 方法（Rate/Errors/Duration）'
    }
    if (text.includes('故障树') || text.includes('FTA')) {
      return '故障树分析（FTA）'
    }
    return '综合排查方法论'
  }

  /**
   * 从故障描述推断分类
   */
  private inferCategory(description: string): string {
    const lower = description.toLowerCase()
    if (/cpu|内存|磁盘|io|负载|慢|卡|性能/.test(lower)) return '性能'
    if (/网络|连接|超时|dns|端口|ping/.test(lower)) return '网络'
    if (/服务|进程|启动|崩溃|502|503|应用/.test(lower)) return '服务'
    if (/权限|拒绝|denied|403|认证/.test(lower)) return '安全'
    return '综合'
  }

  /**
   * 提取排查优先级建议
   */
  private extractPriorities(category: string | undefined): string[] {
    const base = [
      '先确认故障现象（可复现？影响范围？）',
      '检查最近变更（配置/部署/更新）',
      '查看系统日志和应用日志',
    ]

    switch (category) {
      case '性能':
        return [...base, '使用 USE 方法逐资源排查', '关注 top/iostat/vmstat 输出']
      case '网络':
        return [...base, '从物理层→网络层→应用层逐层排查', '使用 ping/traceroute/ss 定位断点']
      case '服务':
        return [...base, '使用 RED 方法检查服务三指标', '确认服务进程状态和依赖关系']
      default:
        return [...base, '使用故障树方法逐层分解', '先排除简单原因再深入排查']
    }
  }

  /**
   * 解析任务输入（兼容字符串和结构化对象）
   */
  private parseInput(task: SubagentTask): MethodologySubagentInput {
    if (typeof task.input === 'string') {
      return { faultDescription: task.input }
    }
    if (task.input && typeof task.input === 'object') {
      const obj = task.input as Record<string, unknown>
      return {
        faultDescription: typeof obj.faultDescription === 'string'
          ? obj.faultDescription
          : typeof obj.description === 'string'
            ? obj.description
            : typeof obj.prompt === 'string'
              ? obj.prompt
              : (task.description ?? ''),
        faultCategory: typeof obj.faultCategory === 'string'
          ? obj.faultCategory
          : typeof obj.category === 'string'
            ? obj.category
            : undefined,
        systemInfo: typeof obj.systemInfo === 'string' ? obj.systemInfo : undefined,
      }
    }
    return { faultDescription: task.description ?? '' }
  }
}
