/**
 * command-preflight 单元测试（v2.6 命令前置环境预检纯函数）
 *
 * 覆盖：命令名提取（管道/分隔符/包装命令/内建/env 前缀/重定向/不安全 token）、
 * 检查脚本拼装（防注入白名单）、缺失输出解析。
 */
import { describe, it, expect } from 'vitest'
import {
  extractCommandNames,
  buildMissingCheckScript,
  parseMissingOutput,
} from '../../src/shared/command-preflight'

describe('extractCommandNames 命令名提取', () => {
  it('单命令', () => {
    expect(extractCommandNames('df -h')).toEqual(['df'])
  })

  it('分号/&&/||/管道 分段各取首命令并去重', () => {
    expect(
      extractCommandNames('hostnamectl; df -h && free -m || uname -a | grep x; df -i'),
    ).toEqual(['hostnamectl', 'df', 'free', 'uname', 'grep'])
  })

  it('包装命令 sudo/nohup/timeout 跳过取真实命令', () => {
    expect(extractCommandNames('sudo systemctl status nginx --no-pager')).toEqual(['systemctl'])
    expect(extractCommandNames('timeout 5 journalctl -xe')).toEqual(['journalctl'])
    expect(extractCommandNames('nohup env FOO=1 mytool run')).toEqual(['mytool'])
  })

  it('shell 内建不检查', () => {
    expect(extractCommandNames('cd /tmp && echo ok; export A=1')).toEqual([])
  })

  it('环境变量赋值前缀跳过', () => {
    expect(extractCommandNames('LANG=C df -h')).toEqual(['df'])
  })

  it('重定向 token 跳过', () => {
    expect(extractCommandNames('cat /etc/os-release 2>/dev/null || cat /etc/redhat-release')).toEqual(['cat'])
  })

  it('不安全 token（含 $ 引号等）保守跳过', () => {
    expect(extractCommandNames('"$WEIRD_CMD" --x')).toEqual([])
  })

  it('空/纯空白输入返回空数组', () => {
    expect(extractCommandNames('')).toEqual([])
    expect(extractCommandNames('   ')).toEqual([])
  })
})

describe('buildMissingCheckScript 检查脚本', () => {
  it('拼装 POSIX 检查脚本且只含白名单命令名', () => {
    const s = buildMissingCheckScript(['df', 'free'])
    expect(s).toContain('for c in df free')
    expect(s).toContain('command -v "$c"')
  })

  it('非法命令名被过滤（防注入）', () => {
    const s = buildMissingCheckScript(['df', 'x; rm -rf /', '$(evil)'])
    expect(s).toContain('for c in df')
    expect(s).not.toContain('rm -rf')
    expect(s).not.toContain('$(evil)')
  })
})

describe('parseMissingOutput 缺失解析', () => {
  it('空输出 = 无缺失', () => {
    expect(parseMissingOutput('')).toEqual([])
    expect(parseMissingOutput('  \n')).toEqual([])
  })

  it('空格分隔的缺失命令列表', () => {
    expect(parseMissingOutput(' docker kubectl')).toEqual(['docker', 'kubectl'])
  })
})
