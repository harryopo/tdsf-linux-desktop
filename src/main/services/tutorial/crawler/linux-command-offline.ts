/**
 * jaywcjlove/linux-command 离线抓取器（GitHub Clone 方式）
 *
 * 教学术语：
 * - jaywcjlove/linux-command：国内开发者「小弟调调」维护的 36k+ stars 中文 Linux 命令速查
 *   - 仓库：https://github.com/jaywcjlove/linux-command
 *   - 协议：MIT
 *   - 形式：command/<cmd>.md（每个命令 1 个 MD 文件）
 *   - 特点：内容详尽、参数完整、示例丰富，与 tldr-pages 极简风格互补
 *
 * 数据流：
 *   1. 浅克隆 jaywcjlove/linux-command 仓库
 *   2. 仅 sparse-checkout command/ 目录（命令文档）
 *   3. 遍历 command/<cmd>.md 文件
 *   4. 解析首行标题（`ls\n===`） + 副标题 + 章节
 *   5. 提取代码块中的命令（含选项说明）
 *   6. 启发式分类
 *   7. 输出 TutorialEntry（source.kind = 'github-clone', license = 'MIT'）
 *
 * 合规说明：
 *   - 协议：MIT（允许商用 + 修改 + 闭源，但**必须保留版权声明**）
 *   - 0 爬虫礼仪风险（GitHub clone）
 *   - 标注 source.url = GitHub 原文链接 + licenseUrl 指向仓库 LICENSE
 *
 * 为什么是 Phase 2 P0？
 *   - 与 tldr-pages 形成「英文极简 + 中文详尽」双语速查
 *   - 用户群体（国内学习者）友好度高
 *   - MIT 协议零合规风险
 *   - 单文件结构解析简单（与 tldr-pages 模式一致）
 *
 * 与 tldr-pages 的差异：
 *   - tldr-pages：英文、1500+ 命令、极简（每条 ~10 行）
 *   - linux-command：中文、500+ 命令、详尽（每条 1-30 KB）
 *   - 互补关系，**不重复**
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TutorialEntry, TutorialCategory, LinuxDistro } from '../types'
import type { CrawlProgress } from '@shared/crawler-types'
import { makeTutorialId } from './html-to-tutorial'

const execFileAsync = promisify(execFile)

/** jaywcjlove/linux-command 仓库地址 */
const LC_REPO = 'https://github.com/jaywcjlove/linux-command.git'
/** 来源元数据 */
const SOURCE_NAME = 'jaywcjlove/linux-command'
const SOURCE_LICENSE = 'MIT'
const SOURCE_LICENSE_URL = 'https://opensource.org/licenses/MIT'
const SOURCE_KIND = 'github-clone' as const
/** 仓库根路径（clone 后） */
const LC_REPO_DIR_NAME = 'linux-command'
/** 命令文档子目录 */
const LC_COMMAND_DIR = 'command'
/** 仓库 License 文件 URL（用于在 UI 显示原文 + 版权归属） */
const LC_LICENSE_URL = 'https://github.com/jaywcjlove/linux-command/blob/master/LICENSE'

/** 用 git clone --depth 1 --filter 浅克隆（只下 command/ 子目录） */
async function cloneLcRepo(targetDir: string, onLog: (msg: string) => void): Promise<void> {
  onLog(`git clone ${LC_REPO} -> ${targetDir}`)
  await execFileAsync(
    'git',
    [
      'clone',
      '--depth=1',
      '--filter=blob:none',
      '--sparse',
      LC_REPO,
      LC_REPO_DIR_NAME
    ],
    { cwd: targetDir, timeout: 180_000 }
  )
  // 稀疏检出：只拉取 command/
  onLog('git sparse-checkout set command')
  await execFileAsync(
    'git',
    ['sparse-checkout', 'set', LC_COMMAND_DIR],
    { cwd: join(targetDir, LC_REPO_DIR_NAME), timeout: 60_000 }
  )
}

/** 从 MD 文件路径解析命令名（如 command/ls.md → ls） */
function mdPathToCommand(relPath: string): string {
  const fileName = relPath.replace(/\\/g, '/').split('/').pop() || ''
  return fileName.replace(/\.md$/, '')
}

