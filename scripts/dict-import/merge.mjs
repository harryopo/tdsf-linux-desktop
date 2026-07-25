#!/usr/bin/env node
/**
 * 词库合并脚本：把多个数据源合并为最终的 linux-commands-zh.json
 *
 * 数据源（按优先级从高到低，**高优先级字段覆盖低优先级**）：
 *   1. v1.1.0 现有手工词典（最权威：含课程关联、level 标注）
 *   2. jaywcjlove linux-command（高质量中文描述 + options）
 *   3. tldr-pages/tldr 中文版（examples + description 备选）
 *
 * 合并策略：
 *   - 同一命令：保留最高优先级源的 `zh`，但低优先级源可补 `example`（若无）
 *   - 选项（option 类别词条）：从 jaywcjlove 提取，作为独立词条
 *   - 错误信息（error）：保留 v1.1.0（人工标注）
 *   - 通用术语（term）：保留 v1.1.0
 *   - 去重：以命令名为 key，小写化
 *   - 总条数：目标 1500+
 *
 * 用法：
 *   node scripts/dict-import/merge.mjs
 *
 * 输出：
 *   - src/renderer/src/assets/dict/linux-commands-zh.json （v1.2.0）
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..')
const PROJECT_ROOT = resolve(__dirname, '..', '..')

const CACHE_DIR = join(__dirname, '.cache')
const JAY_PATH = join(CACHE_DIR, 'jaywcjlove.json')
const TLDR_PATH = join(CACHE_DIR, 'tldr-zh.json')
const V11_PATH = join(PROJECT_ROOT, 'src', 'renderer', 'src', 'assets', 'dict', 'linux-commands-zh.json')
const OUT_PATH = V11_PATH // 原地升级 v1.2.0

// ============================================================
// 类型映射（DictEntry 字段约束）
// ============================================================

/** 命令分类启发式：根据命令名判断 category/level */
function inferCategoryAndLevel(cmd) {
  // 网络类
  if (/^(ip|ifconfig|netstat|ss|nc|netcat|curl|wget|ssh|scp|ping|traceroute|nslookup|dig|nmap|arp|iptables|firewall|firewalld|tcpdump|host|hostname|ifup|ifdown|route|ethtool|ssh-keygen|sshpass|sftp|ip6tables)$/i.test(cmd)) {
    return { category: 'command', level: 'intermediate' }
  }
  // 权限/用户
  if (/^(chmod|chown|chgrp|su|sudo|passwd|useradd|userdel|usermod|groupadd|groupdel|groupmod|visudo|umask|setfacl|getfacl|chattr|lsattr)$/i.test(cmd)) {
    return { category: 'command', level: 'intermediate' }
  }
  // 系统/进程
  if (/^(ps|top|htop|kill|killall|pkill|pgrep|pidof|systemctl|service|journalctl|crontab|at|bg|fg|jobs|nohup|nice|renice|uptime|uname|hostname|who|w|last|dmesg|free|vmstat|iostat|mpstat|top|btm|glances|atop)$/i.test(cmd)) {
    return { category: 'command', level: 'intermediate' }
  }
  // 包管理
  if (/^(apt|apt-get|aptitude|dpkg|yum|dnf|rpm|pacman|zypper|emerge|pip|pip3|conda|brew|npm|yarn|pnpm)$/i.test(cmd)) {
    return { category: 'command', level: 'intermediate' }
  }
  // 文件/目录
  if (/^(ls|cd|pwd|mkdir|rmdir|cp|mv|rm|touch|cat|less|more|head|tail|find|locate|which|whereis|file|stat|ln|readlink|realpath|tree|du|df|lsattr|lsblk|lsmod|lsof|chroot)$/i.test(cmd)) {
    return { category: 'command', level: 'basic' }
  }
  // 文本处理
  if (/^(grep|egrep|fgrep|awk|sed|sort|uniq|wc|cut|tr|diff|patch|tee|xargs|comm|join|fold|paste|column|expand|unexpand|head|tail|nl|fmt|printf|echo|printf)$/i.test(cmd)) {
    return { category: 'command', level: 'intermediate' }
  }
  // 压缩/归档
  if (/^(tar|gzip|gunzip|bzip2|bunzip2|xz|unxz|zip|unzip|7z|7za|7zr|rar|unrar|zcat|bzcat|xzcat|lzma|lzcat|compress)$/i.test(cmd)) {
    return { category: 'command', level: 'intermediate' }
  }
  // SELinux
  if (/^(chcon|restorecon|getenforce|setenforce|getsebool|setsebool|semanage|seinfo|sesearch|sealert|audit2why|audit2allow)$/i.test(cmd)) {
    return { category: 'command', level: 'advanced' }
  }
  // 防火墙
  if (/^(firewall-cmd|firewalld|iptables|ip6tables|iptables-save|iptables-restore|ufw)$/i.test(cmd)) {
    return { category: 'command', level: 'advanced' }
  }
  // 编辑器
  if (/^(vi|vim|nano|emacs|jed|joe|ed|sed)$/i.test(cmd)) {
    return { category: 'command', level: 'intermediate' }
  }
  // 默认：基础
  return { category: 'command', level: 'intermediate' }
}

