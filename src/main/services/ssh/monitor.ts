/**
 * 服务器监控采集器
 *
 * 通过 SSH 执行远程命令采集 Linux 系统指标，定时刷新（默认 3 秒）。
 *
 * 采集指标：
 * - CPU 使用率（top -bn1）
 * - 内存使用率（free）
 * - 磁盘使用率（df -h /）
 * - 网络入站/出站速率（/proc/net/dev 差值）
 * - 系统负载（/proc/loadavg）
 * - 运行时长（uptime -p / cat /proc/uptime）
 * - 进程数（ps aux | wc -l）
 *
 * 静态系统信息：
 * - hostname、os（/etc/os-release）、kernel（uname -r）、arch（uname -m）
 * - CPU 型号/核心数（/proc/cpuinfo）、内存总量（free）、磁盘总量（df /）
 *
 * 通知机制：
 * - 使用 Node.js EventEmitter 触发 'monitor:data' 事件
 * - IPC 层通过 onMonitorData 注册回调，再转 webContents.send 推送渲染进程
 *
 * 参考：_legacy-python/src/tdsf_desktop/ssh/monitor.py
 */

import { EventEmitter } from 'node:events'
import { SshConnectionManager } from './connection-manager'
import type { MonitorData, SystemInfo } from '@shared/models'

/** 监控事件名 */
export const MONITOR_DATA_EVENT = 'monitor:data'

/** 单个会话的监控状态 */
interface MonitorState {
  /** 定时器句柄 */
  timer: NodeJS.Timeout
  /** 采集间隔（毫秒） */
  interval: number
  /** 上一次网络快照（用于计算速率） */
  lastNetRx: number
  lastNetTx: number
  /** 上一次采集时间戳（毫秒） */
  lastTimestamp: number
  /** 是否已采集系统静态信息 */
  systemInfoCollected: boolean
}

/** 最小采集间隔（毫秒） */
const MIN_INTERVAL_MS = 1000

/**
 * 系统监控器
 *
 * 通过 SshConnectionManager 执行远程命令采集系统指标。
 * 支持多会话同时监控，每会话独立定时器。
 */
export class SystemMonitor extends EventEmitter {
  /** SSH 连接管理器实例 */
  private readonly sshManager: SshConnectionManager
  /** 监控状态表：sessionId → MonitorState */
  private states: Map<string, MonitorState> = new Map()

  /**
   * @param sshManager SSH 连接管理器（默认使用单例）
   */
  public constructor(sshManager?: SshConnectionManager) {
    super()
    this.sshManager = sshManager ?? SshConnectionManager.getInstance()
  }

  // ------------------------------------------------------------------
  // 公共方法
  // ------------------------------------------------------------------

  /**
   * 启动监控
   *
   * 立即采集一次系统静态信息和实时指标，然后按 interval 周期采集实时指标。
   * 第一次网络数据仅记录基线，第二次开始计算速率。
   *
   * @param sessionId SSH 会话 ID
   * @param interval 采集间隔（秒），最小 1 秒
   * @returns 是否成功启动（已监控视为成功）
   */
  public async startMonitoring(
    sessionId: string,
    interval: number
  ): Promise<boolean> {
    // 已监控直接返回
    if (this.states.has(sessionId)) {
      return true
    }
    const intervalMs = Math.max(MIN_INTERVAL_MS, interval * 1000)
    const state: MonitorState = {
      timer: null as unknown as NodeJS.Timeout,
      interval: intervalMs,
      lastNetRx: 0,
      lastNetTx: 0,
      lastTimestamp: 0,
      systemInfoCollected: false,
    }
    this.states.set(sessionId, state)

    // 立即采集一次（不阻塞返回）
    this.tick(sessionId, state).catch(() => {
      // 单次采集失败不影响后续采集
    })

    // 启动定时器
    state.timer = setInterval(() => {
      this.tick(sessionId, state).catch(() => {
        // 采集失败不中断定时器
      })
    }, intervalMs)

    return true
  }