/**
 * 从命令名启发式分类
 *
 * 与 tldr-pages-offline.ts 保持一致的分类逻辑，确保两个源的命令能合并显示。
 */
function commandToCategory(command: string): TutorialCategory {
  const c = command.toLowerCase()
  if (/^(ls|cat|cd|cp|mv|rm|mkdir|rmdir|tree|pwd|chmod|chown|ln|find|grep|awk|sed|sort|uniq|wc|tar|zip|unzip|gzip|cut|tr|head|tail|less|more|file|stat|which|whereis|man|info|history|alias|echo|printf|env|set|unset|export|source|bash|sh|zsh|fish|tee|xargs|basename|dirname|readlink|touch|diff|patch|comm|join|paste|expand|unexpand|fold|nl|od|xxd|iconv)$/.test(c)) {
    return 'shell-scripting'
  }
  if (/^(systemctl|service|journalctl|loginctl|hostnamctl|timedatectl|localectl|logrotate|crontab|at|systemd|init|reboot|halt|poweroff|shutdown|runlevel|chkconfig)$/.test(c)) {
    return 'services'
  }
  if (/^(apt|apt-get|dpkg|dnf|yum|rpm|pacman|zypper|emerge|xbps-install|nix-env|brew|snap|flatpak|pip|npm|yarn|pnpm|cargo|gem|go|make|cmake|configure|autoreconf|checkinstall|conda)$/.test(c)) {
    return 'package-management'
  }
  if (/^(ip|ifconfig|route|netstat|ss|ping|traceroute|tracepath|nslookup|dig|host|curl|wget|scp|ssh|ftp|sftp|nc|ncat|netcat|iptables|nft|ufw|firewalld|nmcli|iwconfig|iwlist|hostapd|dhclient|arp|tcpdump|wireshark|ethtool|mtr|telnet)$/.test(c)) {
    return 'networking'
  }
  if (/^(chmod|chown|setfacl|getfacl|chattr|lsattr|umask|passwd|useradd|userdel|usermod|groupadd|groupdel|groupmod|su|sudo|visudo|newgrp|id|whoami|who|w|last|login|logout|fail2ban|ssh-keygen|ssh-add|openssl|gpg|chroot)$/.test(c)) {
    return 'security'
  }
  if (/^(mount|umount|fsck|mkfs|fdisk|parted|lsblk|blkid|du|df|lsof|lsmod|modprobe|insmod|rmmod|depmod|sync|hdparm|smartctl|mdadm|lvm|pvcreate|vgcreate|lvcreate|swapon|swapoff|losetup|mkdir)$/.test(c)) {
    return 'storage'
  }
  if (/^(ps|top|htop|btop|atop|iotop|iftop|nethogs|lsof|strace|ltrace|free|uptime|vmstat|mpstat|iostat|sar|perf|dmesg|tail|watch)$/.test(c)) {
    return 'monitoring'
  }
  if (/^(docker|podman|nerdctl|ctr|crictl|kubectl|helm|k9s|lxc|lxd|runc|buildah|skopeo|docker-compose)$/.test(c)) {
    return 'containers'
  }
  if (/^(qemu|kvm|virsh|virt-install|virt-manager|qemu-img|qemu-system|systemd-nspawn)$/.test(c)) {
    return 'virtualization'
  }
  if (/^(nginx|apache|httpd|caddy|lighttpd|haproxy|squid|traefik|envoy|cgi|fpm)$/.test(c)) {
    return 'web-server'
  }
  if (/^(mysql|mariadb|psql|pg_dump|pg_restore|sqlite3|redis-cli|mongo|mongosh|couchdb|psql|mysqldump)$/.test(c)) {
    return 'database'
  }
  if (/^(aws|gcloud|az|terraform|ansible|puppet|chef|eksctl)$/.test(c)) {
    return 'cloud'
  }
  if (/^(git|svn|hg|fossil|gh|hub|glab)$/.test(c)) {
    return 'linux-basics'
  }
  return 'linux-basics'
}

/** linux-command 是跨发行版的，不绑定特定 distro */
function commandToDistros(_command: string): LinuxDistro[] {
  return []
}

