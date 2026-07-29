/**
 * 运维知识库内置种子（v2.6）
 *
 * 背景：knowledge_entries 除 10 篇教程外，incident_case / command_skill 两类
 * 此前没有任何初始数据——kb_search 永远查不到东西，知识库页面为空。
 * 本文件提供 12 条【真实可用】的运维故障案例与命令技能作为出厂内容：
 * 命令均为 openEuler/RHEL 系与 Debian 系通用或标注差异的真实命令，
 * 根因/验证均为真实运维经验，非占位文案。
 *
 * 加载：loadKnowledgeSeeds(db) 在应用启动时调用（与教程种子同一时机），
 * 表内已有对应类型数据则跳过，不覆盖用户/AI 沉淀的内容。
 */
import type { KnowledgeEntry } from '@shared/models'
import type { DatabaseManager } from './database'

/** 种子版本（变更种子内容时递增，便于排查） */
export const KNOWLEDGE_SEED_VERSION = 'kb-seed-v1.0'

/** 固定创建时间：2026-07-01（种子内容编写日，避免每次启动时间漂移） */
const SEED_TIME = 1782864000000

/** 12 条真实运维知识种子 */
export const KNOWLEDGE_SEED_ENTRIES: KnowledgeEntry[] = [
  {
    id: 'kb-seed-nginx-502',
    type: 'incident_case',
    title: 'Nginx 502 Bad Gateway 排查与修复',
    problem: '访问站点返回 502 Bad Gateway，Nginx 本身进程存活，错误日志出现 "connect() failed (111: Connection refused) while connecting to upstream"。',
    rootCause: '502 表示 Nginx 无法从上游（PHP-FPM/后端应用）拿到合法响应。最常见三类根因：① 上游服务未启动或崩溃（Connection refused）；② 上游处理超时（upstream timed out）；③ SELinux 阻止 Nginx 发起网络连接（httpd_can_network_connect 未开）。',
    commands: [
      'systemctl status nginx --no-pager',
      "tail -50 /var/log/nginx/error.log",
      'ss -lntp | grep -E "9000|8080"',
      'systemctl status php-fpm --no-pager || systemctl list-units --failed',
      'curl -sv http://127.0.0.1:8080/ -o /dev/null',
      'getsebool httpd_can_network_connect',
    ],
    rollbackCommands: ['systemctl restart php-fpm', 'setsebool -P httpd_can_network_connect 1'],
    verification: 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/ 返回 200，且 error.log 不再新增 upstream 相关错误。',
    keywords: ['nginx', '502', 'bad gateway', 'upstream', 'php-fpm', '反向代理', '网关错误'],
    tags: ['nginx', 'web', '故障案例'],
    successRate: 0.9,
    useCount: 0,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  },
  {
    id: 'kb-seed-disk-full',
    type: 'incident_case',
    title: '磁盘空间写满应急处理（df 100%）',
    problem: '应用写文件报 "No space left on device"，df -h 显示根分区或 /var 使用率 100%，服务写日志失败甚至崩溃。',
    rootCause: '常见来源：① 应用/系统日志暴涨（/var/log，journal 未限额）；② 被删除但仍被进程持有的大文件（df 与 du 统计不一致的典型原因）；③ Docker 镜像/容器日志堆积；④ 核心转储或临时文件。',
    commands: [
      'df -h',
      'du -x -h --max-depth=1 / 2>/dev/null | sort -rh | head -15',
      'du -sh /var/log/* 2>/dev/null | sort -rh | head -10',
      'lsof +L1 2>/dev/null | head -20',
      'journalctl --disk-usage',
      'journalctl --vacuum-size=200M',
    ],
    rollbackCommands: [],
    verification: 'df -h 使用率降到 90% 以下；lsof +L1 无残留的已删除大文件；应用恢复正常写入。',
    keywords: ['磁盘', 'disk', '空间', '写满', 'no space left', 'df', 'du', 'journal', '日志'],
    tags: ['磁盘', '故障案例', '应急'],
    successRate: 0.95,
    useCount: 0,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  },
  {
    id: 'kb-seed-oom-killer',
    type: 'incident_case',
    title: '进程被 OOM Killer 杀掉的定位与缓解',
    problem: '服务莫名退出且无自身错误日志，dmesg 出现 "Out of memory: Killed process"，或 systemd 显示服务 oom-kill。',
    rootCause: '物理内存 + swap 耗尽时，内核按 oom_score 选择牺牲进程。常见诱因：应用内存泄漏、单机部署过密、未配置 swap、某进程 oom_score_adj 偏高成为首选目标。',
    commands: [
      'dmesg -T | grep -iE "out of memory|oom" | tail -10',
      'journalctl -k --since "-2 hours" | grep -i oom',
      'free -h',
      'ps aux --sort=-%mem | head -10',
      'cat /proc/$(pgrep -f 目标进程 | head -1)/oom_score',
      'systemctl show 服务名 -p MemoryMax',
    ],
    rollbackCommands: ['systemctl restart 被杀服务'],
    verification: 'free -h 中 available 保持健康余量；观察期内 dmesg 不再出现 oom 记录；关键服务可用 systemd MemoryMax/MemoryHigh 设定资源上限防止拖垮整机。',
    keywords: ['oom', '内存', 'out of memory', 'killed process', '内存泄漏', 'dmesg', 'swap'],
    tags: ['内存', '故障案例'],
    successRate: 0.85,
    useCount: 0,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  },
  {
    id: 'kb-seed-systemd-failed',
    type: 'incident_case',
    title: 'systemd 服务启动失败的标准排查路径',
    problem: 'systemctl start 后服务立即失败，状态显示 failed (Result: exit-code) 或反复重启进入 activating (auto-restart)。',
    rootCause: '按出现频率：① 配置文件语法错误（服务自检失败）；② 端口被占用；③ ExecStart 路径或权限错误；④ 依赖服务未就绪；⑤ 资源限制（LimitNOFILE 等）过低。日志永远是第一手证据。',
    commands: [
      'systemctl status 服务名 --no-pager -l',
      'journalctl -u 服务名 -n 50 --no-pager',
      'systemd-analyze verify /usr/lib/systemd/system/服务名.service',
      'ss -lntp | grep 端口号',
      'systemctl cat 服务名',
      'systemctl list-dependencies 服务名 --failed',
    ],
    rollbackCommands: ['systemctl daemon-reload', 'systemctl restart 服务名'],
    verification: 'systemctl is-active 服务名 输出 active；journalctl -u 服务名 -f 观察 1 分钟无错误重启记录。',
    keywords: ['systemd', 'systemctl', '服务', '启动失败', 'failed', 'journalctl', 'unit'],
    tags: ['systemd', '故障案例'],
    successRate: 0.92,
    useCount: 0,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  },
  {
    id: 'kb-seed-ssh-refused',
    type: 'incident_case',
    title: 'SSH 连不上（Connection refused / timed out）排查',
    problem: '客户端 ssh 连接报 Connection refused 或长时间无响应超时，控制台/带外可以登录。',
    rootCause: 'refused = 到达了主机但端口没人监听（sshd 挂了/换端口）；timed out = 包被丢弃（防火墙/安全组/网络路由）。二者排查方向完全不同，先区分现象再动手。',
    commands: [
      'systemctl status sshd --no-pager',
      'ss -lntp | grep sshd',
      'grep -E "^Port|^ListenAddress" /etc/ssh/sshd_config',
      'firewall-cmd --list-all',
      'journalctl -u sshd -n 30 --no-pager',
      'sshd -t',
    ],
    rollbackCommands: ['systemctl restart sshd', 'firewall-cmd --permanent --add-service=ssh && firewall-cmd --reload'],
    verification: '客户端 ssh -v 能建立连接进入认证阶段；ss -lntp 确认 sshd 监听预期端口。',
    keywords: ['ssh', 'sshd', 'connection refused', '连接拒绝', '超时', '防火墙', 'firewalld', '22'],
    tags: ['ssh', '网络', '故障案例'],
    successRate: 0.9,
    useCount: 0,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  },
  {
    id: 'kb-seed-port-conflict',
    type: 'incident_case',
    title: '端口被占用（Address already in use）处理',
    problem: '服务启动报 "bind: Address already in use"，无法监听目标端口。',
    rootCause: '端口已被其他进程占用（含同服务的僵尸旧实例），或前一个进程退出后连接处于 TIME_WAIT。少数场景是服务配置了重复的监听项。',
    commands: [
      'ss -lntp | grep 端口号',
      'lsof -i :端口号',
      'ps -fp 占用进程PID',
      'ss -ant | grep 端口号 | awk "{print \\$1}" | sort | uniq -c',
    ],
    rollbackCommands: ['systemctl stop 占用端口的旧服务'],
    verification: 'ss -lntp 显示目标服务成功监听端口；旧进程已正常退出而非 kill -9 遗留资源。',
    keywords: ['端口', 'port', 'address already in use', '占用', 'bind', 'ss', 'lsof'],
    tags: ['网络', '故障案例'],
    successRate: 0.95,
    useCount: 0,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  },
  {
    id: 'kb-seed-inode-full',
    type: 'incident_case',
    title: '磁盘还有空间却报 No space left（inode 耗尽）',
    problem: 'df -h 显示磁盘还有大量空间，但创建文件仍报 "No space left on device"。',
    rootCause: '文件系统 inode 用光了——海量小文件（如邮件队列、会话文件、PHP session、未清理的缓存目录）把 inode 表耗尽，此时有块空间也无法新建文件。',
    commands: [
      'df -i',
      'du --inodes -x --max-depth=1 / 2>/dev/null | sort -rn | head -10',
      'find /var/spool -xdev -type f | wc -l',
      'find 可疑目录 -type f -mtime +30 -delete',
    ],
    rollbackCommands: [],
    verification: 'df -i 中 IUse% 明显下降；touch /tmp/inode-test 能成功创建文件。',
    keywords: ['inode', '磁盘', 'no space left', '小文件', 'df -i', '文件系统'],
    tags: ['磁盘', '故障案例'],
    successRate: 0.9,
    useCount: 0,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  },
  {
    id: 'kb-seed-mysql-connections',
    type: 'incident_case',
    title: 'MySQL Too many connections 的排查与治理',
    problem: '应用报 "ERROR 1040 (HY000): Too many connections"，新连接被拒绝，已有业务变慢。',
    rootCause: '连接数达到 max_connections 上限。诱因：慢查询堆积占住连接、应用连接池泄漏（用完不还）、wait_timeout 过长导致空闲连接迟迟不回收、突发流量。',
    commands: [
      'mysql -e "SHOW STATUS LIKE \'Threads_connected\';"',
      'mysql -e "SHOW VARIABLES LIKE \'max_connections\';"',
      'mysql -e "SHOW FULL PROCESSLIST;" | head -30',
      'mysql -e "SELECT * FROM information_schema.processlist WHERE time > 60 ORDER BY time DESC LIMIT 10;"',
      'mysql -e "SET GLOBAL max_connections = 500;"',
    ],
    rollbackCommands: ['mysql -e "KILL 慢查询线程ID;"'],
    verification: 'Threads_connected 回落到 max_connections 的 70% 以下；业务连接成功率恢复；根因侧（慢 SQL/连接池配置）已跟进修复而非只调大上限。',
    keywords: ['mysql', 'too many connections', '1040', '连接数', 'processlist', 'max_connections'],
    tags: ['mysql', '数据库', '故障案例'],
    successRate: 0.88,
    useCount: 0,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  },
  {
    id: 'kb-seed-high-load',
    type: 'command_skill',
    title: '系统负载高（load average 飙升）快速定位',
    problem: 'uptime 显示 load average 远超 CPU 核数，系统响应迟缓，需要快速判断是 CPU 密集、IO 等待还是进程堆积。',
    rootCause: 'load 统计的是可运行 + 不可中断（D 状态，通常在等 IO）的进程数。先用 vmstat/top 区分 us/sy/wa：us 高→应用计算密集；wa 高→磁盘 IO 瓶颈；D 状态进程多→存储/NFS 卡死。',
    commands: [
      'uptime && nproc',
      'vmstat 1 5',
      'top -b -n 1 | head -20',
      'ps -eo state,pid,cmd | grep "^D" | head',
      'iostat -x 1 3',
      'pidstat -u 1 3 | sort -k8 -rn | head',
    ],
    rollbackCommands: [],
    verification: 'load average 1 分钟值回落至核数附近；vmstat 的 r/b 列与 wa 百分比恢复正常水平。',
    keywords: ['负载', 'load average', 'cpu', 'iowait', 'vmstat', 'iostat', '卡顿', '性能'],
    tags: ['性能', '命令技能'],
    successRate: 0.93,
    useCount: 0,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  },
  {
    id: 'kb-seed-journal-log',
    type: 'command_skill',
    title: 'journalctl 高效查日志（按服务/时间/等级过滤）',
    problem: '排障时需要从 systemd journal 中快速捞出目标服务、指定时间窗、指定级别的日志，而不是裸翻全量输出。',
    rootCause: 'journal 是二进制结构化日志，用对过滤参数（-u/-p/--since/-k/-b）比管道 grep 快且准；--disk-usage 与 vacuum 可治理日志占盘。',
    commands: [
      'journalctl -u nginx --since "1 hour ago" --no-pager',
      'journalctl -p err..alert --since today',
      'journalctl -k -b -1 | tail -50',
      'journalctl -u 服务名 -f',
      'journalctl --disk-usage',
      'journalctl --vacuum-time=7d',
    ],
    rollbackCommands: [],
    verification: '能在 30 秒内输出目标服务指定时间窗的错误日志；vacuum 后 --disk-usage 显示占用下降。',
    keywords: ['journalctl', '日志', 'systemd', 'journal', '过滤', '查日志', 'log'],
    tags: ['日志', '命令技能'],
    successRate: 0.97,
    useCount: 0,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  },
  {
    id: 'kb-seed-firewalld-port',
    type: 'command_skill',
    title: 'firewalld 开放端口/服务的标准操作',
    problem: '新部署的服务外部访问不通，本机 curl 正常——需要在 firewalld 上开放端口并持久化。',
    rootCause: 'firewalld 运行时规则与永久规则是两套：不带 --permanent 重启即失效，带了 --permanent 不 --reload 当场不生效。漏掉任意一半都是"配了但没用"。',
    commands: [
      'firewall-cmd --state',
      'firewall-cmd --list-all',
      'firewall-cmd --permanent --add-port=8080/tcp',
      'firewall-cmd --reload',
      'firewall-cmd --list-ports',
    ],
    rollbackCommands: ['firewall-cmd --permanent --remove-port=8080/tcp && firewall-cmd --reload'],
    verification: '外部主机 curl http://服务器IP:8080 连通；firewall-cmd --list-ports 含目标端口且重启 firewalld 后仍在。',
    keywords: ['firewalld', '防火墙', '端口', '开放端口', 'firewall-cmd', 'permanent', 'reload'],
    tags: ['防火墙', '网络', '命令技能'],
    successRate: 0.96,
    useCount: 0,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  },
  {
    id: 'kb-seed-docker-disk',
    type: 'command_skill',
    title: 'Docker 占盘治理（镜像/容器日志清理）',
    problem: '宿主机磁盘被 /var/lib/docker 吃掉大量空间，需要安全回收并防止容器日志无限增长。',
    rootCause: '悬空镜像、退出容器、未用卷长期堆积；json-file 日志驱动默认不限大小，单容器日志可涨到几十 GB。清理靠 prune，根治靠 log-opts 限额。',
    commands: [
      'docker system df',
      'docker system prune -f',
      'docker image prune -a -f --filter "until=168h"',
      'du -sh /var/lib/docker/containers/*/*-json.log 2>/dev/null | sort -rh | head -5',
      'truncate -s 0 /var/lib/docker/containers/容器ID/容器ID-json.log',
    ],
    rollbackCommands: [],
    verification: 'docker system df 的 RECLAIMABLE 明显下降；daemon.json 配置 {"log-opts":{"max-size":"50m","max-file":"3"}} 并重启 docker 后新容器日志受限。',
    keywords: ['docker', '磁盘', '清理', 'prune', '容器日志', 'json-file', 'var/lib/docker'],
    tags: ['docker', '命令技能'],
    successRate: 0.94,
    useCount: 0,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  },
]

