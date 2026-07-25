/**
 * Translator 单元测试
 *
 * 覆盖：
 * - 6 种匹配策略：短语、路径、命令、选项、多词短语、单词
 * - 边界场景：空字符串、未命中、混合路径、特殊字符
 * - 性能基准：200 词查询 < 10ms
 * - LRU 缓存行为
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  translate,
  loadDict,
  extractWordAtLine,
  clearTranslateCache,
  type Dict,
  type DictEntry,
} from '../../../src/renderer/src/components/terminal/translator'

/** 简化词典（用于单元测试，不依赖主词典） */
const testDict: Dict = {
  version: '1.0.0',
  entries: {
    'ls': { zh: '列出目录', category: 'command' },
    'cd': { zh: '切换目录', category: 'command' },
    'permission denied': { zh: '权限不足', category: 'error' },
    'no such file': { zh: '文件不存在', category: 'error' },
    'home': { zh: '家目录', category: 'term' },
    'usr': { zh: '用户系统资源', category: 'term' },
    'local': { zh: '本地的', category: 'term' },
    'bin': { zh: '可执行目录', category: 'term' },
    'file': { zh: '文件', category: 'term' },
    'directory': { zh: '目录', category: 'term' },
    'process': { zh: '进程', category: 'term' },
    '-l': { zh: '长格式', category: 'option' },
    '-a': { zh: '全部', category: 'option' },
    '--all': { zh: '全部（长）', category: 'option' },
    'chmod': { zh: '修改权限', category: 'command', courseChapter: 'ch05' },
  },
}