/**
 * 估算阅读时间（分钟）
 * 中文按 300 字/分钟（与 html-to-tutorial 一致）
 */
function estimateReadingTime(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const minutes = cjkChars / 300
  return Math.max(1, Math.ceil(minutes))
}

/**
 * 提取代码块中的命令
 *
 * jaywcjlove 的 code block 多为 `shell`、`bash`、`sh` 三种 lang 标签
 * 一些选项说明也写在代码块里（如 `# -R   # 递归列出`），需要过滤注释
 */
function extractLcCommands(md: string): string[] {
  const lines = md.split('\n')
  const cmds: string[] = []
  let inCode = false
  let lang = ''
  let buf: string[] = []

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        // 结束
        if (/^(shell|bash|sh|console)?$/i.test(lang)) {
          for (const cmd of buf) {
            const t = cmd.trim()
            // 过滤空行、单行注释、纯选项说明
            if (t && !t.startsWith('#') && t.length > 1) {
              cmds.push(t)
            }
          }
        }
        inCode = false
        lang = ''
        buf = []
      } else {
        inCode = true
        lang = line.slice(3).trim()
        buf = []
      }
      continue
    }
    if (inCode) {
      buf.push(line)
    }
  }
  return cmds
}

/**
 * 解析 jaywcjlove/linux-command 单个 MD 文件
 *
 * 典型结构：
 * ```
 * ls
 * ===
 *
 * 显示目录内容列表
 *
 * ## 补充说明
 *
 * **ls命令** 就是list的缩写...
 *
 * ###  语法
 *
 * ```shell
 * ls [选项] [文件名...]
 * ```
 *
 * ###  选项
 *
 * ```shell
 * -C     # 多列输出
 * -F     # 每个目录名加 "/" 后缀
 * ```
 * ```
 */