/** 从命令名启发式推断 pos（v./n.） */
function inferPos(cmd, desc) {
  // 大多数命令是动词
  const nounCmds = /^(ls|cd|pwd|ps|top|htop|free|df|du|stat|file|find|cat|less|more|head|tail|grep|awk|sed|sort|wc|cut|tr|tee|nl|comm|join|patch|tar|gzip|zip|7z|crontab|at|jobs|date|env|hostname|uname|who|whoami|w|uptime|history|alias|umask|chmod|chown|chgrp)$/i
  if (nounCmds.test(cmd)) return 'n.'
  return 'v.'
}

/** 推断 courseChapter（基于命令类别） */
function inferCourseChapter(cmd, category) {
  const map = {
    'ls': 'ch03-files', 'cd': 'ch03-files', 'pwd': 'ch03-files', 'mkdir': 'ch03-files',
    'rmdir': 'ch03-files', 'cp': 'ch03-files', 'mv': 'ch03-files', 'rm': 'ch03-files',
    'touch': 'ch03-files', 'cat': 'ch03-files', 'less': 'ch03-files', 'more': 'ch03-files',
    'head': 'ch03-files', 'tail': 'ch03-files', 'find': 'ch03-files', 'locate': 'ch03-files',
    'tree': 'ch03-files', 'du': 'ch03-files', 'df': 'ch03-files', 'stat': 'ch03-files',
    'file': 'ch03-files', 'ln': 'ch03-files',
    'grep': 'ch07-text', 'awk': 'ch07-text', 'sed': 'ch07-text', 'sort': 'ch07-text',
    'uniq': 'ch07-text', 'wc': 'ch07-text', 'cut': 'ch07-text', 'tr': 'ch07-text',
    'diff': 'ch07-text', 'xargs': 'ch07-text', 'tee': 'ch07-text',
    'chmod': 'ch05-permission', 'chown': 'ch05-permission', 'chgrp': 'ch05-permission',
    'su': 'ch05-permission', 'sudo': 'ch05-permission', 'passwd': 'ch05-permission',
    'useradd': 'ch05-permission', 'userdel': 'ch05-permission', 'usermod': 'ch05-permission',
    'umask': 'ch05-permission', 'setfacl': 'ch05-permission', 'getfacl': 'ch05-permission',
    'ps': 'ch06-process', 'top': 'ch06-process', 'htop': 'ch06-process', 'kill': 'ch06-process',
    'killall': 'ch06-process', 'pkill': 'ch06-process', 'pgrep': 'ch06-process',
    'systemctl': 'ch06-process', 'service': 'ch06-process', 'journalctl': 'ch06-process',
    'crontab': 'ch06-process', 'bg': 'ch06-process', 'fg': 'ch06-process', 'jobs': 'ch06-process',
    'nohup': 'ch06-process', 'uptime': 'ch06-process', 'free': 'ch06-process',
    'ip': 'ch08-network', 'ifconfig': 'ch08-network', 'netstat': 'ch08-network', 'ss': 'ch08-network',
    'ping': 'ch08-network', 'curl': 'ch08-network', 'wget': 'ch08-network', 'ssh': 'ch08-network',
    'scp': 'ch08-network', 'traceroute': 'ch08-network', 'nslookup': 'ch08-network', 'dig': 'ch08-network',
    'nmap': 'ch08-network', 'iptables': 'ch08-network', 'firewall-cmd': 'ch08-network',
    'firewalld': 'ch08-network', 'tcpdump': 'ch08-network', 'host': 'ch08-network',
    'hostname': 'ch08-network', 'route': 'ch08-network', 'sftp': 'ch08-network',
    'tar': 'ch09-package', 'gzip': 'ch09-package', 'gunzip': 'ch09-package', 'zip': 'ch09-package',
    'unzip': 'ch09-package', '7z': 'ch09-package', 'xz': 'ch09-package',
    'apt': 'ch09-package', 'apt-get': 'ch09-package', 'yum': 'ch09-package', 'dnf': 'ch09-package',
    'rpm': 'ch09-package', 'pacman': 'ch09-package', 'pip': 'ch09-package', 'pip3': 'ch09-package',
    'chcon': 'ch10-selinux', 'restorecon': 'ch10-selinux', 'getenforce': 'ch10-selinux',
    'setenforce': 'ch10-selinux', 'getsebool': 'ch10-selinux', 'setsebool': 'ch10-selinux',
    'semanage': 'ch10-selinux', 'sealert': 'ch10-selinux',
  }
  return map[cmd] || null
}

