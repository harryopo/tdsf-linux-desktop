/**
 * AST 风险评估引擎 - 只读命令白名单 + 注入防御模式
 *
 * v0.9.4 批次 1 新增（risk-engine-rules.ts 拆分，避免单文件 > 500 行）。
 * 本文件集中管理：
 * - READONLY_BASH_COMMANDS：60+ 只读命令白名单（用于沙箱白名单审批）
 * - DANGEROUS_INJECTION_PATTERNS：11+ shell 注入防御模式
 *
 * 设计依据：Kilo Code 的 allow/deny 列表（60+ allow + 10+ deny）
 * 对标方案：Claude Code / Kilo Code 的命令安全白名单 + 注入防御
 *
 * Hard Constraints 对齐：
 * - HC-6 沙箱命令始终审批：白名单辅助 UI 提示「只读命令」标签
 * - 质量绝对优先：覆盖 60+ 只读命令 + 11+ 注入模式，便于审计
 */

// ============================================================================
// 1. 只读命令白名单（60+ 项，分类组织）
// ============================================================================
//
// 用途：
// - 沙箱审批 UI 中标注「只读命令」（recommendation: approve）
// - 命令组合分析时区分只读命令和写入命令
// - 优化审批体验：纯只读命令可一键批准
//
// 借鉴：Kilo Code 的 60+ allow 列表 + OpenHands 沙箱白名单
// 注意：白名单只匹配命令名（不含参数），调用方仍需检测参数是否包含写入操作
// ============================================================================

/**
 * 只读 Bash 命令白名单（60+ 项）
 *
 * 分类：
 * 1. 系统信息（uname / hostname / uptime / date / who / whoami / id 等）
 * 2. 文件查看（ls / cat / less / more / head / tail / file / stat / wc 等）
 * 3. 网络诊断（ping / traceroute / nslookup / dig / ip / netstat / ss 等）
 * 4. 进程查看（ps / top / pgrep / pstree / jobs 等）
 * 5. 文本工具（grep / sed / awk / cut / tr / sort / uniq 等）
 * 6. 查找工具（find / locate / which / whereis / type 等）
 * 7. 版本信息（--version 类查询命令）
 */
