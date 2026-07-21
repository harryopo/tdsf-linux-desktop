/**
 * 课程章节匹配器 - CourseMatcher
 *
 * 教学术语：
 * - 课程关联（Course Linking）：将命令/术语与教学章节关联
 * - 章节 ID（Chapter ID）：课程章节的唯一标识符（如 ch03-files）
 *
 * 职责：
 * 1. 根据词条中的 courseChapter 字段返回关联提示
 * 2. 提供课程章节元数据（标题、排序）
 * 3. 供 SelectionPopover 调用，决定是否显示"跳转课程"按钮
 *
 * 当前状态：
 * - 骨架阶段：仅字段定义，UI 跳转功能待课程模块完善后接入
 *
 * @module utils/course-matcher
 */

import type { TranslateResult, CourseHint } from '../components/terminal/translator'

/** 课程章节元数据 */
export interface CourseChapterMeta {
  id: string
  title: string
  /** 章节顺序（用于排序） */
  order: number
  /** 关联分类（便于检索） */
  category?: string
}

/** 课程章节元数据表（手工维护，与 tdsf-tutorial 模块对应） */
export const COURSE_CHAPTERS: Record<string, CourseChapterMeta> = {
  'ch01-intro': { id: 'ch01-intro', title: '第 1 章 - Linux 简介', order: 1, category: 'intro' },
  'ch02-shell': { id: 'ch02-shell', title: '第 2 章 - Shell 与终端基础', order: 2, category: 'shell' },
  'ch03-files': { id: 'ch03-files', title: '第 3 章 - 文件与目录操作', order: 3, category: 'file' },
  'ch04-edit': { id: 'ch04-edit', title: '第 4 章 - 文本编辑', order: 4, category: 'edit' },
  'ch05-permission': { id: 'ch05-permission', title: '第 5 章 - 用户与权限', order: 5, category: 'permission' },
  'ch06-process': { id: 'ch06-process', title: '第 6 章 - 进程与服务', order: 6, category: 'process' },
  'ch07-text': { id: 'ch07-text', title: '第 7 章 - 文本处理三剑客', order: 7, category: 'text' },
  'ch08-network': { id: 'ch08-network', title: '第 8 章 - 网络配置与诊断', order: 8, category: 'network' },
  'ch09-package': { id: 'ch09-package', title: '第 9 章 - 软件包管理', order: 9, category: 'package' },
  'ch10-disk': { id: 'ch10-disk', title: '第 10 章 - 磁盘与文件系统', order: 10, category: 'disk' },
  'ch11-shell-script': { id: 'ch11-shell-script', title: '第 11 章 - Shell 脚本编程', order: 11, category: 'script' },
  'ch12-advanced': { id: 'ch12-advanced', title: '第 12 章 - 高级运维', order: 12, category: 'advanced' },
}

/**
 * 从翻译结果中提取课程关联提示
 * @param result 翻译结果
 * @returns 课程提示（含章节元数据），无关联返回 null
 */
export function getCourseHint(
  result: TranslateResult
): (CourseHint & CourseChapterMeta) | null {
  if (!result.courseHint) return null
  const meta = COURSE_CHAPTERS[result.courseHint.chapterId]
  if (!meta) return null
  return {
    ...result.courseHint,
    ...meta,
  }
}

/**
 * 根据词条名称模糊匹配课程章节
 * （用于词条未显式标注 courseChapter 的情况）
 *
 * @param word 英文词
 * @returns 命中的章节 ID，未命中返回 null
 */
export function guessCourseByWord(word: string): string | null {
  const lower = word.toLowerCase()
  // 文件操作
  if (/^(ls|cd|cp|mv|rm|mkdir|rmdir|touch|cat|head|tail|find|pwd|tree)$/.test(lower)) return 'ch03-files'
  // 文本处理
  if (/^(grep|awk|sed|sort|uniq|wc|cut|tr|xargs|tee)$/.test(lower)) return 'ch07-text'
  // 权限
  if (/^(chmod|chown|chgrp|su|sudo|passwd|umask)$/.test(lower)) return 'ch05-permission'
  // 进程
  if (/^(ps|top|htop|kill|killall|pgrep|pkill|jobs|bg|fg|systemctl|service)$/.test(lower)) return 'ch06-process'
  // 网络
  if (/^(ping|curl|wget|ssh|scp|netstat|ss|ip|ifconfig|nslookup|dig|traceroute)$/.test(lower)) return 'ch08-network'
  // 包管理
  if (/^(apt|apt-get|yum|dnf|dpkg|rpm|pacman|pip|npm)$/.test(lower)) return 'ch09-package'
  // 磁盘
  if (/^(df|du|mount|umount|fdisk|lsblk|mkfs|fsck|dd)$/.test(lower)) return 'ch10-disk'
  // 编辑器
  if (/^(vi|vim|nano|emacs)$/.test(lower)) return 'ch04-edit'
  // Shell
  if (/^(echo|export|alias|history|source|env|bash|sh|zsh)$/.test(lower)) return 'ch02-shell'
  return null
}
