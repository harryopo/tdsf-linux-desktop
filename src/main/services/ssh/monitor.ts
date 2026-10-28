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
import type { SessionClosedListener } from './connection-manager'
import { logger } from '../log/logger'
import type { CommandResult, MonitorData, SystemInfo } from '@shared/models'

/**
 * 采集器依赖的 SSH 出口
 *
 * 只声明真用到的两件事：执行命令、订阅"会话没了"。
 * 后者是这张网的关键——监控定时器属于会话，会话死了它就该停，
 * 不该等应用退出或指望渲染层记得点"停止监控"。
 */
export interface SshCollectSource {
  exec(
    sessionId: string,
    command: string,
    onData?: (chunk: string, source: 'stdout' | 'stderr') => void,
  ): Promise<CommandResult>
  onSessionClosed(listener: SessionClosedListener): () => void
}

/** 监控数据事件名（实时指标推送） */
export const MONITOR_DATA_EVENT = 'monitor:data'

/** 系统信息事件名（静态信息推送，首次采集时触发） */
export const MONITOR_SYSTEM_INFO_EVENT = 'monitor:systemInfo'

/**
 * execBatch 用的分段分隔符
 *
 * 导出给判据拼"假但形状正确"的响应，别让测试抄一份字面量——分隔符一改，
 * 抄的那份就变成在测一个不存在的东西。
 */