/**
 * 加载知识库种子（应用启动时调用）
 *
 * 表内已存在 incident_case / command_skill 任一记录则整体跳过——
 * 不覆盖用户贡献或 AI 沉淀的真实数据；数据库不可用时静默跳过。
 *
 * @returns 实际写入条数（跳过时为 0）
 */
export function loadKnowledgeSeeds(db: DatabaseManager): number {
  const existing = db
    .prepare("SELECT COUNT(*) AS cnt FROM knowledge_entries WHERE type IN ('incident_case', 'command_skill')")
    .get() as { cnt: number } | undefined

  if ((existing?.cnt ?? 0) > 0) {
    console.log(`[KnowledgeSeed] 已有 ${existing!.cnt} 条案例/技能，跳过种子加载`)
    return 0
  }

  const raw = db.getRawConnection()
  if (!raw) {
    console.warn('[KnowledgeSeed] 数据库不可用，跳过种子加载')
    return 0
  }

  console.log(`[KnowledgeSeed] 开始加载 ${KNOWLEDGE_SEED_VERSION}，共 ${KNOWLEDGE_SEED_ENTRIES.length} 条`)
  const insert = db.prepare(`
    INSERT OR REPLACE INTO knowledge_entries
    (id, type, title, problem, "rootCause", commands, "rollbackCommands", verification, keywords, tags, "successRate", "useCount", "createdAt", "updatedAt")
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertMany = raw.transaction((entries: KnowledgeEntry[]) => {
    for (const e of entries) {
      insert.run(
        e.id,
        e.type,
        e.title,
        e.problem,
        e.rootCause ?? null,
        JSON.stringify(e.commands),
        JSON.stringify(e.rollbackCommands ?? []),
        e.verification ?? null,
        JSON.stringify(e.keywords),
        JSON.stringify(e.tags),
        e.successRate,
        e.useCount,
        e.createdAt,
        e.updatedAt,
      )
    }
  })
  insertMany(KNOWLEDGE_SEED_ENTRIES)
  console.log(`[KnowledgeSeed] ✅ 成功加载 ${KNOWLEDGE_SEED_ENTRIES.length} 条运维知识`)
  return KNOWLEDGE_SEED_ENTRIES.length
}