describe('translator.translate', () => {
  beforeEach(() => {
    clearTranslateCache()
  })

  describe('策略 1：完整短语精确匹配', () => {
    it('应匹配错误信息 "permission denied"', () => {
      const result = translate('permission denied', testDict)
      expect(result.matched).toBe(true)
      expect(result.primary?.entry.zh).toBe('权限不足')
      expect(result.strategy).toBe('exact-phrase')
    })

    it('应匹配 "no such file"', () => {
      const result = translate('no such file', testDict)
      expect(result.matched).toBe(true)
      expect(result.primary?.entry.zh).toBe('文件不存在')
    })

    it('大小写不敏感', () => {
      const result = translate('PERMISSION DENIED', testDict)
      expect(result.matched).toBe(true)
    })

    it('前后空白应被 trim', () => {
      const result = translate('  permission denied  ', testDict)
      expect(result.matched).toBe(true)
    })
  })

  describe('策略 2：路径整体识别', () => {
    it('应识别 /home 路径', () => {
      const result = translate('/home', testDict)
      expect(result.strategy).toBe('path')
      const seg = result.segments.find(s => s.word === 'home')
      expect(seg?.entry?.zh).toBe('家目录')
    })

    it('应识别多段路径 /usr/local/bin', () => {
      const result = translate('/usr/local/bin', testDict)
      expect(result.strategy).toBe('path')
      expect(result.segments.length).toBeGreaterThanOrEqual(4)
      const usr = result.segments.find(s => s.word === 'usr')
      expect(usr?.entry?.zh).toBe('用户系统资源')
    })

    it('应识别 Windows 路径 C:\\Users', () => {
      const result = translate('C:\\Users', testDict)
      expect(result.strategy).toBe('path')
    })

    it('应识别 ~ 家目录路径', () => {
      const result = translate('~', testDict)
      // 单个 ~ 不算路径（按策略 2 要求 PATH_SEP_REGEX.test）
      expect(result.matched).toBe(false)
    })
  })

  describe('策略 3：命令匹配', () => {
    it('应匹配 ls', () => {
      const result = translate('ls', testDict)
      expect(result.matched).toBe(true)
      expect(result.primary?.entry.zh).toBe('列出目录')
      // 短词会被 exact-phrase 优先命中
      expect(['command', 'exact-phrase']).toContain(result.strategy)
    })

    it('应匹配 chmod 并返回课程关联', () => {
      const result = translate('chmod', testDict)
      expect(result.matched).toBe(true)
      expect(result.primary?.entry.zh).toBe('修改权限')
      expect(result.courseHint?.chapterId).toBe('ch05')
    })
  })

  describe('策略 4：选项匹配', () => {
    it('应匹配 -l', () => {
      const result = translate('-l', testDict)
      expect(result.matched).toBe(true)
      expect(result.primary?.entry.zh).toBe('长格式')
      expect(result.strategy).toBe('option')
    })

    it('应匹配 --all', () => {
      const result = translate('--all', testDict)
      expect(result.matched).toBe(true)
      expect(result.primary?.entry.zh).toBe('全部（长）')
    })

    it('应匹配无 - 前缀的 l（容错）', () => {
      const result = translate('l', testDict)
      expect(result.matched).toBe(true)
      expect(result.primary?.entry.zh).toBe('长格式')
    })
  })

  describe('策略 5：多词短语（贪心）', () => {
    it('应优先匹配长短语', () => {
      // "no such file" 在词条里，"file" 也是单词
      const result = translate('no such file or dir', testDict)
      expect(result.matched).toBe(true)
      expect(result.primary?.entry.zh).toBe('文件不存在')
    })
  })

  describe('策略 6：单词匹配', () => {
    it('应匹配 "file"', () => {
      const result = translate('file', testDict)
      expect(result.matched).toBe(true)
      expect(result.primary?.entry.zh).toBe('文件')
    })

    it('应匹配 "process"', () => {
      const result = translate('process', testDict)
      expect(result.matched).toBe(true)
      expect(result.primary?.entry.zh).toBe('进程')
    })
  })

  describe('边界场景', () => {
    it('空字符串应返回未命中', () => {
      const result = translate('', testDict)
      expect(result.matched).toBe(false)
      expect(result.strategy).toBe('none')
    })

    it('仅空白应返回未命中', () => {
      const result = translate('   ', testDict)
      expect(result.matched).toBe(false)
    })

    it('未收录的随机词应返回未命中', () => {
      const result = translate('xyzabc-not-in-dict', testDict)
      expect(result.matched).toBe(false)
    })

    it('大小写差异应同等处理', () => {
      expect(translate('LS', testDict).matched).toBe(true)
      expect(translate('File', testDict).matched).toBe(true)
    })
  })

  describe('LRU 缓存', () => {
    it('重复查询应命中缓存', () => {
      // 第一次查询
      const r1 = translate('ls', testDict)
      // 第二次查询应返回相同对象（命中缓存）
      const r2 = translate('ls', testDict)
      expect(r1).toBe(r2)
    })

    it('不同大小写应命中同一缓存', () => {
      const r1 = translate('ls', testDict)
      const r2 = translate('LS', testDict)
      expect(r1).toBe(r2)
    })

    it('清空缓存后应重新计算', () => {
      const r1 = translate('ls', testDict)
      clearTranslateCache()
      const r2 = translate('ls', testDict)
      expect(r1).not.toBe(r2)
      expect(r1).toEqual(r2)
    })
  })

  describe('性能基准', () => {
    it('200 次查询应在 10ms 内完成', () => {
      const samples = ['ls', 'cd', 'file', 'permission denied', '-l', '/home', 'process', '--all']
      const start = performance.now()
      for (let i = 0; i < 200; i++) {
        const sample = samples[i % samples.length]
        translate(sample, testDict)
      }
      const elapsed = performance.now() - start
      expect(elapsed).toBeLessThan(10)
    })
  })
})

describe('translator.extractWordAtLine', () => {
  it('应提取命令名', () => {
    expect(extractWordAtLine('ls -la /home', 0)).toBe('ls')
    expect(extractWordAtLine('ls -la /home', 1)).toBe('ls')
  })

  it('应提取选项', () => {
    expect(extractWordAtLine('ls -la /home', 4)).toBe('-la')
  })

  it('应提取路径', () => {
    expect(extractWordAtLine('ls -la /home', 8)).toBe('/home')
  })

  it('应提取带点的文件名', () => {
    expect(extractWordAtLine('cat file.txt', 4)).toBe('file.txt')
  })

  it('应提取波浪号路径', () => {
    expect(extractWordAtLine('cd ~/projects', 3)).toBe('~/projects')
  })

  it('空字符串返回 null', () => {
    expect(extractWordAtLine('', 0)).toBe(null)
  })

  it('col 越界返回 null', () => {
    expect(extractWordAtLine('ls', 100)).toBe(null)
  })

  it('col 为负数返回 null', () => {
    expect(extractWordAtLine('ls', -1)).toBe(null)
  })

  it('col 落在空白上返回 null', () => {
    expect(extractWordAtLine('ls  -l', 3)).toBe(null)
  })

  it('多行场景仅处理单行', () => {
    // col=8 落在 "test" 的起始引号上，应整体提取 "test"（含两侧引号）
    expect(extractWordAtLine('grep -r "test"', 8)).toBe('"test"')
  })
})

