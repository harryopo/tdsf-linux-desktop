/**
 * 教程分类标签：去表情 + 旧库兼容（阶段 E5）
 *
 * 分类/难度/发行版这三类结构化字段会冗余存进 knowledge_entries.tags，
 * 读取侧要按同一套规则剥回去。历史上分类标签带表情前缀（例如「企鹅 + Linux 基础」），
 * 表情从标签表移除后，旧库里那些带表情的标签必须仍被识别为结构化字段，
 * 否则它们会作为普通标签出现在教程卡片上，把表情又带回界面。
 */
import { describe, it, expect } from 'vitest'
import {
  TUTORIAL_CATEGORY_LABELS,
  TUTORIAL_DIFFICULTY_LABELS,
  LINUX_DISTRO_VALUES,
  stripLeadingEmoji,
  pickDistroTags,
  stripStructuralTags
} from '@shared/tutorial-types'

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F2FF}]/u

describe('教程分类标签', () => {
  it('分类与难度标签都不含表情', () => {
    const labels = [...Object.values(TUTORIAL_CATEGORY_LABELS), ...Object.values(TUTORIAL_DIFFICULTY_LABELS)]
    expect(labels.length).toBeGreaterThan(0)
    for (const l of labels) expect(l).not.toMatch(EMOJI_RE)
  })

  it('写入侧与读取侧对得上（自由标签被保留，结构化标签被剥掉）', () => {
    const stored = ['Linux 基础', '入门', 'rhel', 'centos', 'firewalld', '端口']
    expect(pickDistroTags(stored)).toEqual(['rhel', 'centos'])
    expect(stripStructuralTags(stored)).toEqual(['firewalld', '端口'])
  })

  it('旧库带表情前缀的分类/难度标签同样被剥掉', () => {
    const legacy = ['\u{1F427} Linux 基础', '\u{1F512} 安全', '\u{2699}\u{FE0F} 服务管理', '入门']
    expect(stripStructuralTags(legacy)).toEqual([])
  })

  it('去前缀只吃表情，不动正文', () => {
    expect(stripLeadingEmoji('\u{1F427} Linux 基础')).toBe('Linux 基础')
    expect(stripLeadingEmoji('nginx: 80/443')).toBe('nginx: 80/443')
    expect(stripLeadingEmoji('\u{1F512}')).toBe('')
  })

  it('发行版表与 LinuxDistro 联合类型一致（防止写入/读取两侧口径漂移）', () => {
    expect(LINUX_DISTRO_VALUES).toEqual([
      'rhel', 'centos', 'rocky', 'fedora', 'ubuntu', 'debian', 'arch', 'opensuse'
    ])
  })
})