  /**
   * 停止监控
   * @param sessionId SSH 会话 ID
   * @returns 是否成功停止（未监控返回 false）
   */
  public async stopMonitoring(sessionId: string): Promise<boolean> {
    const state = this.states.get(sessionId)
    if (!state) {
      return false
    }
    clearInterval(state.timer)
    this.states.delete(sessionId)
    return true
  }

  /**
   * 获取系统静态信息（一次性采集）
   *
   * 综合多个命令的输出：
   * - hostname: 主机名
   * - uname -r: 内核版本
   * - uname -m: 架构
   * - /etc/os-release: 操作系统发行版
   * - /proc/cpuinfo: CPU 型号和核心数
   * - free -b: 内存总量（字节）
   * - df /: 磁盘总量（GB）
   *
   * @param sessionId SSH 会话 ID
   * @returns SystemInfo 系统静态信息
   */
  public async getSystemInfo(sessionId: string): Promise<SystemInfo> {
    // 并行执行多个命令，提高采集效率
    const [hostname, kernel, arch, osRelease, cpuInfo, memInfo, diskInfo] =
      await Promise.all([
        this.execSafe(sessionId, 'hostname'),
        this.execSafe(sessionId, 'uname -r'),
        this.execSafe(sessionId, 'uname -m'),
        this.execSafe(sessionId, 'cat /etc/os-release'),
        this.execSafe(sessionId, 'cat /proc/cpuinfo'),
        this.execSafe(sessionId, "free -b | grep Mem | awk '{print $2}'"),
        this.execSafe(sessionId, "df -B1 / | awk 'NR==2{print $2}'"),
      ])

    // 解析 CPU 型号和核心数
    let cpuModel = ''
    let cpuCores = 0
    for (const line of cpuInfo.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('model name') && trimmed.includes(':')) {
        cpuModel = trimmed.split(':')[1].trim()
      } else if (trimmed.startsWith('processor') && trimmed.includes(':')) {
        cpuCores++
      }
    }