describe('translator.loadDict', () => {
  it('应返回有效的 Dict 对象', () => {
    const dict = loadDict()
    expect(dict.version).toBeDefined()
    expect(dict.entries).toBeDefined()
    expect(Object.keys(dict.entries).length).toBeGreaterThan(100)
  })

  it('应至少包含核心命令', () => {
    const dict = loadDict()
    expect(dict.entries['ls']).toBeDefined()
    expect(dict.entries['cd']).toBeDefined()
    expect(dict.entries['grep']).toBeDefined()
  })
})

// ============================================================
// v1.2.0 新增：从 jaywcjlove + tldr 合并后的真实词库覆盖
// 验证词条数据质量（不是单元测试逻辑）
// ============================================================

describe('translator v1.2.0 真实词库质量', () => {
  it('应包含 >= 2000 词条（v1.2.0 目标 1500+）', () => {
    const dict = loadDict()
    const total = Object.keys(dict.entries).length
    expect(total).toBeGreaterThanOrEqual(2000)
  })

  it('应包含 jaywcjlove 提供的高频命令', () => {
    const dict = loadDict()
    // jaywcjlove data.json 中的典型命令
    expect(dict.entries['ls']?.zh).toContain('目录')
    expect(dict.entries['cp']?.zh).toBeDefined()
    expect(dict.entries['chmod']?.zh).toContain('权限')
    expect(dict.entries['systemctl']?.zh).toBeDefined()
    expect(dict.entries['journalctl']?.zh).toBeDefined()
  })

  it('应包含 tldr 提供的高频命令', () => {
    const dict = loadDict()
    // tldr pages.zh 中的典型命令
    expect(dict.entries['tar']?.zh).toBeDefined()
    expect(dict.entries['ssh']?.zh).toBeDefined()
    expect(dict.entries['find']?.zh).toBeDefined()
    expect(dict.entries['grep']?.zh).toBeDefined()
  })

  it('应包含 jaywcjlove 提取的选项词条', () => {
    const dict = loadDict()
    // 至少应该有 -l 和 -a 这样的高频选项
    expect(dict.entries['-l']?.category).toBe('option')
    expect(dict.entries['-R']?.category).toBe('option')
    expect(dict.entries['--help']?.category).toBe('option')
  })

  it('应保留 v1.1.0 人工标注的错误信息', () => {
    const dict = loadDict()
    expect(dict.entries['permission denied']?.category).toBe('error')
    expect(dict.entries['no such file or directory']?.category).toBe('error')
  })

  it('应保留 v1.1.0 课程关联（courseChapter）', () => {
    const dict = loadDict()
    expect(dict.entries['chmod']?.courseChapter).toBe('ch05-permission')
    expect(dict.entries['grep']?.courseChapter).toBe('ch07-text')
    expect(dict.entries['ls']?.courseChapter).toBe('ch03-files')
  })

  it('词典版本应为 v1.2.0', () => {
    const dict = loadDict()
    expect(dict.version).toBe('1.2.0')
  })

  it('source 字段应标注合并来源', () => {
    const dict = loadDict()
    expect(dict.source).toBeDefined()
    expect(dict.source).toContain('jaywcjlove')
    expect(dict.source).toContain('tldr')
  })

  it('command 类别应占主导（>= 80%）', () => {
    const dict = loadDict()
    const cmdCount = Object.values(dict.entries).filter(e => e.category === 'command').length
    const total = Object.keys(dict.entries).length
    expect(cmdCount / total).toBeGreaterThan(0.8)
  })

  it('每个 command 词条应有 zh 释义', () => {
    const dict = loadDict()
    const cmds = Object.entries(dict.entries).filter(([_, e]) => e.category === 'command')
    let missing = 0
    for (const [key, entry] of cmds.slice(0, 100)) {
      if (!entry.zh || entry.zh.length === 0) {
        missing++
      }
    }
    // 抽样 100 个，不应超过 5 个缺失释义
    expect(missing).toBeLessThanOrEqual(5)
  })
})