export const READONLY_BASH_COMMANDS = new Set<string>([
  // ────────── 1. 系统信息 ──────────
  /** uname - 打印系统信息（内核名/版本/架构） */
  'uname',
  /** hostname - 显示或设置系统主机名（无参时只读） */
  'hostname',
  /** uptime - 显示系统运行时间与平均负载 */
  'uptime',
  /** date - 显示当前日期时间（无参时只读） */
  'date',
  /** who - 显示已登录用户列表 */
  'who',
  /** whoami - 显示当前用户名 */
  'whoami',
  /** id - 显示用户与组 ID 信息 */
  'id',
  /** w - 显示已登录用户及其活动 */
  'w',
  /** last - 显示最近登录用户记录 */
  'last',
  /** arch - 显示系统架构 */
  'arch',
  /** lscpu - 显示 CPU 架构信息 */
  'lscpu',
  /** lsmem - 显示内存区域信息 */
  'lsmem',
  /** lsblk - 列出块设备信息 */
  'lsblk',
  /** lsof - 列出打开的文件（含网络套接字） */
  'lsof',
  /** lsusb - 列出 USB 设备 */
  'lsusb',
  /** lspci - 列出 PCI 设备 */
  'lspci',
  /** lsmod - 列出已加载内核模块 */
  'lsmod',
  /** lspd - 列出动态链接器信息 */
  'lspd',

  // ────────── 2. 文件查看 ──────────
  /** ls - 列出目录内容 */
  'ls',
  /** cat - 查看文件内容（无重定向时只读） */
  'cat',
  /** less - 分页查看文件（向后翻页） */
  'less',
  /** more - 分页查看文件（向前翻页） */
  'more',
  /** head - 查看文件头部 */
  'head',
  /** tail - 查看文件尾部 */
  'tail',
  /** file - 检测文件类型 */
  'file',
  /** stat - 显示文件 inode 元信息 */
  'stat',
  /** wc - 统计文件行数/字数/字节数 */
  'wc',
  /** od - 以八进制/十六进制查看文件 */
  'od',
  /** hexdump - 十六进制转储文件 */
  'hexdump',
  /** xxd - 十六进制转储与还原 */
  'xxd',
  /** strings - 提取二进制文件中的可打印字符串 */
  'strings',
  /** basename - 提取文件名（去除目录） */
  'basename',
  /** dirname - 提取目录名（去除文件名） */
  'dirname',
  /** readlink - 显示符号链接指向 */
  'readlink',
  /** realpath - 显示规范化的绝对路径 */
  'realpath',
  /** tree - 树状显示目录结构 */
  'tree',

  // ────────── 3. 网络诊断 ──────────
  /** ping - ICMP 连通性测试 */
  'ping',
  /** ping6 - IPv6 ICMP 连通性测试 */
  'ping6',
  /** traceroute - 路由追踪 */
  'traceroute',
  /** tracepath - 路径追踪（不需 root） */
  'tracepath',
  /** nslookup - DNS 查询工具 */
  'nslookup',
  /** dig - DNS 查询工具（高级） */
  'dig',
  /** host - 主机名/IP 反查 */
  'host',
  /** ip - 网络接口/路由/地址查看（ip addr/ip route 只读） */
  'ip',
  /** ifconfig - 网络接口查看（旧版，仅查看时只读） */
  'ifconfig',
  /** route - 路由表查看（无 -add/-del 时只读） */
  'route',
  /** netstat - 网络状态统计 */
  'netstat',
  /** ss - 套接字统计（netstat 替代品） */
  'ss',
  /** arp - ARP 缓存查看 */
  'arp',
  /** ipcalc - IP 地址计算 */
  'ipcalc',
  /** getent - 查询 NSS 数据库（passwd/group/hosts） */
  'getent',

  // ────────── 4. 进程查看 ──────────
  /** ps - 进程快照 */
  'ps',
  /** top - 实时进程监控 */
  'top',
  /** htop - 增强版实时进程监控 */
  'htop',
  /** pgrep - 按名查找进程 ID */
  'pgrep',
  /** pstree - 树状显示进程 */
  'pstree',
  /** jobs - 显示后台作业（shell 内建） */
  'jobs',
  /** nproc - 显示可用 CPU 数量 */
  'nproc',
  /** free - 显示内存使用情况 */
  'free',
  /** df - 显示磁盘使用情况 */
  'df',
  /** du - 显示目录磁盘占用 */
  'du',

  // ────────── 5. 文本工具 ──────────
  /** grep - 文本搜索（正则） */
  'grep',
  /** egrep - 扩展正则文本搜索（grep -E 别名） */
  'egrep',
  /** fgrep - 固定字符串文本搜索（grep -F 别名） */
  'fgrep',
  /** rg - ripgrep，快速正则搜索 */
  'rg',
  /** sed - 流编辑器（无 -i 时只读） */
  'sed',
  /** awk - 文本处理语言 */
  'awk',
  /** gawk - GNU awk */
  'gawk',
  /** cut - 按字段切分 */
  'cut',
  /** tr - 字符转换/删除 */
  'tr',
  /** sort - 排序 */
  'sort',
  /** uniq - 去重（需配合 sort） */
  'uniq',
  /** expand - 制表符转空格 */
  'expand',
  /** unexpand - 空格转制表符 */
  'unexpand',
  /** column - 列对齐格式化 */
  'column',
  /** paste - 合并文件行 */
  'paste',
  /** fold - 折行 */
  'fold',
  /** fmt - 段落格式化 */
  'fmt',
  /** tac - 反向输出行 */
  'tac',
  /** nl - 添加行号 */
  'nl',
  /** rev - 反转每行字符 */
  'rev',

  // ────────── 6. 查找工具 ──────────
  /** find - 文件查找（无 -delete/-exec 时只读） */
  'find',
  /** locate - 快速文件查找（依赖数据库） */
  'locate',
  /** which - 查找可执行文件路径 */
  'which',
  /** whereis - 查找二进制/源码/手册路径 */
  'whereis',
  /** type - 显示命令类型（shell 内建） */
  'type',
  /** command - 显示命令路径（shell 内建） */
  'command',

  // ────────── 7. 版本信息 ──────────
  /** echo - 输出文本（无重定向时只读） */
  'echo',
  /** printf - 格式化输出（无重定向时只读） */
  'printf',
  /** true - 返回 0 退出码 */
  'true',
  /** false - 返回 1 退出码 */
  'false',
  /** test - 条件测试（等价 [ ]） */
  'test',
  /** env - 显示环境变量 */
  'env',
  /** printenv - 打印指定环境变量 */
  'printenv',
  /** history - 显示命令历史（shell 内建） */
  'history',
  /** help - 显示 shell 内建命令帮助 */
  'help',
  /** man - 显示命令手册 */
  'man',
  /** info - 显示 info 文档 */
  'info',
  /** tldr - 简化版命令示例（社区工具） */
  'tldr',
])

// ============================================================================
// 2. Shell 注入防御模式（11+ 项）
// ============================================================================
//
// 用途：
// - 检测命令中是否包含 shell 元字符（管道 / 重定向 / 命令替换等）
// - 命中即视为可疑（注入风险），升级风险评估
// - 辅助 UI 提示「命令包含 shell 元字符，请人工审核」
//
// 借鉴：Kilo Code 的 10+ deny 列表（shell 元字符黑名单）
// 注意：模式使用 glob 风格描述（如 *|* 表示「包含 | 字符」），
//       实际匹配使用正则表达式
// ============================================================================

