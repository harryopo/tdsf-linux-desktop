/**
 * 系统架构感知器（System Profiler）
 *
 * 编排 27 项并发探查，5 秒内完成系统全量信息采集。
 * 每个探查项由 CommandProbe 执行，最终生成 ProfilerResult。
 *
 * 探查组（10 组 / 27 项）：
 *   system      — 系统标识（5 项）
 *   cpu-memory  — CPU 与内存（3 项）
 *   storage     — 存储（3 项）
 *   network     — 网络（4 项）
 *   users       — 用户（3 项）
 *   services    — 服务（2 项）
 *   tools       — 开发工具（1 项 - 一条命令检测 25+ 工具）
 *   virt        — 虚拟化（2 项）
 *   web         — Web 应用（1 项）
 *   ops         — 运维（2 项）
 */

import { commandProbe } from './command-probe'
import type { ProfilerItem, ProfilerResult, ProfilerGroupName } from './types'

/** 单个探查项定义 */
interface ProbeDef {
  group: ProfilerGroupName
  groupLabel: string
  cmd: string
}

/** 27 项探查清单（按组归类） */
export const PROBE_CATALOG: ProbeDef[] = [
  // === 系统标识 (5) ===
  { group: 'system', groupLabel: '系统标识', cmd: 'uname -a' },
  { group: 'system', groupLabel: '系统标识', cmd: 'cat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || cat /etc/lsb-release 2>/dev/null || echo "未识别发行版"' },
  { group: 'system', groupLabel: '系统标识', cmd: 'hostname -f 2>/dev/null; hostname' },
  { group: 'system', groupLabel: '系统标识', cmd: 'uptime' },
  { group: 'system', groupLabel: '系统标识', cmd: 'date' },

  // === CPU 与内存 (3) ===
  { group: 'cpu-memory', groupLabel: 'CPU 与内存', cmd: 'lscpu | head -20' },
  { group: 'cpu-memory', groupLabel: 'CPU 与内存', cmd: 'nproc; cat /proc/cpuinfo | grep "model name" | head -1' },
  { group: 'cpu-memory', groupLabel: 'CPU 与内存', cmd: 'free -h' },

  // === 存储 (3) ===
  { group: 'storage', groupLabel: '存储', cmd: 'lsblk -a 2>/dev/null || echo "lsblk 未安装"' },
  { group: 'storage', groupLabel: '存储', cmd: 'df -hT | head -20' },
  { group: 'storage', groupLabel: '存储', cmd: 'mount | head -20' },

  // === 网络 (4) ===
  { group: 'network', groupLabel: '网络', cmd: 'ip addr show 2>/dev/null || ifconfig 2>/dev/null || echo "无网络工具"' },
  { group: 'network', groupLabel: '网络', cmd: 'ip route 2>/dev/null || route -n 2>/dev/null' },
  { group: 'network', groupLabel: '网络', cmd: 'cat /etc/resolv.conf 2>/dev/null | head -5' },
  { group: 'network', groupLabel: '网络', cmd: 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "无端口查看工具"' },

  // === 用户 (3) ===
  { group: 'users', groupLabel: '用户', cmd: 'whoami; id' },
  { group: 'users', groupLabel: '用户', cmd: 'cat /etc/passwd | grep -v nologin | grep -v false' },
  { group: 'users', groupLabel: '用户', cmd: 'sudo -n true 2>&1 | head -3 || echo "需要密码"' },

  // === 服务 (2) ===
  { group: 'services', groupLabel: '服务', cmd: 'systemctl list-units --type=service --state=running 2>/dev/null | head -30 || ps aux | head -30' },
  { group: 'services', groupLabel: '服务', cmd: 'systemctl list-unit-files --type=service --state=enabled 2>/dev/null | head -30' },

  // === 开发工具 (1) ===
  { group: 'tools', groupLabel: '开发工具', cmd: 'for tool in python python3 node npm java gcc g++ make git curl wget vim nano ssh rsync docker podman nginx apache2 httpd mysql mariadb psql redis-server php php-fpm; do command -v $tool >/dev/null && echo "Y $tool: $(command -v $tool)" || echo "N $tool: 未安装"; done' },

  // === 虚拟化 (2) ===
  { group: 'virt', groupLabel: '虚拟化', cmd: 'systemd-detect-virt 2>/dev/null || echo "未检测到虚拟化"' },
  { group: 'virt', groupLabel: '虚拟化', cmd: 'cat /proc/1/cgroup 2>/dev/null | head -3' },

  // === Web 应用 (1) ===
  { group: 'web', groupLabel: 'Web 应用', cmd: 'ls /var/www/ 2>/dev/null; ls /usr/share/nginx/html/ 2>/dev/null; ls /etc/nginx/sites-enabled/ 2>/dev/null; ls /etc/apache2/sites-enabled/ 2>/dev/null; ls /etc/httpd/conf.d/ 2>/dev/null' },

  // === 运维 (2) ===
  { group: 'ops', groupLabel: '运维', cmd: 'crontab -l 2>/dev/null; ls /etc/cron.d/ 2>/dev/null' },
  { group: 'ops', groupLabel: '运维', cmd: 'ls /var/log/ 2>/dev/null | head -20' }
]

/** 并发上限（避免单 SSH 连接过载） */
const CONCURRENCY = 6

/**
 * 在远程主机执行完整 27 项系统架构探查
 *
 * 流程：
 *   1. 并发执行 27 项探查（每批 CONCURRENCY 个）
 *   2. 收集所有结果（含失败项）
 *   3. 聚合成 ProfilerResult
 *
 * @param sessionId SSH 会话 ID
 * @param host 主机标识（用于展示）
 * @returns 完整探查结果
 */
export async function runProfiler(
  sessionId: string,
  host: string
): Promise<ProfilerResult> {
  const startTime = Date.now()
  const items: ProfilerItem[] = []
  const errors: ProfilerResult['errors'] = []

  // 分批并发执行
  for (let i = 0; i < PROBE_CATALOG.length; i += CONCURRENCY) {
    const batch = PROBE_CATALOG.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map((def) =>
        commandProbe(sessionId, def.group, def.groupLabel, def.cmd, {
          timeoutMs: 8000,
          retries: 0  // 探查场景不重试，加快失败
        })
      )
    )
    for (const item of batchResults) {
      items.push(item)
      if (!item.ok) {
        errors.push({
          group: item.group,
          groupLabel: item.groupLabel,
          cmd: item.cmd,
          error: item.error ?? 'unknown',
          durationMs: item.durationMs
        })
      }
    }
  }

  return {
    host,
    sessionId,
    generatedAt: Date.now(),
    totalDurationMs: Date.now() - startTime,
    items,
    errors
  }
}

/** 探查目录元数据：组名 → 中文标签 */
export const GROUP_LABELS: Record<ProfilerGroupName, string> = {
  'system': '系统标识',
  'cpu-memory': 'CPU 与内存',
  'storage': '存储',
  'network': '网络',
  'users': '用户',
  'services': '服务',
  'tools': '开发工具',
  'virt': '虚拟化',
  'web': 'Web 应用',
  'ops': '运维'
}