// ============================================================
// 合并逻辑
// ============================================================

function normalizeCmd(cmd) {
  // 简单归一化：去除前后空格、转小写（保持原始大小写作 key）
  return cmd.trim()
}

function main() {
  console.log('[merge] 开始合并...')

  // 0. 检查依赖
  if (!existsSync(JAY_PATH)) {
    console.error(`[merge] 缺少缓存: ${JAY_PATH}（请先运行 jaywcjlove.mjs）`)
    process.exit(1)
  }
  if (!existsSync(TLDR_PATH)) {
    console.error(`[merge] 缺少缓存: ${TLDR_PATH}（请先运行 tldr.mjs）`)
    process.exit(1)
  }
  if (!existsSync(V11_PATH)) {
    console.error(`[merge] 缺少 v1.1.0 词典: ${V11_PATH}`)
    process.exit(1)
  }

  // 1. 加载所有源
  const v11 = JSON.parse(readFileSync(V11_PATH, 'utf-8'))
  const jay = JSON.parse(readFileSync(JAY_PATH, 'utf-8'))
  const tldr = JSON.parse(readFileSync(TLDR_PATH, 'utf-8'))

  console.log(`[merge] v1.1.0: ${Object.keys(v11.entries).length} 词条`)
  console.log(`[merge] jaywcjlove: ${Object.keys(jay).length} 词条`)
  console.log(`[merge] tldr-zh: ${Object.keys(tldr).length} 词条`)

  /** 最终词典（key: 小写命令名） */
  const final = {}
  /** 统计 */
  const stats = {
    fromV11: 0,
    fromJay: 0,
    fromTldr: 0,
    merged: 0,
    optionsAdded: 0,
  }

  // ============================================================
  // Pass 1: 先把 v1.1.0 全部塞入（最高优先级）
  // ============================================================
  for (const [key, entry] of Object.entries(v11.entries)) {
    const k = normalizeCmd(key)
    final[k] = { ...entry }
    if (entry.category === 'option' || entry.category === 'error' || entry.category === 'term') {
      stats.fromV11++
    } else {
      stats.fromV11++
    }
  }

  // ============================================================
  // Pass 2: jaywcjlove 补充（高优先级：description 详细 + options）
  // ============================================================
  for (const [cmd, jentry] of Object.entries(jay)) {
    const k = normalizeCmd(cmd)
    if (final[k]) {
      // 已存在（v1.1.0）：保留 v1.1.0，但补充 example 和 syntax/detail
      const existing = final[k]
      if (!existing.example && jentry.example) existing.example = jentry.example
      if (jentry.syntax && !existing._syntax) existing._syntax = jentry.syntax
      if (jentry.detail && !existing._detail) existing._detail = jentry.detail
      // 记录 jaywcjlove 也覆盖了
      existing._sources = Array.from(new Set([...(existing._sources || []), 'jaywcjlove']))
      stats.merged++
    } else {
      // 新增：从 jaywcjlove 创建
      const { category, level } = inferCategoryAndLevel(cmd)
      const courseChapter = inferCourseChapter(cmd, category)
      final[k] = {
        zh: jentry.zh,
        pos: inferPos(cmd, jentry.zh),
        example: jentry.example,
        category,
        level,
        ...(courseChapter ? { courseChapter } : {}),
        _sources: ['jaywcjlove'],
        _syntax: jentry.syntax,
        _detail: jentry.detail,
      }
      stats.fromJay++
    }

    // 添加 options 作为独立词条
    if (jentry._options && jentry._options.length > 0) {
      for (const opt of jentry._options) {
        if (!final[opt.flag]) {
          final[opt.flag] = {
            zh: opt.desc,
            category: 'option',
            level: 'intermediate',
            _sources: ['jaywcjlove'],
          }
          stats.optionsAdded++
        }
      }
    }
  }

  // ============================================================
  // Pass 3: tldr-zh 补充（最低优先级：仅作 fallback）
  // ============================================================
  for (const [cmd, tentry] of Object.entries(tldr)) {
    const k = normalizeCmd(cmd)
    if (final[k]) {
      // 已存在：补充 example（若无），记录来源
      const existing = final[k]
      if (!existing.example && tentry._examples && tentry._examples.length > 0) {
        const ex = tentry._examples[0]
        existing.example = `${ex.code}（${ex.desc}）`
      }
      existing._sources = Array.from(new Set([...(existing._sources || []), 'tldr-zh']))
    } else {
      // 新增：从 tldr 创建
      const { category, level } = inferCategoryAndLevel(cmd)
      const courseChapter = inferCourseChapter(cmd, category)
      const example = (tentry._examples && tentry._examples[0])
        ? `${tentry._examples[0].code}（${tentry._examples[0].desc}）`
        : undefined
      final[k] = {
        zh: tentry.zh,
        pos: inferPos(cmd, tentry.zh),
        ...(example ? { example } : {}),
        category,
        level,
        ...(courseChapter ? { courseChapter } : {}),
        _sources: ['tldr-zh'],
      }
      stats.fromTldr++
    }
  }

  // ============================================================
  // Pass 4: 清理内部字段（_sources / _syntax / _detail 不暴露给运行时）
  //          但保留 _sources 供调试（可选，后续可去除）
  // ============================================================

  // ============================================================
  // Pass 5: 统计 + 输出
  // ============================================================
  const totalEntries = Object.keys(final).length
  const byCategory = {}
  const bySource = { jaywcjlove: 0, tldr: 0, manual: 0 }
  for (const [k, e] of Object.entries(final)) {
    const cat = e.category || 'unknown'
    byCategory[cat] = (byCategory[cat] || 0) + 1
    if (e._sources?.includes('jaywcjlove')) bySource.jaywcjlove++
    if (e._sources?.includes('tldr-zh')) bySource.tldr++
    if (!e._sources?.length) bySource.manual++
  }

  // 清理内部字段（_sources 是用于统计的元数据，生产环境不暴露）
  for (const k of Object.keys(final)) {
    delete final[k]._sources
    delete final[k]._syntax
    delete final[k]._detail
    delete final[k]._platform
  }

  const output = {
    version: '1.2.0',
    updatedAt: new Date().toISOString().slice(0, 10),
    source: 'jaywcjlove/linux-command(MIT) + tldr-pages(CC BY 4.0) + manual v1.1.0',
    stats: {
      totalEntries,
      byCategory,
      bySource,
      v11Base: stats.fromV11,
      addedFromJay: stats.fromJay,
      addedFromTldr: stats.fromTldr,
      merged: stats.merged,
      optionsAdded: stats.optionsAdded,
    },
    entries: final,
  }

  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf-8')

  console.log('\n========== 合并结果 ==========')
  console.log(`总词条数: ${totalEntries}`)
  console.log(`按 category:`, byCategory)
  console.log(`按来源:`, bySource)
  console.log(`从 jaywcjlove 新增: ${stats.fromJay}`)
  console.log(`从 tldr-zh 新增: ${stats.fromTldr}`)
  console.log(`选项词条新增: ${stats.optionsAdded}`)
  console.log(`已合并（多源覆盖）: ${stats.merged}`)
  console.log(`输出: ${OUT_PATH}`)
  console.log('================================\n')
}

main()