export const MONITOR_SEGMENT_SEP = '__TDSF_MON_SEP_9f3c2b__'

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
  /** 连续采集失败次数：只为"别刷屏"（一次失败记一条，恢复时补一条） */
  consecutiveFailures: number
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
  /** 全应用共用那一份（采集缓存只有共享才谈得上"AI 读到界面正在看的数据"） */
  private static instance: SystemMonitor | null = null

  /** SSH 采集出口 */
  private readonly sshManager: SshCollectSource
  /** 监控状态表：sessionId → MonitorState */
  private states: Map<string, MonitorState> = new Map()
  /** 最近一次采集样本：sessionId → { data, at }（界面轮询与 AI 按需采集共用） */
  private readonly samples: Map<string, { data: MonitorData; at: number }> = new Map()
  /** 取消"会话关闭"订阅的函数（实例被丢弃时调用，别把监听器留在单例上） */
  private readonly offSessionClosed: () => void

  /**
   * @param sshManager SSH 采集出口（默认使用 SshConnectionManager 单例）
   */
  public constructor(sshManager?: SshCollectSource) {
    super()
    this.sshManager = sshManager ?? SshConnectionManager.getInstance()
    // 会话没了就停这一路的定时器：断连入口有四处以上，逐个补 stop 迟早漏一个，
    // 于是订阅点只有一个——所有权在会话上，不在页面上，也不在退出流程上。
    this.offSessionClosed = this.sshManager.onSessionClosed((sessionId) => {
      void this.stopMonitoring(sessionId)
    })
  }

  /**
   * 取全应用共用的那一份采集器
   *
   * @param source 首次创建时可注入采集出口（判据用假 SSH 源跑真解析）；
   *               实例已存在时该参数被忽略——否则会出现"两份缓存、两种答案"。
   */
  public static getInstance(source?: SshCollectSource): SystemMonitor {
    if (!SystemMonitor.instance) {
      SystemMonitor.instance = new SystemMonitor(source)
    }
    return SystemMonitor.instance
  }

  /** 单例是否已经建过（退出清理走这个，免得在退出路上凭空建一份） */
  public static peek(): SystemMonitor | null {
    return SystemMonitor.instance
  }

  /** 正在监控的会话（判据与诊断都要能看见真实状态，不能只看"没报错"） */
  public monitoredSessions(): string[] {
    return Array.from(this.states.keys())
  }

  /** 释放：停掉全部监控并摘掉订阅 */
  public async dispose(): Promise<void> {
    this.offSessionClosed()
    await this.stopAll()
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
   * @param intervalMsArg 采集间隔（毫秒），最小 1000ms。
   *   v2.4 修复：历史注释写“秒”但所有前端调用方实际传毫秒（MonitorPage 5000 / E2E 2000），
   *   而后端又 ×1000，导致实际间隔 5000×1000ms≈83分钟——首次采集后几乎不刷新。
   *   现统一按毫秒处理，与所有调用方对齐。
   * @returns 是否成功启动（已监控视为成功）
   */
  public async startMonitoring(
    sessionId: string,
    intervalMsArg: number
  ): Promise<boolean> {
    // 已监控直接返回
    if (this.states.has(sessionId)) {
      return true
    }
    const intervalMs = Math.max(MIN_INTERVAL_MS, intervalMsArg)
    const state: MonitorState = {
      timer: null as unknown as NodeJS.Timeout,
      interval: intervalMs,
      lastNetRx: 0,
      lastNetTx: 0,
      lastTimestamp: 0,
      systemInfoCollected: false,
      consecutiveFailures: 0,
    }
    this.states.set(sessionId, state)

    // 立即采集一次（不阻塞返回）
    void this.runPeriodicTick(sessionId, state)

    // 启动定时器
    state.timer = setInterval(() => {
      void this.runPeriodicTick(sessionId, state)
    }, intervalMs)

    return true
  }

  /**
   * 周期性采集：失败不中断定时器，但不能一声不吭
   *
   * 远端断链后每次 tick 都会失败，3 秒一条逐条写日志会把环形缓冲冲干净，
   * 所以只在"开始失败"那一刻记一条（带原因），恢复时再补一条。
   * 界面上"数据已停更"由 MonitorPage 的新鲜度判定负责，这里留的是事后可查的痕迹：
   * 用户报"监控不动了"时，日志里能直接看到从哪一刻起失败、为什么。
   */
  private async runPeriodicTick(sessionId: string, state: MonitorState): Promise<void> {
    try {
      await this.tick(sessionId, state)
      if (state.consecutiveFailures > 0) {
        logger.info(
          'SSH',
          `监控采集恢复：会话 ${sessionId}（此前连续失败 ${state.consecutiveFailures} 次）`
        )
        state.consecutiveFailures = 0
      }
    } catch (err) {
      state.consecutiveFailures += 1
      if (state.consecutiveFailures === 1) {
        logger.warn('SSH', `监控采集失败，会话 ${sessionId} 的数据已停止更新`, {
          reason: (err as Error).message,
        })
      }
    }
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
    // v2.4 修复：合并为单条 exec（单 channel），避免并发 7 channel 撞爆 MaxSessions
    const [hostname, kernel, arch, osRelease, cpuInfo, memInfo, diskInfo] =
      await this.execBatch(sessionId, [
        'hostname',
        'uname -r',
        'uname -m',
        'cat /etc/os-release',
        'cat /proc/cpuinfo',
        "free -b | grep Mem | awk '{print $2}'",
        "df -B1 / | awk 'NR==2{print $2}'",
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

    // 内存总量（字节，free -b 直接返回字节）
    const totalMemory = parseInt(memInfo.trim(), 10) || 0
    // 磁盘总量（字节，df -B1 返回字节）
    // 注意：保持字节单位与 totalMemory 一致，前端使用 formatBytes 统一格式化
    const totalDisk = parseInt(diskInfo.trim(), 10) || 0

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
   * @returns 取消注册函数（IPC 层重复注册时先用它摘掉旧回调，否则同一份数据会被推多次）
   */
  public onMonitorData(
    callback: (sessionId: string, data: MonitorData) => void
  ): () => void {
    this.on(MONITOR_DATA_EVENT, callback)
    return () => {
      this.off(MONITOR_DATA_EVENT, callback)
    }
  }

  /**
   * 注册系统信息回调
   *
   * 首次采集到系统静态信息时触发回调，参数为 (sessionId, info)。
   * IPC 层用此回调把系统信息转发到渲染进程，避免渲染进程额外 invoke 请求。
   *
   * @param callback 回调函数
   * @returns 取消注册函数（理由同 onMonitorData）
   */
  public onSystemInfo(
    callback: (sessionId: string, info: SystemInfo) => void
  ): () => void {
    this.on(MONITOR_SYSTEM_INFO_EVENT, callback)
    return () => {
      this.off(MONITOR_SYSTEM_INFO_EVENT, callback)
    }
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
      // 异步采集系统信息，成功后通过事件推送给渲染进程
      this.getSystemInfo(sessionId)
        .then((info) => {
          // 推送系统信息到 IPC 层 → 渲染进程
          this.emit(MONITOR_SYSTEM_INFO_EVENT, sessionId, info)
        })
        .catch(() => {
          // 系统信息采集失败不影响后续重试
          state.systemInfoCollected = false
        })
    }

    const data = await this.sample(sessionId, state)
    this.remember(sessionId, data)
    // 触发事件
    this.emit(MONITOR_DATA_EVENT, sessionId, data)
  }

  /**
   * 采集一轮实时指标：单条 exec（单 channel）→ 解析 → 算网络速率
   *
   * 网络速率要跟前一次快照作差，所以速率只在**周期性**采集时才有意义；
   * 按需采集（AI 工具）用的是另起的一份基线，网络两路返回 0。
   */
  private async sample(sessionId: string, state: MonitorState): Promise<MonitorData> {
    const currentTimestamp = Date.now()

    // v2.4 修复：合并为单条 exec（单 channel），避免每周期并发 7 channel
    const [cpuOut, memOut, diskOut, netOut, loadOut, uptimeOut, procOut] =
      await this.execBatch(sessionId, [
        'top -bn1 | grep "Cpu(s)" | head -1',
        "free -b | grep Mem | awk '{print $3/$2 * 100}'",
        "df -h / | awk 'NR==2{print $5}'",
        'cat /proc/net/dev',
        'cat /proc/loadavg',
        'cat /proc/uptime',
        'ps aux | wc -l',
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

    return {
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
  }

  /**
   * 按需采集一次（AI 的 monitor_get 工具走这条路）
   *
   * 与界面轮询共用同一份采集与解析实现：一次调用只开**一个** SSH channel。
   * 旧版在这里并发 7 条 exec（每条一个 channel），叠加界面轮询与交互 shell
   * 就会撞满 OpenSSH 默认 MaxSessions=10，表现为 "Channel open failure"、指标全 0。
   *
   * @param sessionId SSH 会话 ID
   * @returns 本轮 MonitorData（网络两路为 0，因为没有可比的前一次快照）
   */
  public async collectOnce(sessionId: string): Promise<MonitorData> {
    const state: MonitorState = {
      timer: null as unknown as NodeJS.Timeout,
      interval: 0,
      lastNetRx: 0,
      lastNetTx: 0,
      lastTimestamp: 0,
      systemInfoCollected: true,
      consecutiveFailures: 0,
    }
    const data = await this.sample(sessionId, state)
    this.remember(sessionId, data)
    return data
  }

  /**
   * 最近一次采集结果与它距今的毫秒数；没采过返回 null
   *
   * 界面轮询与 AI 按需采集都会写这份缓存，所以 AI 问"现在负载多少"时
   * 优先读缓存，读不到才去开 channel。
   */
  public latestSample(sessionId: string): { data: MonitorData; ageMs: number } | null {
    const hit = this.samples.get(sessionId)
    if (!hit) return null
    return { data: hit.data, ageMs: Date.now() - hit.at }
  }

  /** 记下这份样本（缓存写入的唯一入口，两条采集路径共用） */
  private remember(sessionId: string, data: MonitorData): void {
    this.samples.set(sessionId, { data, at: data.timestamp })
  }

  /**
   * 批量执行多条命令 —— 合并为【单条 exec】（单个 SSH channel）
   *
   * v2.4 修复（SSH channel 耗尽）：此前采集用 Promise.all 并发 7 条 exec，
   * 每条 exec 开一个 SSH channel；首次采集叠加 getSystemInfo 的 7 条 =
   * 瞬间 14 个并发 channel，撞爆 OpenSSH 默认 MaxSessions=10，
   * 表现为 "Channel open failure: open failed"、监控数据全 0。
   *
   * 改为用唯一分隔符把多条命令串联成一条命令、单次 exec，输出按分隔符切回。
   * 好处：channel 数 7→1（远低于 MaxSessions），且只需一次网络往返，更快。
   *
   * 命令间用 `;` 顺序执行（非 `&&`）：单条命令失败不影响后续，对应段落为空串。
   *
   * @param sessionId SSH 会话 ID
   * @param commands 命令数组
   * @returns 与 commands 等长的 stdout 段落数组（单条探针没输出时该段为空串）
   * @throws 整条 exec 失败（断链/通道打不开）时抛出——失败的采集不产生样本
   */
  private async execBatch(sessionId: string, commands: string[]): Promise<string[]> {
    if (commands.length === 0) return []
    const SEP = MONITOR_SEGMENT_SEP
    const combined = commands.join(` ; echo '${SEP}' ; `)
    let stdout = ''
    try {
      const result = await this.sshManager.exec(sessionId, combined)
      stdout = result.stdout
    } catch (err) {
      // 整条 exec 失败 ≠ "某个探针没输出"。
      // 以前这里把失败吐成空串，解析层再把空串读成 0，于是断链期间每 3 秒
      // 推一条「CPU 0% / 内存 0%」的假样本——界面看起来比任何时候都健康。
      // 失败的采集必须没有样本；调用方（周期性采集/AI 按需）各自决定怎么报。
      throw new Error(`监控采集命令执行失败：${(err as Error).message}`)
    }
    const segments = stdout.split(SEP)
    // 对齐命令数量：按序取段，去掉每段首尾多余换行；缺失段补空串
    return commands.map((_, i) => (segments[i] ?? '').replace(/^\n+/, '').replace(/\n+$/, ''))
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
