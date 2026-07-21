/**
 * tldr-pages 离线抓取器（GitHub Clone 方式）
 *
 * 教学术语：
 * - tldr（Too Long; Didn't Read）：简化版 man page，社区协作
 * - Git Clone（Git 克隆）：从远程仓库下载完整代码库
 * - Sparse Checkout（稀疏检出）：只检出指定子目录
 *
 * 数据流：
 *   1. 浅克隆 tldr-pages/tldr 仓库（仅 pages/linux/ 子目录，节省空间）
 *   2. 遍历 pages/linux/<command>.md 文件
 *   3. 解析 frontmatter（按 # 注释的元信息）+ body
 *   4. 构造 TutorialEntry（命令速查形式）
 *   5. 返回 TutorialEntry[]
 *
 * 合规说明：
 *   - tldr-pages 整体协议：CC BY-SA 4.0（详见 https://github.com/tldr-pages/tldr/blob/main/LICENSE.md）
 *   - 各命令的协议由原作者决定，部分 MIT（MIT 协议的命令会标注）
 *   - 我们标注整体协议为 CC BY-SA 4.0 + 标记为"已整理引用"
 *   - 0 爬虫礼仪风险（不是爬 HTML，是 git clone 公开仓库）
 *
 * 为什么 Git Clone 而不是爬 HTML？
 *   - tldr-pages 本身就是 GitHub 仓库，git clone 是"最直接"的方式
 *   - 不会有 robots.txt / 429 风险
 *   - 更新只需 `git pull`，增量友好
 *   - 业界 doc-crawler-rag / omnidocs 等项目都优先 clone
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

/** tldr-pages 仓库地址 */
const TLDR_REPO = 'https://github.com/tldr-pages/tldr.git'
/** 来源元数据 */
// 注意：tldr-pages 协议 = CC BY 4.0（不是 CC BY-SA 4.0），见 https://github.com/tldr-pages/tldr/blob/main/LICENSE.md
const SOURCE_NAME = 'tldr-pages'
const SOURCE_LICENSE = 'CC BY 4.0'
const SOURCE_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'
const SOURCE_KIND = 'github-clone' as const
/** 仓库根路径（clone 后） */
const TLDR_REPO_DIR_NAME = 'tldr-pages'
/** Linux 命令子目录 */
const TLDR_LINUX_DIR = 'pages/linux'
/** 仓库 License 文件路径（用于在 UI 显示原文） */
const TLDR_LICENSE_URL = 'https://github.com/tldr-pages/tldr/blob/main/LICENSE.md'

/** 用 git clone --depth 1 --filter 浅克隆（只下 linux 子目录） */
async function cloneTldrRepo(targetDir: string, onLog: (msg: string) => void): Promise<void> {
  // 使用 --filter=blob:none 进一步减小下载体积（仅 metadata + 按需 blob）
  onLog(`git clone ${TLDR_REPO} -> ${targetDir}`)
  await execFileAsync(
    'git',
    [
      'clone',
      '--depth=1',
      '--filter=blob:none',
      '--sparse',
      TLDR_REPO,
      TLDR_REPO_DIR_NAME
    ],
    { cwd: targetDir, timeout: 180_000 }
  )
  // 稀疏检出：只拉取 pages/linux/
  onLog('git sparse-checkout set pages/linux')
  await execFileAsync(
    'git',
    ['sparse-checkout', 'set', TLDR_LINUX_DIR],
    { cwd: join(targetDir, TLDR_REPO_DIR_NAME), timeout: 60_000 }
  )
}

/** 从 tldr frontmatter 解析命令名（tldr pages 文件名 = 命令名） */
function mdPathToCommand(relPath: string): string {
  const fileName = relPath.replace(/\\/g, '/').split('/').pop() || ''
  return fileName.replace(/\.md$/, '')
}