    // 解析 OS 发行版（优先 PRETTY_NAME）
    let os = ''
    for (const line of osRelease.split('\n')) {
      if (line.startsWith('PRETTY_NAME=')) {
        os = line.slice('PRETTY_NAME='.length).replace(/^["']|["']$/g, '')
        break
      }
    }
    if (!os) {
      for (const line of osRelease.split('\n')) {
        if (line.startsWith('NAME=')) {
          os = line.slice('NAME='.length).replace(/^["']|["']$/g, '')
          break
        }
      }
    }

    // 内存总量（字节）
    const totalMemory = parseInt(memInfo.trim(), 10) || 0
    // 磁盘总量（字节 → GB）
    const totalDiskBytes = parseInt(diskInfo.trim(), 10) || 0
    const totalDisk = Math.floor(totalDiskBytes / (1024 * 1024 * 1024))

    return {
      hostname: hostname.trim(),
      os,
      kernel: kernel.trim(),
      architecture: arch.trim(),
      cpuModel,
      cpuCores,
      totalMemory,
      totalDisk,
    }
  }

  /**
   * 注册监控数据回调
   *
   * 每次采集到新数据时触发回调，参数为 (sessionId, data)。
   * IPC 层用此回调把数据转发到渲染进程。
   *
   * @param callback 回调函数
   */
  public onMonitorData(
    callback: (sessionId: string, data: MonitorData) => void
  ): void {
    this.on(MONITOR_DATA_EVENT, callback)
  }

  /** 停止所有监控（应用退出时调用） */
  public async stopAll(): Promise<void> {
    const ids = Array.from(this.states.keys())
    for (const id of ids) {
      await this.stopMonitoring(id)
    }
  }

  // ------------------------------------------------------------------
  // 内部实现
  // ------------------------------------------------------------------

  /**
   * 单次采集周期
   *
   * 流程：
   * 1. 首次采集时获取 SystemInfo（异步触发，不阻塞指标采集）
   * 2. 并行执行 7 个采集命令
   * 3. 解析命令输出
   * 4. 计算网络速率（需要上一次快照）
   * 5. 通过 EventEmitter 触发 'monitor:data' 事件
   */
  private async tick(sessionId: string, state: MonitorState): Promise<void> {
    // 首次采集系统静态信息（不阻塞本次指标采集）
    if (!state.systemInfoCollected) {
      state.systemInfoCollected = true
      this.getSystemInfo(sessionId).catch(() => {
        // 系统信息采集失败不影响后续重试
        state.systemInfoCollected = false
      })
    }

    const currentTimestamp = Date.now()

    // 并行执行所有采集命令
    const [cpuOut, memOut, diskOut, netOut, loadOut, uptimeOut, procOut] =
      await Promise.all([
        this.execSafe(sessionId, 'top -bn1 | grep "Cpu(s)" | head -1'),
        this.execSafe(sessionId, "free -b | grep Mem | awk '{print $3/$2 * 100}'"),
        this.execSafe(sessionId, "df -h / | awk 'NR==2{print $5}'"),
        this.execSafe(sessionId, 'cat /proc/net/dev'),
        this.execSafe(sessionId, 'cat /proc/loadavg'),
        this.execSafe(sessionId, 'cat /proc/uptime'),
        this.execSafe(sessionId, 'ps aux | wc -l'),
      ])

    // 解析各项指标
    const cpuUsage = this.parseCpuUsage(cpuOut)
    const memoryUsage = this.parseMemoryUsage(memOut)
    const diskUsage = this.parseDiskUsage(diskOut)
    const loadAverage = this.parseLoadAverage(loadOut)
    const uptimeSeconds = this.parseUptime(uptimeOut)
    const processCount = this.parseProcessCount(procOut)

    // 网络速率计算
    const { networkIn, networkOut } = this.parseNetworkRate(
      netOut,
      state,
      currentTimestamp
    )

    const data: MonitorData = {
      timestamp: currentTimestamp,
      cpuUsage,
      memoryUsage,
      diskUsage,
      networkIn,
      networkOut,
      loadAverage,
      uptime: uptimeSeconds,
      processCount,
    }

    // 触发事件
    this.emit(MONITOR_DATA_EVENT, sessionId, data)
  }

  /**
   * 执行 SSH 命令，失败返回空字符串
   *
   * 用于非关键采集命令，避免单命令失败导致整个采集周期失败。
   *
   * @param sessionId SSH 会话 ID
   * @param command 远程命令
   * @returns 命令 stdout（失败返回空字符串）
   */
  private async execSafe(sessionId: string, command: string): Promise<string> {
    try {
      const result = await this.sshManager.exec(sessionId, command)
      return result.stdout
    } catch {
      return ''
    }
  }

  // ------------------------------------------------------------------
  // 解析函数
  // ------------------------------------------------------------------

  /**
   * 解析 CPU 使用率
   *
   * top -bn1 | grep "Cpu(s)" 输出格式（不同发行版略有差异）：
   *   %Cpu(s):  5.0 us,  2.0 sy,  0.0 ni, 92.0 id,  1.0 wa,  0.0 hi,  0.0 si
   * 取 100 - id 计算 CPU 使用率；若无法解析则尝试用 us+sy。
   *
   * @returns CPU 使用率（百分比，0-100）
   */
  private parseCpuUsage(output: string): number {
    const cleaned = output.trim()
    if (!cleaned) return 0
    // 优先匹配 id（idle）字段
    const idleMatch = cleaned.match(/([\d.]+)\s*id/)
    if (idleMatch) {
      const idle = parseFloat(idleMatch[1])
      if (!isNaN(idle)) {
        return Math.max(0, Math.min(100, 100 - idle))
      }
    }
    // 退而求其次：us + sy
    const usMatch = cleaned.match(/([\d.]+)\s*us/)
    const syMatch = cleaned.match(/([\d.]+)\s*sy/)
    if (usMatch && syMatch) {
      const usage = parseFloat(usMatch[1]) + parseFloat(syMatch[1])
      return Math.max(0, Math.min(100, usage))
    }
    return 0
  }

  /**
   * 解析内存使用率
   * @returns 内存使用率（百分比，0-100）
   */
  private parseMemoryUsage(output: string): number {
    const value = parseFloat(output.trim())
    return isNaN(value) ? 0 : Math.max(0, Math.min(100, value))
  }

  /**
   * 解析磁盘使用率
   *
   * df -h / | awk 'NR==2{print $5}' 输出形如 "45%"
   *
   * @returns 磁盘使用率（百分比，0-100）
   */
  private parseDiskUsage(output: string): number {
    const cleaned = output.trim().replace('%', '')
    const value = parseFloat(cleaned)
    return isNaN(value) ? 0 : Math.max(0, Math.min(100, value))
  }

  /**
   * 解析系统负载（1 分钟平均）
   *
   * /proc/loadavg 输出格式：0.52 0.58 0.59 1/234 5678
   *
   * @returns 1 分钟平均负载
   */
  private parseLoadAverage(output: string): number {
    const parts = output.trim().split(/\s+/)
    if (parts.length < 1) return 0
    const value = parseFloat(parts[0])
    return isNaN(value) ? 0 : value
  }

  /**
   * 解析运行时长
   *
   * /proc/uptime 输出格式：123456.78 234567.89
   * 第一个值是系统启动至今的秒数。
   *
   * @returns 运行时长（秒）
   */
  private parseUptime(output: string): number {
    const parts = output.trim().split(/\s+/)
    if (parts.length < 1) return 0
    const value = parseFloat(parts[0])
    return isNaN(value) ? 0 : Math.floor(value)
  }

  /**
   * 解析进程数
   *
   * ps aux | wc -l 输出包含表头，所以实际进程数需要 -1。
   *
   * @returns 进程数
   */
  private parseProcessCount(output: string): number {
    const value = parseInt(output.trim(), 10)
    if (isNaN(value)) return 0
    // wc -l 包含表头行，减 1 得到实际进程数（最小 0）
    return Math.max(0, value - 1)
  }

  /**
   * 解析网络速率
   *
   * /proc/net/dev 格式（每行 16 个字段）：
   *   Inter-|   Receive ... |  Transmit
   *    face |bytes packets ...|bytes packets ...
   *       lo: 123456  789 ...|123456  789 ...
   *     eth0: 123456  789 ...|123456  789 ...
   *
   * 汇总所有非 lo 接口的 rx_bytes（索引 0）和 tx_bytes（索引 8），
   * 与上一次快照差值除以时间间隔得到速率（KB/s）。
   *
   * 第一次采集仅记录基线，返回 0。
   */
  private parseNetworkRate(
    output: string,
    state: MonitorState,
    currentTimestamp: number
  ): { networkIn: number; networkOut: number } {
    let totalRx = 0
    let totalTx = 0
    const lines = output.split('\n')
    // 跳过前两行标题
    for (const line of lines.slice(2)) {
      const idx = line.indexOf(':')
      if (idx < 0) continue
      const name = line.slice(0, idx).trim()
      // 跳过回环接口
      if (name === 'lo') continue
      const values = line.slice(idx + 1).trim().split(/\s+/)
      if (values.length < 16) continue
      const rx = parseInt(values[0], 10)
      const tx = parseInt(values[8], 10)
      if (!isNaN(rx)) totalRx += rx
      if (!isNaN(tx)) totalTx += tx
    }

    // 第一次采样仅记录基线
    if (state.lastTimestamp === 0) {
      state.lastNetRx = totalRx
      state.lastNetTx = totalTx
      state.lastTimestamp = currentTimestamp
      return { networkIn: 0, networkOut: 0 }
    }

    // 计算速率（字节/秒 → KB/s）
    const elapsed = (currentTimestamp - state.lastTimestamp) / 1000
    if (elapsed <= 0) {
      return { networkIn: 0, networkOut: 0 }
    }
    const rxRate = Math.max(0, (totalRx - state.lastNetRx) / elapsed / 1024)
    const txRate = Math.max(0, (totalTx - state.lastNetTx) / elapsed / 1024)

    // 更新基线
    state.lastNetRx = totalRx
    state.lastNetTx = totalTx
    state.lastTimestamp = currentTimestamp

    return {
      networkIn: Math.round(rxRate * 100) / 100,
      networkOut: Math.round(txRate * 100) / 100,
    }
  }
}
