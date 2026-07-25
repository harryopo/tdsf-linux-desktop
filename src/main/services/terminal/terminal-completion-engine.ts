/**
 * 终端智能补全引擎（Phase 1）
 *
 * 零 Token 本地补全：
 * - 内存 Trie：基于命令历史构建前缀树，O(L) 前缀查找
 * - SQLite 持久化：命令历史落盘，重启后仍可补全
 * - Frecency 排序：频次 + 时间衰减，让常用且最近使用的命令排在前面
 * - 多源补充：历史不足时，用静态常见 Linux 命令兜底
 *
 * 设计约束：
 * - 不调用任何 LLM / API，完全本地计算
 * - 单次补全延迟 < 10ms（Trie 查找）
 * - 内存占用可控（默认保留最近 10000 条命令）
 */

import { TerminalHistoryIndex } from './terminal-history-index'

/** Trie 节点 */
interface TrieNode {
  /** 当前节点代表的完整命令（到达终点时非空） */
  command?: string
  /** 子节点映射：字符 -> TrieNode */
  children: Map<string, TrieNode>
  /** Frecency 分数（用于同前缀下排序） */
  score: number
}

/** 补全建议单项 */
export interface CompletionSuggestion {
  /** 完整命令 */
  command: string
  /** 需要追加到当前输入后面的文本 */
  completion: string
  /** Frecency 分数 */
  score: number
  /** 来源：history / static */
  source: 'history' | 'static'
}

/** 补全引擎配置 */
export interface TerminalCompletionEngineOptions {
  /** 历史索引实例（可选，默认新建） */
  historyIndex?: TerminalHistoryIndex
  /** 最大保留历史命令数（默认 10000） */
  maxHistoryItems?: number
  /** 最大返回建议数（默认 5） */
  maxSuggestions?: number
  /** 静态命令词表（兜底） */
  staticCommands?: string[]
}

/** 常见 Linux 运维命令兜底词表 */
const DEFAULT_STATIC_COMMANDS: string[] = [
  'ls -la',
  'ls -lh',
  'cd /etc',
  'cd /var/log',
  'cat /var/log/messages',
  'cat /var/log/syslog',
  'tail -f /var/log/messages',
  'tail -f /var/log/syslog',
  'ps aux',
  'ps aux | grep ',
  'top',
  'htop',
  'df -h',
  'du -sh ',
  'du -sh .',
  'free -h',
  'systemctl status ',
  'systemctl start ',
  'systemctl stop ',
  'systemctl restart ',
  'systemctl enable ',
  'journalctl -u ',
  'journalctl -xe',
  'journalctl -f',
  'ss -tlnp',
  'netstat -tlnp',
  'ip addr',
  'ip route',
  'ping ',
  'curl -I ',
  'curl -s ',
  'wget ',
  'scp ',
  'ssh ',
  'tar -czvf ',
  'tar -xzvf ',
  'chmod +x ',
  'chmod 755 ',
  'chown -R ',
  'find / -name ',
  'grep -rn ',
  'awk ',
  'sed -i ',
  'crontab -l',
  'crontab -e',
  'yum install -y ',
  'dnf install -y ',
  'apt update && apt install -y ',
  'docker ps',
  'docker logs ',
  'docker exec -it ',
  'kubectl get pods',
  'kubectl logs ',
  'kubectl exec -it ',
  'git status',
  'git log --oneline',
  'git pull',
  'git push',
  'history',
  'clear',
  'exit',
]

export class TerminalCompletionEngine {
  private historyIndex: TerminalHistoryIndex
  private maxHistoryItems: number
  private maxSuggestions: number
  private staticCommands: string[]
  private root: TrieNode = { children: new Map(), score: 0 }
  private initialized = false

  constructor(options: TerminalCompletionEngineOptions = {}) {
    this.historyIndex = options.historyIndex ?? new TerminalHistoryIndex()
    this.maxHistoryItems = options.maxHistoryItems ?? 10_000
    this.maxSuggestions = options.maxSuggestions ?? 5
    this.staticCommands = options.staticCommands ?? DEFAULT_STATIC_COMMANDS
  }

  /**
   * 初始化：从 SQLite 加载历史命令并构建内存 Trie
   */
  async init(): Promise<void> {
    if (this.initialized) return
    this.rebuildTrie()
    this.initialized = true
  }

  /**
   * 重新构建 Trie（历史数据变化后调用）
   */
  rebuildTrie(): void {
    this.root = { children: new Map(), score: 0 }
    const items = this.historyIndex.getAll(this.maxHistoryItems)
    for (const item of items) {
      this.insert(item.command, item.score)
    }
    // 静态兜底命令以较低分数插入，确保历史命令优先
    for (const cmd of this.staticCommands) {
      this.insert(cmd, 0.1)
    }
  }

  /**
   * 记录一次命令使用（异步包装，不阻塞调用方）
   */
  recordCommand(command: string, directory?: string): void {
    this.historyIndex.record(command, directory)
    // 同步更新 Trie，避免每次都 rebuild
    this.insert(command, this.computeQuickScore())
  }

  /**
   * 批量导入命令（例如读取远端 ~/.bash_history）
   */
  importHistory(commands: string[], directory?: string): void {
    this.historyIndex.importCommands(commands, directory)
    this.rebuildTrie()
  }

  /**
   * 根据当前输入获取补全建议
   *
   * @param input 当前已输入的文本（如 "tail -"）
   * @returns 按分数降序排列的建议列表
   */
  complete(input: string): CompletionSuggestion[] {
    const trimmed = input.trimStart()
    if (!trimmed) return []

    // 1. Trie 前缀查找
    const suggestions = this.collectFromTrie(trimmed)

    // 2. 去重并按分数排序
    const seen = new Set<string>()
    const unique: CompletionSuggestion[] = []
    for (const s of suggestions) {
      if (seen.has(s.command)) continue
      seen.add(s.command)
      unique.push(s)
    }
    unique.sort((a, b) => b.score - a.score)

    // 3. 截断
    return unique.slice(0, this.maxSuggestions)
  }

  /**
   * 接受某条建议（提升其分数）
   */
  acceptSuggestion(command: string): void {
    this.recordCommand(command)
  }

  /** 关闭引擎 */
  close(): void {
    this.historyIndex.close()
  }

  // ------------------------------------------------------------------
  // Trie 实现
  // ------------------------------------------------------------------

  private insert(command: string, score: number): void {
    let node = this.root
    for (const char of command) {
      let child = node.children.get(char)
      if (!child) {
        child = { children: new Map(), score: 0 }
        node.children.set(char, child)
      }
      node = child
    }
    node.command = command
    node.score = Math.max(node.score, score)
  }

  private collectFromTrie(prefix: string): CompletionSuggestion[] {
    let node = this.root
    for (const char of prefix) {
      const child = node.children.get(char)
      if (!child) return []
      node = child
    }
    const results: CompletionSuggestion[] = []
    this.traverse(node, prefix, results)
    return results
  }

  private traverse(node: TrieNode, prefix: string, results: CompletionSuggestion[]): void {
    if (node.command !== undefined) {
      const source = this.staticCommands.includes(node.command) ? 'static' : 'history'
      results.push({
        command: node.command,
        completion: node.command.slice(prefix.length),
        score: node.score,
        source,
      })
    }
    for (const [char, child] of node.children) {
      this.traverse(child, prefix + char, results)
    }
  }

  private computeQuickScore(): number {
    // 新命令给一个中等分数，让它能快速进入前排
    return 10
  }
}