function lcMdToEntry(relPath: string, rawMd: string): TutorialEntry | null {
  try {
    const command = mdPathToCommand(relPath)
    if (!command) return null

    const now = Date.now()

    // 1. 解析标题：前两行是 "ls\n===\n"
    const lines = rawMd.split('\n')
    let titleLine = ''
    let subtitle = ''
    let bodyStartIdx = 0

    if (lines[0] && lines[1] && /^=+$/.test(lines[1].trim())) {
      // setext-style 标题
      titleLine = lines[0].trim()
      // 副标题（第 2 个非空行，跳过 ===）
      for (let i = 2; i < Math.min(lines.length, 10); i++) {
        const l = lines[i].trim()
        if (l && !/^=+$/.test(l) && l !== command) {
          subtitle = l
          bodyStartIdx = i + 1
          break
        }
      }
    } else {
      // 退化方案：用文件名做标题
      titleLine = command
      bodyStartIdx = 0
    }

    // 2. 构造正文章节（保留原始 MD 完整结构）
    // 在标题前补一个 # 标题，让 Markdown 渲染时显示标题
    let md = ''
    if (titleLine) {
      md += `# ${titleLine}\n\n`
    }
    if (subtitle) {
      md += `> ${subtitle}\n\n`
    }
    // 接上原文（从 bodyStartIdx 开始）
    md += lines.slice(bodyStartIdx).join('\n').trim()

    // 3. 提取 commands
    const commands = extractLcCommands(rawMd)

    // 4. 提取首段（## 补充说明 第一段）作为 summary
    let summary = subtitle || `${command} 命令详解`
    const supplementMatch = rawMd.match(/##\s*补充说明[\s\S]*?\n\n([\s\S]*?)(?=\n###|\n##|$)/)
    if (supplementMatch) {
      const firstPara = supplementMatch[1]
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('!'))
        .join('')
        .replace(/[*_`]/g, '')
        .trim()
      if (firstPara) summary = firstPara.slice(0, 200)
    }

    // 5. 关键词：命令名 + 副标题分词
    const keywords = [
      command,
      `${command} 命令`,
      `${command} 中文`,
      `${command} 速查`,
      'jaywcjlove',
      'linux-command'
    ]
    if (subtitle) {
      for (const w of subtitle.split(/\s+/)) {
        if (w.length >= 2) keywords.push(w)
      }
    }

    return {
      id: makeTutorialId(`lc:${command}`),
      title: `${command}（${subtitle || 'Linux 命令详解'}）`,
      summary,
      source: {
        name: SOURCE_NAME,
        url: `https://github.com/jaywcjlove/linux-command/blob/master/command/${command}.md`,
        crawledAt: now,
        license: SOURCE_LICENSE,
        licenseUrl: SOURCE_LICENSE_URL,
        kind: SOURCE_KIND
      },
      category: commandToCategory(command),
      tags: ['jaywcjlove', '命令速查', '中文', command, 'linux-command'],
      difficulty: 'beginner',
      readingTime: estimateReadingTime(rawMd),
      content: md,
      commands,
      keywords,
      distros: commandToDistros(command),
      createdAt: now,
      updatedAt: now
    }
  } catch (err) {
    console.warn(`[linux-command] 解析失败 (${relPath}):`, (err as Error).message)
    return null
  }
}

/**
 * 抓取 jaywcjlove/linux-command
 *
 * @param onProgress 进度回调
 * @returns 解析出的 TutorialEntry[]
 */
export async function crawlLinuxCommand(
  onProgress: (p: CrawlProgress) => void,
  signal: AbortSignal
): Promise<TutorialEntry[]> {
  const sourceId = 'linux-command'
  const sourceLabel = 'jaywcjlove/linux-command（中文命令速查）'

  const tmpDir = join(tmpdir(), `tdsf-lc-${Date.now()}`)
  await mkdir(tmpDir, { recursive: true })
  const repoDir = join(tmpDir, LC_REPO_DIR_NAME)

  try {
    // 1. Clone
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'downloading',
      message: '浅克隆 jaywcjlove/linux-command 仓库（sparse-checkout）...',
      progress: 0,
      processed: 0,
      total: 0
    })
    await cloneLcRepo(tmpDir, (msg) => {
      onProgress({
        sourceId,
        sourceLabel,
        phase: 'downloading',
        message: msg,
        progress: 0.1,
        processed: 0,
        total: 0
      })
    })

    // 2. 列出所有命令文件
    const cmdDir = join(repoDir, LC_COMMAND_DIR)
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'parsing',
      message: '扫描 command/ 命令列表...',
      progress: 0.3,
      processed: 0,
      total: 0
    })
    const allFiles = await readdir(cmdDir)
    const files = allFiles.filter((f) => f.endsWith('.md') && !f.startsWith('.'))
    const total = files.length

    // 3. 解析每个命令
    const entries: TutorialEntry[] = []
    let failed = 0
    for (let i = 0; i < files.length; i++) {
      if (signal.aborted) { throw new Error('用户已取消') }
      const file = files[i]
      const fullPath = join(cmdDir, file)
      try {
        const md = (await readFile(fullPath, 'utf-8')).replace(/\r\n/g, '\n')
        const entry = lcMdToEntry(`command/${file}`, md)
        if (entry) {
          entries.push(entry)
        } else {
          failed++
        }
      } catch (err) {
        failed++
        console.warn(`[linux-command] 读取失败 (${file}):`, (err as Error).message)
      }

      // 每 50 个或最后一个报告进度
      if (i % 50 === 0 || i === files.length - 1) {
        onProgress({
          sourceId,
          sourceLabel,
          phase: 'parsing',
          message: `解析 ${i + 1}/${total} (成功 ${entries.length}, 失败 ${failed})`,
          progress: 0.3 + (i / total) * 0.6,
          processed: i + 1,
          total
        })
      }
    }

    onProgress({
      sourceId,
      sourceLabel,
      phase: 'done',
      message: `完成！成功 ${entries.length} 篇中文命令速查，失败 ${failed} 篇。原始 License：${SOURCE_LICENSE} (${LC_LICENSE_URL})`,
      progress: 1.0,
      processed: total,
      total
    })

    return entries
  } catch (err) {
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'error',
      message: '抓取失败',
      progress: 0,
      processed: 0,
      total: 0,
      error: (err as Error).message
    })
    throw err
  } finally {
    // 清理临时目录
    await rm(tmpDir, { recursive: true, force: true })
  }
}