/**
 * Shell 注入防御模式（11+ 项）
 *
 * 每个模式包含：
 * - pattern: glob 风格模式描述（用于文档/UI 展示）
 * - regex: 实际匹配的正则表达式
 * - match: 命令匹配函数（接收命令字符串，返回是否命中）
 * - reason: 命中原因说明（教学属性）
 */
export interface DangerousInjectionPattern {
  /** glob 风格模式（如 *|* / *$(* / *`*），用于文档展示 */
  pattern: string
  /** 正则表达式字符串（用于 match 函数） */
  regex: string
  /** 匹配函数：命令命中返回 true */
  match: (command: string) => boolean
  /** 命中原因说明（教学属性：为什么这个元字符危险） */
  reason: string
}

/**
 * Shell 注入防御模式列表（11+ 项）
 *
 * 覆盖 11 类 shell 元字符：
 * 1. 换行符（\n）—— 绕过单行命令解析
 * 2. 管道符（|）—— 命令链路注入
 * 3. 命令替换 $() —— 注入子命令
 * 4. 反引号 `—— 反引号命令替换
 * 5. 重定向 > —— 覆盖写入文件
 * 6. 分号 ; —— 命令串联
 * 7. 逻辑与 && —— 条件执行
 * 8. 逻辑或 || —— 条件执行
 * 9. 文件描述符重定向 >& —— 重定向到文件描述符
 * 10. 进程替换 <( —— 进程替换输入
 * 11. 进程替换 >( —— 进程替换输出
 */
export const DANGEROUS_INJECTION_PATTERNS: DangerousInjectionPattern[] = [
  {
    pattern: '*\\n*',
    regex: '\\n',
    match: (cmd) => cmd.includes('\n'),
    reason: '换行注入：命令包含 \\n 换行符，可能在单行审批中隐藏下一条命令',
  },
  {
    pattern: '*|*',
    regex: '\\|',
    match: (cmd) => cmd.includes('|'),
    reason: '管道注入：命令包含 | 管道符，可能将危险命令的输出传入下一条命令',
  },
  {
    pattern: '*$(*',
    regex: '\\$\\(',
    match: (cmd) => cmd.includes('$('),
    reason: '命令替换 $()：命令包含 $(...)，可能在子 shell 中执行任意命令',
  },
  {
    pattern: '*`*',
    regex: '`',
    match: (cmd) => cmd.includes('`'),
    reason: '反引号命令替换：命令包含 `...`，可能在子 shell 中执行任意命令',
  },
  {
    pattern: '*>*',
    regex: '(?<!<)>(?!>)',
    match: (cmd) => /(?<!<)>(?!>)/.test(cmd),
    reason: '重定向覆盖：命令包含 > 重定向符，可能覆盖文件内容',
  },
  {
    pattern: '*;*',
    regex: ';',
    match: (cmd) => cmd.includes(';'),
    reason: '分号串联：命令包含 ; 分隔符，可能在单次审批中执行多条命令',
  },
  {
    pattern: '*&&*',
    regex: '&&',
    match: (cmd) => cmd.includes('&&'),
    reason: '逻辑与串联：命令包含 && 条件执行，前一条成功后执行下一条',
  },
  {
    pattern: '*||*',
    regex: '\\|\\|',
    match: (cmd) => cmd.includes('||'),
    reason: '逻辑或串联：命令包含 || 条件执行，前一条失败后执行下一条',
  },
  {
    pattern: '*>&*',
    regex: '>&',
    match: (cmd) => cmd.includes('>&'),
    reason: '文件描述符重定向：命令包含 >& 重定向符，可能将输出重定向到任意文件描述符',
  },
  {
    pattern: '*<(*',
    regex: '<\\(',
    match: (cmd) => cmd.includes('<('),
    reason: '进程替换输入：命令包含 <(...)，可能调用子 shell 作为输入源',
  },
  {
    pattern: '*>(*',
    regex: '>\\(',
    match: (cmd) => cmd.includes('>('),
    reason: '进程替换输出：命令包含 >(...)，可能调用子 shell 作为输出目标',
  },
]

/**
 * 检测命令是否命中任一 shell 注入防御模式
 *
 * @param command 用户输入的 shell 命令
 * @returns 命中模式列表（可能多条命中）；空数组表示无注入风险
 */
export function detectInjectionPatterns(command: string): DangerousInjectionPattern[] {
  return DANGEROUS_INJECTION_PATTERNS.filter((p) => p.match(command))
}