/** 从命令名启发式分类（tldr 没有显式分类） */
function commandToCategory(command: string): TutorialCategory {
  const c = command.toLowerCase()
  if (/^(ls|cat|cd|cp|mv|rm|mkdir|rmdir|tree|pwd|chmod|chown|ln|find|grep|awk|sed|sort|uniq|wc|tar|zip|unzip|gzip|cut|tr|head|tail|less|more|file|stat|which|whereis|man|info|history|alias|echo|printf|env|set|unset|export|source|bash|sh|zsh|fish)$/.test(c)) {
    return 'shell-scripting'
  }
  if (/^(systemctl|service|journalctl|loginctl|hostnamctl|timedatectl|localectl|logrotate|crontab|at|systemd|init|reboot|halt|poweroff|shutdown|runlevel|chkconfig|service)$/.test(c)) {
    return 'services'
  }
  if (/^(apt|apt-get|dpkg|dnf|yum|rpm|pacman|zypper|emerge|xbps-install|nix-env|brew|snap|flatpak|pip|npm|yarn|pnpm|cargo|gem|go|make|cmake|configure|autoreconf|checkinstall)$/.test(c)) {
    return 'package-management'
  }
  if (/^(ip|ifconfig|route|netstat|ss|ping|traceroute|tracepath|nslookup|dig|host|curl|wget|scp|ssh|ftp|sftp|nc|ncat|netcat|iptables|nft|ufw|firewalld|nmcli|iwconfig|iwlist|hostapd|dhclient|arp|tcpdump|wireshark|ethtool|mtr)$/.test(c)) {
    return 'networking'
  }
  if (/^(chmod|chown|setfacl|getfacl|chattr|lsattr|umask|passwd|useradd|userdel|usermod|groupadd|groupdel|groupmod|su|sudo|visudo|newgrp|id|whoami|who|w|last|login|logout|fail2ban|ssh-keygen|ssh-add|openssl|gpg|chroot|mount|umount)$/.test(c)) {
    return 'security'
  }
  if (/^(mount|umount|fsck|mkfs|fdisk|parted|lsblk|blkid|du|df|lsof|lsmod|modprobe|insmod|rmmod|depmod|sync|hdparm|smartctl|mdadm|lvm|pvcreate|vgcreate|lvcreate|swapon|swapoff|losetup|losetup)$/.test(c)) {
    return 'storage'
  }
  if (/^(ps|top|htop|btop|atop|iotop|iftop|nethogs|lsof|strace|ltrace|free|uptime|vmstat|mpstat|iostat|sar|perf|dmesg|journalctl|tail)$/.test(c)) {
    return 'monitoring'
  }
  if (/^(docker|podman|nerdctl|ctr|crictl|kubectl|helm|k9s|lxc|lxd|runc|buildah|skopeo)$/.test(c)) {
    return 'containers'
  }
  if (/^(qemu|kvm|virsh|virt-install|virt-manager|qemu-img|qemu-system|systemd-nspawn)$/.test(c)) {
    return 'virtualization'
  }
  if (/^(nginx|apache|httpd|caddy|lighttpd|haproxy|squid|traefik|envoy|cgi|fpm)$/.test(c)) {
    return 'web-server'
  }
  if (/^(mysql|mariadb|psql|pg_dump|pg_restore|sqlite3|redis-cli|mongo|mongosh|couchdb)$/.test(c)) {
    return 'database'
  }
  if (/^(aws|gcloud|az|terraform|ansible|puppet|chef|kubectl|eksctl)$/.test(c)) {
    return 'cloud'
  }
  if (/^(git|svn|hg|fossil|gh|hub|glab)$/.test(c)) {
    return 'linux-basics'
  }
  return 'linux-basics'
}

/** 从命令名启发式关联发行版（tldr 是跨发行版的，但某些命令仅特定发行版有） */
function commandToDistros(_command: string): LinuxDistro[] {
  // tldr-pages 是跨发行版社区，命令通用
  return []
}

/** 解析 tldr markdown：把 {{#command}}、{{command}}、value{placeholders} 渲染为可读文本 */
function stripTldrSyntax(md: string): string {
  return md
    // {{#var}}（加粗）→ **var**
    .replace(/\{\{#([^}]+)\}\}/g, '**$1**')
    // {{var}}（占位符）→ `var`
    .replace(/\{\{([^}#][^}]*)\}\}/g, '`$1`')
    // 链接 [name](url) 保留
    // 列表 - xxx 保留
    return md
}

/** 提取 tldr 示例命令（` - xxx` 行） */
function extractTldrExamples(md: string): string[] {
  const lines = md.split('\n')
  const cmds: string[] = []
  for (const line of lines) {
    // 匹配 "- <command> ..." 形式
    const m = line.match(/^-\s+`?([^`\n]+?)`?\s*$/)
    if (m) {
      const t = m[1].trim()
      if (t && !t.startsWith('#') && t.length > 1) {
        cmds.push(t)
      }
    }
  }
  return cmds
}

/** 把 tldr 文件转成 TutorialEntry */
function tldrMdToEntry(relPath: string, rawMd: string): TutorialEntry | null {
  try {
    const command = mdPathToCommand(relPath)
    if (!command) return null

    const md = stripTldrSyntax(rawMd)
    // 提取标题：tldr 文件首行为 `# command`
    const titleMatch = md.match(/^#\s+(.+)$/m)
    const title = titleMatch ? `tldr ${command}（${titleMatch[1].trim()}）` : `tldr ${command}`

    // 提取首段作为 summary
    const descMatch = md.match(/^>\s*(.+)$/m)
    const summary = descMatch ? descMatch[1].trim().slice(0, 200) : `Linux 命令 ${command} 的速查手册（tldr-pages）`

    // 提取 examples
    const commands = extractTldrExamples(md)

    // 关键词：命令名 + 常见同义词
    const keywords = [command, `${command} 命令`, `${command} 速查`, `tldr ${command}`]

    const now = Date.now()
    return {
      id: makeTutorialId(`tldr:${command}`),
      title,
      summary,
      source: {
        name: SOURCE_NAME,
        url: `https://github.com/tldr-pages/tldr/blob/main/${TLDR_LINUX_DIR}/${command}.md`,
        crawledAt: now,
        license: SOURCE_LICENSE,
        licenseUrl: SOURCE_LICENSE_URL,
        kind: SOURCE_KIND
      },
      category: commandToCategory(command),
      tags: ['tldr', '命令速查', 'man 简化', command],
      difficulty: 'beginner',
      readingTime: 2,
      content: md,
      commands,
      keywords,
      distros: commandToDistros(command),
      createdAt: now,
      updatedAt: now
    }
  } catch (err) {
    console.warn(`[tldr] 解析失败 (${relPath}):`, (err as Error).message)
    return null
  }
}

/**
 * 抓取 tldr-pages
 *
 * @param onProgress 进度回调
 * @returns 解析出的 TutorialEntry[]
 */
export async function crawlTldrPages(
  onProgress: (p: CrawlProgress) => void,
  signal: AbortSignal
): Promise<TutorialEntry[]> {
  const sourceId = 'tldr-pages'
  const sourceLabel = 'tldr-pages（命令速查）'

  const tmpDir = join(tmpdir(), `tdsf-tldr-${Date.now()}`)
  await mkdir(tmpDir, { recursive: true })
  const repoDir = join(tmpDir, TLDR_REPO_DIR_NAME)

  try {
    // 1. Clone
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'downloading',
      message: '浅克隆 tldr-pages 仓库（sparse-checkout）...',
      progress: 0,
      processed: 0,
      total: 0
    })
    await cloneTldrRepo(tmpDir, (msg) => {
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

    // 2. 列出所有 linux 命令
    const linuxDir = join(repoDir, TLDR_LINUX_DIR)
    onProgress({
      sourceId,
      sourceLabel,
      phase: 'parsing',
      message: '扫描 pages/linux/ 命令列表...',
      progress: 0.3,
      processed: 0,
      total: 0
    })
    const files = (await readdir(linuxDir)).filter((f) => f.endsWith('.md'))
    const total = files.length

    // 3. 解析每个命令
    const entries: TutorialEntry[] = []
    let failed = 0
    for (let i = 0; i < files.length; i++) {
      if (signal.aborted) { throw new Error('用户已取消') }
      const file = files[i]
      const fullPath = join(linuxDir, file)
      try {
        // 关键：归一化 CRLF -> LF，避免 Windows git clone 后正则失败
        const md = (await readFile(fullPath, 'utf-8')).replace(/\r\n/g, '\n')
        const entry = tldrMdToEntry(`pages/linux/${file}`, md)
        if (entry) {
          entries.push(entry)
        } else {
          failed++
        }
      } catch (err) {
        failed++
        console.warn(`[tldr] 读取失败 (${file}):`, (err as Error).message)
      }

      // 每 100 个或最后一个报告进度
      if (i % 100 === 0 || i === files.length - 1) {
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
      message: `完成！成功 ${entries.length} 篇命令速查，失败 ${failed} 篇。原始 License：${SOURCE_LICENSE} (${TLDR_LICENSE_URL})`,
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
